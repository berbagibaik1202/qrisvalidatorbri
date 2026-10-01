import type {ProviderTransaction} from '../../packages/provider-core/src/index.js';
export interface RowMapping {reference:string;amount:string;timestamp:string;status:string;successStatuses:string[];timestampFormat:'iso'|'id';timezoneOffset:string;merchantId:string;expectedMerchantId:string}
export function parseRupiah(value:string):number {
  const text=value.replace(/^Rp\s*/i,'').trim();if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,00)?$/.test(text))throw new Error('INVALID_PROVIDER_AMOUNT');
  const number=Number(text.replace(/,00$/,'').replaceAll('.',''));if(!Number.isSafeInteger(number)||number<=0)throw new Error('INVALID_PROVIDER_AMOUNT');return number;
}
export function parseTimestamp(value:string,mapping:Pick<RowMapping,'timestampFormat'|'timezoneOffset'>):Date {
  let text=value.trim();
  if(mapping.timestampFormat==='id'){
    const match=text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);if(!match)throw new Error('INVALID_PROVIDER_TIMESTAMP');
    const [,d,m,y,h,min,s]=match;text=`${y}-${m}-${d}T${h}:${min}:${s}${mapping.timezoneOffset}`;const parsed=new Date(text);
    if(!Number.isFinite(parsed.getTime()))throw new Error('INVALID_PROVIDER_TIMESTAMP');
    const offset=(Number(mapping.timezoneOffset.slice(1,3))*60+Number(mapping.timezoneOffset.slice(4,6)))*60000*(mapping.timezoneOffset[0]==='-'?-1:1);
    if(new Date(parsed.getTime()+offset).toISOString().slice(0,19)!==`${y}-${m}-${d}T${h}:${min}:${s}`)throw new Error('INVALID_PROVIDER_TIMESTAMP');
  }else if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text))throw new Error('INVALID_PROVIDER_TIMESTAMP');
  const result=new Date(text);if(!Number.isFinite(result.getTime()))throw new Error('INVALID_PROVIDER_TIMESTAMP');return result;
}
export function normalizeRow(row:Record<string,string>,mapping:RowMapping,sourceId:string):ProviderTransaction {
  if(!mapping.expectedMerchantId||row[mapping.merchantId]?.trim()!==mapping.expectedMerchantId)throw new Error('MERCHANT_IDENTITY_MISMATCH');
  const reference=row[mapping.reference]?.trim();if(!reference||reference.length>190)throw new Error('INVALID_PROVIDER_REFERENCE');
  const status=row[mapping.status]?.trim();if(!status)throw new Error('MISSING_PROVIDER_STATUS');
  return {sourceId,provider:'BRI_MERCHANT',reference,amount:parseRupiah(row[mapping.amount]||''),transactionAt:parseTimestamp(row[mapping.timestamp]||'',mapping),providerStatus:mapping.successStatuses.includes(status)?'SUCCESS':'UNCONFIRMED'};
}
