// Exploratory probes against prod. Each probe prints a verdict line.
const API = 'https://virtual-data-room-production.up.railway.app';
const run = Date.now().toString(36);

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function register(tag, name = 'QA ' + tag) {
  const email = `qa-${run}-${tag}@example.com`;
  const r = await req('POST', '/auth/register', { body: { name, email, password: 'Passw0rd!' } });
  const token = r.json.accessToken;
  const rooms = await req('GET', '/data-rooms', { token });
  return { email, token, roomId: rooms.json.items?.[0]?.id, reg: r };
}

const out = (id, msg, obj) => console.log(`[${id}] ${msg}`, obj !== undefined ? JSON.stringify(obj).slice(0, 400) : '');

const owner = await register('owner');
const other = await register('other');
out('setup', 'owner room', { roomId: owner.roomId });

// H-whitespace-name: register with whitespace-only name
const ws = await req('POST', '/auth/register', { body: { name: '   ', email: `qa-${run}-ws@example.com`, password: 'Passw0rd!' } });
if (ws.status === 201) {
  const me = await req('GET', '/auth/me', { token: ws.json.accessToken });
  out('H1', `whitespace name register -> ${ws.status}, stored name`, me.json.name);
} else out('H1', `whitespace name register -> ${ws.status}`, ws.json);

// H-room-name: data room with whitespace name
const room2 = await req('POST', '/data-rooms', { token: owner.token, body: { name: '   ' } });
out('H2', `create data room "   " -> ${room2.status}`, room2.json);
const rooms = await req('GET', '/data-rooms', { token: owner.token });
out('H2b', 'owner rooms count', rooms.json.items.length);

// H-race: concurrent folder creation with same name
const fname = `race-${run}`;
const results = await Promise.all(
  Array.from({ length: 6 }, () => req('POST', '/folders', { token: owner.token, body: { name: fname, dataRoomId: owner.roomId } })),
);
out('H3', 'concurrent same-name folder create statuses', results.map((r) => r.status));
const contents = await req('GET', `/data-rooms/${owner.roomId}/contents?limit=100`, { token: owner.token });
out('H3b', 'folders with that name in listing', contents.json.items.filter((i) => i.name === fname).length);

// H-race files: concurrent upload intents same name
const intents = await Promise.all(
  Array.from({ length: 6 }, () => req('POST', '/files/upload-intent', { token: owner.token, body: { dataRoomId: owner.roomId, name: 'dup.pdf', size: 10, mimeType: 'application/pdf' } })),
);
out('H4', 'concurrent same-name intents -> names', intents.map((r) => r.json.name));

// H-non-pdf name accepted
const exe = await req('POST', '/files/upload-intent', { token: owner.token, body: { dataRoomId: owner.roomId, name: 'invoice.exe', size: 10, mimeType: 'application/pdf' } });
out('H5', `intent with .exe name -> ${exe.status}`, exe.json.name);

// H-size bypass + content-type: declare 10 bytes, upload HTML
async function putToSigned(url, bytes, contentType) {
  const fd = new FormData();
  fd.append('cacheControl', '3600');
  fd.append('', new Blob([bytes], { type: contentType }), 'x');
  const r = await fetch(url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}
const html = '<html><body><h1 id="x">not a pdf</h1><script>document.title="pwned"</script></body></html>';
const hIntent = await req('POST', '/files/upload-intent', { token: owner.token, body: { dataRoomId: owner.roomId, name: `html-${run}.pdf`, size: 1, mimeType: 'application/pdf' } });
const put = await putToSigned(hIntent.json.uploadUrl, html, 'text/html');
out('H6a', 'PUT html bytes to signed url', put);
const comp = await req('POST', `/files/${hIntent.json.fileId}/complete`, { token: owner.token });
out('H6b', `complete -> ${comp.status}`, comp.json);
const fileDetail = await req('GET', `/files/${hIntent.json.fileId}`, { token: owner.token });
out('H6c', 'file detail (size/mime as stored)', fileDetail.json);
const view = await req('GET', `/files/${hIntent.json.fileId}/view-url`, { token: owner.token });
if (view.json.url) {
  const v = await fetch(view.json.url);
  out('H6d', `view-url serves content-type`, { ct: v.headers.get('content-type'), status: v.status, body: (await v.text()).slice(0, 60) });
}

// H-oversize: declare 1 byte, upload 51 MB
const bigIntent = await req('POST', '/files/upload-intent', { token: owner.token, body: { dataRoomId: owner.roomId, name: `big-${run}.pdf`, size: 1, mimeType: 'application/pdf' } });
const big = new Uint8Array(51 * 1024 * 1024);
big.set(new TextEncoder().encode('%PDF-1.4\n'));
const bigPut = await putToSigned(bigIntent.json.uploadUrl, big, 'application/pdf');
out('H7a', 'PUT 51MB after declaring 1 byte', bigPut);
const bigComp = await req('POST', `/files/${bigIntent.json.fileId}/complete`, { token: owner.token });
out('H7b', `complete -> ${bigComp.status}`, bigComp.json);
const bigDetail = await req('GET', `/files/${bigIntent.json.fileId}`, { token: owner.token });
out('H7c', 'stored size', bigDetail.json.size);

// H-claim share: share room to an unregistered email, then register that email
const victimEmail = `qa-${run}-future@example.com`;
const sh = await req('POST', '/shares', { token: owner.token, body: { resourceType: 'DATAROOM', resourceId: owner.roomId, mode: 'USER', granteeEmail: victimEmail } });
out('H8a', `share to unregistered email -> ${sh.status}`);
const claimer = await req('POST', '/auth/register', { body: { name: 'Anyone', email: victimEmail, password: 'Passw0rd!' } });
const claimed = await req('GET', `/data-rooms/${owner.roomId}/contents`, { token: claimer.json.accessToken });
out('H8b', `freshly registered (unverified) user reads shared room -> ${claimed.status}, items`, claimed.json.items?.length);

// H-self-share
const self = await req('POST', '/shares', { token: owner.token, body: { resourceType: 'DATAROOM', resourceId: owner.roomId, mode: 'USER', granteeEmail: owner.email } });
out('H9', `owner shares room with own email -> ${self.status}`);
const recv = await req('GET', '/shares/received', { token: owner.token });
out('H9b', 'owner "shared with me" entries', recv.json.items?.length);

// H-cross-tenant: other user reads owner's room/folder/file
const ownFolder = results.find((r) => r.status === 201)?.json;
const xs = await Promise.all([
  req('GET', `/data-rooms/${owner.roomId}/contents`, { token: other.token }),
  req('GET', `/folders/${ownFolder.id}/contents`, { token: other.token }),
  req('GET', `/folders/${ownFolder.id}/breadcrumbs`, { token: other.token }),
  req('GET', `/files/${hIntent.json.fileId}/view-url`, { token: other.token }),
  req('PATCH', `/folders/${ownFolder.id}`, { token: other.token, body: { name: 'hacked' } }),
  req('DELETE', `/files/${hIntent.json.fileId}`, { token: other.token }),
  req('POST', '/folders', { token: other.token, body: { name: 'intrude', dataRoomId: owner.roomId } }),
  req('POST', '/shares', { token: other.token, body: { resourceType: 'DATAROOM', resourceId: owner.roomId, mode: 'PUBLIC_LINK' } }),
]);
out('H10', 'cross-tenant statuses (expect all 404)', xs.map((r) => r.status));

// H-viewer write: other gets VIEWER share, tries mutations
await req('POST', '/shares', { token: owner.token, body: { resourceType: 'FOLDER', resourceId: ownFolder.id, mode: 'USER', granteeEmail: other.email } });
const vw = await Promise.all([
  req('GET', `/folders/${ownFolder.id}/contents`, { token: other.token }),
  req('PATCH', `/folders/${ownFolder.id}`, { token: other.token, body: { name: 'hacked' } }),
  req('POST', '/folders', { token: other.token, body: { name: 'sub', dataRoomId: owner.roomId, parentId: ownFolder.id } }),
  req('DELETE', `/folders/${ownFolder.id}`, { token: other.token }),
  req('GET', `/folders/${ownFolder.id}/delete-preview`, { token: other.token }),
  req('GET', `/data-rooms/${owner.roomId}/contents`, { token: other.token }),
]);
out('H11', 'viewer: read/rename/create/delete/preview/room-root (expect 200,404,404,404,404,404)', vw.map((r) => r.status));

// Public link + revoke + id substitution
const pub = await req('POST', '/shares', { token: owner.token, body: { resourceType: 'FOLDER', resourceId: ownFolder.id, mode: 'PUBLIC_LINK' } });
const tok = pub.json.token;
const p1 = await req('GET', `/public/${tok}`);
const p2 = await req('GET', `/public/${tok}/files/${hIntent.json.fileId}/view-url`); // file at root, outside folder
const p3 = await req('GET', `/public/${tok}/contents`); // room root via folder token
await req('DELETE', `/shares/${pub.json.id}`, { token: owner.token });
const p4 = await req('GET', `/public/${tok}`);
const p5 = await req('GET', `/public/${tok}/folders/${ownFolder.id}/contents`);
out('H12', 'public: summary, out-of-scope file, room root, after revoke summary, after revoke contents', [p1.status, p2.status, p3.status, p4.status, p5.status]);

// Login brute force: 12 wrong attempts
const bf = [];
for (let i = 0; i < 12; i++) bf.push((await req('POST', '/auth/login', { body: { email: owner.email, password: 'wrong' + i } })).status);
out('H13', '12 wrong logins statuses', bf);

// Rename file: extension removal / change
const rn = await req('PATCH', `/files/${hIntent.json.fileId}`, { token: owner.token, body: { name: 'renamed.exe' } });
out('H14', `rename to .exe -> ${rn.status}`, rn.json.name);

// Malformed ids / cursors
const m = await Promise.all([
  req('GET', '/folders/not-a-uuid/contents', { token: owner.token }),
  req('GET', `/data-rooms/${owner.roomId}/contents?cursor=garbage`, { token: owner.token }),
  req('GET', `/data-rooms/${owner.roomId}/contents?limit=0`, { token: owner.token }),
  req('GET', `/data-rooms/${owner.roomId}/contents?limit=101`, { token: owner.token }),
  req('GET', '/public/not-a-token'),
]);
out('H15', 'malformed id, cursor, limit=0, limit=101, bad token', m.map((r) => r.status));

// Delete folder that has an active share; check dangling share for viewer
const del = await req('DELETE', `/folders/${ownFolder.id}`, { token: owner.token });
const afterDel = await req('GET', `/folders/${ownFolder.id}/contents`, { token: other.token });
const recvOther = await req('GET', '/shares/received', { token: other.token });
out('H16', `delete shared folder -> ${del.status}; viewer reads -> ${afterDel.status}; viewer received`, recvOther.json.items?.length);

console.log(JSON.stringify({ owner: owner.email, other: other.email }));
