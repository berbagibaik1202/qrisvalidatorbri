import {db} from '../../../packages/database/src.js';
import {simulationEnabled} from '../../../packages/payment-core/src/mode.js';
import {browserControl} from '../../../providers/bri-merchant/client.js';
export async function posReadiness(){
  if(simulationEnabled())return {ready:true,mode:'TEST',message:'Lingkungan pengujian otomatis.',sourceId:null,merchantName:null,lastSync:null};
  const [browser,session,application]=await Promise.all([browserControl('status'),db.browserSession.findUnique({where:{id:'BRI_MERCHANT'}}),db.application.findUnique({where:{code:'MINI_POS'}})]);
  const configuration=application?await db.auditLog.findFirst({where:{event:'APPLICATION_SETTINGS_UPDATED',resourceId:application.id},orderBy:{createdAt:'desc'}}):null;
  const configured=(configuration?.metadata as {payment_source_id?:string|null}|undefined)?.payment_source_id;
  const sourceId=configured||session?.sourceId;
  const source=sourceId?await db.paymentSource.findUnique({where:{id:sourceId}}):null;
  let message='Siap menerima pembayaran QRIS melalui BRI Merchant.';
  let ready=true;
  if(application?.status!=='ACTIVE'){ready=false;message='Aplikasi Mini POS belum aktif.';}
  else if(browser.status!=='CONNECTED'){ready=false;message=browser.message||'Browser BRI belum terhubung. Pulihkan sesi melalui Browser Session.';}
  else if(browser.collector!=='READY'){ready=false;message=browser.collector==='ERROR'?'Sesi BRI terhubung, tetapi sinkronisasi collector gagal. '+browser.message:'Sesi BRI terhubung; collector belum selesai melakukan sync. Jalankan Sync sekarang.';}
  else if(!source||source.status!=='ACTIVE'||source.provider!=='BRI_MERCHANT'||!source.activeVersionId||source.id!==session?.sourceId){ready=false;message='Source QRIS aktif belum sesuai dengan merchant yang dibaca collector.';}
  else if(!session.lastSync||Date.now()-session.lastSync.getTime()>120000){ready=false;message='Collector BRI belum melakukan sync terbaru. Jalankan Sync sekarang.';}
  return {ready,mode:'LIVE',message,sourceId:source?.id||null,merchantName:source?.merchantName||null,lastSync:session?.lastSync?.toISOString()||null};
}
