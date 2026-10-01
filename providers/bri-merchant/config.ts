import { createHash } from 'node:crypto';
export const BRI_LOGIN_URL='https://brimerchant.bri.co.id/auth/login';
export const BRI_TRANSACTIONS_URL='https://brimerchant.bri.co.id/transaksi';
export function controlToken(){const secret=process.env.SECRET_ENCRYPTION_KEY;if(!secret||secret.length<32)throw new Error('SECRET_ENCRYPTION_KEY minimal 32 karakter');return createHash('sha256').update('rizpay:bri-control:'+secret).digest('hex');}
export type SessionStatus='DISABLED'|'LOGIN_REQUIRED'|'CONNECTED'|'ERROR'|'BROWSER_OFFLINE';
export interface SessionHealth {status:SessionStatus;browserOpen:boolean;loginUrl:string;transactionsUrl:string;lastCheck:string|null;lastSync:string|null;message:string;collector:'NOT_CONFIGURED'|'READY'|'ERROR'}
