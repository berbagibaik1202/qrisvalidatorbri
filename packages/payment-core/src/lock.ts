import {Redis} from 'ioredis';
import {randomUUID} from 'node:crypto';
let connection:Redis|undefined;
export async function withAllocationLock<T>(work:()=>Promise<T>):Promise<T> {
  if(!process.env.DATABASE_URL?.startsWith('mysql:')) return work();
  if(!connection){connection=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:1,connectTimeout:3000,lazyConnect:true});connection.on('error',()=>{});}
  const key='rizpay:lock:payment-allocation',token=randomUUID();let acquired=false;
  for(let i=0;i<100;i++) {
    if(await connection.set(key,token,'PX',30000,'NX')==='OK'){acquired=true;break;}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!acquired) throw new Error('ALLOCATION_BUSY');
  try{return await work();}finally{await connection.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",1,key,token).catch(()=>{});}
}
export async function closeAllocationLock(){await connection?.quit();}
