import puppeteer,{type Browser,type Page} from 'puppeteer-core';
import {existsSync,readdirSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {BRI_LOGIN_URL,BRI_TRANSACTIONS_URL,type SessionHealth} from './config.js';
export function executablePath(){
  if(process.env.BRI_BROWSER_EXECUTABLE){if(!existsSync(process.env.BRI_BROWSER_EXECUTABLE))throw new Error('BROWSER_NOT_FOUND');return process.env.BRI_BROWSER_EXECUTABLE;}
  const candidates=[join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),'/usr/bin/chromium','/usr/bin/google-chrome'];
  const cache=join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'ms-playwright');
  if(existsSync(cache))for(const entry of readdirSync(cache).filter(e=>/^chromium-\d+$/.test(e)).sort().reverse())candidates.push(join(cache,entry,'chrome-win64/chrome.exe'));
  const executable=candidates.find(existsSync);if(!executable)throw new Error('BROWSER_NOT_FOUND');return executable;
}
export class BriBrowserSession {
  browser?:Browser;page?:Page;private visible=false;private loginAttempted=false;private manualLogin=false;
  automaticLoginConfigured(){return process.env.BRI_AUTO_LOGIN_ENABLED==='true'&&!!process.env.BRI_USERNAME?.trim()&&!!process.env.BRI_PASSWORD;}
  private health:SessionHealth={status:'DISABLED',browserOpen:false,loginUrl:BRI_LOGIN_URL,transactionsUrl:BRI_TRANSACTIONS_URL,lastCheck:null,lastSync:null,message:'Buka browser login untuk menghubungkan akun BRI Merchant.',collector:'NOT_CONFIGURED'};
  snapshot():SessionHealth{return {...this.health,browserOpen:!!this.browser?.connected};}
  setSync(at:string){this.health.lastSync=at;this.health.collector='READY';this.health.message='Sinkronisasi transaksi BRI terverifikasi berhasil.';}
  setPreviousSync(at:string){this.health.lastSync=at;}
  setNetworkConnected(){this.health.status='CONNECTED';this.health.lastCheck=new Date().toISOString();this.loginAttempted=false;this.manualLogin=false;}
  setLoginRequired(){this.health.status='LOGIN_REQUIRED';this.health.collector='ERROR';this.health.lastCheck=new Date().toISOString();this.health.message='Sesi API BRI berakhir. Pulihkan sesi atau login kembali.';}
  setCollectorError(message:string){this.health.collector='ERROR';this.health.message=message;}
  setSessionError(message:string){this.health.status='ERROR';this.health.message=message;}
  private async launch(visible:boolean){
    // Keep the authenticated browser even when the requested display mode differs.
    if(this.browser?.connected){
      if(!this.page||this.page.isClosed()){const pages=await this.browser.pages();this.page=pages.find(p=>!p.isClosed())||await this.browser.newPage();}
      return;
    }
    if(await this.attachExisting())return;
    await this.close();const profile=resolve(process.env.BRI_BROWSER_PROFILE||'data/browser/bri');mkdirSync(profile,{recursive:true});
    this.browser=await puppeteer.launch({executablePath:executablePath(),userDataDir:profile,headless:!visible,defaultViewport:visible?null:{width:1440,height:1000},timeout:30000,args:process.env.BRI_BROWSER_DISABLE_SANDBOX==='true'?['--no-sandbox']:[]});this.visible=visible;
    const pages=await this.browser.pages();this.page=pages[0]||await this.browser.newPage();this.page.setDefaultTimeout(15000);this.page.setDefaultNavigationTimeout(30000);
    this.browser.on('disconnected',()=>{this.health.status='DISABLED';this.health.browserOpen=false;this.health.message='Browser ditutup. Buka kembali untuk melanjutkan sesi.';});
  }
  private async navigate(url:string){
    const response=await this.page!.goto(url,{waitUntil:'domcontentloaded'});await new Promise(resolve=>setTimeout(resolve,1000));
    const blocked=await this.page!.$('iframe#main-iframe');
    if((response&&[401,403,429].includes(response.status()))||blocked){this.health.status='ERROR';this.health.message='Akses dibatasi proteksi BRI. Periksa browser dan selesaikan tantangan resmi jika tersedia.';return false;}return true;
  }
  async openLogin(){this.manualLogin=true;await this.launch(true);this.health.lastCheck=new Date().toISOString();if(await this.navigate(BRI_LOGIN_URL)){this.health.status='LOGIN_REQUIRED';this.health.message='Browser login terbuka di komputer worker. Login dan OTP dilakukan langsung di portal BRI.';}await this.page!.bringToFront();return this.snapshot();}
  async check(){
    this.health.lastCheck=new Date().toISOString();if(!this.browser?.connected||!this.page){this.health.status='DISABLED';return this.snapshot();}
    if(this.page.isClosed())await this.launch(this.visible);
    if(!await this.navigate(BRI_TRANSACTIONS_URL))return this.snapshot();
    await this.page.waitForFunction(marker=>{
      if(document.querySelector('input[type=password]'))return true;
      if(marker&&document.querySelector(marker))return true;
      const title=Array.from(document.querySelectorAll('h1,h2,h3')).some(e=>e.textContent?.trim()==='Daftar Transaksi');
      const mpan=Array.from(document.querySelectorAll('p')).some(e=>/^MPAN\s*:\s*\d{18,19}$/.test(e.textContent?.trim()||''));
      if(document.querySelector('#transaction-revamp-list')&&title&&mpan&&document.querySelector('#search-input[type=search]'))return true;
      const links=Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')?.includes('/transaksi'));
      const logout=Array.from(document.querySelectorAll('button,a')).some(e=>/^logout$|^log out$|^keluar$/i.test(e.textContent?.trim()||''));
      return links&&logout&&Array.from(document.querySelectorAll('h1,h2,h3,nav')).some(e=>/transaksi|merchant/i.test(e.textContent||''));
    },{timeout:10000},process.env.BRI_AUTHENTICATED_SELECTOR||'').catch(()=>{});
    const url=new URL(this.page.url()),password=await this.page.$('input[type=password]');
    if(url.origin!==new URL(BRI_TRANSACTIONS_URL).origin||url.pathname.startsWith('/auth')||password){this.health.status='LOGIN_REQUIRED';this.health.message='Sesi BRI belum login atau sudah berakhir.';return this.snapshot();}
    const marker=process.env.BRI_AUTHENTICATED_SELECTOR;
    const authenticated=marker?!!await this.page.$(marker):await this.page.evaluate(()=>{
      const portalList=document.querySelector('#transaction-revamp-list');
      const portalTitle=Array.from(document.querySelectorAll('h1,h2,h3')).some(e=>e.textContent?.trim()==='Daftar Transaksi');
      const mpan=Array.from(document.querySelectorAll('p')).some(e=>/^MPAN\s*:\s*\d{18,19}$/.test(e.textContent?.trim()||''));
      if(portalList&&portalTitle&&mpan&&document.querySelector('#search-input[type=search]'))return true;
      const links=Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')?.includes('/transaksi'));
      const logout=Array.from(document.querySelectorAll('a,button')).some(el=>/^logout$|^log out$|^keluar$/i.test(el.textContent?.trim()||''));
      const merchant=Array.from(document.querySelectorAll('h1,h2,h3,nav')).some(el=>/transaksi|merchant/i.test(el.textContent||''));return links&&logout&&merchant;
    });
    if(!authenticated){this.health.status='ERROR';this.health.message='Halaman transaksi belum terverifikasi. Marker sesi perlu disesuaikan dari halaman merchant yang sah.';return this.snapshot();}
    this.loginAttempted=false;this.manualLogin=false;this.health.status='CONNECTED';this.health.message=this.health.collector==='READY'?'Sesi BRI terhubung dan collector aktif.':'Sesi BRI terhubung. Collector akan memeriksa kecocokan payment source dan detail transaksi.';return this.snapshot();
  }
  async automaticLogin(){
    if(!this.automaticLoginConfigured()||this.manualLogin)return this.snapshot();
    if(this.loginAttempted){this.health.message='Login otomatis belum berhasil. Periksa kredensial, lalu pulihkan sesi untuk mencoba kembali.';return this.snapshot();}
    this.loginAttempted=true;
    try{
      if(!await this.navigate(BRI_LOGIN_URL))return this.snapshot();
      const page=this.page!;
      await page.waitForSelector('#username',{visible:true,timeout:10000});
      const safe=await page.evaluate(origin=>{
        if(location.origin!==origin||location.pathname!=='/auth/login')return false;
        if(document.querySelector('iframe[src*="captcha"], [class*="captcha"], input[autocomplete="one-time-code"], #otp'))return false;
        const username=document.querySelector<HTMLInputElement>('#username');
        const password=document.querySelector<HTMLInputElement>('#confirm_password');
        const form=password?.form;
        const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).filter(button=>button.textContent?.trim()==='Masuk');
        return !!username&&password?.type==='password'&&username.form===password.form&&(!form||new URL(form.action||location.href).origin===origin)&&buttons.length===1&&(!form||buttons[0].form===form);
      },new URL(BRI_LOGIN_URL).origin);
      if(!safe){this.health.status='LOGIN_REQUIRED';this.health.message='Form login berubah atau membutuhkan verifikasi manual. Buka Browser Session.';return this.snapshot();}
      for(const [selector,value] of [['#username',process.env.BRI_USERNAME!.trim()],['#confirm_password',process.env.BRI_PASSWORD!]]){
        await page.$eval(selector,el=>(el as HTMLInputElement).select());await page.keyboard.press('Backspace');await page.type(selector,value);
      }
      await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).find(button=>button.textContent?.trim()==='Masuk')!.click());
      await page.waitForFunction(()=>!location.pathname.startsWith('/auth'),{timeout:15000}).catch(()=>{});
      if(new URL(page.url()).pathname.startsWith('/auth')){
        this.health.status='LOGIN_REQUIRED';this.health.message='Login otomatis belum selesai. Periksa kredensial atau selesaikan OTP/verifikasi melalui Browser Session.';return this.snapshot();
      }
      return await this.check();
    }catch{
      this.health.status='LOGIN_REQUIRED';this.health.message='Login otomatis gagal. Periksa kredensial atau form portal melalui Browser Session.';return this.snapshot();
    }
  }
  async restore(automatic=false){if(automatic&&(this.manualLogin||this.loginAttempted))return this.snapshot();if(!automatic){this.manualLogin=false;this.loginAttempted=false;}await this.launch(process.env.BRI_BROWSER_VISIBLE!=='false');const state=await this.check();return state.status==='LOGIN_REQUIRED'?this.automaticLogin():state;}
  async attachExisting(){
    const file=resolve(process.env.BRI_BROWSER_PROFILE||'data/browser/bri','DevToolsActivePort');if(!existsSync(file))return false;
    const port=readFileSync(file,'utf8').split('\n')[0].trim();if(!/^\d+$/.test(port))return false;
    try{
      const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+port});
      const pages=await browser.pages();
      const page=pages.find(p=>{try{return new URL(p.url()).origin===new URL(BRI_LOGIN_URL).origin;}catch{return false;}})||pages.find(p=>p.url()==='about:blank')||await browser.newPage();
      this.browser=browser;this.page=page;this.visible=true;page.setDefaultNavigationTimeout(30000);page.setDefaultTimeout(15000);
      browser.on('disconnected',()=>{this.health.status='DISABLED';this.health.browserOpen=false;});return true;
    }catch{return false;}
  }
  async close(){if(this.browser?.connected)await this.browser.close();this.browser=undefined;this.page=undefined;this.health.status='DISABLED';this.health.browserOpen=false;}
}
