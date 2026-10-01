import {describe,it,expect} from 'vitest';
import {normalizeRow,parseRupiah,parseTimestamp,type RowMapping} from '../providers/bri-merchant/normalizer.js';
import {collectorMapping} from '../providers/bri-merchant/collector.js';
const mapping:RowMapping={reference:'reference',amount:'amount',timestamp:'time',status:'status',merchantId:'merchant',expectedMerchantId:'MERCHANT-1',successStatuses:['Sales Success'],timestampFormat:'id',timezoneOffset:'+07:00'};
const row={reference:'223074911478',amount:'Rp 50.037,00',time:'01/10/2026 13:10:03',status:'Sales Success',merchant:'MERCHANT-1'};
describe('BRI normalizer',()=>{
  it('normalizes Indonesian Rupiah without fractional money',()=>{expect(parseRupiah('Rp 50.037,00')).toBe(50037);expect(parseRupiah('1000')).toBe(1000);for(const amount of ['Rp 1.000,50','1,000','-1000','50.03','0'])expect(()=>parseRupiah(amount)).toThrow();});
  it('normalizes merchant time using WIB',()=>expect(parseTimestamp(row.time,mapping).toISOString()).toBe('2026-10-01T06:10:03.000Z'));
  it('rejects impossible dates and timezone-less ISO timestamps',()=>{expect(()=>parseTimestamp('31/02/2026 13:00:00',mapping)).toThrow();expect(()=>parseTimestamp('2026-10-01T13:00:00',{timestampFormat:'iso',timezoneOffset:'+07:00'})).toThrow();});
  it('only marks verified transaction success labels SUCCESS',()=>{expect(normalizeRow(row,mapping,'SOURCE1').providerStatus).toBe('SUCCESS');expect(normalizeRow({...row,status:'Pencairan Diproses'},mapping,'SOURCE1').providerStatus).toBe('UNCONFIRMED');expect(normalizeRow({...row,status:'Failed'},mapping,'SOURCE1').providerStatus).toBe('UNCONFIRMED');});
  it('rejects wrong merchant, missing reference, and missing status',()=>{expect(()=>normalizeRow({...row,merchant:'OTHER'},mapping,'SOURCE1')).toThrow('MERCHANT_IDENTITY_MISMATCH');expect(()=>normalizeRow({...row,reference:''},mapping,'SOURCE1')).toThrow();expect(()=>normalizeRow({...row,status:''},mapping,'SOURCE1')).toThrow();});
  it('fails closed when mapping is absent or has no verified pagination/filter coverage',()=>{const previous=process.env.BRI_COLLECTOR_MAPPING;try{delete process.env.BRI_COLLECTOR_MAPPING;expect(collectorMapping()).toBeNull();process.env.BRI_COLLECTOR_MAPPING=JSON.stringify(mapping);expect(()=>collectorMapping()).toThrow('BRI_MAPPING_INVALID');}finally{if(previous===undefined)delete process.env.BRI_COLLECTOR_MAPPING;else process.env.BRI_COLLECTOR_MAPPING=previous;}});
});
