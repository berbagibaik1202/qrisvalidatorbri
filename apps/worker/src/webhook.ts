import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { db } from '../../../packages/database/src.js';
import { decrypt } from '../../../packages/payment-core/src/security.js';
export const signWebhook=(secret:string,timestamp:string,body:string)=>createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
export function publicAddress(address:string) {
  if(isIP(address)===6) return false; // IPv4 only until IPv6 egress policies are supported.
  const [a,b]=address.split('.').map(Number);
  return isIP(address)===4 && ![0,10,127].includes(a) && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) && !(a===192&&b===168) && !(a===100&&b>=64&&b<=127) && !(a===198&&(b===18||b===19)) && a<224;
}
async function send(url:string,body:string,headers:Record<string,string>):Promise<number> {
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password|| (target.port&&target.port!=='443')) throw new Error('Webhook URL tidak diizinkan');
  const addresses=await lookup(target.hostname,{all:true,family:4});
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('Webhook harus mengarah ke IP publik');
  const address=addresses[0].address;
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{method:'POST',headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(body))},lookup:(_hostname,_options,callback)=>callback(null,address,4)},res=>{res.destroy();resolve(res.statusCode||0);});
    req.setTimeout(10000,()=>req.destroy(new Error('Timeout')));req.on('error',reject);req.end(body);
  });
}
export async function deliverWebhook(eventId:string,transport:(url:string,body:string,headers:Record<string,string>)=>Promise<number>=send) {
  const now=new Date();
  const claimed=await db.webhookEvent.updateMany({where:{id:eventId,status:'PENDING',nextRetryAt:{lte:now}},data:{status:'PROCESSING',nextRetryAt:new Date(now.getTime()+120000)}});
  if(!claimed.count)return;
  const event=await db.webhookEvent.findUniqueOrThrow({where:{id:eventId}});
  const application=await db.application.findUniqueOrThrow({where:{id:event.applicationId}});
  const attempt=event.attempts+1,start=Date.now();let httpStatus:number|null=null;
  try {
    if(!event.endpoint||!application.webhookSecret) throw new Error('Konfigurasi webhook tidak lengkap');
    const body=JSON.stringify(event.payload),timestamp=String(Math.floor(Date.now()/1000));
    const headers={'X-Rizpay-Event-ID':event.id,'X-Rizpay-Timestamp':timestamp,'X-Rizpay-Signature':signWebhook(decrypt(application.webhookSecret),timestamp,body)};
    if(transport===send&&event.endpoint==='internal://mini-pos'&&application.code==='MINI_POS'&&process.env.MINI_POS_URL){
      // Fixed operator-controlled internal service; consumer-supplied URLs still require public HTTPS.
      const response=await fetch(process.env.MINI_POS_URL+'/api/webhooks/rizpay',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(10000)});
      httpStatus=response.status;await response.body?.cancel();
    }else httpStatus=await transport(event.endpoint,body,headers);
  }catch{/* Never persist URLs, secrets, or untrusted response bodies in error logs. */}
  const delivered=httpStatus!==null&&httpStatus>=200&&httpStatus<300;
  const delays=[60000,300000,900000,3600000];
  await db.$transaction(async tx=>{
    await tx.webhookDelivery.create({data:{eventId,attempt,httpStatus,durationMs:Date.now()-start}});
    await tx.webhookEvent.update({where:{id:eventId},data:{attempts:attempt,status:delivered?'DELIVERED':attempt>=5?'FAILED':'PENDING',nextRetryAt:new Date(Date.now()+(delays[attempt-1]||3600000))}});
    await tx.auditLog.create({data:{actor:'worker',event:delivered?'WEBHOOK_SENT':'WEBHOOK_FAILED',resourceId:eventId,metadata:{attempt,httpStatus}}});
  });
}
