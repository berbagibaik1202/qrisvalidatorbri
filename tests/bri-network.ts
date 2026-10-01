import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {BriBrowserSession,executablePath} from '../providers/bri-merchant/browser.js';
import {BriNetworkCollector,normalizeNetworkDetail} from '../providers/bri-merchant/network.js';
import {luhnDigit} from '../providers/bri-merchant/portal.js';
import {BRI_TRANSACTIONS_URL} from '../providers/bri-merchant/config.js';
const source={id:'SOURCE',merchantName:'TEST MERCHANT',city:'TEST CITY',mpan:'936000020000000001',storeId:'70200001'};
const mpan=source.mpan+luhnDigit(source.mpan),day=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const rows=Array.from({length:105},(_,index)=>({date_trx:day,time_trx:'00:00:01',mid:mpan,tid:source.storeId,amount_trx:1000+index,reff_num:'REF-'+index,trx_status:'Pencairan Diproses',no_kartu_trx:'DO_NOT_COLLECT'}));
const detail=(row:typeof rows[number])=>({date_trx:row.date_trx,time_trx:row.time_trx,mid_mpan:mpan,tid_storeid:source.storeId,nama_merchant:'TEST MERCHANT   TEST CITY ID',app_code_reff_num:row.reff_num,amount_trx:row.amount_trx,rc:'00',status_trx:'sukses',status_desc_trx:'Sales Success',type_trx:'Payment QR',no_kartu_cpan:'DO_NOT_COLLECT',no_rek_merchant:'DO_NOT_COLLECT'});
const browser=await puppeteer.launch({executablePath:executablePath(),headless:true});const page=await browser.newPage();await page.setRequestInterception(true);
let scenario='normal',detailRequests=0,navigations=0;
const pages:number[]=[];
page.on('request',request=>{
  const url=new URL(request.url());
  if(request.isNavigationRequest()){navigations++;void request.respond({status:200,contentType:'text/html',body:`<script>const options={method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:'{}'};fetch('/api/wong/v1/inquiryUser',options);fetch('/api/reporting/v3/inquiryListTransaction',{...options,body:JSON.stringify({midOrMpan:'${mpan}',tidOrStoreId:'${source.storeId}',page:1,limit:100})});</script>`});return;}
  if(url.origin!==new URL(BRI_TRANSACTIONS_URL).origin){void request.abort();return;}
  const body=JSON.parse(request.postData()||'{}');let data:unknown;
  if(url.pathname.endsWith('inquiryUser'))data={list_mid:[mpan],list_store:[{store_id:mpan,store_name:source.merchantName,type:'qris'}],token:'DO_NOT_COLLECT'};
  else if(url.pathname.endsWith('inquiryListSummaryTransactionTID'))data=[{tid:source.storeId,tid_name:source.merchantName,frekuensi:scenario==='total'?106:105,nominal:rows.reduce((sum,row)=>sum+row.amount_trx,0)}];
  else if(url.pathname.endsWith('inquiryListTransaction')){pages.push(body.page);const batch=scenario==='repeated'?rows.slice(0,100):rows.slice((body.page-1)*100,body.page*100);data=[{date:day,totalDataTransaction:105,transactions:batch}];}
  else if(url.pathname.endsWith('inquiryDetailTransaction')){detailRequests++;data=detail(rows.find(row=>row.reff_num===body.reff_num)!);}
  else{void request.abort();return;}
  void request.respond({status:scenario==='expired'?401:200,contentType:'application/json',body:JSON.stringify({responseCode:'00',responseData:data})});
});
const session=new BriBrowserSession();session.browser=browser;session.page=page;const collector=new BriNetworkCollector(session);
const range={from:new Date(day+'T00:00:00+07:00'),to:new Date(day+'T23:59:59+07:00')};
try{
  const first=await collector.collect(source,range);assert.equal(first.length,105);assert.equal(first[0].providerStatus,'SUCCESS');assert.equal(detailRequests,105);assert(pages.includes(2));assert.equal(JSON.stringify(first).includes('DO_NOT_COLLECT'),false);
  console.log('PASS network pagination, detail success evidence and sensitive-field exclusion');
  const before=navigations;await collector.collect(source,range);assert.equal(navigations,before);assert.equal(detailRequests,105);
  console.log('PASS repeated polling performs no navigation or repeated successful detail requests');
  assert.equal(normalizeNetworkDetail({...detail(rows[0]),status_desc_trx:'Pencairan Berhasil'},rows[0],source).providerStatus,'UNCONFIRMED');
  assert.equal(normalizeNetworkDetail({...detail(rows[0]),rc:'05'},rows[0],source).providerStatus,'UNCONFIRMED');
  console.log('PASS settlement label and failed response code cannot confirm payment');
  for(const patch of [{amount_trx:999},{app_code_reff_num:'WRONG'},{mid_mpan:'WRONG'},{tid_storeid:'WRONG'},{nama_merchant:'WRONG'},{time_trx:'00:00:02'}])assert.throws(()=>normalizeNetworkDetail({...detail(rows[0]),...patch},rows[0],source),/MISMATCH/);
  console.log('PASS amount/reference/merchant/MPAN/store/time mismatches rejected');
  scenario='total';await assert.rejects(()=>collector.collect(source,range),/BRI_TOTAL_UNVERIFIED/);
  scenario='repeated';await assert.rejects(()=>collector.collect(source,range),/BRI_PAGINATION_STALLED/);
  console.log('PASS inconsistent total and repeated pages fail without a partial batch');
  scenario='expired';await assert.rejects(()=>collector.collect(source,range),/BRI_LOGIN_REQUIRED/);assert.equal(session.snapshot().status,'LOGIN_REQUIRED');
  console.log('PASS expired network session requires reauthentication');
  console.log('6 network collector checks passed; no live BRI requests.');
}finally{await session.close();}
