const API='https://virtual-data-room-production.up.railway.app'; const run=Date.now().toString(36);
const j=async(m,p,t,b)=>{const r=await fetch(API+p,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});const x=await r.text();try{return{s:r.status,j:JSON.parse(x)}}catch{return{s:r.status,j:x}}};
const reg=await j('POST','/auth/register',null,{name:'QA ghost',email:`qa-${run}-g@example.com`,password:'Passw0rd!'}); const t=reg.j.accessToken;
const room=(await j('GET','/data-rooms',t)).j.items[0].id;
const PDF='%PDF-1.4\n%%EOF';
// step 1: intent created, upload never finishes (tab closed / network drop)
const ghost=await j('POST','/files/upload-intent',t,{dataRoomId:room,name:'Q3 Report.pdf',size:PDF.length,mimeType:'application/pdf'});
// step 2: user uploads the same file again later
const i=await j('POST','/files/upload-intent',t,{dataRoomId:room,name:'Q3 Report.pdf',size:PDF.length,mimeType:'application/pdf'});
const fd=new FormData();fd.append('cacheControl','3600');fd.append('',new Blob([PDF],{type:'application/pdf'}),'x');
await fetch(i.j.uploadUrl,{method:'PUT',body:fd});
const c=await j('POST',`/files/${i.j.fileId}/complete`,t);
const list=(await j('GET',`/data-rooms/${room}/contents`,t)).j.items.map(x=>x.name);
console.log('[G1] second upload name:',c.j.name,'| visible listing:',JSON.stringify(list));
// step 3: user tries renaming it back to the clean name
const rn=await j('PATCH',`/files/${i.j.fileId}`,t,{name:'Q3 Report.pdf'});
console.log('[G2] rename back to "Q3 Report.pdf" ->',rn.s,rn.j.name);
