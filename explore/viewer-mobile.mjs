import { chromium } from '@playwright/test';
const WEB='https://virtual-data-room-ten.vercel.app', API='https://virtual-data-room-production.up.railway.app';
const run=Date.now().toString(36); const dir=new URL('.',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const j=async(m,p,t,b)=>{const r=await fetch(API+p,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return r.json().catch(()=>null)};
const email=`qa-${run}-vm@example.com`; const {accessToken:t}=await j('POST','/auth/register',null,{name:'QA vm',email,password:'Passw0rd!'});
const room=(await j('GET','/data-rooms',t)).items[0].id;
const fs=await import('node:fs'); const pdf=fs.readFileSync(dir+'../fixtures/files/Term Sheet.pdf');
const i=await j('POST','/files/upload-intent',t,{dataRoomId:room,name:'Term Sheet.pdf',size:pdf.length,mimeType:'application/pdf'});
const fd=new FormData();fd.append('cacheControl','3600');fd.append('',new Blob([pdf],{type:'application/pdf'}),'x');await fetch(i.uploadUrl,{method:'PUT',body:fd});
await j('POST',`/files/${i.fileId}/complete`,t);
const {url}=await j('GET',`/files/${i.fileId}/view-url`,t); const h=await fetch(url);
console.log('[V1] view-url headers:',h.headers.get('content-type'),'| disposition:',h.headers.get('content-disposition'));
const dl=await j('GET',`/files/${i.fileId}/download-url`,t); const hd=await fetch(dl.url);
console.log('[V2] download-url disposition:',hd.headers.get('content-disposition'));
// Real Chrome, headed, to see whether <object> renders the PDF inline
const b=await chromium.launch({channel:'chrome',headless:false}).catch(e=>{console.log('no chrome channel',e.message);return null});
if(b){const p=await (await b.newContext()).newPage();await p.goto(WEB+'/login');await p.getByLabel('Email').fill(email);await p.getByLabel('Password').fill('Passw0rd!');await p.getByRole('button',{name:/sign in|log in/i}).click();await p.waitForURL(WEB+'/');
await p.goto(WEB+'/file/'+i.fileId);await p.waitForTimeout(5000);await p.screenshot({path:dir+'shots/18-viewer-real-chrome.png'});
console.log('[V3] fallback visible in real Chrome:',await p.getByText("can't preview PDFs inline").isVisible());await b.close();}
// Mobile: are row actions reachable?
const m=await chromium.launch(); const mp=await (await m.newContext({viewport:{width:375,height:740},isMobile:true,hasTouch:true})).newPage();
await mp.goto(WEB+'/login');await mp.getByLabel('Email').fill(email);await mp.getByLabel('Password').fill('Passw0rd!');await mp.getByRole('button',{name:/sign in|log in/i}).click();await mp.waitForURL(WEB+'/');await mp.waitForLoadState('networkidle');
const info=await mp.evaluate(()=>{const tb=document.querySelector('table');const w=tb.parentElement;const btn=[...document.querySelectorAll('table tbody tr button')].pop();const r=btn?.getBoundingClientRect();return{wrapperScroll:w.scrollWidth,wrapperClient:w.clientWidth,actionBtnLeft:r?.left,viewport:innerWidth}});
console.log('[M1] mobile table/actions:',JSON.stringify(info));
await mp.screenshot({path:dir+'shots/19-mobile-actions.png'});await m.close();
