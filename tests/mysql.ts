import 'dotenv/config';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {calculateCRC,encodeQRIS,payloadHash,validateQRIS} from '../packages/qris/src/index.js';
const url=new URL(process.env.DATABASE_URL||'file:invalid');
if(url.protocol!=='mysql:'||!url.pathname.endsWith('_test'))throw new Error('Pengujian ini hanya boleh memakai database MySQL dengan nama berakhiran _test');
process.env.MINI_POS_URL='';process.env.NODE_ENV='test';
process.env.MOCK_PROVIDER_ENABLED='true';
const {db}=await import('../packages/database/src.js');
const {ingestTransaction}=await import('../packages/payment-core/src/index.js');
const suffix=randomUUID().replaceAll('-','');
const children:ChildProcess[]=[];
async function start(port:number){
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/api/src/index.ts'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});children.push(child);
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('API test startup timeout')),30000);
    child.stdout?.on('data',chunk=>{if(String(chunk).includes('api_started')){clearTimeout(timer);resolve();}});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('API test exited'));});child.once('error',reject);
  });return `http://127.0.0.1:${port}`;
}
try{
  const application=await db.application.create({data:{code:'MYSQL_TEST_'+suffix,name:'Isolated concurrency test'}});
  const token='rz_test_'+suffix;await db.apiKey.create({data:{applicationId:application.id,name:'Concurrency fixture',prefix:token.slice(0,16),hash:payloadHash(token)}});
  const base=encodeQRIS([{tag:'00',value:'01'},{tag:'01',value:'11'},{tag:'26',value:'',children:[{tag:'00',value:'ID.CO.BRI.WWW'},{tag:'01',value:'936000020000000001'}]},{tag:'52',value:'7299'},{tag:'53',value:'360'},{tag:'58',value:'ID'},{tag:'59',value:'RIZPAY TEST MERCHANT'},{tag:'60',value:'SUMEDANG'}])+'6304';
  const payload=base+calculateCRC(base),merchant=validateQRIS(payload,true);
  const source=await db.paymentSource.create({data:{name:'Concurrency fixture',status:'ACTIVE',merchantName:merchant.merchantName,city:merchant.city,mpan:merchant.mpan,mcc:merchant.mcc,filename:'fixture'}});
  const version=await db.sourceVersion.create({data:{sourceId:source.id,version:1,payload,hash:merchant.hash,merchantData:JSON.parse(JSON.stringify(merchant))}});
  await db.paymentSource.update({where:{id:source.id},data:{activeVersionId:version.id}});
  const servers=await Promise.all([start(18001),start(18002)]);
  async function create(index:number,reference='CONCURRENT-'+index){
    const response=await fetch(servers[index%2]+'/v1/payments',{method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':reference,'Content-Type':'application/json'},body:JSON.stringify({reference_id:reference,amount:16000,payment_source_id:source.id}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));return result;
  }
  const payments=await Promise.all(Array.from({length:20},(_,i)=>create(i)));
  assert.equal(new Set(payments.map(p=>p.pay_amount)).size,20);
  console.log('PASS two API processes allocate unique amounts using MySQL/Redis');
  const repeated=await Promise.all([create(0,'IDEMPOTENT'),create(1,'IDEMPOTENT')]);assert.equal(repeated[0].payment_id,repeated[1].payment_id);
  console.log('PASS idempotency holds across API processes');
  const transaction={sourceId:source.id,provider:'MOCK',reference:'MYSQL_'+suffix,amount:payments[0].pay_amount,transactionAt:new Date(),providerStatus:'SUCCESS'};
  await Promise.all([ingestTransaction(transaction),ingestTransaction(transaction)]);
  assert.equal(await db.paymentMatch.count({where:{paymentId:payments[0].payment_id}}),1);
  assert.equal(await db.webhookEvent.count({where:{paymentId:payments[0].payment_id}}),1);
  console.log('PASS concurrent ingestion produces one match and one webhook event');
}finally{
  for(const child of children)child.kill('SIGTERM');
  await db.$disconnect();
}
