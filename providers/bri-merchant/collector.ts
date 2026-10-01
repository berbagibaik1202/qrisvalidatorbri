import type {BriBrowserSession} from './browser.js';
import {normalizeRow,type RowMapping} from './normalizer.js';
import type {DateRange,ProviderTransaction} from '../../packages/provider-core/src/index.js';
export interface CollectorMapping extends RowMapping {rowSelector:string;cellSelector:string;columns:string[];emptySelector:string;allPagesInRangeVerified:boolean;paginationMode:'none'|'next';firstPageSelector?:string;nextPageSelector?:string;fromDateSelector:string;toDateSelector:string;filterSubmitSelector:string;maxPages?:number}
export function collectorMapping():CollectorMapping|null {
  const raw=process.env.BRI_COLLECTOR_MAPPING;if(!raw)return null;const mapping=JSON.parse(raw) as CollectorMapping;
  if(!mapping.rowSelector||!mapping.cellSelector||!mapping.emptySelector||!Array.isArray(mapping.columns)||!mapping.columns.length||!Array.isArray(mapping.successStatuses)||!mapping.successStatuses.length||!mapping.expectedMerchantId||!mapping.merchantId||!['iso','id'].includes(mapping.timestampFormat)||mapping.timezoneOffset!=='+07:00'||mapping.allPagesInRangeVerified!==true)throw new Error('BRI_MAPPING_INVALID');
  if(!mapping.fromDateSelector||!mapping.toDateSelector||!mapping.filterSubmitSelector||!['none','next'].includes(mapping.paginationMode)||(mapping.paginationMode==='next'&&(!mapping.firstPageSelector||!mapping.nextPageSelector)))throw new Error('BRI_MAPPING_INVALID');
  for(const key of [mapping.reference,mapping.amount,mapping.timestamp,mapping.status,mapping.merchantId])if(!mapping.columns.includes(key))throw new Error('BRI_MAPPING_INVALID');return mapping;
}
export async function collect(session:BriBrowserSession,sourceId:string,range:DateRange):Promise<ProviderTransaction[]> {
  const mapping=collectorMapping();if(!mapping)throw new Error('BRI_MAPPING_REQUIRED');const health=await session.check();if(health.status!=='CONNECTED'||!session.page)throw new Error('BRI_LOGIN_REQUIRED');
  const page=session.page;
  const day=(value:Date)=>new Date(value.getTime()+7*3600000).toISOString().slice(0,10);
  for(const [selector,value] of [[mapping.fromDateSelector,day(range.from)],[mapping.toDateSelector,day(range.to)]])await page.$eval(selector,(element,text)=>{
    if(!(element instanceof HTMLInputElement)||element.type!=='date')throw new Error('BRI_DATE_FILTER_UNVERIFIED');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(element,text);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  await page.click(mapping.filterSubmitSelector);
  // Filtering must reach a settled DOM before reading; actual portal fixture must verify these selectors.
  await page.waitForNetworkIdle({idleTime:700,timeout:15000});
  if(mapping.paginationMode==='next'){
    const first=await page.$(mapping.firstPageSelector!);if(!first)throw new Error('BRI_PAGINATION_CHANGED');
    const disabled=await first.evaluate(el=>el.hasAttribute('disabled')||el.getAttribute('aria-disabled')==='true');
    if(!disabled){await first.click();await page.waitForNetworkIdle({idleTime:700,timeout:15000});}
  }
  const result:ProviderTransaction[]=[];const seen=new Set<string>();const maxPages=Math.min(500,Math.max(1,mapping.maxPages||100));
  for(let index=0;index<maxPages;index++){
    await page.waitForFunction((rows,empty)=>{
      if(document.querySelector(rows))return true;const marker=document.querySelector(empty);
      return !!marker&&marker.getBoundingClientRect().width>0&&marker.getBoundingClientRect().height>0&&getComputedStyle(marker).visibility!=='hidden';
    },{timeout:15000},mapping.rowSelector,mapping.emptySelector);
    const rows=await page.$$eval(mapping.rowSelector,(elements,config)=>elements.map(el=>Array.from(el.querySelectorAll(config.cellSelector)).map(cell=>cell.textContent?.trim()||'')),{cellSelector:mapping.cellSelector});
    if(!rows.length&&!await page.$eval(mapping.emptySelector,el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden').catch(()=>false))throw new Error('BRI_TABLE_UNRECOGNIZED');
    const fingerprint=JSON.stringify(rows);if(seen.has(fingerprint))throw new Error('BRI_PAGINATION_STALLED');seen.add(fingerprint);
    for(const values of rows){if(values.length!==mapping.columns.length)throw new Error('BRI_TABLE_CHANGED');result.push(normalizeRow(Object.fromEntries(mapping.columns.map((key,column)=>[key,values[column]])),mapping,sourceId));}
    if(mapping.paginationMode==='none')break;
    const next=await page.$(mapping.nextPageSelector!);if(!next)throw new Error('BRI_PAGINATION_CHANGED');
    if(await next.evaluate(el=>el.hasAttribute('disabled')||el.getAttribute('aria-disabled')==='true'))break;
    if(index===maxPages-1)throw new Error('BRI_PAGE_LIMIT');
    await next.click();await page.waitForNetworkIdle({idleTime:700,timeout:15000});
  }
  return result.filter(row=>row.transactionAt>=range.from&&row.transactionAt<=range.to);
}
