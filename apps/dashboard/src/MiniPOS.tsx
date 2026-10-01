import {useEffect,useState} from 'react';
import {ArrowRight,Check,Plus,QrCode,Store} from 'lucide-react';
const money=(value:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const time=(value:string)=>new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
async function request(path:string,body?:unknown){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Permintaan gagal');return result;
}
type Payment={payment_id:string;reference_id:string;amount:number;unique_code:number;pay_amount:number;status:string;expires_at:string;provider_reference:string|null;qr_image?:string;mock_enabled?:boolean;merchant_name?:string;webhook_received?:boolean};
type Readiness={ready:boolean;mode:string;message:string;merchantName:string|null};
const draftKey='rizpay.pos.checkout';
export function MiniPOS({action}:{action:(fn:()=>Promise<void>)=>Promise<void>}){
  const [products,setProducts]=useState<{id:string;name:string;price:number;emoji:string}[]>([]);
  const [cart,setCart]=useState<Record<string,number>>({}),[payment,setPayment]=useState<Payment|null>(null);
  const [reference,setReference]=useState('POS_'+crypto.randomUUID()),[busy,setBusy]=useState(false);
  const [readiness,setReadiness]=useState<Readiness|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
  const [orders,setOrders]=useState<Payment[]>([]);
  useEffect(()=>{
    request('/api/pos/products').then(setProducts).catch(e=>setError(e.message));
    let active=true;
    const load=()=>{
      request('/api/pos/orders').then(value=>{if(active)setOrders(value);}).catch(()=>{});
      return request('/api/pos/readiness').then(state=>{if(active)setReadiness(state);}).catch(()=>{if(active)setReadiness({ready:false,mode:'LIVE',message:'Layanan pembayaran belum dapat dihubungi.',merchantName:null});});
    };
    void load();const timer=setInterval(load,5000);
    try{
      const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');
      if(saved?.reference){setReference(saved.reference);setCart(saved.cart||{});}
      if(saved?.paymentId)request('/api/pos/payments/'+saved.paymentId+'?include_qr=1').then(p=>{if(active)setPayment(p);}).catch(e=>{if(active)setError(e.message);});
    }catch{sessionStorage.removeItem(draftKey);}
    return()=>{active=false;clearInterval(timer);};
  },[]);
  useEffect(()=>{
    if(!payment||!['PENDING','PAID'].includes(payment.status))return;
    let active=true;
    const timer=setInterval(()=>{
      setNow(Date.now());
      request('/api/pos/payments/'+payment.payment_id).then(p=>{if(active){setPayment(current=>({...current,...p}));setError('');}}).catch(e=>{if(active)setError('Status belum dapat diperbarui: '+e.message);});
    },2000);
    return()=>{active=false;clearInterval(timer);};
  },[payment?.payment_id,payment?.status]);
  const total=products.reduce((sum,p)=>sum+p.price*(cart[p.id]||0),0);
  const remaining=payment?Math.max(0,Math.ceil((new Date(payment.expires_at).getTime()-now)/1000)):0;
  const activeQR=payment?.status==='PENDING'&&remaining>0;
  function clear(){sessionStorage.removeItem(draftKey);setPayment(null);setCart({});setReference('POS_'+crypto.randomUUID());setError('');}
  return <>
    <div className="dev-note"><Store size={17}/><span>{readiness?.mode==='TEST'?'Lingkungan pengujian':'Pembayaran QRIS langsung melalui BRI Merchant'} · {readiness?.merchantName||'Memeriksa merchant'}</span></div>
    <div role="status" className={readiness?.ready?'notice':'error'}>{readiness?.message||'Memeriksa kesiapan pembayaran…'}</div>
    {error&&<div role="alert" className="error">{error}</div>}
    <div className="pos-grid"><div className="panel products"><div className="panel-heading"><h2>Produk</h2><span>Katalog Mini POS</span></div><div className="product-grid">{products.map(p=><button className="product" key={p.id} onClick={()=>setCart(c=>({...c,[p.id]:(c[p.id]||0)+1}))}><span className="product-emoji">{p.emoji}</span><strong>{p.name}</strong><small>{money(p.price)}</small><span className="product-add"><Plus size={15}/></span></button>)}</div></div>
    <div className="panel cart"><div className="panel-heading"><h2>Keranjang</h2><span>{Object.values(cart).reduce((a,b)=>a+b,0)} items</span></div>{products.filter(p=>cart[p.id]).map(p=><div className="cart-row" key={p.id}><div><strong>{p.name}</strong><small>{money(p.price)}</small></div><div className="quantity"><button onClick={()=>setCart(c=>({...c,[p.id]:Math.max(0,c[p.id]-1)}))}>−</button>{cart[p.id]}<button onClick={()=>setCart(c=>({...c,[p.id]:c[p.id]+1}))}>+</button></div></div>)}{!total&&<p>Pilih produk untuk memulai transaksi.</p>}<div className="cart-total"><span>Total</span><strong>{money(total)}</strong></div>
    <button className="primary full" disabled={!total||busy||!readiness?.ready} onClick={()=>void action(async()=>{
      setBusy(true);setError('');sessionStorage.setItem(draftKey,JSON.stringify({reference,cart}));
      try{const p=await request('/api/pos/checkout',{reference_id:reference,items:Object.entries(cart).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity}))});setPayment(p);setNow(Date.now());sessionStorage.setItem(draftKey,JSON.stringify({reference,cart,paymentId:p.payment_id}));}finally{setBusy(false);}
    })}><QrCode size={18}/>{busy?'Memproses…':'Bayar QRIS'}</button><p className="cart-note">Bayar sesuai nominal akhir, termasuk kode unik.</p></div></div>
    {!!orders.length&&<div className="panel settings pos-orders"><h2>Transaksi terakhir</h2>{orders.map(order=><div className="setting-row" key={order.payment_id}><span><strong>{order.reference_id}</strong><br/>{money(order.pay_amount)} · {order.status}</span><button className="secondary" onClick={()=>void action(async()=>{const p=await request('/api/pos/payments/'+order.payment_id+'?include_qr=1');setPayment(p);setReference(p.reference_id);setNow(Date.now());sessionStorage.setItem(draftKey,JSON.stringify({reference:p.reference_id,cart:{},paymentId:p.payment_id}));})}>Buka pembayaran</button></div>)}</div>}
    {payment&&<div className="modal-backdrop"><div className="modal payment-modal">{payment.status==='PAID'?<><div className="success-icon"><Check size={35}/></div><span className="eyebrow">PEMBAYARAN BERHASIL</span><h2>{money(payment.pay_amount)}</h2><p>Pembayaran telah dikonfirmasi.</p><p>Ref: {payment.provider_reference}</p><button className="primary full" onClick={clear}>Transaksi baru<ArrowRight size={16}/></button></>:<><span className="eyebrow">{activeQR?'SCAN QRIS':'QRIS TIDAK AKTIF'}</span><h2>{money(payment.pay_amount)}</h2><p>{payment.merchant_name||readiness?.merchantName}</p><p>Subtotal {money(payment.amount)} + kode unik {payment.unique_code}</p>{activeQR&&payment.qr_image&&<img src={payment.qr_image} alt="QRIS pembayaran"/>}<p role="status">{activeQR?'Menunggu pembayaran dan konfirmasi BRI…':payment.status==='PENDING'?'Waktu pembayaran habis. Memeriksa konfirmasi terakhir…':payment.status}</p>{activeQR&&<p>Sisa waktu {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</p>}<p>Berlaku sampai {time(payment.expires_at)} WIB</p>{error&&<div role="alert" className="error">{error}</div>}{payment.mock_enabled&&activeQR&&<button className="primary full" onClick={()=>void action(async()=>{const p=await request('/api/pos/payments/'+payment.payment_id+'/simulate',{});setPayment(current=>({...current,...p}));})}>Simulasikan pembayaran · MOCK</button>}<button className="secondary full" onClick={()=>void action(async()=>{if(payment.status==='PENDING')await request('/api/pos/payments/'+payment.payment_id+'/cancel',{});clear();})}>{payment.status==='PENDING'?'Batalkan':'Tutup'}</button></>}</div></div>}
  </>;
}
