import { z } from 'zod';
import { db } from '../../database/src.js';
export const settingsSchema=z.object({
  expiryMinutes:z.number().int().min(1).max(1440),
  uniqueCodeMax:z.number().int().min(1).max(999),
  cooldownMinutes:z.number().int().min(1).max(1440),
  minAmount:z.number().int().min(100).max(10000000),
  maxAmount:z.number().int().min(100).max(10000000),
  activeCollectorSeconds:z.number().int().min(5).max(300).default(5),
  idleCollectorSeconds:z.number().int().min(5).max(3600).default(30)
}).strict().refine(v=>v.maxAmount>=v.minAmount,'Batas maksimum harus >= minimum');
export async function paymentSettings(){
  const saved=await db.auditLog.findFirst({where:{event:'PAYMENT_SETTINGS_UPDATED',resourceId:'GLOBAL'},orderBy:{createdAt:'desc'}});
  return settingsSchema.parse(saved?.metadata??{
    expiryMinutes:Number(process.env.PAYMENT_EXPIRY_MINUTES||15),uniqueCodeMax:Number(process.env.UNIQUE_CODE_MAX||999),
    cooldownMinutes:Number(process.env.COOLDOWN_MINUTES||30),minAmount:Number(process.env.MIN_AMOUNT||100),maxAmount:Number(process.env.MAX_AMOUNT||10000000),
    activeCollectorSeconds:Number(process.env.BRI_ACTIVE_INTERVAL_SECONDS||5),idleCollectorSeconds:Number(process.env.BRI_IDLE_INTERVAL_SECONDS||30)
  });
}
