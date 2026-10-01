import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {BriBrowserSession,executablePath} from '../providers/bri-merchant/browser.js';
import {BRI_LOGIN_URL,BRI_TRANSACTIONS_URL} from '../providers/bri-merchant/config.js';
process.env.BRI_AUTO_LOGIN_ENABLED='true';process.env.BRI_USERNAME='081234567890';process.env.BRI_PASSWORD='fixture-only';
delete process.env.BRI_AUTHENTICATED_SELECTOR;
const browser=await puppeteer.launch({executablePath:executablePath(),headless:true});
const page=await browser.newPage();await page.setRequestInterception(true);
let authenticated=false,submissions=0,hostile=false;
const login=()=>`${hostile?'<form action="https://example.com/steal">':'<div>'}<input id="username" type="tel"><input id="confirm_password" type="password"><button type="submit">Masuk</button>${hostile?'</form>':'</div>'}<script>document.querySelector('button').onclick=e=>{e.preventDefault();location.href='/transaksi?submitted=1'}</script>`;
page.on('request',r=>{
  const url=new URL(r.url());
  if(url.origin!==new URL(BRI_LOGIN_URL).origin){void r.abort();return;}
  if(url.searchParams.has('submitted')){submissions++;authenticated=true;}
  void r.respond({status:200,contentType:'text/html',body:authenticated?'<h1>Transaksi Merchant</h1><a href="/transaksi">Transaksi</a><button>Keluar</button>':login()});
});
const session=new BriBrowserSession();session.browser=browser;session.page=page;
try{
  assert.equal((await session.restore()).status,'CONNECTED');assert.equal(submissions,1);
  assert.equal((await session.restore(true)).status,'CONNECTED');assert.equal(submissions,1);
  console.log('PASS automatic login and authenticated session reuse');
  authenticated=false;hostile=true;
  assert.equal((await session.restore()).status,'LOGIN_REQUIRED');assert.equal(submissions,1);
  assert.equal((await session.restore(true)).status,'LOGIN_REQUIRED');assert.equal(submissions,1);
  assert.equal(await page.$eval('#username',e=>(e as HTMLInputElement).value),'');
  console.log('PASS foreign form action rejected before credential entry; failed attempt not repeated');
  process.env.BRI_AUTO_LOGIN_ENABLED='false';hostile=false;
  assert.equal((await session.restore()).status,'LOGIN_REQUIRED');assert.equal(submissions,1);
  console.log('PASS disabled automatic login preserves manual login');
}finally{await session.close();}
