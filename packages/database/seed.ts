import { db } from './src.js';
import bcrypt from 'bcryptjs';
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD minimal 8 karakter');
await db.user.upsert({where:{email:process.env.ADMIN_EMAIL || 'admin@rizpay.local'},update:{},create:{email:process.env.ADMIN_EMAIL || 'admin@rizpay.local',passwordHash:await bcrypt.hash(process.env.ADMIN_PASSWORD,12)}});
await db.application.upsert({where:{code:'MINI_POS'},update:{},create:{code:'MINI_POS',name:'Rizpay Mini POS'}});
console.log('Admin dan aplikasi Mini POS siap. Kredensial berasal dari .env.');
await db.$disconnect();
