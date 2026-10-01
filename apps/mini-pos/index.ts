import {createPOS} from './server.js';
const pos=createPOS(process.env.MINI_POS_DATABASE||'data/mini-pos/orders.db',process.env.RIZPAY_API_URL||'http://127.0.0.1:3001');
const server=pos.app.listen(Number(process.env.MINI_POS_PORT||3011),process.env.MINI_POS_HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'mini_pos_started'})));
function stop(){server.close(()=>{pos.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
