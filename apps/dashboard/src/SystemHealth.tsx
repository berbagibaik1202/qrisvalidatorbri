import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import type {SystemHealth as Health} from '../../api/src/system-health.js';
const labels:Record<string,string>={api:'API',database:'Database',redis:'Redis',worker:'Payment worker',browser:'Browser',session:'Sesi BRI',collector:'Collector',webhookQueue:'Antrean webhook'};
const statuses:Record<string,string>={HEALTHY:'Sehat',DEGRADED:'Perlu perhatian',OFFLINE:'Offline',ERROR:'Error',NOT_REQUIRED:'Tidak diperlukan'};
const time=(value:string|null)=>value?new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}):'Belum tersedia';
export function SystemHealth(){
  const [health,setHealth]=useState<Health|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(signal?:AbortSignal){
    setBusy(true);
    try{const response=await fetch('/api/admin/health',{credentials:'same-origin',signal});if(!response.ok)throw new Error('Status kesehatan belum dapat dibaca.');const data=await response.json() as Health;if(!signal?.aborted){setHealth(data);setError('');}}
    catch(e){if(!signal?.aborted)setError((e as Error).message);}
    finally{if(!signal?.aborted)setBusy(false);}
  }
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);const timer=setInterval(()=>void load(controller.signal),20000);return()=>{clearInterval(timer);controller.abort();};},[]);
  return <section className="panel system-health" aria-label="Kesehatan sistem"><div className="panel-heading"><div><h2>Kesehatan sistem</h2><p>{health?'Diperiksa '+time(health.checkedAt):'Memeriksa layanan…'}</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/>Periksa layanan</button></div>{error&&<p role="alert" className="error">{error}</p>}{health&&<><div className="health-grid">{Object.entries(health.components).map(([key,value])=><div className="health-item" key={key}><div><strong>{labels[key]||key}</strong><span className={'health-status '+value.status.toLowerCase()}>{statuses[value.status]}</span></div><p>{value.message}</p>{value.lastActivity&&<small>Aktivitas: {time(value.lastActivity)}</small>}</div>)}</div><div className="health-summary"><span>Transaksi provider terakhir: <strong>{time(health.lastTransactionAt)}</strong></span><span>Webhook menunggu: <strong>{health.webhooks.pending}</strong> · diproses: <strong>{health.webhooks.processing}</strong> · gagal: <strong>{health.webhooks.failed}</strong></span></div></>}</section>;
}
