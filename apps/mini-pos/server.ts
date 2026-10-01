import 'dotenv/config';
import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';
import {products} from './catalog.js';
import {verifyWebhook} from './webhook.js';
import {internalAuthorized,internalToken} from './auth.js';
import {simulationEnabled} from '../../packages/payment-core/src/mode.js';
export function createPOS(databasePath:string,apiURL:string){
  if(databasePath!==':memory:')mkdirSync(dirname(databasePath),{recursive:true});
  const store=new DatabaseSync(databasePath);
  store.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS orders (reference TEXT PRIMARY KEY, payment_id TEXT UNIQUE, amount INTEGER NOT NULL, payment TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (event_id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, received_at TEXT NOT NULL)');
  const app=express();app.disable('x-powered-by');
  let apiKey=process.env.MINI_POS_API_KEY||'',webhookSecret=process.env.MINI_POS_WEBHOOK_SECRET||'';
  let bootstrap:Promise<void>|undefined;
  async function ready(){
    if(apiKey&&webhookSecret)return;
    bootstrap??=(async()=>{
      const r=await fetch(apiURL+'/internal/mini-pos/bootstrap',{method:'POST',headers:{'X-Rizpay-Internal':internalToken()}});
      if(!r.ok)throw new Error('Bootstrap Mini POS gagal');
      const result=await r.json();apiKey=result.api_key;webhookSecret=result.webhook_secret;
    })().catch(e=>{bootstrap=undefined;throw e;});
    await bootstrap;
  }
  async function paymentAPI(path:string,body?:unknown,idempotency?:string){
    await ready();const r=await fetch(apiURL+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',...(idempotency?{'Idempotency-Key':idempotency}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error?.message||'Payment API gagal'),{status:r.status});return data;
  }
  async function readiness(){
    const r=await fetch(apiURL+'/internal/mini-pos/readiness',{headers:{'X-Rizpay-Internal':internalToken()},signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw new Error('Kesiapan pembayaran tidak dapat diperiksa');return r.json();
  }
  async function qrImage(payment:{qris:{image_url:string}}){
    const qr=await fetch(apiURL+payment.qris.image_url,{headers:{Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(15000)});
    if(qr.status===410)return null;
    if(!qr.ok)throw new Error('QR image gagal');return 'data:image/png;base64,'+Buffer.from(await qr.arrayBuffer()).toString('base64');
  }
  app.get('/health',(_req,res)=>res.json({status:'HEALTHY',service:'MINI_POS'}));
  app.post('/api/webhooks/rizpay',express.raw({type:'application/json',limit:'100kb'}),async(req,res)=>{
    await ready();
    if(!Buffer.isBuffer(req.body)||!verifyWebhook(webhookSecret,String(req.headers['x-rizpay-timestamp']||''),req.body,String(req.headers['x-rizpay-signature']||'')))return res.status(401).json({error:{message:'Signature tidak valid'}});
    const event=z.object({event:z.literal('payment.paid'),event_id:z.string(),data:z.object({payment_id:z.string(),reference_id:z.string(),paid_amount:z.number().int().positive()})}).parse(JSON.parse(req.body.toString('utf8')));
    if(req.headers['x-rizpay-event-id']!==event.event_id)return res.status(400).json({error:{message:'Event ID tidak sesuai'}});
    const order=store.prepare('SELECT payment,amount FROM orders WHERE reference=? AND payment_id=?').get(event.data.reference_id,event.data.payment_id);
    if(!order)return res.status(409).json({error:{message:'Order tidak ditemukan'}});
    const payment=JSON.parse(String(order.payment));
    if(payment.pay_amount!==event.data.paid_amount)return res.status(409).json({error:{message:'Nominal tidak sesuai'}});
    const receipt=store.prepare('SELECT payment_id FROM receipts WHERE event_id=?').get(event.event_id);
    if(receipt&&receipt.payment_id!==event.data.payment_id)return res.status(409).json({error:{message:'Event ID sudah digunakan'}});
    store.exec('BEGIN IMMEDIATE');
    try{
      store.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?)').run(event.event_id,event.data.payment_id,new Date().toISOString());
      store.prepare('UPDATE orders SET payment=? WHERE payment_id=?').run(JSON.stringify({...payment,status:'PAID'}),event.data.payment_id);
      store.exec('COMMIT');
    }catch(e){store.exec('ROLLBACK');throw e;}
    res.json({ok:true});
  });
  app.use(express.json({limit:'100kb'}));
  app.use('/api/pos',(req,res,next)=>{if(!internalAuthorized(String(req.headers['x-rizpay-internal']||'')))return res.status(401).json({error:{message:'Unauthorized'}});next();});
  app.get('/api/pos/products',(_req,res)=>res.json(products));
  app.get('/api/pos/orders',(_req,res)=>res.json(store.prepare('SELECT payment FROM orders ORDER BY rowid DESC LIMIT 20').all().map(row=>JSON.parse(String(row.payment)))));
  app.get('/api/pos/readiness',async(_req,res)=>res.json(await readiness()));
  app.post('/api/pos/checkout',async(req,res)=>{
    const input=z.object({reference_id:z.string().min(1).max(100),items:z.array(z.object({id:z.string(),quantity:z.number().int().min(1).max(100)})).min(1).max(50)}).parse(req.body);
    let amount=0;for(const item of input.items){const p=products.find(p=>p.id===item.id);if(!p)return res.status(400).json({error:{message:'Produk tidak ditemukan'}});amount+=p.price*item.quantity;}
    const existing=store.prepare('SELECT amount FROM orders WHERE reference=?').get(input.reference_id);
    if(existing&&existing.amount!==amount)return res.status(409).json({error:{message:'Reference dipakai untuk order berbeda'}});
    const state=await readiness();
    if(!state.ready)return res.status(503).json({error:{code:'BRI_NOT_READY',message:state.message}});
    let payment=await paymentAPI('/v1/payments',{reference_id:input.reference_id,amount,description:'Pembelian Mini POS',...(state.sourceId?{payment_source_id:state.sourceId}:{})},input.reference_id);
    store.prepare('INSERT INTO orders VALUES (?,?,?,?) ON CONFLICT(reference) DO UPDATE SET payment=excluded.payment').run(input.reference_id,payment.payment_id,amount,JSON.stringify(payment));
    let qr_image:string|undefined;
    if(payment.status==='PENDING'){
      const image=await qrImage(payment);
      if(image)qr_image=image;
      else{payment=await paymentAPI('/v1/payments/'+payment.payment_id);store.prepare('UPDATE orders SET payment=? WHERE payment_id=?').run(JSON.stringify(payment),payment.payment_id);}
    }
    res.status(201).json({...payment,qr_image,mock_enabled:simulationEnabled(),merchant_name:state.merchantName,payment_mode:state.mode});
  });
  app.use('/api/pos/payments/:id',(req,res,next)=>{if(!store.prepare('SELECT payment_id FROM orders WHERE payment_id=?').get(String(req.params.id)))return res.status(404).json({error:{message:'Order tidak ditemukan'}});next();});
  app.get('/api/pos/payments/:id',async(req,res)=>{
    const payment=await paymentAPI('/v1/payments/'+req.params.id);
    store.prepare('UPDATE orders SET payment=? WHERE payment_id=?').run(JSON.stringify(payment),String(req.params.id));
    const receipt=store.prepare('SELECT received_at FROM receipts WHERE payment_id=? LIMIT 1').get(String(req.params.id));
    const image=req.query.include_qr==='1'&&payment.status==='PENDING'?await qrImage(payment):null;
    res.json({...payment,webhook_received:!!receipt,mock_enabled:simulationEnabled(),payment_mode:simulationEnabled()?'TEST':'LIVE',...(image?{qr_image:image}:{})});
  });
  for(const action of ['cancel','simulate'])app.post('/api/pos/payments/:id/'+action,async(req,res)=>{
    const result=await paymentAPI('/v1/payments/'+req.params.id+'/'+action,{});
    const payment=action==='cancel'?await paymentAPI('/v1/payments/'+req.params.id):result;
    store.prepare('UPDATE orders SET payment=? WHERE payment_id=?').run(JSON.stringify(payment),String(req.params.id));
    res.json(result);
  });
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof z.ZodError||error instanceof SyntaxError?400:(error as {status?:number}).status||502).json({error:{message:error instanceof z.ZodError||error instanceof SyntaxError?'Permintaan tidak valid':'Mini POS gagal memproses permintaan'}}));
  return {app,close:()=>store.close()};
}
