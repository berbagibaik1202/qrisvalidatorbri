import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key = () => {
  const secret=process.env.SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length<32) throw new Error('SECRET_ENCRYPTION_KEY minimal 32 karakter');
  return createHash('sha256').update(secret).digest();
};
export function encrypt(secret: string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  return [iv.toString('hex'),Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]).toString('hex'),cipher.getAuthTag().toString('hex')].join('.');
}
export function decrypt(value: string) {
  const [iv,data,tag]=value.split('.');
  const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));
  cipher.setAuthTag(Buffer.from(tag,'hex'));
  return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');
}
