import 'dotenv/config';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {executablePath} from '../providers/bri-merchant/browser.js';
import {collectPortalCards,mpanMatches,luhnDigit} from '../providers/bri-merchant/portal.js';
const source={id:'SOURCE1',merchantName:'TEST MERCHANT',mpan:'936000020000000001',city:'TEST CITY',storeId:'70200001'};
const portalMpan=source.mpan+luhnDigit(source.mpan);
const day=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const fixture=`<h1>Daftar Transaksi</h1><p>TEST MERCHANT</p><p>MPAN : ${portalMpan}</p><input type="search" id="search-input"><div><img src="data:image/svg+xml,filter-new"></div><label class="radio-container">Semua<input type="radio" checked></label><label class="radio-container">7 Hari Terakhir<input type="radio" checked></label><button>Terapkan</button><p>Total Transaksi</p><p>2 Transaksi</p><div id="transaction-revamp-list"><div class="card-container" onclick="receipt(0)"><p>No. Ref REF1</p><p>Rp 1.001</p></div><div class="card-container" onclick="receipt(1)"><p>No. Ref REF2</p><p>Rp 1.002</p></div></div><div id="receipt-root"></div><script>
function receipt(index){const root=document.getElementById('receipt-root');root.innerHTML='<div><span class="cursor-pointer">Close</span><div class="w-full"><div><div id="dataStruk-nama">'+(index===0?'TEST MERCHANT TEST CITY ID':'TEST MERCHANT')+'</div></div><div id="dataStruk-reffNum">REF'+(index+1)+'</div><div id="dataStruk-mid">${portalMpan}</div><div id="dataStruk-tid">70200001</div><div id="dataStruk-date">${day}</div><div id="dataStruk-time">00:00:01</div><div id="dataStruk-amount">Rp 1.00'+(index+1)+'</div><div>'+(index===0?'Sales Success':'Sales Failed')+'</div></div></div>';root.querySelector('span').onclick=function(){root.innerHTML='';};} document.querySelector('button').onclick=()=>{};
</script>`;
const browser=await puppeteer.launch({executablePath:executablePath(),headless:true});
try{
  const page=await browser.newPage();await page.setContent(fixture);
  const range={from:new Date(day+'T00:00:00+07:00'),to:new Date(Date.now()+60000)};
  const rows=await collectPortalCards(page,source,range);assert.equal(rows.length,2);assert.equal(rows[0].providerStatus,'SUCCESS');assert.equal(rows[1].providerStatus,'UNCONFIRMED');assert.equal(rows[1].reference,'REF2');
  console.log('PASS actual card/receipt DOM, merchant name with/without city, exact amount, and success evidence');
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
  assert.equal((await collectPortalCards(page,source,range)).length,2);console.log('PASS collection does not depend on animation frames in a background browser');
  await page.evaluate(()=>{const label=Array.from(document.querySelectorAll('p')).find(p=>p.textContent==='Total Transaksi');const count=label!.nextElementSibling!;count.textContent='Memuat…';setTimeout(()=>{count.textContent='2 Transaksi';},250);});
  assert.equal((await collectPortalCards(page,source,range)).length,2);console.log('PASS delayed summary rendering is awaited before total verification');
  assert(mpanMatches(source.mpan,portalMpan));assert(!mpanMatches(source.mpan,portalMpan.slice(0,-1)+(portalMpan.endsWith('0')?'1':'0')));console.log('PASS MPAN suffix validation');
  await assert.rejects(()=>collectPortalCards(page,{...source,storeId:'WRONG'},range),/BRI_DETAIL_STORE_MISMATCH/);console.log('PASS store mismatch never confirms a transaction');
  await assert.rejects(()=>collectPortalCards(page,{...source,merchantName:'WRONG'},range),/MERCHANT_IDENTITY_MISMATCH/);console.log('PASS wrong merchant blocked');
  await assert.rejects(()=>collectPortalCards(page,source,{...range,from:new Date(Date.now()-8*86400000)}),/BRI_RANGE_EXCEEDED/);console.log('PASS catch-up range cannot silently truncate to seven days');
  console.log('7 portal adapter fixture checks passed.');
}finally{await browser.close();}
