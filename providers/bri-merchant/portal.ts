import type {Page} from 'puppeteer-core';
import type {DateRange,ProviderSource,ProviderTransaction} from '../../packages/provider-core/src/index.js';
import {parseRupiah,parseTimestamp} from './normalizer.js';
export const CARD_LIST='#transaction-revamp-list';
export function luhnDigit(stem:string){let sum=0;for(const [index,digit] of [...stem].reverse().entries()){let value=Number(digit)*(index%2===0?2:1);if(value>9)value-=9;sum+=value;}return String((10-sum%10)%10);}
export function mpanMatches(qr:string,portal:string){return /^\d{18,19}$/.test(qr)&&/^\d{18,19}$/.test(portal)&&(qr===portal||(qr.length===18&&portal===qr+luhnDigit(qr)));}
export async function portalIdentity(page:Page){return page.evaluate(()=>{
  const label=Array.from(document.querySelectorAll('p')).find(e=>/^MPAN\s*:\s*\d{18,19}$/.test(e.textContent?.trim()||''));
  if(!label)return null;return {mpan:label.textContent!.replace(/\D/g,''),merchantName:label.previousElementSibling?.textContent?.trim()||''};
});}
async function clickRadio(page:Page,text:string){
  await page.evaluate(label=>{const element=Array.from(document.querySelectorAll('label.radio-container')).find(el=>el.textContent?.trim()===label);if(!(element instanceof HTMLElement))throw new Error('BRI_FILTER_CHANGED');element.click();},text);
  await page.waitForFunction(label=>{const element=Array.from(document.querySelectorAll('label.radio-container')).find(el=>el.textContent?.trim()===label);return (element?.querySelector('input') as HTMLInputElement|null)?.checked===true;},{timeout:5000,polling:100},text);
}
export async function collectPortalCards(page:Page,source:ProviderSource,range:DateRange):Promise<ProviderTransaction[]>{
  const identity=await portalIdentity(page);
  if(!identity||!source.mpan||!source.storeId||!mpanMatches(source.mpan,identity.mpan)||identity.merchantName!==source.merchantName)throw new Error('MERCHANT_IDENTITY_MISMATCH');
  const currentDay=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const earliest=new Date(new Date(currentDay+'T00:00:00+07:00').getTime()-6*86400000);
  if(range.from<earliest)throw new Error('BRI_RANGE_EXCEEDED');
  await page.$eval('img[src*="filter-new"]',element=>(element.parentElement as HTMLElement).click());
  await page.waitForSelector('label.radio-container',{visible:true});await clickRadio(page,'Semua');await clickRadio(page,'7 Hari Terakhir');
  const apply=await page.evaluateHandle(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.trim()==='Terapkan'));
  const button=apply.asElement();if(!button)throw new Error('BRI_FILTER_CHANGED');
  const live=page.url().startsWith('https://brimerchant.bri.co.id/transaksi');
  if(!await button.evaluate(el=>(el as Element).hasAttribute('disabled'))){
    const responses=live?Promise.all(['/api/reporting/v3/inquiryListTransaction','/api/reporting/v1/inquiryListSummaryTransactionTID'].map(path=>page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.status()===200,{timeout:15000}).then(response=>response.json()))):Promise.resolve([]);
    await button.evaluate(el=>(el as HTMLElement).click());await responses;
    // Readiness is verified below from the summary DOM. Animation frames can stop
    // when Chrome is minimized/backgrounded, leaving a CDP evaluate pending.
  }
  else await page.$eval('img[src*="filter-new"]',element=>(element.parentElement as HTMLElement).click());await apply.dispose();
  await page.waitForSelector(CARD_LIST);
  // Vue can render the list before the summary response has populated its count.
  await page.waitForFunction(()=>{
    const label=Array.from(document.querySelectorAll('p')).find(e=>e.textContent?.trim()==='Total Transaksi');
    return /^\d+\s+Transaksi$/.test(label?.nextElementSibling?.textContent?.trim()||'');
  },{timeout:10000,polling:100}).catch(()=>{throw new Error('BRI_TOTAL_UNVERIFIED');});
  const total=await page.evaluate(()=>{
    const label=Array.from(document.querySelectorAll('p')).find(e=>e.textContent?.trim()==='Total Transaksi');
    const text=label?.nextElementSibling?.textContent?.trim()||'';const match=text.match(/^(\d+)\s+Transaksi$/);return match?Number(match[1]):null;
  });
  if(total===null||total>500)throw new Error('BRI_TOTAL_UNVERIFIED');
  let count=0;
  for(let attempt=0;attempt<50;attempt++){
    count=await page.$$eval(CARD_LIST+' .card-container',cards=>cards.length);if(count===total)break;if(count>total)throw new Error('BRI_TOTAL_UNVERIFIED');
    const response=live?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reporting/v3/inquiryListTransaction'&&response.status()===200,{timeout:15000}).then(response=>response.json()):Promise.resolve(null);
    await page.$eval(CARD_LIST,el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});await response;
    await page.waitForFunction(before=>document.querySelectorAll('#transaction-revamp-list .card-container').length>before,{timeout:10000,polling:100},count);
    const nextCount=await page.$$eval(CARD_LIST+' .card-container',cards=>cards.length);if(nextCount===count)throw new Error('BRI_PAGINATION_STALLED');
  }
  if(count!==total)throw new Error('BRI_PAGE_LIMIT');
  const cards=await page.$$eval(CARD_LIST+' .card-container',elements=>elements.map(card=>{
    const paragraphs=Array.from(card.querySelectorAll('p'));const reference=paragraphs.find(e=>/^No\. Ref\s+/.test(e.textContent?.trim()||''))?.textContent?.trim().replace(/^No\. Ref\s+/,'')||'';
    const amount=paragraphs.find(e=>/^Rp[\s\u00a0]/.test(e.textContent?.trim()||''))?.textContent?.trim()||'';
    return {reference,amount};
  }));
  if(new Set(cards.map(c=>c.reference)).size!==total)throw new Error('BRI_DUPLICATE_CARD');
  const result:ProviderTransaction[]=[];
  for(const card of cards){
    const selected=await page.evaluateHandle(reference=>Array.from(document.querySelectorAll('#transaction-revamp-list .card-container')).find(el=>Array.from(el.querySelectorAll('p')).some(p=>p.textContent?.trim()==='No. Ref '+reference)),card.reference);
    const element=selected.asElement();if(!element)throw new Error('BRI_CARD_CHANGED');await element.evaluate(el=>(el as HTMLElement).click());await selected.dispose();
    await page.waitForFunction(reference=>{
      const field=document.querySelector('#dataStruk-reffNum');return field?.textContent?.trim()===reference&&field.getBoundingClientRect().width>0;
    },{timeout:15000,polling:100},card.reference);
    const detail=await page.evaluate(()=>{
      const fields:Record<string,string>={};for(const id of ['nama','reffNum','mid','tid','date','time','amount'])fields[id]=document.getElementById('dataStruk-'+id)?.textContent?.trim()||'';
      const receipt=document.querySelector('#dataStruk-nama')?.parentElement?.parentElement;
      const success=Array.from(receipt?.querySelectorAll('div')||[]).some(e=>e.childElementCount===0&&e.textContent?.trim()==='Sales Success');
      return {reference:fields.reffNum,mpan:fields.mid,storeId:fields.tid,merchant:fields.nama.replace(/\s+/g,' '),date:fields.date,time:fields.time,amount:fields.amount,success};
    });
    try{
      const expectedMerchant=[source.merchantName,source.city,'ID'].filter(Boolean).join(' ');
      if(detail.reference!==card.reference)throw new Error('BRI_DETAIL_REFERENCE_MISMATCH');
      if(detail.mpan!==identity.mpan)throw new Error('BRI_DETAIL_MPAN_MISMATCH');
      if(detail.storeId!==source.storeId)throw new Error('BRI_DETAIL_STORE_MISMATCH');
      if(detail.merchant!==source.merchantName&&detail.merchant!==expectedMerchant)throw new Error('BRI_DETAIL_MERCHANT_MISMATCH');
      if(parseRupiah(detail.amount)!==parseRupiah(card.amount))throw new Error('BRI_DETAIL_AMOUNT_MISMATCH');
      const at=parseTimestamp(detail.date+'T'+detail.time+'+07:00',{timestampFormat:'iso',timezoneOffset:'+07:00'});
      if(at>=range.from&&at<=range.to)result.push({sourceId:source.id,provider:'BRI_MERCHANT',reference:detail.reference,amount:parseRupiah(detail.amount),transactionAt:at,providerStatus:detail.success?'SUCCESS':'UNCONFIRMED'});
    }finally{
      await page.evaluate(()=>{
        const receipt=document.querySelector('#dataStruk-nama');let ancestor=receipt?.parentElement;
        while(ancestor){const close=ancestor.querySelector(':scope > span.cursor-pointer');if(close){(close as HTMLElement).click();return;}ancestor=ancestor.parentElement;}throw new Error('BRI_RECEIPT_CLOSE_CHANGED');
      });await page.waitForSelector('#dataStruk-reffNum',{hidden:true});
    }
  }
  return result;
}
