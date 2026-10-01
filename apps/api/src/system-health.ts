import {Redis} from 'ioredis';
import {db} from '../../../packages/database/src.js';
import {browserControl} from '../../../providers/bri-merchant/client.js';
import type {SessionHealth} from '../../../providers/bri-merchant/config.js';

type HealthStatus='HEALTHY'|'DEGRADED'|'OFFLINE'|'ERROR'|'NOT_REQUIRED';
export type HealthComponent={status:HealthStatus;message:string;lastActivity:string|null};
export type SystemHealth={checkedAt:string;mode:string;status:'HEALTHY'|'DEGRADED';queueMode:'LOCAL_DURABLE'|'REDIS_BULLMQ';components:Record<string,HealthComponent>;webhooks:{pending:number;processing:number;failed:number;oldestPendingAt:string|null};lastTransactionAt:string|null};
const component=(status:HealthStatus,message:string,lastActivity:string|null=null):HealthComponent=>({status,message,lastActivity});
export function collectorHealth(provider:SessionHealth,now=Date.now()):HealthComponent{
  if(provider.status!=='CONNECTED')return component('OFFLINE',provider.message,provider.lastCheck);
  if(provider.collector==='ERROR')return component('ERROR',provider.message,provider.lastSync);
  const age=provider.lastSync?now-new Date(provider.lastSync).getTime():NaN;
  if(provider.collector!=='READY'||!Number.isFinite(age)||age<0||age>120000)return component('DEGRADED','Sinkronisasi collector belum tersedia atau lebih dari dua menit.',provider.lastSync);
  return component('HEALTHY','Sinkronisasi transaksi terverifikasi.',provider.lastSync);
}
export function workerHealth(worker:{status:string;lastCheck:Date|null}|null,now=Date.now()):HealthComponent{
  const age=worker?.lastCheck?now-worker.lastCheck.getTime():NaN;
  if(!Number.isFinite(age)||age<0||age>120000)return component('OFFLINE','Heartbeat worker belum tersedia atau sudah kedaluwarsa.',worker?.lastCheck?.toISOString()||null);
  return component(worker!.status==='HEALTHY'?'HEALTHY':'ERROR',worker!.status==='HEALTHY'?'Worker expiry dan webhook aktif.':'Worker melaporkan kegagalan.',worker!.lastCheck!.toISOString());
}
async function redisHealth():Promise<HealthComponent>{
  if(process.env.DATABASE_URL?.startsWith('file:'))return component('NOT_REQUIRED','Mode lokal menggunakan antrean durable di database.');
  const redis=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{lazyConnect:true,connectTimeout:2000,commandTimeout:2000,maxRetriesPerRequest:0,retryStrategy:()=>null});
  redis.on('error',()=>{});
  try{await redis.connect();await redis.ping();return component('HEALTHY','Redis merespons PING.');}
  catch{return component('OFFLINE','Redis tidak dapat dijangkau.');}
  finally{redis.disconnect();}
}
let cached:Promise<SystemHealth>|undefined,cachedAt=0;
export function systemHealth(){
  if(!cached||Date.now()-cachedAt>5000){cachedAt=Date.now();cached=readHealth().catch(()=>{cached=undefined;throw new Error('HEALTH_CHECK_FAILED');});}
  return cached;
}
async function readHealth():Promise<SystemHealth>{
  const database=await db.$queryRaw`SELECT 1`.then(()=>component('HEALTHY','Database merespons.')).catch(()=>component('OFFLINE','Database tidak dapat dijangkau.'));
  const [provider,redis,worker,queue,lastTransaction]=await Promise.all([
    browserControl('status'),redisHealth(),
    database.status==='HEALTHY'?db.browserSession.findUnique({where:{id:'WEBHOOK_WORKER'}}):Promise.resolve(null),
    database.status==='HEALTHY'?Promise.all([
      db.webhookEvent.count({where:{status:'PENDING'}}),db.webhookEvent.count({where:{status:'PROCESSING'}}),db.webhookEvent.count({where:{status:'FAILED'}}),
      db.webhookEvent.findFirst({where:{status:{in:['PENDING','PROCESSING']}},orderBy:{createdAt:'asc'},select:{createdAt:true}})
    ]):Promise.resolve(null),
    database.status==='HEALTHY'?db.providerTransaction.findFirst({orderBy:{transactionAt:'desc'},select:{transactionAt:true}}):Promise.resolve(null)
  ]);
  const webhooks={pending:queue?.[0]||0,processing:queue?.[1]||0,failed:queue?.[2]||0,oldestPendingAt:queue?.[3]?.createdAt.toISOString()||null};
  const components:Record<string,HealthComponent>={
    api:component('HEALTHY','API merespons.'),database,redis,worker:workerHealth(worker),
    browser:component(provider.browserOpen?'HEALTHY':'OFFLINE',provider.browserOpen?'Proses browser terhubung.':'Browser worker tidak terhubung.',provider.lastCheck),
    session:component(provider.status==='CONNECTED'?'HEALTHY':provider.status==='ERROR'?'ERROR':'OFFLINE',provider.message,provider.lastCheck),
    collector:collectorHealth(provider),
    webhookQueue:database.status!=='HEALTHY'?component('OFFLINE','Status antrean tidak tersedia.'):
      component(webhooks.failed?'DEGRADED':'HEALTHY',webhooks.failed?`${webhooks.failed} event gagal dan membutuhkan pemeriksaan.`:`${webhooks.pending} menunggu, ${webhooks.processing} sedang dikirim.`,webhooks.oldestPendingAt)
  };
  return {checkedAt:new Date().toISOString(),mode:process.env.NODE_ENV||'development',status:Object.values(components).every(c=>['HEALTHY','NOT_REQUIRED'].includes(c.status))?'HEALTHY':'DEGRADED',queueMode:process.env.DATABASE_URL?.startsWith('file:')?'LOCAL_DURABLE':'REDIS_BULLMQ',components,webhooks,lastTransactionAt:lastTransaction?.transactionAt.toISOString()||null};
}
