import { Prisma, type Payment, type ProviderTransaction } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { db } from '../../database/src.js';
import { generateQRIS, payloadHash, validateQRIS } from '../../qris/src/index.js';
import { withAllocationLock } from './lock.js';
import { paymentSettings } from './settings.js';
import {simulationEnabled} from './mode.js';
export class AppError extends Error { constructor(public code:string,message:string,public status=400){super(message);} }
export const id = (prefix:string) => prefix+'_'+randomUUID().replaceAll('-','');
export const audit = (tx:Prisma.TransactionClient,actor:string,event:string,resourceId:string,metadata:Prisma.InputJsonValue={}) => tx.auditLog.create({data:{actor,event,resourceId,metadata}});
export function paymentResponse(p:Payment) {
  const merchant=validateQRIS(p.qrPayload);
  return {payment_id:p.id,reference_id:p.referenceId,amount:p.baseAmount,unique_code:p.uniqueCode,pay_amount:p.payAmount,status:p.status,description:p.description,payment_source_id:p.sourceId,merchant_name:merchant.merchantName,qris:{payload:p.qrPayload,image_url:`/v1/payments/${p.id}/qris`},expires_at:p.expiresAt,paid_at:p.paidAt,provider_reference:p.providerReference};
}
let sqliteQueue:Promise<void>=Promise.resolve();
export async function serial<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  // SQLite has one writer. Queue local writers rather than hold competing read transactions.
  if(process.env.DATABASE_URL?.startsWith('file:')) {
    const prior=sqliteQueue;let release!:()=>void;
    sqliteQueue=new Promise<void>(resolve=>{release=resolve;});
    await prior;
    try{return await transactionWithRetry(work);}finally{release();}
  }
  return transactionWithRetry(work);
}
async function transactionWithRetry<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  for(let attempt=0;;attempt++) {
    try { return await db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000,maxWait:15000}); }
    catch(e) { if(attempt<4 && e instanceof Prisma.PrismaClientKnownRequestError && ['P2034','P2002'].includes(e.code)) {await new Promise(resolve=>setTimeout(resolve,20+attempt*30));continue;} throw e; }
  }
}
export interface CreateInput { reference_id:string; amount:number; description?:string; payment_source_id?:string }
export async function createPayment(applicationId:string,input:CreateInput,key:string) {
  try{return await withAllocationLock(()=>createPaymentLocked(applicationId,input,key));}
  catch(e){if(e instanceof AppError)throw e;if(e instanceof Error && /ALLOCATION_BUSY|ECONNREFUSED|Reached the max retries/.test(e.message))throw new AppError('PAYMENT_ENGINE_UNAVAILABLE','Reservasi nominal sedang tidak tersedia.',503);throw e;}
}
async function createPaymentLocked(applicationId:string,input:CreateInput,key:string) {
  const settings=await paymentSettings();
  if(!Number.isSafeInteger(input.amount) || input.amount<settings.minAmount || input.amount>settings.maxAmount) throw new AppError('INVALID_AMOUNT','Nominal di luar batas yang diizinkan.');
  const fingerprint=payloadHash(JSON.stringify({reference:input.reference_id,amount:input.amount,description:input.description||'',source:input.payment_source_id||''}));
  return serial(async tx=>{
    const existing=await tx.payment.findUnique({where:{applicationId_idempotencyKey:{applicationId,idempotencyKey:key}}});
    if(existing) { if(existing.requestHash!==fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT','Idempotency-Key digunakan untuk permintaan berbeda.',409); return existing; }
    if(await tx.payment.findUnique({where:{applicationId_referenceId:{applicationId,referenceId:input.reference_id}}})) throw new AppError('DUPLICATE_REFERENCE','Reference sudah digunakan.',409);
    const configuration=await tx.auditLog.findFirst({where:{event:'APPLICATION_SETTINGS_UPDATED',resourceId:applicationId},orderBy:{createdAt:'desc'}});
    const defaults=configuration?.metadata as {payment_source_id?:string|null;expiry_minutes?:number|null}|undefined;
    const sourceId=input.payment_source_id||defaults?.payment_source_id;
    const source=await tx.paymentSource.findFirst({where:{...(sourceId?{id:sourceId}:{}),status:'ACTIVE'},orderBy:{createdAt:'asc'}});
    if(!source?.activeVersionId) throw new AppError('PAYMENT_SOURCE_UNAVAILABLE','Aktifkan payment source terlebih dahulu.',409);
    const version=await tx.sourceVersion.findUniqueOrThrow({where:{id:source.activeVersionId}});
    const merchant=validateQRIS(version.payload,true);
    if(payloadHash(version.payload)!==version.hash || merchant.merchantName!==source.merchantName || merchant.mpan!== (source.mpan||undefined)) throw new AppError('QRIS_GENERATION_FAILED','Integritas QRIS sumber gagal.',409);
    const now=new Date(),expiresAt=new Date(now.getTime()+(defaults?.expiry_minutes||settings.expiryMinutes)*60000);
    const until=new Date(expiresAt.getTime()+settings.cooldownMinutes*60000);
    await tx.reservation.deleteMany({where:{sourceId:source.id,until:{lte:now}}});
    const reserved=new Set((await tx.reservation.findMany({where:{sourceId:source.id}})).map(r=>r.amount));
    let uniqueCode=1;
    while(reserved.has(input.amount+uniqueCode) && uniqueCode<=settings.uniqueCodeMax) uniqueCode++;
    if(uniqueCode>settings.uniqueCodeMax) throw new AppError('UNIQUE_AMOUNT_EXHAUSTED','Nominal unik sedang penuh, coba lagi nanti.',409);
    const payAmount=input.amount+uniqueCode,qrPayload=generateQRIS(version.payload,payAmount);
    await tx.reservation.create({data:{sourceId:source.id,amount:payAmount,until}});
    const payment=await tx.payment.create({data:{id:id('PAY'),applicationId,sourceId:source.id,sourceVersionId:version.id,referenceId:input.reference_id,idempotencyKey:key,requestHash:fingerprint,description:input.description||'',baseAmount:input.amount,uniqueCode,payAmount,qrPayload,qrHash:payloadHash(qrPayload),expiresAt}});
    await audit(tx,applicationId,'PAYMENT_CREATED',payment.id,{amount:payAmount,cooldownMinutes:settings.cooldownMinutes});
    return payment;
  });
}
async function markPaid(tx:Prisma.TransactionClient,payment:Payment,transaction:ProviderTransaction,type:string,actor:string) {
  if(payment.status==='PAID' || payment.status==='CANCELLED') throw new AppError('INVALID_MATCH','Payment tidak dapat dipasangkan.',409);
  await tx.paymentMatch.create({data:{paymentId:payment.id,transactionId:transaction.id,type,actor}});
  const paid=await tx.payment.update({where:{id:payment.id},data:{status:'PAID',paidAt:transaction.transactionAt,providerReference:transaction.reference}});
  await tx.providerTransaction.update({where:{id:transaction.id},data:{status:'MATCHED'}});
  const app=await tx.application.findUniqueOrThrow({where:{id:payment.applicationId}});
  const eventId=id('EVT');
  await tx.webhookEvent.create({data:{id:eventId,applicationId:app.id,paymentId:payment.id,endpoint:app.webhookUrl,status:app.webhookUrl?'PENDING':'NO_ENDPOINT',payload:{event:'payment.paid',event_id:eventId,data:{payment_id:paid.id,reference_id:paid.referenceId,amount:paid.baseAmount,unique_code:paid.uniqueCode,paid_amount:paid.payAmount,provider:transaction.provider,provider_reference:transaction.reference,paid_at:transaction.transactionAt.toISOString()}}}});
  await audit(tx,actor,type==='MANUAL'?'MANUAL_MATCH':'PAYMENT_PAID',payment.id,{transactionId:transaction.id});
  return paid;
}
export async function ingestTransaction(input:{sourceId:string;provider:string;reference:string;amount:number;transactionAt:Date;providerStatus:string}) {
  if(input.provider==='MOCK'&&!simulationEnabled())throw new AppError('MOCK_DISABLED','Provider simulasi tidak tersedia.',403);
  if(!Number.isSafeInteger(input.amount)||input.amount<=0||!Number.isFinite(input.transactionAt.getTime())||!input.reference) throw new AppError('INVALID_TRANSACTION','Transaksi provider tidak valid.');
  return serial(async tx=>{
    const existing=await tx.providerTransaction.findUnique({where:{sourceId_reference:{sourceId:input.sourceId,reference:input.reference}}});
    if(existing&&(existing.amount!==input.amount||existing.provider!==input.provider||existing.transactionAt.getTime()!==input.transactionAt.getTime())) throw new AppError('TRANSACTION_CONFLICT','Identitas transaksi provider berubah.',409);
    let transaction=await tx.providerTransaction.upsert({where:{sourceId_reference:{sourceId:input.sourceId,reference:input.reference}},create:input,update:{lastSeenAt:new Date(),providerStatus:input.providerStatus}});
    if(transaction.status==='MATCHED' || input.providerStatus!=='SUCCESS') return transaction;
    // Include expired/cancelled candidates to avoid assigning late money to a newer invoice.
    const recent=await tx.payment.findMany({where:{sourceId:input.sourceId,payAmount:input.amount,createdAt:{lte:input.transactionAt},expiresAt:{gte:new Date(input.transactionAt.getTime()-1440*60000)}}});
    const candidates:Payment[]=[];
    for(const candidate of recent){
      const creation=await tx.auditLog.findFirst({where:{resourceId:candidate.id,event:'PAYMENT_CREATED'}});
      const metadata=creation?.metadata as {cooldownMinutes?:number}|undefined;
      const cooldown=metadata?.cooldownMinutes??Number(process.env.COOLDOWN_MINUTES||30);
      if(input.transactionAt.getTime()<=candidate.expiresAt.getTime()+cooldown*60000)candidates.push(candidate);
    }
    if(candidates.length>1) {
      await tx.payment.updateMany({where:{id:{in:candidates.filter(p=>['PENDING','EXPIRED'].includes(p.status)).map(p=>p.id)}},data:{status:'AMBIGUOUS'}});
      return tx.providerTransaction.update({where:{id:transaction.id},data:{status:'AMBIGUOUS'}});
    }
    const p=candidates[0];
    if(p && ['PENDING','EXPIRED'].includes(p.status) && input.transactionAt<=p.expiresAt) {
      await markPaid(tx,p,transaction,'AUTO_UNIQUE_AMOUNT','worker');
      transaction=await tx.providerTransaction.findUniqueOrThrow({where:{id:transaction.id}});
    } else if(p) transaction=await tx.providerTransaction.update({where:{id:transaction.id},data:{status:'LATE_PAYMENT'}});
    return transaction;
  });
}
export async function manualMatch(paymentId:string,transactionId:string,actor:string) {
  return serial(async tx=>{
    const p=await tx.payment.findUniqueOrThrow({where:{id:paymentId}}),t=await tx.providerTransaction.findUniqueOrThrow({where:{id:transactionId}});
    if(p.sourceId!==t.sourceId || p.payAmount!==t.amount || t.status==='MATCHED' || t.providerStatus!=='SUCCESS' || t.transactionAt<p.createdAt) throw new AppError('INVALID_MATCH','Source, nominal, waktu, atau status transaksi tidak sesuai.',409);
    return markPaid(tx,p,t,'MANUAL',actor);
  });
}
export async function expirePayments() {
  return serial(async tx=>{
    const pending=await tx.payment.findMany({where:{status:'PENDING',expiresAt:{lte:new Date()}}});
    for(const p of pending) { await tx.payment.update({where:{id:p.id},data:{status:'EXPIRED'}}); await audit(tx,'worker','PAYMENT_EXPIRED',p.id); }
    return pending.length;
  });
}
