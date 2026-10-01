import { createHash } from 'node:crypto';
import sharp from 'sharp';
import jsQR from 'jsqr';
export interface Field { tag: string; value: string; children?: Field[] }
export function calculateCRC(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function parseQRIS(payload: string, nested = true): Field[] {
  if (!payload || !/^[\x20-\x7e]+$/.test(payload)) throw new Error('Payload harus berupa karakter EMV ASCII');
  const fields: Field[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const header = payload.slice(offset, offset + 4);
    if (!/^\d{4}$/.test(header)) throw new Error('Header TLV tidak valid');
    const tag = header.slice(0, 2), length = Number(header.slice(2));
    offset += 4;
    if (!length || offset + length > payload.length || fields.some(f => f.tag === tag)) throw new Error('Panjang atau tag TLV tidak valid');
    const value = payload.slice(offset, offset + length);
    const isNested = nested && ((Number(tag) >= 26 && Number(tag) <= 51) || tag === '62' || tag === '64');
    fields.push({tag,value,...(isNested ? {children:parseQRIS(value,false)} : {})});
    offset += length;
  }
  return fields;
}
export function encodeQRIS(fields: Field[]): string {
  return fields.map(f => {
    const value = f.children ? encodeQRIS(f.children) : f.value;
    if (value.length < 1 || value.length > 99 || !/^\d{2}$/.test(f.tag)) throw new Error('Field TLV tidak dapat diencode');
    return f.tag + String(value.length).padStart(2,'0') + value;
  }).join('');
}
export const payloadHash = (payload: string) => createHash('sha256').update(payload).digest('hex');
export function validateQRIS(payload: string, requireStatic = false) {
  const fields = parseQRIS(payload);
  const get = (tag: string) => fields.find(f=>f.tag===tag)?.value;
  if (fields[0]?.tag !== '00' || get('00') !== '01') throw new Error('Payload format tidak valid');
  if (!['11','12'].includes(get('01') || '')) throw new Error('POI QRIS tidak valid');
  if (get('53') !== '360' || get('58') !== 'ID') throw new Error('QRIS harus menggunakan IDR dan negara ID');
  if (!/^\d{4}$/.test(get('52') || '') || !get('59') || !get('60')) throw new Error('Identitas merchant tidak lengkap');
  const account = fields.find(f=>Number(f.tag)>=26 && Number(f.tag)<=51 && f.children?.some(c=>c.tag==='00' && /^(ID\.|COM\.)/.test(c.value)));
  if (!account) throw new Error('Merchant account QRIS tidak ditemukan');
  if (fields.at(-1)?.tag !== '63' || get('63')?.length !== 4 || calculateCRC(payload.slice(0,-4)) !== get('63')) throw new Error('CRC QRIS tidak valid');
  if (requireStatic && (get('01') !== '11' || get('54') !== undefined)) throw new Error('Gunakan QRIS statis merchant tanpa nominal');
  if (get('54') !== undefined && !/^[1-9]\d*$/.test(get('54')!)) throw new Error('Nominal QRIS tidak valid');
  return {valid:true,crc:'VALID',type:get('01')==='11'?'STATIC':'DYNAMIC',merchantName:get('59')!,city:get('60')!,mcc:get('52')!,currency:'IDR',country:'ID',postalCode:get('61'),mpan:account.children?.find(c=>c.tag==='01')?.value,fields,hash:payloadHash(payload)};
}
export function generateQRIS(source: string, amount: number): string {
  validateQRIS(source,true);
  if (!Number.isSafeInteger(amount) || amount<=0 || amount>1000000000) throw new Error('Nominal harus integer Rupiah positif');
  const fields = parseQRIS(source).filter(f=>!['54','63'].includes(f.tag));
  fields.find(f=>f.tag==='01')!.value='12';
  const index = fields.findIndex(f=>Number(f.tag)>54);
  fields.splice(index<0?fields.length:index,0,{tag:'54',value:String(amount)});
  const base = encodeQRIS(fields)+'6304';
  const result = base+calculateCRC(base);
  validateQRIS(result);
  return result;
}
export async function decodeQRImage(image: Buffer): Promise<string> {
  const metadata = await sharp(image,{limitInputPixels:25000000}).metadata();
  if (!['png','jpeg','webp'].includes(metadata.format || '')) throw new Error('Format gambar harus PNG, JPG, atau WEBP');
  const {data,info} = await sharp(image,{limitInputPixels:25000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded = jsQR(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'attemptBoth'});
  if (!decoded) throw new Error('QR tidak dapat dibaca. Pastikan gambar jelas dan tidak terpotong.');
  return decoded.data;
}
