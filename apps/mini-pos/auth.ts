import {createHmac,timingSafeEqual} from 'node:crypto';
export function internalToken(){
  const secret=process.env.SECRET_ENCRYPTION_KEY;
  if(!secret||secret.length<32)throw new Error('SECRET_ENCRYPTION_KEY minimal 32 karakter');
  return createHmac('sha256',secret).update('rizpay-mini-pos-control-v1').digest('hex');
}
export function internalAuthorized(value:string){
  const token=internalToken();
  return value.length===token.length&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
}
