import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes,createHmac } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../../../packages/database/src.js';
import { decodeQRImage,validateQRIS,generateQRIS,payloadHash } from '../../../packages/qris/src/index.js';
import { AppError,createPayment,paymentResponse,ingestTransaction,manualMatch,expirePayments,audit,serial } from '../../../packages/payment-core/src/index.js';
import { encrypt } from '../../../packages/payment-core/src/security.js';
import { browserControl } from '../../../providers/bri-merchant/client.js';
import { paymentSettings,settingsSchema } from '../../../packages/payment-core/src/settings.js';
import { verifyWebhook } from '../../mini-pos/webhook.js';
import { decrypt } from '../../../packages/payment-core/src/security.js';
import { internalToken,internalAuthorized } from '../../mini-pos/auth.js';
import {simulationEnabled} from '../../../packages/payment-core/src/mode.js';
import {posReadiness} from './pos-readiness.js';
import {systemHealth} from './system-health.js';
const jwtSecret=process.env.JWT_SECRET;
if(!jwtSecret || jwtSecret.length<32) throw new Error('JWT_SECRET minimal 32 karakter. Jalankan npm run setup.');
const secret=new TextEncoder().encode(jwtSecret);
export const app=express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.post('/internal/mini-pos/bootstrap',async(req,res)=>{
  if(!internalAuthorized(String(req.headers['x-rizpay-internal']||'')))throw new AppError('UNAUTHORIZED','Unauthorized',401);
  const master=process.env.SECRET_ENCRYPTION_KEY!;
  const token='rz_'+(simulationEnabled()?'test':'live')+'_'+createHmac('sha256',master).update('mini-pos-api-key-v1').digest('hex');
  const webhookSecret=createHmac('sha256',master).update('mini-pos-webhook-v1').digest('hex');
  await serial(async tx=>{
    const application=await tx.application.findUniqueOrThrow({where:{code:'MINI_POS'}});
    await tx.apiKey.upsert({where:{hash:payloadHash(token)},update:{},create:{applicationId:application.id,name:'Mini POS backend',prefix:token.slice(0,16),hash:payloadHash(token),environment:simulationEnabled()?'test':'live'}});
    if(!application.webhookSecret||!application.webhookUrl)await tx.application.update({where:{id:application.id},data:{...(!application.webhookSecret?{webhookSecret:encrypt(webhookSecret)}:{}),...(!application.webhookUrl?{webhookUrl:'internal://mini-pos'}:{})}});
  });
  const application=await db.application.findUniqueOrThrow({where:{code:'MINI_POS'}});
  res.set('Cache-Control','no-store').json({api_key:token,webhook_secret:decrypt(application.webhookSecret!)});
});
app.get('/internal/mini-pos/readiness',async(req,res)=>{
  if(!internalAuthorized(String(req.headers['x-rizpay-internal']||'')))throw new AppError('UNAUTHORIZED','Unauthorized',401);
  res.json(await posReadiness());
});
app.post('/api/webhooks/rizpay',express.raw({type:'application/json',limit:'100kb'}),async(req,res)=>{
  if(process.env.MINI_POS_URL){
    const response=await fetch(process.env.MINI_POS_URL+'/api/webhooks/rizpay',{method:'POST',headers:{'Content-Type':'application/json','X-Rizpay-Event-ID':String(req.headers['x-rizpay-event-id']||''),'X-Rizpay-Timestamp':String(req.headers['x-rizpay-timestamp']||''),'X-Rizpay-Signature':String(req.headers['x-rizpay-signature']||'')},body:req.body,signal:AbortSignal.timeout(15000)});
    return res.status(response.status).send(await response.text());
  }
  const application=await db.application.findUnique({where:{code:'MINI_POS'}});
  const timestamp=String(req.headers['x-rizpay-timestamp']||''),signature=String(req.headers['x-rizpay-signature']||'');
  if(!application?.webhookSecret||!Buffer.isBuffer(req.body)||!verifyWebhook(decrypt(application.webhookSecret),timestamp,req.body,signature)) throw new AppError('INVALID_SIGNATURE','Signature webhook tidak valid.',401);
  let body;try{body=JSON.parse(req.body.toString('utf8'));}catch{throw new AppError('INVALID_REQUEST','JSON tidak valid.');}
  const event=z.object({event:z.literal('payment.paid'),event_id:z.string(),data:z.object({payment_id:z.string(),reference_id:z.string(),paid_amount:z.number().int().positive()})}).parse(body);
  if(req.headers['x-rizpay-event-id']!==event.event_id)throw new AppError('INVALID_EVENT','Identitas event tidak sesuai.');
  await serial(async tx=>{
    const payment=await tx.payment.findFirst({where:{id:event.data.payment_id,applicationId:application.id,status:'PAID',referenceId:event.data.reference_id,payAmount:event.data.paid_amount}});
    if(!payment)throw new AppError('INVALID_EVENT','Payment webhook tidak sesuai.',409);
    if(!await tx.auditLog.findFirst({where:{event:'POS_WEBHOOK_RECEIVED',resourceId:event.event_id}}))await audit(tx,'MINI_POS','POS_WEBHOOK_RECEIVED',event.event_id,{paymentId:payment.id});
  });res.json({ok:true});
});
app.use(express.json({limit:'100kb'}));
app.use(cookieParser());
app.use(rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
app.use((req,res,next)=>{
  // Same-origin dashboard and POS; reject cross-site cookie mutations.
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.cookies.rizpay_session && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return next(new AppError('INVALID_ORIGIN','Origin tidak diizinkan.',403));
  next();
});
async function admin(req:Request,res:Response,next:NextFunction) {
  try {
    const token=req.cookies.rizpay_session;
    if(!token) throw new AppError('UNAUTHORIZED','Silakan login.',401);
    const {payload}=await jwtVerify(token,secret);
    const user=await db.user.findUnique({where:{id:payload.sub}});
    if(!user) throw new AppError('UNAUTHORIZED','Sesi tidak valid.',401);
    if(!['SUPER_ADMIN','ADMIN','VIEWER'].includes(user.role))throw new AppError('FORBIDDEN','Role tidak diizinkan.',403);
    if(!['GET','HEAD'].includes(req.method) && user.role==='VIEWER'&&req.originalUrl!=='/api/auth/logout') throw new AppError('FORBIDDEN','Akses hanya baca.',403);
    if(user.role==='VIEWER'&&!/^\/api\/(auth\/(me|logout)|admin\/(overview|health(?:\/|\?|$)|payments(?:\/|\?|$)|transactions(?:\/|\?|$)|audit(?:\/|\?|$)))/.test(req.originalUrl))throw new AppError('FORBIDDEN','Menu tidak tersedia untuk Viewer.',403);
    res.locals.user=user; next();
  } catch(e){next(e instanceof AppError?e:new AppError('UNAUTHORIZED','Sesi berakhir.',401));}
}
async function consumer(req:Request,res:Response,next:NextFunction) {
  try {
    const token=req.headers.authorization?.replace(/^Bearer /,'');
    if(!token) throw new AppError('INVALID_API_KEY','API key diperlukan.',401);
    const key=await db.apiKey.findUnique({where:{hash:payloadHash(token)},include:{application:true}});
    if(!key || key.status!=='ACTIVE' || key.application.status!=='ACTIVE' || (key.expiresAt && key.expiresAt<=new Date())) throw new AppError('INVALID_API_KEY','API key tidak valid.',401);
    await db.apiKey.update({where:{id:key.id},data:{lastUsedAt:new Date()}});
    res.locals.application=key.application;res.locals.environment=key.environment;next();
  }catch(e){next(e);}
}
const paymentInput=z.object({reference_id:z.string().min(1).max(100),amount:z.number().int().positive(),description:z.string().max(250).optional(),payment_source_id:z.string().optional()}).strict();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
app.get('/health',async(req,res)=>{
  await db.$queryRaw`SELECT 1`;
  const [provider,worker,pending,failed]=await Promise.all([browserControl('status'),db.browserSession.findUnique({where:{id:'WEBHOOK_WORKER'}}),db.webhookEvent.count({where:{status:{in:['PENDING','PROCESSING']}}}),db.webhookEvent.count({where:{status:'FAILED'}})]);
  res.json({api:'HEALTHY',database:'HEALTHY',provider:provider.status,worker:worker?.lastCheck&&Date.now()-worker.lastCheck.getTime()<120000?worker.status:'OFFLINE',webhooks:{pending,failed},queueMode:process.env.DATABASE_URL?.startsWith('file:')?'LOCAL_DURABLE':'REDIS_BULLMQ',mode:process.env.NODE_ENV||'development'});
});
app.post('/api/auth/login',rateLimit({windowMs:15*60000,limit:20}),async(req,res)=>{
  const input=z.object({email:z.string().email(),password:z.string().max(200)}).parse(req.body);
  const user=await db.user.findUnique({where:{email:input.email}});
  if(!user || !await bcrypt.compare(input.password,user.passwordHash)) throw new AppError('INVALID_CREDENTIALS','Email atau password salah.',401);
  const token=await new SignJWT({role:user.role}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('8h').sign(secret);
  res.cookie('rizpay_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*3600000,path:'/'}).json({email:user.email,role:user.role});
});
app.post('/api/auth/logout',admin,(req,res)=>res.clearCookie('rizpay_session',{path:'/'}).json({ok:true}));
app.get('/api/auth/me',admin,(req,res)=>res.json({email:res.locals.user.email,role:res.locals.user.role}));
app.use('/api/admin',admin);
app.get('/api/admin/health',async(req,res)=>res.set('Cache-Control','no-store').json(await systemHealth()));
app.get('/api/admin/settings',async(req,res)=>res.json(await paymentSettings()));
app.get('/api/admin/payments',async(req,res)=>{
  await expirePayments();
  const input=z.object({page:z.coerce.number().int().min(1).default(1),query:z.string().max(100).default(''),status:z.enum(['ALL','PENDING','PAID','EXPIRED','CANCELLED','AMBIGUOUS']).default('ALL')}).parse(req.query);
  const where={...(input.query?{referenceId:{contains:input.query}}:{}),...(input.status==='ALL'?{}:{status:input.status})};
  const [items,total]=await Promise.all([db.payment.findMany({where,orderBy:{createdAt:'desc'},skip:(input.page-1)*25,take:25}),db.payment.count({where})]);
  res.json({items:items.map(paymentResponse),total,page:input.page,pageSize:25});
});
app.get('/api/admin/payments/:id',async(req,res)=>{
  const payment=await db.payment.findUniqueOrThrow({where:{id:String(req.params.id)},include:{application:{select:{name:true,code:true}},source:{select:{name:true,merchantName:true}},sourceVersion:{select:{version:true,hash:true}},match:{include:{transaction:true}}}});
  const [auditLogs,webhook]=await Promise.all([db.auditLog.findMany({where:{resourceId:payment.id},orderBy:{createdAt:'desc'}}),db.webhookEvent.findUnique({where:{paymentId:payment.id},include:{deliveries:true}})]);
  res.json({...paymentResponse(payment),application:payment.application,source:payment.source,version:payment.sourceVersion,match:payment.match,auditLogs,webhook});
});
app.get('/api/admin/transactions',async(req,res)=>{
  const input=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),query:z.string().max(100).default(''),status:z.enum(['ALL','UNMATCHED','MATCHED','AMBIGUOUS','LATE_PAYMENT']).default('ALL')}).parse(req.query);
  const where={...(input.query?{reference:{contains:input.query}}:{}),...(input.status==='ALL'?{}:{status:input.status})};
  const [items,total]=await Promise.all([db.providerTransaction.findMany({where,orderBy:[{transactionAt:'desc'},{id:'desc'}],skip:(input.page-1)*25,take:25,include:{source:{select:{name:true}},match:{select:{paymentId:true,type:true}}}}),db.providerTransaction.count({where})]);
  res.json({items,total,page:input.page,pageSize:25});
});
app.get('/api/admin/transactions/:id',async(req,res)=>{
  const transaction=await db.providerTransaction.findUnique({where:{id:String(req.params.id)},include:{source:{select:{name:true,merchantName:true}},match:{include:{payment:{select:{id:true,referenceId:true,status:true,payAmount:true,paidAt:true,application:{select:{name:true}}}}}}}});
  if(!transaction)throw new AppError('TRANSACTION_NOT_FOUND','Transaksi tidak ditemukan.',404);
  const auditLogs=await db.auditLog.findMany({where:{OR:[{resourceId:transaction.id},...(transaction.match?[{resourceId:transaction.match.paymentId}]:[])]},orderBy:{createdAt:'desc'},take:100});
  res.json({...transaction,auditLogs});
});
app.get('/api/admin/webhooks/:id',async(req,res)=>res.json(await db.webhookEvent.findUniqueOrThrow({where:{id:String(req.params.id)},include:{deliveries:{orderBy:{createdAt:'desc'}}}})));
app.post('/api/admin/settings',async(req,res)=>{
  const settings=settingsSchema.parse(req.body);
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'PAYMENT_SETTINGS_UPDATED',resourceId:'GLOBAL',metadata:settings}});
  res.json(settings);
});
app.get('/api/admin/users',async(req,res)=>{
  if(res.locals.user.role!=='SUPER_ADMIN')throw new AppError('FORBIDDEN','Hanya Super Admin.',403);
  res.json(await db.user.findMany({select:{id:true,email:true,role:true,createdAt:true},orderBy:{createdAt:'desc'}}));
});
app.post('/api/admin/users',async(req,res)=>{
  if(res.locals.user.role!=='SUPER_ADMIN')throw new AppError('FORBIDDEN','Hanya Super Admin.',403);
  const input=z.object({email:z.email(),password:z.string().min(12).max(200),role:z.enum(['SUPER_ADMIN','ADMIN','VIEWER'])}).strict().parse(req.body);
  const passwordHash=await bcrypt.hash(input.password,12);
  const user=await serial(async tx=>{
    const user=await tx.user.create({data:{email:input.email,role:input.role,passwordHash}});
    await audit(tx,res.locals.user.id,'USER_CREATED',user.id,{role:user.role});
    return {id:user.id,email:user.email,role:user.role};
  });res.status(201).json(user);
});
app.get('/api/admin/sources/:id/versions',async(req,res)=>res.json(await db.sourceVersion.findMany({where:{sourceId:String(req.params.id)},select:{id:true,version:true,hash:true,merchantData:true,createdAt:true,archivedAt:true},orderBy:{version:'desc'}})));
app.post('/api/admin/sources/:id/versions',async(req,res)=>{
  const input=z.object({payload:z.string().max(5000),filename:z.string().max(200)}).strict().parse(req.body);
  const merchant=validateQRIS(input.payload,true);
  const result=await serial(async tx=>{
    const source=await tx.paymentSource.findUniqueOrThrow({where:{id:String(req.params.id)}});
    const latest=await tx.sourceVersion.findFirst({where:{sourceId:source.id},orderBy:{version:'desc'}});
    if(latest?.hash===merchant.hash)throw new AppError('UNCHANGED_QRIS','QRIS sama dengan versi saat ini.',409);
    if(source.mpan!==(merchant.mpan||null)||source.merchantName!==merchant.merchantName)throw new AppError('MERCHANT_CHANGED','Identitas merchant berbeda. Tambahkan sebagai source baru.',409);
    if(source.activeVersionId)await tx.sourceVersion.update({where:{id:source.activeVersionId},data:{archivedAt:new Date()}});
    const version=await tx.sourceVersion.create({data:{sourceId:source.id,version:(latest?.version||0)+1,payload:input.payload,hash:merchant.hash,merchantData:JSON.parse(JSON.stringify(merchant))}});
    await audit(tx,res.locals.user.id,'QRIS_VERSION_CREATED',source.id,{versionId:version.id});
    return tx.paymentSource.update({where:{id:source.id},data:{activeVersionId:version.id,status:'VALIDATED',filename:input.filename,city:merchant.city,mcc:merchant.mcc}});
  });res.status(201).json(result);
});
app.get('/api/admin/overview',async(req,res)=>{
  await expirePayments();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  const start=new Date(today+'T00:00:00+07:00'),end=new Date(start.getTime()+86400000);
  const [payments,transactions,sources,webhooks,counts,todayCount,todayPaid,unmatched,webhookFailed,provider]=await Promise.all([
    db.payment.findMany({orderBy:{createdAt:'desc'},take:100}),db.providerTransaction.findMany({orderBy:{createdAt:'desc'},take:100}),db.paymentSource.findMany(),db.webhookEvent.findMany({orderBy:{createdAt:'desc'},take:100}),
    db.payment.groupBy({by:['status'],_count:true}),db.payment.count({where:{createdAt:{gte:start,lt:end}}}),db.payment.aggregate({where:{status:'PAID',paidAt:{gte:start,lt:end}},_sum:{payAmount:true}}),db.providerTransaction.count({where:{status:{not:'MATCHED'}}}),db.webhookEvent.count({where:{status:'FAILED'}}),browserControl('status')
  ]);
  const count=(status:string)=>counts.find(c=>c.status===status)?._count||0;
  res.json({mode:process.env.NODE_ENV||'development',mockEnabled:simulationEnabled(),payments:payments.map(paymentResponse),transactions,sources,webhooks,stats:{todayAmount:todayPaid._sum.payAmount||0,todayCount,paid:count('PAID'),pending:count('PENDING'),expired:count('EXPIRED'),unmatched,webhookFailed},provider});
});
app.get('/api/admin/browser-session',async(req,res)=>res.json(await browserControl('status')));
app.post('/api/admin/browser-session/:action',async(req,res)=>{
  const action=z.enum(['login','check','restore','sync','close']).parse(req.params.action);
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'BRI_BROWSER_'+action.toUpperCase(),resourceId:'BRI_MERCHANT',metadata:{}}});
  res.json(await browserControl(action));
});
app.get('/api/admin/sources',async(req,res)=>res.json(await db.paymentSource.findMany({orderBy:{createdAt:'desc'}})));
app.post('/api/admin/sources/verify',upload.single('image'),async(req,res)=>{
  if(!req.file) throw new AppError('IMAGE_REQUIRED','Unggah gambar QRIS.');
  const payload=await decodeQRImage(req.file.buffer),merchant=validateQRIS(payload,true);
  res.json({payload,filename:req.file.originalname.slice(0,200),merchant});
});
app.post('/api/admin/sources',async(req,res)=>{
  const input=z.object({name:z.string().min(2).max(100),payload:z.string().max(5000),filename:z.string().max(200)}).parse(req.body);
  const merchant=validateQRIS(input.payload,true);
  const source=await serial(async tx=>{
    const source=await tx.paymentSource.create({data:{name:input.name,merchantName:merchant.merchantName,city:merchant.city,mpan:merchant.mpan,mcc:merchant.mcc,filename:input.filename}});
    const version=await tx.sourceVersion.create({data:{sourceId:source.id,version:1,payload:input.payload,hash:merchant.hash,merchantData:JSON.parse(JSON.stringify(merchant))}});
    await audit(tx,res.locals.user.id,'QRIS_SOURCE_VALIDATED',source.id);
    return tx.paymentSource.update({where:{id:source.id},data:{activeVersionId:version.id}});
  });
  res.status(201).json(source);
});
app.post('/api/admin/sources/:id/test',async(req,res)=>{
  const {amount}=z.object({amount:z.number().int().min(100).max(10000000)}).parse(req.body);
  const source=await db.paymentSource.findUniqueOrThrow({where:{id:String(req.params.id)}});
  const version=await db.sourceVersion.findUniqueOrThrow({where:{id:source.activeVersionId!}});
  const payload=generateQRIS(version.payload,amount);
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'QRIS_TEST_GENERATED',resourceId:version.id,metadata:{amount}}});
  res.json({payload,image:await QRCode.toDataURL(payload,{width:360,errorCorrectionLevel:'M',margin:4}),amount});
});
app.post('/api/admin/sources/:id/status',async(req,res)=>{
  const {status}=z.object({status:z.enum(['TESTED','ACTIVE','DISABLED'])}).parse(req.body);
  res.json(await serial(async tx=>{
    const source=await tx.paymentSource.findUniqueOrThrow({where:{id:String(req.params.id)}});
    if(status==='TESTED' && source.status!=='VALIDATED') throw new AppError('INVALID_TRANSITION','Source harus VALIDATED.');
    if(status==='TESTED' && !await tx.auditLog.findFirst({where:{resourceId:source.activeVersionId!,event:'QRIS_TEST_GENERATED'}})) throw new AppError('TEST_REQUIRED','Generate dan periksa test QR terlebih dahulu.');
    if(status==='ACTIVE' && !['TESTED','DISABLED'].includes(source.status)) throw new AppError('TEST_REQUIRED','Uji QR dan tandai TESTED terlebih dahulu.');
    if(status==='ACTIVE'&&source.status==='DISABLED'&&!await tx.auditLog.findFirst({where:{resourceId:source.activeVersionId!,event:'QRIS_VERSION_TESTED'}}))throw new AppError('TEST_REQUIRED','Versi QRIS harus ditandai diuji sebelum diaktifkan.');
    if(status==='TESTED')await audit(tx,res.locals.user.id,'QRIS_VERSION_TESTED',source.activeVersionId!);
    await audit(tx,res.locals.user.id,'PAYMENT_SOURCE_'+status,source.id);
    return tx.paymentSource.update({where:{id:source.id},data:{status}});
  }));
});
app.get('/api/admin/applications',async(req,res)=>{
  const apps=await db.application.findMany({include:{keys:{select:{id:true,name:true,prefix:true,status:true,environment:true,lastUsedAt:true}}}});
  res.json(await Promise.all(apps.map(async({webhookSecret,...a})=>({...a,hasWebhookSecret:!!webhookSecret,settings:(await db.auditLog.findFirst({where:{event:'APPLICATION_SETTINGS_UPDATED',resourceId:a.id},orderBy:{createdAt:'desc'}}))?.metadata||{payment_source_id:null,expiry_minutes:null}}))));
});
app.post('/api/admin/applications/:id/settings',async(req,res)=>{
  const input=z.object({payment_source_id:z.string().nullable(),expiry_minutes:z.number().int().min(1).max(1440).nullable()}).strict().parse(req.body);
  await serial(async tx=>{
    await tx.application.findUniqueOrThrow({where:{id:String(req.params.id)}});
    if(input.payment_source_id)await tx.paymentSource.findUniqueOrThrow({where:{id:input.payment_source_id}});
    await audit(tx,res.locals.user.id,'APPLICATION_SETTINGS_UPDATED',String(req.params.id),input);
  });res.json(input);
});
app.post('/api/admin/applications',async(req,res)=>{
  const input=z.object({name:z.string().min(2).max(100),code:z.string().regex(/^[A-Z0-9_]{2,50}$/)}).parse(req.body);
  res.status(201).json(await db.application.create({data:input}));
});
app.post('/api/admin/applications/:id/status',async(req,res)=>{
  const {status}=z.object({status:z.enum(['ACTIVE','DISABLED'])}).strict().parse(req.body);
  res.json(await serial(async tx=>{
    const application=await tx.application.update({where:{id:String(req.params.id)},data:{status}});
    await audit(tx,res.locals.user.id,'APPLICATION_'+status,application.id);
    const {webhookSecret,...safe}=application;return safe;
  }));
});
app.post('/api/admin/applications/:id/keys',async(req,res)=>{
  const input=z.object({name:z.string().min(1).max(100),environment:z.enum(['test','live']),expires_at:z.iso.datetime().nullable().optional()}).parse(req.body);
  if(input.expires_at&&new Date(input.expires_at)<=new Date())throw new AppError('INVALID_EXPIRY','Expiry key harus di masa depan.');
  const token=`rz_${input.environment}_${randomBytes(32).toString('hex')}`;
  const key=await db.apiKey.create({data:{applicationId:String(req.params.id),name:input.name,environment:input.environment,prefix:token.slice(0,16),hash:payloadHash(token),expiresAt:input.expires_at?new Date(input.expires_at):null}});
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'API_KEY_CREATED',resourceId:key.id,metadata:{}}});
  res.status(201).json({id:key.id,api_key:token,message:'Simpan sekarang; secret hanya ditampilkan sekali.'});
});
app.post('/api/admin/keys/:id/revoke',async(req,res)=>{await serial(async tx=>{await tx.apiKey.update({where:{id:String(req.params.id)},data:{status:'REVOKED'}});await audit(tx,res.locals.user.id,'API_KEY_REVOKED',String(req.params.id));});res.json({ok:true});});
app.post('/api/admin/applications/:id/webhook',async(req,res)=>{
  const input=z.object({url:z.url().startsWith('https://'),secret:z.string().min(32).max(200)}).parse(req.body);
  await db.application.update({where:{id:String(req.params.id)},data:{webhookUrl:input.url,webhookSecret:encrypt(input.secret)}});
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'WEBHOOK_CONFIGURED',resourceId:String(req.params.id),metadata:{}}});
  res.json({ok:true});
});
app.get('/api/admin/audit',async(req,res)=>res.json(await db.auditLog.findMany({orderBy:{createdAt:'desc'},take:200})));
app.post('/api/admin/reconciliation',async(req,res)=>{
  const input=z.object({payment_id:z.string(),transaction_id:z.string()}).parse(req.body);
  res.json(paymentResponse(await manualMatch(input.payment_id,input.transaction_id,res.locals.user.id)));
});
app.post('/api/admin/webhooks/:id/retry',async(req,res)=>{
  const event=await db.webhookEvent.findUniqueOrThrow({where:{id:String(req.params.id)}});
  if(!event.endpoint || !['FAILED','PENDING'].includes(event.status)) throw new AppError('INVALID_RETRY','Event tidak dapat diulang.');
  const reset=await db.webhookEvent.updateMany({where:{id:event.id,status:{in:['FAILED','PENDING']}},data:{status:'PENDING',attempts:0,nextRetryAt:new Date()}});
  if(!reset.count)throw new AppError('INVALID_RETRY','Event sedang dikirim.',409);
  await db.auditLog.create({data:{actor:res.locals.user.id,event:'WEBHOOK_RETRY_REQUESTED',resourceId:event.id,metadata:{}}});res.json({ok:true});
});
app.use('/v1',consumer);
app.post('/v1/payments',async(req,res)=>{
  const key=z.string().min(1).max(100).parse(req.headers['idempotency-key']);
  const input=paymentInput.parse(req.body);
  if(res.locals.application.code==='MINI_POS'&&!simulationEnabled()){
    const state=await posReadiness();
    if(!state.ready)throw new AppError('BRI_NOT_READY',state.message,503);
    if(input.payment_source_id&&input.payment_source_id!==state.sourceId)throw new AppError('SOURCE_MISMATCH','Source berbeda dari merchant collector.',409);
    input.payment_source_id=state.sourceId!;
  }
  res.status(201).json(paymentResponse(await createPayment(res.locals.application.id,input,key)));
});
app.get('/v1/payments/:id',async(req,res)=>{
  await expirePayments();
  const p=await db.payment.findFirst({where:{id:String(req.params.id),applicationId:res.locals.application.id}});
  if(!p) throw new AppError('PAYMENT_NOT_FOUND','Payment tidak ditemukan.',404);
  res.json(paymentResponse(p));
});
app.get('/v1/payments/:id/qris',async(req,res)=>{
  const p=await db.payment.findFirst({where:{id:String(req.params.id),applicationId:res.locals.application.id}});
  if(!p) throw new AppError('PAYMENT_NOT_FOUND','Payment tidak ditemukan.',404);
  if(p.status!=='PENDING'||p.expiresAt<=new Date()) throw new AppError('PAYMENT_EXPIRED','QR sudah tidak aktif.',410);
  res.set('Cache-Control','no-store');
  if(req.query.format==='svg') res.type('svg').send(await QRCode.toString(p.qrPayload,{type:'svg',margin:4}));
  else res.type('png').send(await QRCode.toBuffer(p.qrPayload,{margin:4,width:400}));
});
app.post('/v1/payments/:id/cancel',async(req,res)=>{
  const payment=await db.payment.findFirst({where:{id:String(req.params.id),applicationId:res.locals.application.id}});
  if(!payment)throw new AppError('PAYMENT_NOT_FOUND','Payment tidak ditemukan.',404);
  await serial(async tx=>{
    const result=await tx.payment.updateMany({where:{id:payment.id,status:'PENDING'},data:{status:'CANCELLED'}});
    if(!result.count)throw new AppError('INVALID_STATUS','Payment tidak bisa dibatalkan.',409);
    await audit(tx,res.locals.application.id,'PAYMENT_CANCELLED',payment.id);
  });res.json({ok:true});
});
app.post('/v1/payments/:id/simulate',async(req,res)=>{
  if(!simulationEnabled()||res.locals.environment!=='test')throw new AppError('NOT_FOUND','Endpoint tidak tersedia.',404);
  const payment=await db.payment.findFirst({where:{id:String(req.params.id),applicationId:res.locals.application.id,status:'PENDING',expiresAt:{gt:new Date()}}});
  if(!payment)throw new AppError('PAYMENT_NOT_FOUND','Payment aktif tidak ditemukan.',404);
  await ingestTransaction({sourceId:payment.sourceId,provider:'MOCK',reference:'MOCK_'+payment.id,amount:payment.payAmount,transactionAt:new Date(),providerStatus:'SUCCESS'});
  res.json(paymentResponse(await db.payment.findUniqueOrThrow({where:{id:payment.id}})));
});
export const products=[{id:'kopi',name:'Kopi',price:5000,emoji:'☕'},{id:'teh',name:'Teh',price:4000,emoji:'🍵'},{id:'air',name:'Air Mineral',price:3000,emoji:'💧'},{id:'mie',name:'Mie Instan',price:7000,emoji:'🍜'},{id:'roti',name:'Roti',price:6000,emoji:'🥐'},{id:'snack',name:'Snack',price:8000,emoji:'🍿'}];
// POS is a reference consumer backend: no payment API key is exposed to the browser.
app.use('/api/pos',admin);
app.use('/api/pos',async(req,res,next)=>{
  if(!process.env.MINI_POS_URL)return next();
  const response=await fetch(process.env.MINI_POS_URL+req.originalUrl,{method:req.method,headers:{'Content-Type':'application/json','X-Rizpay-Internal':internalToken()},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body),signal:AbortSignal.timeout(20000)});
  res.status(response.status).type('json').send(await response.text());
});
app.get('/api/pos/products',(req,res)=>res.json(products));
app.get('/api/pos/readiness',async(req,res)=>res.json(await posReadiness()));
app.post('/api/pos/checkout',async(req,res)=>{
  const readiness=await posReadiness();
  if(!readiness.ready)throw new AppError('BRI_NOT_READY',readiness.message,503);
  const input=z.object({reference_id:z.string().min(1).max(100),items:z.array(z.object({id:z.string(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)}).parse(req.body);
  let amount=0;
  for(const item of input.items){const product=products.find(p=>p.id===item.id);if(!product) throw new AppError('INVALID_PRODUCT','Produk tidak ditemukan.');amount+=product.price*item.quantity;}
  const application=await db.application.findUniqueOrThrow({where:{code:'MINI_POS'}});
  if(application.status!=='ACTIVE') throw new AppError('APPLICATION_DISABLED','Mini POS dinonaktifkan.',403);
  const p=await createPayment(application.id,{reference_id:input.reference_id,amount,description:'Pembelian Mini POS',...(readiness.sourceId?{payment_source_id:readiness.sourceId}:{})},input.reference_id);
  res.status(201).json({...paymentResponse(p),qr_image:await QRCode.toDataURL(p.qrPayload,{width:360,margin:4}),mock_enabled:simulationEnabled(),merchant_name:readiness.merchantName,payment_mode:readiness.mode});
});
async function posPayment(req:Request){
  const p=await db.payment.findFirst({where:{id:String(req.params.id),application:{code:'MINI_POS'}}});
  if(!p) throw new AppError('PAYMENT_NOT_FOUND','Payment tidak ditemukan.',404);return p;
}
app.get('/api/pos/payments/:id',async(req,res)=>{await expirePayments();res.json(paymentResponse(await posPayment(req)));});
app.post('/api/pos/payments/:id/cancel',async(req,res)=>{
  const p=await posPayment(req);
  const result=await db.payment.updateMany({where:{id:p.id,status:'PENDING'},data:{status:'CANCELLED'}});
  if(!result.count) throw new AppError('INVALID_STATUS','Payment tidak bisa dibatalkan.',409);
  res.json({ok:true});
});
app.post('/api/pos/payments/:id/simulate',async(req,res)=>{
  if(!simulationEnabled()) throw new AppError('NOT_FOUND','Endpoint tidak tersedia.',404);
  const p=await posPayment(req);
  if(p.status!=='PENDING' || p.expiresAt<=new Date()) throw new AppError('INVALID_STATUS','Payment tidak aktif.',409);
  await ingestTransaction({sourceId:p.sourceId,provider:'MOCK',reference:'MOCK_'+p.id,amount:p.payAmount,transactionAt:new Date(),providerStatus:'SUCCESS'});
  res.json(paymentResponse(await posPayment(req)));
});
app.use((req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint tidak ditemukan.'}}));
app.use((error:unknown,req:Request,res:Response,next:NextFunction)=>{
  if(error instanceof z.ZodError) return res.status(400).json({error:{code:'INVALID_REQUEST',message:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}});
  if(error instanceof AppError) return res.status(error.status).json({error:{code:error.code,message:error.message}});
  if(error instanceof multer.MulterError) return res.status(400).json({error:{code:'INVALID_UPLOAD',message:'Gambar maksimal 5 MB.'}});
  if(error instanceof Error && /QR|TLV|CRC|merchant|Payload|Format|Nominal/.test(error.message)) return res.status(400).json({error:{code:'INVALID_QRIS',message:error.message}});
  if(error && typeof error==='object' && 'code' in error && error.code==='P2025') return res.status(404).json({error:{code:'NOT_FOUND',message:'Data tidak ditemukan.'}});
  if(error && typeof error==='object' && 'code' in error && error.code==='P2002') return res.status(409).json({error:{code:'DUPLICATE_RECORD',message:'Data sudah ada.'}});
  console.error(JSON.stringify({event:'request_failed',path:req.path,type:error instanceof Error?error.name:'Unknown',code:error&&typeof error==='object'&&'code' in error?String(error.code):undefined}));
  res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Terjadi kesalahan internal.'}});
});
