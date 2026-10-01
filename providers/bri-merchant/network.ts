import type {Page,HTTPRequest,HTTPResponse} from 'puppeteer-core';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {BriBrowserSession} from './browser.js';
import {BRI_TRANSACTIONS_URL} from './config.js';
import {mpanMatches} from './portal.js';
import {parseTimestamp} from './normalizer.js';
import type {ProviderSource,ProviderTransaction,DateRange} from '../../packages/provider-core/src/index.js';
const origin=new URL(BRI_TRANSACTIONS_URL).origin;
const paths={list:'/api/reporting/v3/inquiryListTransaction',summary:'/api/reporting/v1/inquiryListSummaryTransactionTID',detail:'/api/reporting/v1/inquiryDetailTransaction',user:'/api/wong/v1/inquiryUser'};
const text=z.string().min(1);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time=z.string().regex(/^\d{2}:\d{2}:\d{2}$/);
const rowSchema=z.object({date_trx:date,time_trx:time,mid:text,tid:text,amount_trx:z.number().int().positive().max(1000000000),reff_num:text});
const groupsSchema=z.array(z.object({date:text,totalDataTransaction:z.number().int().nonnegative(),transactions:z.array(rowSchema)}));
const summarySchema=z.array(z.object({tid:text,tid_name:text,nominal:z.number().int().nonnegative(),frekuensi:z.number().int().nonnegative()}));
const detailSchema=z.object({date_trx:date,time_trx:time,mid_mpan:text,tid_storeid:text,nama_merchant:text,app_code_reff_num:text,amount_trx:z.number().int().positive(),rc:z.string(),status_trx:z.string(),status_desc_trx:z.string(),type_trx:z.string()});
const userSchema=z.object({list_mid:z.array(text),list_store:z.array(z.object({store_id:text,store_name:text,type:text}))});
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new Error('BRI_NETWORK_SCHEMA_CHANGED');return result.data;}
function bodyData(value:unknown){const result=z.object({responseCode:z.string(),responseData:z.unknown()}).safeParse(value);if(!result.success)throw new Error('BRI_NETWORK_SCHEMA_CHANGED');if(result.data.responseCode!=='00')throw new Error('BRI_NETWORK_REJECTED');return result.data.responseData;}
export function normalizeNetworkDetail(raw:unknown,row:z.infer<typeof rowSchema>,source:ProviderSource):ProviderTransaction{
  const detail=parse(detailSchema,raw);
  const merchant=detail.nama_merchant.trim().replace(/\s+/g,' '),expected=[source.merchantName,source.city,'ID'].filter(Boolean).join(' ');
  if(!source.mpan||!source.storeId||!mpanMatches(source.mpan,row.mid)||detail.mid_mpan!==row.mid||row.tid!==source.storeId||detail.tid_storeid!==source.storeId)throw new Error('MERCHANT_IDENTITY_MISMATCH');
  if(merchant!==source.merchantName&&merchant!==expected)throw new Error('BRI_DETAIL_MERCHANT_MISMATCH');
  if(detail.app_code_reff_num!==row.reff_num)throw new Error('BRI_DETAIL_REFERENCE_MISMATCH');
  if(detail.amount_trx!==row.amount_trx)throw new Error('BRI_DETAIL_AMOUNT_MISMATCH');
  if(detail.date_trx!==row.date_trx||detail.time_trx!==row.time_trx)throw new Error('BRI_DETAIL_TIME_MISMATCH');
  const transactionAt=parseTimestamp(detail.date_trx+'T'+detail.time_trx+'+07:00',{timestampFormat:'iso',timezoneOffset:'+07:00'});
  const success=detail.rc==='00'&&detail.status_trx==='sukses'&&detail.status_desc_trx==='Sales Success'&&detail.type_trx==='Payment QR';
  return {sourceId:source.id,provider:'BRI_MERCHANT',reference:row.reff_num,amount:row.amount_trx,transactionAt,providerStatus:success?'SUCCESS':'UNCONFIRMED'};
}
export class BriNetworkCollector {
  private page?:Page;private headers:Record<string,string>={};private identity?:z.infer<typeof userSchema>;
  private capturedBinding?:{mpan:string;storeId:string};private jobs=new Set<Promise<void>>();
  private cache=new Map<string,{fingerprint:string;transaction:ProviderTransaction;until:number}>();
  constructor(private readonly session:BriBrowserSession){}
  private captureRequest=(request:HTTPRequest)=>{
    const url=new URL(request.url());if(url.origin!==origin||!Object.values(paths).includes(url.pathname))return;
    const headers=request.headers();for(const name of ['authorization','x-device-id','x-device','content-type'])if(headers[name])this.headers[name]=headers[name];
    if(url.pathname===paths.list){try{const body=JSON.parse(request.postData()||'{}');if(typeof body.midOrMpan==='string'&&typeof body.tidOrStoreId==='string')this.capturedBinding={mpan:body.midOrMpan,storeId:body.tidOrStoreId};}catch{}}
  };
  private captureResponse=(response:HTTPResponse)=>{
    const url=new URL(response.url());if(url.origin!==origin||url.pathname!==paths.user||response.status()!==200)return;
    const job=(async()=>{try{this.identity=parse(userSchema,bodyData(await response.json()));}catch{/* Explicit identity() requests surface failures. */}})();
    this.jobs.add(job);void job.finally(()=>this.jobs.delete(job));
  };
  private async prepare(){
    if(!this.session.browser?.connected||!this.session.page||this.session.page.isClosed()){this.session.setLoginRequired();throw new Error('BRI_LOGIN_REQUIRED');}
    const page=this.session.page;
    if(this.page!==page){this.page?.off('request',this.captureRequest);this.page?.off('response',this.captureResponse);this.page=page;this.headers={};this.identity=undefined;this.capturedBinding=undefined;page.on('request',this.captureRequest);page.on('response',this.captureResponse);}
    if(!this.headers.authorization){
      await page.goto(BRI_TRANSACTIONS_URL,{waitUntil:'networkidle2',timeout:30000});
      await Promise.all([...this.jobs]);
      if(!this.headers.authorization||new URL(page.url()).origin!==origin||new URL(page.url()).pathname.startsWith('/auth')){this.session.setLoginRequired();throw new Error('BRI_LOGIN_REQUIRED');}
    }
  }
  private async request(path:string,body:unknown):Promise<unknown>{
    await this.prepare();
    // Cookies stay in the browser; observed bearer/device headers stay only in memory.
    const result=await this.page!.evaluate(async(url,headers,payload)=>{
      if(location.origin!==new URL(url).origin)return {status:0,body:null};
      try{const response=await fetch(url,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});return {status:response.status,body:await response.json()};}
      catch{return {status:0,body:null};}
    },origin+path,{...this.headers,'content-type':'application/json','x-bm-request-id':randomUUID()},body);
    if([401,403].includes(result.status)){this.headers={};this.identity=undefined;this.session.setLoginRequired();throw new Error('BRI_LOGIN_REQUIRED');}
    if(result.status!==200)throw new Error('BRI_NETWORK_HTTP_ERROR');
    return bodyData(result.body);
  }
  async merchantIdentity(){
    await this.prepare();
    this.identity=parse(userSchema,await this.request(paths.user,{}));
    const binding=this.capturedBinding;
    if(!binding||!this.identity.list_mid.includes(binding.mpan))throw new Error('SOURCE_IDENTITY_MISMATCH');
    const stores=this.identity.list_store.filter(store=>store.type==='qris'&&store.store_id===binding.mpan);
    if(stores.length!==1)throw new Error('SOURCE_IDENTITY_MISMATCH');
    this.session.setNetworkConnected();return {...binding,merchantName:stores[0].store_name};
  }
  async collect(source:ProviderSource,range:DateRange):Promise<ProviderTransaction[]>{
    if(!source.mpan||!source.storeId)throw new Error('SOURCE_IDENTITY_MISMATCH');
    if(!Number.isFinite(range.from.getTime())||!Number.isFinite(range.to.getTime())||range.from>range.to)throw new Error('BRI_RANGE_INVALID');
    const identity=await this.merchantIdentity();
    if(!mpanMatches(source.mpan,identity.mpan)||source.storeId!==identity.storeId||source.merchantName!==identity.merchantName)throw new Error('MERCHANT_IDENTITY_MISMATCH');
    const day=(at:Date)=>new Date(at.getTime()+7*3600000).toISOString().slice(0,10),startDate=day(range.from),endDate=day(range.to);
    // Retain the verified seven-calendar-day bound until longer ranges are verified.
    if(new Date(endDate).getTime()-new Date(startDate).getTime()>6*86400000)throw new Error('BRI_RANGE_EXCEEDED');
    const summary=parse(summarySchema,await this.request(paths.summary,{mid:identity.mpan,tid:[source.storeId],start_date:startDate,end_date:endDate}));
    if(summary.some(item=>item.tid!==source.storeId||item.tid_name!==source.merchantName))throw new Error('MERCHANT_IDENTITY_MISMATCH');
    const total=summary.reduce((sum,item)=>sum+item.frekuensi,0),nominal=summary.reduce((sum,item)=>sum+item.nominal,0);
    if(total>5000)throw new Error('BRI_PAGE_LIMIT');
    const rows:z.infer<typeof rowSchema>[]=[];const seen=new Set<string>();
    for(let page=1;page<=50;page++){
      const groups:z.infer<typeof groupsSchema>=parse(groupsSchema,await this.request(paths.list,{midOrMpan:identity.mpan,tidOrStoreId:source.storeId,page,limit:100,startDate,endDate,filter:{metodePembayaran:[],status:''}}));
      const batch:z.infer<typeof rowSchema>[]=groups.flatMap(group=>group.transactions);
      for(const row of batch){if(seen.has(row.reff_num))throw new Error('BRI_PAGINATION_STALLED');if(!mpanMatches(source.mpan,row.mid)||row.tid!==source.storeId)throw new Error('MERCHANT_IDENTITY_MISMATCH');if(row.date_trx<startDate||row.date_trx>endDate)throw new Error('BRI_NETWORK_RANGE_MISMATCH');seen.add(row.reff_num);rows.push(row);}
      if(rows.length===total)break;
      if(rows.length>total||!batch.length)throw new Error('BRI_TOTAL_UNVERIFIED');
      if(page===50)throw new Error('BRI_PAGE_LIMIT');
    }
    if(rows.length!==total||rows.reduce((sum,row)=>sum+row.amount_trx,0)!==nominal)throw new Error('BRI_TOTAL_UNVERIFIED');
    const result:ProviderTransaction[]=[];
    for(const row of rows){
      const at=parseTimestamp(row.date_trx+'T'+row.time_trx+'+07:00',{timestampFormat:'iso',timezoneOffset:'+07:00'});
      if(at<range.from||at>range.to)continue;
      const key=source.id+':'+row.reff_num,fingerprint=JSON.stringify([row,source.mpan,source.storeId,source.merchantName,source.city]);
      const cached=this.cache.get(key);
      let transaction:ProviderTransaction;
      if(cached&&cached.fingerprint===fingerprint&&cached.until>Date.now())transaction=cached.transaction;
      else{transaction=normalizeNetworkDetail(await this.request(paths.detail,{mid:row.mid,tid:row.tid,date_trx:row.date_trx,time_trx:row.time_trx,reff_num:row.reff_num}),row,source);if(transaction.providerStatus==='SUCCESS')this.cache.set(key,{fingerprint,transaction,until:Date.now()+3600000});}
      result.push(transaction);
    }
    while(this.cache.size>5000)this.cache.delete(this.cache.keys().next().value!);
    this.session.setNetworkConnected();return result;
  }
}
