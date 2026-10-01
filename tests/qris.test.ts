import { describe,it,expect } from 'vitest';
import QRCode from 'qrcode';
import {calculateCRC,parseQRIS,encodeQRIS,validateQRIS,generateQRIS,decodeQRImage} from '../packages/qris/src/index.js';
export function fixture() {
  const base=encodeQRIS([{tag:'00',value:'01'},{tag:'01',value:'11'},{tag:'26',value:'',children:[{tag:'00',value:'ID.CO.BRI.WWW'},{tag:'01',value:'936000020000000001'}]},{tag:'52',value:'7299'},{tag:'53',value:'360'},{tag:'58',value:'ID'},{tag:'59',value:'RIZPAY TEST MERCHANT'},{tag:'60',value:'SUMEDANG'},{tag:'61',value:'45355'}])+'6304';
  return base+calculateCRC(base);
}
describe('QRIS core',()=>{
  it('matches the CRC-CCITT-FALSE reference vector',()=>expect(calculateCRC('123456789')).toBe('29B1'));
  it('roundtrips nested TLV without losing merchant fields',()=>{const payload=fixture();expect(encodeQRIS(parseQRIS(payload))).toBe(payload);expect(validateQRIS(payload,true).merchantName).toBe('RIZPAY TEST MERCHANT');});
  it('generates an exact integer amount with valid CRC',()=>{const source=fixture(),generated=generateQRIS(source,16037);const fields=parseQRIS(generated);expect(fields.find(f=>f.tag==='01')?.value).toBe('12');expect(fields.find(f=>f.tag==='54')?.value).toBe('16037');expect(fields.find(f=>f.tag==='26')).toEqual(parseQRIS(source).find(f=>f.tag==='26'));expect(validateQRIS(generated).crc).toBe('VALID');});
  it('rejects corrupted CRC, dynamic sources, duplicate tags, truncated values and floating amounts',()=>{expect(()=>validateQRIS(fixture().slice(0,-4)+'FFFF')).toThrow('CRC');expect(()=>validateQRIS(generateQRIS(fixture(),1000),true)).toThrow('statis');expect(()=>parseQRIS('000201000201')).toThrow();expect(()=>parseQRIS('5905ABC')).toThrow();expect(()=>generateQRIS(fixture(),1000.1)).toThrow();});
  it('decodes a generated PNG image',async()=>{const payload=fixture();expect(await decodeQRImage(await QRCode.toBuffer(payload,{width:600,margin:4}))).toBe(payload);});
});
