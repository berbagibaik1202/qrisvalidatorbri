import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {BriBrowserSession,executablePath} from '../providers/bri-merchant/browser.js';
import {BRI_LOGIN_URL,BRI_TRANSACTIONS_URL} from '../providers/bri-merchant/config.js';
import {collect} from '../providers/bri-merchant/collector.js';
const browser=await puppeteer.launch({executablePath:executablePath(),headless:true,userDataDir:mkdtempSync(join(tmpdir(),'rizpay-bri-fixture-'))});
const page=await browser.newPage();await page.setRequestInterception(true);let mode='login';
const markup=(state:string)=>state==='blocked'?'<iframe id="main-iframe"></iframe>':state==='login'?'<input type="password">':`<h1>Transaksi Merchant</h1><a href="/transaksi">Transaksi</a><button>Keluar</button><input id="from" type="date"><input id="to" type="date"><button id="filter">Filter</button><table><tbody><tr><td>223074911478</td><td>Rp 50.037</td><td>01/10/2026 13:10:03</td><td>Sales Success</td><td>MERCHANT-1</td></tr><tr><td>223074911479</td><td>Rp 50.038</td><td>01/10/2026 13:10:04</td><td>Pencairan Diproses</td><td>MERCHANT-1</td></tr></tbody></table><div class="empty" hidden></div>`;
page.on('request',request=>{if([BRI_LOGIN_URL,BRI_TRANSACTIONS_URL].includes(request.url()))void request.respond({status:mode==='blocked'?403:200,contentType:'text/html',body:markup(mode)});else void request.abort();});
const session=new BriBrowserSession();session.browser=browser;session.page=page;
try{
  assert.equal((await session.check()).status,'LOGIN_REQUIRED');console.log('PASS login form cannot be considered CONNECTED');
  mode='blocked';assert.equal((await session.check()).status,'ERROR');console.log('PASS BRI 403/challenge is surfaced as ERROR');
  mode='unknown';page.removeAllListeners('request');page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<h1>Unknown page</h1>'}));assert.equal((await session.check()).status,'ERROR');console.log('PASS protected URL alone does not establish a session');
  page.removeAllListeners('request');mode='connected';page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:markup(mode)}));assert.equal((await session.check()).status,'CONNECTED');console.log('PASS authenticated fixture session recognized');
  const originalLaunch=puppeteer.launch,originalVisibility=process.env.BRI_BROWSER_VISIBLE;
  process.env.BRI_BROWSER_VISIBLE='true';puppeteer.launch=async()=>{throw new Error('Restore must reuse authenticated browser');};
  try{assert.equal((await session.restore()).status,'CONNECTED');assert.equal(session.browser,browser);assert.equal(browser.connected,true);console.log('PASS restore preserves connected browser across visibility changes');}
  finally{puppeteer.launch=originalLaunch;if(originalVisibility===undefined)delete process.env.BRI_BROWSER_VISIBLE;else process.env.BRI_BROWSER_VISIBLE=originalVisibility;}
  process.env.BRI_COLLECTOR_MAPPING=JSON.stringify({rowSelector:'tbody tr',cellSelector:'td',columns:['reference','amount','time','status','merchant'],emptySelector:'.empty',reference:'reference',amount:'amount',timestamp:'time',status:'status',merchantId:'merchant',expectedMerchantId:'MERCHANT-1',successStatuses:['Sales Success'],timestampFormat:'id',timezoneOffset:'+07:00',allPagesInRangeVerified:true,paginationMode:'none',fromDateSelector:'#from',toDateSelector:'#to',filterSubmitSelector:'#filter'});
  const rows=await collect(session,'SOURCE1',{from:new Date('2026-10-01T00:00:00+07:00'),to:new Date('2026-10-02T00:00:00+07:00')});assert.equal(rows.length,2);assert.equal(rows[0].amount,50037);assert.equal(rows[0].providerStatus,'SUCCESS');assert.equal(rows[1].providerStatus,'UNCONFIRMED');console.log('PASS verified DOM rows normalized; settlement status not auto-success');
  const values=await page.$$eval('input',els=>els.map(e=>e.value));assert.deepEqual(values,['2026-10-01','2026-10-02']);console.log('PASS catch-up date filters set using WIB');
  page.removeAllListeners('request');
  const paginated=markup('connected')+`<button id="first" disabled>First</button><button id="next">Next</button><script>document.querySelector('#next').onclick=()=>{document.querySelector('tbody').innerHTML='<tr><td>223074911480</td><td>Rp 50.039</td><td>01/10/2026 13:10:05</td><td>Sales Success</td><td>MERCHANT-1</td></tr>';document.querySelector('#next').disabled=true;}</script>`;
  page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:paginated}));
  const paginationMapping={...JSON.parse(process.env.BRI_COLLECTOR_MAPPING!),paginationMode:'next',firstPageSelector:'#first',nextPageSelector:'#next'};
  process.env.BRI_COLLECTOR_MAPPING=JSON.stringify(paginationMapping);
  const pages=await collect(session,'SOURCE1',{from:new Date('2026-10-01T00:00:00+07:00'),to:new Date('2026-10-02T00:00:00+07:00')});assert.equal(pages.length,3);assert.equal(pages[2].reference,'223074911480');console.log('PASS all pagination rows collected');
  process.env.BRI_COLLECTOR_MAPPING=JSON.stringify({...paginationMapping,maxPages:1});
  await assert.rejects(()=>collect(session,'SOURCE1',{from:new Date('2026-10-01T00:00:00+07:00'),to:new Date('2026-10-02T00:00:00+07:00')}),/BRI_PAGE_LIMIT/);console.log('PASS pagination truncation rejects the entire collection');
  console.log('9 BRI browser fixture checks passed; no requests were sent to live BRI.');
}finally{await session.close();}
