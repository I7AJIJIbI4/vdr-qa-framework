// PI-01: does moving a file into a publicly linked folder expose it to the existing link?
const API='https://virtual-data-room-production.up.railway.app'; const run=Date.now().toString(36);
const j=async(m,p,t,b)=>{const r=await fetch(API+p,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...(t?{authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});const x=await r.text();try{return{s:r.status,j:JSON.parse(x)}}catch{return{s:r.status,j:x}}};
const {j:{accessToken:t}}=await j('POST','/auth/register',null,{name:'QA move',email:`qa-${run}-mv@example.com`,password:'Passw0rd!'});
const room=(await j('GET','/data-rooms',t)).j.items[0].id;
const pub=(await j('POST','/folders',t,{name:'Public teaser',dataRoomId:room})).j;
const link=(await j('POST','/shares',t,{resourceType:'FOLDER',resourceId:pub.id,mode:'PUBLIC_LINK'})).j.token;
const PDF='%PDF-1.4\n%%EOF';const i=(await j('POST','/files/upload-intent',t,{dataRoomId:room,name:'CONFIDENTIAL valuation.pdf',size:PDF.length,mimeType:'application/pdf'})).j;
const fd=new FormData();fd.append('',new Blob([PDF],{type:'application/pdf'}),'x');await fetch(i.uploadUrl,{method:'PUT',body:fd});await j('POST',`/files/${i.fileId}/complete`,t);
const before=(await j('GET',`/public/${link}/folders/${pub.id}/contents`)).j.items.map(x=>x.name);
await j('PATCH',`/files/${i.fileId}/move`,t,{targetFolderId:pub.id});
const after=(await j('GET',`/public/${link}/folders/${pub.id}/contents`)).j.items.map(x=>x.name);
const view=await j('GET',`/public/${link}/files/${i.fileId}/view-url`);
console.log('[PI-01] public listing before move:',JSON.stringify(before),'after move:',JSON.stringify(after),'anonymous view-url:',view.s);
