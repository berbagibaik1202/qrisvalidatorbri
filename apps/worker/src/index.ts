import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import { db } from '../../../packages/database/src.js';
import { expirePayments } from '../../../packages/payment-core/src/index.js';
import { deliverWebhook } from './webhook.js';
const url=new URL(process.env.REDIS_URL||'redis://localhost:6379');
const connection={host:url.hostname,port:Number(url.port||6379),password:url.password||undefined};
const local=process.env.DATABASE_URL?.startsWith('file:');
const queue=local?null:new Queue('rizpay-webhooks',{connection});
const worker=local?null:new Worker('rizpay-webhooks',async job=>deliverWebhook(job.data.eventId),{connection,concurrency:5});
worker?.on('error',()=>console.error(JSON.stringify({event:'webhook_worker_error'})));
let running=false;
async function tick(){
  if(running)return;running=true;
  try {
    await expirePayments();
    await db.webhookEvent.updateMany({where:{status:'PROCESSING',nextRetryAt:{lte:new Date()}},data:{status:'PENDING'}});
    const events=await db.webhookEvent.findMany({where:{status:'PENDING',nextRetryAt:{lte:new Date()}},take:100});
    for(const event of events){
      if(queue)await queue.add('deliver',{eventId:event.id},{jobId:`${event.id}-${event.attempts}`,removeOnComplete:true,removeOnFail:true});
      else await deliverWebhook(event.id);
    }
    await db.browserSession.upsert({where:{id:'WEBHOOK_WORKER'},create:{id:'WEBHOOK_WORKER',status:'HEALTHY',lastCheck:new Date()},update:{status:'HEALTHY',lastCheck:new Date()}});
  }catch{console.error(JSON.stringify({event:'worker_tick_failed'}));await db.browserSession.upsert({where:{id:'WEBHOOK_WORKER'},create:{id:'WEBHOOK_WORKER',status:'ERROR',lastCheck:new Date()},update:{status:'ERROR',lastCheck:new Date()}}).catch(()=>{});}finally{running=false;}
}
const timer=setInterval(tick,5000);await tick();
console.log(JSON.stringify({event:'worker_started'}));
async function stop(){clearInterval(timer);await worker?.close();await queue?.close();await db.$disconnect();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
