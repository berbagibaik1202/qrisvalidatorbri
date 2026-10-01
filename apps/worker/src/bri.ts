import 'dotenv/config';
import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {db} from '../../../packages/database/src.js';
import {ingestTransaction} from '../../../packages/payment-core/src/index.js';
import {paymentSettings} from '../../../packages/payment-core/src/settings.js';
import {BriMerchantProvider} from '../../../providers/bri-merchant/index.js';
import {controlToken} from '../../../providers/bri-merchant/config.js';
import {mpanMatches} from '../../../providers/bri-merchant/portal.js';
import {parseQRIS} from '../../../packages/qris/src/index.js';
import {browserFailure} from '../../../providers/bri-merchant/errors.js';
const provider=new BriMerchantProvider(),session=provider.session;
const app=express();app.disable('x-powered-by');const token=Buffer.from('Bearer '+controlToken());
app.use((req,res,next)=>{const provided=Buffer.from(req.headers.authorization||'');if(provided.length!==token.length||!timingSafeEqual(provided,token))return res.sendStatus(401);next();});
let tail:Promise<void>=Promise.resolve();
function exclusive<T>(work:()=>Promise<T>):Promise<T>{const result=tail.then(work);tail=result.then(()=>{},()=>{});return result;}
async function save(){
  const state=session.snapshot();
  await db.browserSession.upsert({where:{id:'BRI_MERCHANT'},create:{id:'BRI_MERCHANT',status:state.status,lastCheck:state.lastCheck?new Date(state.lastCheck):null},update:{status:state.status,lastCheck:state.lastCheck?new Date(state.lastCheck):null}});
  return state;
}
async function sync(){
  let sourceId=process.env.BRI_PAYMENT_SOURCE_ID;
  if(!sourceId){
    const identity=await provider.network.merchantIdentity();
    const sources=await db.paymentSource.findMany({where:{status:'ACTIVE',provider:'BRI_MERCHANT'}});
    const candidates=sources.filter(source=>source.mpan&&mpanMatches(source.mpan,identity.mpan)&&source.merchantName===identity.merchantName);
    if(candidates.length!==1)throw new Error('BRI_SOURCE_BINDING_REQUIRED');sourceId=candidates[0].id;
  }
  if(!sourceId)throw new Error('BRI_SOURCE_BINDING_REQUIRED');
  const source=await db.paymentSource.findUnique({where:{id:sourceId}});
  if(!source||source.provider!=='BRI_MERCHANT'||source.status!=='ACTIVE'||!source.mpan||(process.env.BRI_EXPECTED_MPAN&&source.mpan!==process.env.BRI_EXPECTED_MPAN))throw new Error('SOURCE_IDENTITY_MISMATCH');
  const version=await db.sourceVersion.findUniqueOrThrow({where:{id:source.activeVersionId!}});
  const account=parseQRIS(version.payload).find(field=>field.children?.some(child=>child.tag==='00'&&child.value==='ID.CO.BRI.WWW'));
  const storeId=account?.children?.find(field=>field.tag==='02')?.value;
  const saved=await db.browserSession.findUnique({where:{id:'BRI_MERCHANT'}});
  const to=new Date(),from=new Date(((saved?.sourceId===sourceId?saved.lastSync?.getTime():undefined)||to.getTime()-86400000)-5*60000);
  const rows=await provider.collectTransactions({...source,storeId},{from,to});
  for(const row of rows)await ingestTransaction(row);
  // Update durable cursor only after every collected transaction has been persisted.
  await db.browserSession.upsert({where:{id:'BRI_MERCHANT'},create:{id:'BRI_MERCHANT',sourceId,status:'CONNECTED',lastSync:to,lastCheck:to},update:{sourceId,status:'CONNECTED',lastSync:to,lastCheck:to}});
  session.setSync(to.toISOString());return save();
}
const messages:Record<string,string>={BRI_MAPPING_REQUIRED:'Mapping tabel transaksi belum dikonfigurasi.',BRI_MAPPING_INVALID:'Mapping tabel belum lengkap atau cakupan pagination belum terverifikasi.',BRI_LOGIN_REQUIRED:'Sesi BRI belum terhubung; lakukan login dan cek koneksi.',BROWSER_NOT_FOUND:'Chromium tidak ditemukan. Set BRI_BROWSER_EXECUTABLE.',SOURCE_IDENTITY_MISMATCH:'Source, status ACTIVE, atau MPAN berbeda dari merchant yang dikonfigurasi.',MERCHANT_IDENTITY_MISMATCH:'Identitas merchant pada transaksi berbeda; collection dihentikan.',BRI_TABLE_UNRECOGNIZED:'Tabel transaksi atau penanda kosong tidak dikenali.',BRI_TABLE_CHANGED:'Struktur kolom transaksi berubah; collection dihentikan.'};
async function run(action:string){
  let result;let restored=false;
  try {
    const previous=session.snapshot().status;
    if(action==='login')result=await session.openLogin();else if(action==='check')result=await session.check();else if(action==='restore'||action==='automatic'){if(action==='restore')paused=false;result=await session.restore(action==='automatic');if(result.status==='CONNECTED'){restored=true;result=await sync();}}else if(action==='close'){paused=true;await session.close();result=session.snapshot();}else if(action==='sync')result=await sync();else throw new Error('INVALID_ACTION');
    await save();
    if(previous!==result.status)await db.auditLog.create({data:{actor:'bri-worker',event:'BRI_'+result.status,resourceId:'BRI_MERCHANT',metadata:{}}});return result;
  }catch(e){const diagnostic=browserFailure(e);const code=diagnostic.code;console.error(JSON.stringify({event:'bri_operation_failed',action,...diagnostic}));const message=messages[code]||'Operasi browser gagal. Pulihkan sesi melalui Browser Session. ('+code+')';if(action==='sync'||restored)session.setCollectorError(message);else session.setSessionError(message);await save();return session.snapshot();}
}
app.get('/status',(req,res)=>res.json(session.snapshot()));
for(const action of ['login','check','restore','sync','close'])app.post('/'+action,async(req,res)=>res.json(await exclusive(()=>run(action))));
const server=app.listen(Number(process.env.BRI_WORKER_PORT||3010),process.env.BRI_WORKER_HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'bri_worker_started',port:Number(process.env.BRI_WORKER_PORT||3010)})));
let paused=false;
if(session.automaticLoginConfigured())await exclusive(()=>run('automatic'));
else if(await session.attachExisting())await exclusive(()=>run('check'));
let stopping=false;let polling=false;
const saved=await db.browserSession.findUnique({where:{id:'BRI_MERCHANT'}});if(saved?.lastSync&&!session.snapshot().lastSync)session.setPreviousSync(saved.lastSync.toISOString());
async function poll(){
  if(stopping||polling)return;polling=true;
  try {
    // Do not reload the login page while the administrator is entering credentials/OTP.
    if(session.snapshot().status==='CONNECTED')await exclusive(()=>run('sync'));
    else if(!paused&&session.automaticLoginConfigured())await exclusive(()=>run('automatic'));
  }finally{polling=false;}
  const pending=await db.payment.count({where:{status:'PENDING',...(process.env.BRI_PAYMENT_SOURCE_ID?{sourceId:process.env.BRI_PAYMENT_SOURCE_ID}:{})}}).catch(()=>0);
  const settings=await paymentSettings().catch(()=>({activeCollectorSeconds:10,idleCollectorSeconds:60}));
  if(!stopping)timer=setTimeout(poll,(pending?settings.activeCollectorSeconds:settings.idleCollectorSeconds)*1000);
}
let timer:ReturnType<typeof setTimeout>=setTimeout(poll,10000);
async function stop(){stopping=true;clearTimeout(timer);server.close();await tail;await session.close();await db.$disconnect();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
