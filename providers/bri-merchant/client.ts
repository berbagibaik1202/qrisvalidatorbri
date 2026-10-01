import {controlToken,BRI_LOGIN_URL,BRI_TRANSACTIONS_URL,type SessionHealth} from './config.js';
const offline:SessionHealth={status:'BROWSER_OFFLINE',browserOpen:false,loginUrl:BRI_LOGIN_URL,transactionsUrl:BRI_TRANSACTIONS_URL,lastCheck:null,lastSync:null,message:'Browser worker belum berjalan. Jalankan npm run bri:worker pada komputer untuk login.',collector:'NOT_CONFIGURED'};
export async function browserControl(action:'status'|'login'|'check'|'restore'|'sync'|'close'):Promise<SessionHealth>{
  const base=process.env.BRI_WORKER_URL||'http://127.0.0.1:3010';
  try {
    const response=await fetch(`${base}/${action}`,{method:action==='status'?'GET':'POST',headers:{Authorization:'Bearer '+controlToken()},signal:AbortSignal.timeout(action==='status'?2000:60000)});
    if(!response.ok) return {...offline,status:'ERROR',message:'Browser worker menolak operasi. Periksa konfigurasi worker.'};return await response.json() as SessionHealth;
  }catch{return offline;}
}
