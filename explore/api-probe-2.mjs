const API = 'https://virtual-data-room-production.up.railway.app';
const run = Date.now().toString(36);
async function req(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
async function register(tag) {
  const email = `qa-${run}-${tag}@example.com`;
  const r = await req('POST', '/auth/register', { body: { name: 'QA ' + tag, email, password: 'Passw0rd!' } });
  const rooms = await req('GET', '/data-rooms', { token: r.json.accessToken });
  return { email, token: r.json.accessToken, roomId: rooms.json.items[0].id };
}
const out = (id, msg, obj) => console.log(`[${id}] ${msg}`, obj !== undefined ? JSON.stringify(obj).slice(0, 500) : '');
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
async function put(url, bytes = PDF) {
  const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', new Blob([bytes], { type: 'application/pdf' }), 'x');
  return (await fetch(url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } })).status;
}
async function upload(token, roomId, name, folderId) {
  const i = await req('POST', '/files/upload-intent', { token, body: { dataRoomId: roomId, folderId, name, size: PDF.length, mimeType: 'application/pdf' } });
  await put(i.json.uploadUrl);
  const c = await req('POST', `/files/${i.json.fileId}/complete`, { token });
  return { id: i.json.fileId, name: c.json.name ?? i.json.name };
}

const o = await register('o');
const v = await register('v');

// complete without PUT
const i0 = await req('POST', '/files/upload-intent', { token: o.token, body: { dataRoomId: o.roomId, name: 'never.pdf', size: 5, mimeType: 'application/pdf' } });
const c0 = await req('POST', `/files/${i0.json.fileId}/complete`, { token: o.token });
out('P1', `complete with no bytes uploaded -> ${c0.status}`, c0.json);

// concurrent full uploads with same name -> duplicates visible?
const ups = await Promise.all(Array.from({ length: 4 }, () => upload(o.token, o.roomId, 'Term Sheet.pdf')));
out('P2', 'concurrent full uploads names', ups.map((u) => u.name));
const list = await req('GET', `/data-rooms/${o.roomId}/contents?limit=100`, { token: o.token });
out('P2b', 'listing names', list.json.items.map((x) => x.name));

// sequential conflict suffixing
const s1 = await upload(o.token, o.roomId, 'nda.pdf');
const s2 = await upload(o.token, o.roomId, 'NDA.PDF');
const s3 = await upload(o.token, o.roomId, 'nda.pdf');
out('P3', 'sequential conflict names', [s1.name, s2.name, s3.name]);

// rename conflicts
const rn = await req('PATCH', `/files/${s3.id}`, { token: o.token, body: { name: 'nda.pdf' } });
out('P4', `rename onto existing name -> ${rn.status}`, rn.json.name);
const rnSelfCase = await req('PATCH', `/files/${s1.id}`, { token: o.token, body: { name: 'NDA.pdf' } });
out('P4b', `rename to own name different case -> ${rnSelfCase.status}`, rnSelfCase.json.name);

// folders: conflicts, nesting, rename, move
const fA = (await req('POST', '/folders', { token: o.token, body: { name: 'Legal', dataRoomId: o.roomId } })).json;
const fA2 = await req('POST', '/folders', { token: o.token, body: { name: 'legal', dataRoomId: o.roomId } });
const fB = (await req('POST', '/folders', { token: o.token, body: { name: 'Finance', dataRoomId: o.roomId } })).json;
const fA_sub = (await req('POST', '/folders', { token: o.token, body: { name: 'Contracts', dataRoomId: o.roomId, parentId: fA.id } })).json;
const renConf = await req('PATCH', `/folders/${fB.id}`, { token: o.token, body: { name: 'LEGAL' } });
const renSelf = await req('PATCH', `/folders/${fA.id}`, { token: o.token, body: { name: 'LEGAL' } });
const long = await req('POST', '/folders', { token: o.token, body: { name: 'x'.repeat(201), dataRoomId: o.roomId } });
const empty = await req('POST', '/folders', { token: o.token, body: { name: '   ', dataRoomId: o.roomId } });
out('P5', 'folder dup-case create, rename-conflict, rename-self-case, 201 chars, whitespace', [fA2.status, renConf.status, renSelf.status, long.status, empty.status]);
const mv = await req('PATCH', `/files/${s1.id}/move`, { token: o.token, body: { targetFolderId: fA_sub.id } });
const mvBack = await upload(o.token, o.roomId, 'NDA.pdf');
const mv2 = await req('PATCH', `/files/${mvBack.id}/move`, { token: o.token, body: { targetFolderId: fA_sub.id } });
out('P6', 'move -> status, move into conflict -> name', [mv.status, mv2.json.name]);
const foreign = (await req('POST', '/folders', { token: v.token, body: { name: 'mine', dataRoomId: v.roomId } })).json;
const mvForeign = await req('PATCH', `/files/${s2.id}/move`, { token: o.token, body: { targetFolderId: foreign.id } });
out('P6b', `move into other user's folder -> ${mvForeign.status}`);

// delete-preview counts
const prev = await req('GET', `/folders/${fA.id}/delete-preview`, { token: o.token });
out('P7', 'delete preview for Legal (expect 1 folder, 2 files)', prev.json);

// breadcrumbs for viewer with folder share on nested folder
await req('POST', '/shares', { token: o.token, body: { resourceType: 'FOLDER', resourceId: fA_sub.id, mode: 'USER', granteeEmail: v.email } });
const bcOwner = await req('GET', `/folders/${fA_sub.id}/breadcrumbs`, { token: o.token });
const bcViewer = await req('GET', `/folders/${fA_sub.id}/breadcrumbs`, { token: v.token });
out('P8', 'breadcrumbs owner vs viewer', { owner: bcOwner.json, viewer: bcViewer.json });
const parentAsViewer = await req('GET', `/folders/${fA.id}/contents`, { token: v.token });
out('P8b', `viewer reads parent of shared folder -> ${parentAsViewer.status}`);

// file share then move out of scope; file in shared folder moved out
const fileInSub = s1; // in Contracts now
const fileView1 = await req('GET', `/files/${fileInSub.id}`, { token: v.token });
await req('PATCH', `/files/${fileInSub.id}/move`, { token: o.token, body: { targetFolderId: null } });
const fileView2 = await req('GET', `/files/${fileInSub.id}`, { token: v.token });
out('P9', 'viewer reads file in shared folder, then after owner moves it to root', [fileView1.status, fileView2.status]);

// revoke USER share
const shares = await req('GET', `/shares?resourceType=FOLDER&resourceId=${fA_sub.id}`, { token: o.token });
const shareId = shares.json.items[0].id;
const before = await req('GET', `/folders/${fA_sub.id}/contents`, { token: v.token });
const viewUrlBeforeRevoke = await req('GET', `/files/${mvBack.id}/view-url`, { token: v.token });
await req('DELETE', `/shares/${shareId}`, { token: o.token });
const after = await req('GET', `/folders/${fA_sub.id}/contents`, { token: v.token });
const signedStill = viewUrlBeforeRevoke.json.url ? (await fetch(viewUrlBeforeRevoke.json.url)).status : 'n/a';
out('P10', 'viewer before revoke, after revoke, previously issued signed URL after revoke', [before.status, after.status, signedStill]);
const revokeAgain = await req('DELETE', `/shares/${shareId}`, { token: o.token });
const revokeByViewer = await req('DELETE', `/shares/${shareId}`, { token: v.token });
out('P10b', 'revoke twice (owner), revoke by non-owner', [revokeAgain.status, revokeByViewer.status]);

// share of a pending (never uploaded) file
const pend = await req('POST', '/files/upload-intent', { token: o.token, body: { dataRoomId: o.roomId, name: 'pending.pdf', size: 5, mimeType: 'application/pdf' } });
const shPend = await req('POST', '/shares', { token: o.token, body: { resourceType: 'FILE', resourceId: pend.json.fileId, mode: 'USER', granteeEmail: v.email } });
const recv = await req('GET', '/shares/received', { token: v.token });
const pendView = await req('GET', `/files/${pend.json.fileId}`, { token: v.token });
out('P11', `share pending file -> ${shPend.status}; viewer sees in received:`, { names: recv.json.items.map((x) => x.resourceName), openStatus: pendView.status });
const pendRename = await req('PATCH', `/files/${pend.json.fileId}`, { token: o.token, body: { name: 'nda.pdf' } });
out('P11b', `rename pending (invisible) file -> ${pendRename.status}`, pendRename.json.name);

// pagination integrity: 9 folders + 5 files, page by 4
for (let k = 0; k < 9; k++) await req('POST', '/folders', { token: v.token, body: { name: `F${k}`, dataRoomId: v.roomId, parentId: foreign.id } });
for (let k = 0; k < 5; k++) await upload(v.token, v.roomId, `doc-${k}.pdf`, foreign.id);
const seen = []; let cursor; let pages = 0;
do {
  const p = await req('GET', `/folders/${foreign.id}/contents?limit=4${cursor ? `&cursor=${cursor}` : ''}`, { token: v.token });
  seen.push(...p.json.items.map((x) => x.name)); cursor = p.json.nextCursor; pages++;
} while (cursor && pages < 10);
out('P12', `pagination pages=${pages}, total=${seen.length}, unique=${new Set(seen).size}`, seen);

// JWT tampering
const [h, p] = o.token.split('.');
const noneTok = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + p + '.';
const forged = h + '.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'x' })).toString('base64url') + '.' + o.token.split('.')[2];
out('P13', 'alg=none, forged payload, garbage', [(await req('GET', '/auth/me', { token: noneTok })).status, (await req('GET', '/auth/me', { token: forged })).status, (await req('GET', '/auth/me', { token: 'abc' })).status]);

// email handling
const dupCase = await req('POST', '/auth/register', { body: { name: 'x', email: o.email.toUpperCase(), password: 'Passw0rd!' } });
const loginCase = await req('POST', '/auth/login', { body: { email: o.email.toUpperCase(), password: 'Passw0rd!' } });
const shortPw = await req('POST', '/auth/register', { body: { name: 'x', email: `qa-${run}-pw@example.com`, password: '1234567' } });
const loginUnknown = await req('POST', '/auth/login', { body: { email: `nobody-${run}@example.com`, password: 'Passw0rd!' } });
out('P14', 'register dup email (upper), login upper-case email, 7-char pw, unknown user', [dupCase.status, loginCase.status, shortPw.status, loginUnknown.status, loginUnknown.json.message]);

// share validation
const badShare = await Promise.all([
  req('POST', '/shares', { token: o.token, body: { resourceType: 'FOLDER', resourceId: fA.id, mode: 'USER' } }),
  req('POST', '/shares', { token: o.token, body: { resourceType: 'FOLDER', resourceId: fA.id, mode: 'USER', granteeEmail: 'not-email' } }),
  req('POST', '/shares', { token: o.token, body: { resourceType: 'FILE', resourceId: fA.id, mode: 'PUBLIC_LINK' } }),
]);
out('P15', 'share without email, bad email, type/id mismatch', badShare.map((r) => r.status));
const pubA = await req('POST', '/shares', { token: o.token, body: { resourceType: 'FOLDER', resourceId: fA.id, mode: 'PUBLIC_LINK' } });
const pubB = await req('POST', '/shares', { token: o.token, body: { resourceType: 'FOLDER', resourceId: fA.id, mode: 'PUBLIC_LINK' } });
out('P15b', 'public link idempotent (same token twice?)', pubA.json.token === pubB.json.token);
const pubSub = await req('GET', `/public/${pubA.json.token}/folders/${fA_sub.id}/contents`);
out('P15c', `public folder link -> nested subfolder contents ${pubSub.status}`);

console.log(JSON.stringify({ o: o.email, v: v.email }));
