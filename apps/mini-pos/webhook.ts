import { createHmac,timingSafeEqual } from 'node:crypto';
export function verifyWebhook(secret:string,timestamp:string,body:Buffer,signature:string,now=Date.now()){
  if(!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||! /^[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(body).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
