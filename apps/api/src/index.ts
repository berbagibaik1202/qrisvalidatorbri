import { app } from './app.js';
import { db } from '../../../packages/database/src.js';
import { expirePayments } from '../../../packages/payment-core/src/index.js';
import { closeAllocationLock } from '../../../packages/payment-core/src/lock.js';
const port=Number(process.env.PORT||3001);
const server=app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'api_started',port})));
const interval=setInterval(()=>expirePayments().catch(()=>console.error(JSON.stringify({event:'expiry_error'}))),10000);
async function stop(){clearInterval(interval);server.close();await closeAllocationLock();await db.$disconnect();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
