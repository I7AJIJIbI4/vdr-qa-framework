// Re-checks three claims that came from the second session and had no recorded evidence:
//   BUG-05 (declared size not enforced), BUG-13 (deleted file stays in public view), BUG-14 (Retry on invalid link).
// Usage: node explore/probe-5-crosscheck.mjs > explore/probe-5-crosscheck.out.txt
import { chromium } from '@playwright/test';

const WEB = 'https://virtual-data-room-ten.vercel.app';
const API = 'https://virtual-data-room-production.up.railway.app';
const run = Date.now().toString(36);
const shots = new URL('../docs/evidence/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
};
async function put(url, bytes) {
  const fd = new FormData();
  fd.append('cacheControl', '3600');
  fd.append('', new Blob([bytes], { type: 'application/pdf' }), 'x');
  return (await fetch(url, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } })).status;
}
async function upload(token, roomId, name, bytes, folderId, declaredSize = bytes.length) {
  const i = (await call('POST', '/files/upload-intent', token, { dataRoomId: roomId, folderId, name, size: declaredSize, mimeType: 'application/pdf' })).body;
  const putStatus = await put(i.uploadUrl, bytes);
  const done = await call('POST', `/files/${i.fileId}/complete`, token);
  return { id: i.fileId, putStatus, completeStatus: done.status };
}

const { accessToken: token } = (await call('POST', '/auth/register', null, { name: 'QA crosscheck', email: `qa-${run}-xc@example.com`, password: 'Passw0rd!' })).body;
const roomId = (await call('GET', '/data-rooms', token)).body.items[0].id;
const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

// BUG-05: declare 1000 bytes, upload 2 MB
const big = new Uint8Array(2 * 1024 * 1024);
big.set(pdf);
const sized = await upload(token, roomId, 'declared-1000.pdf', big, undefined, 1000);
const stored = (await call('GET', `/files/${sized.id}`, token)).body;
console.log(`[BUG-05] declared size 1000, sent ${big.length} bytes -> PUT ${sized.putStatus}, complete ${sized.completeStatus}, stored size ${stored.size}`);

// BUG-13: deleted file in an open public view
const folder = (await call('POST', '/folders', token, { name: 'Public', dataRoomId: roomId })).body;
const keep = await upload(token, roomId, 'keep.pdf', pdf, folder.id);
const gone = await upload(token, roomId, 'gone.pdf', pdf, folder.id);
const link = (await call('POST', '/shares', token, { resourceType: 'FOLDER', resourceId: folder.id, mode: 'PUBLIC_LINK' })).body.token;

const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
await page.goto(`${WEB}/share/${link}`);
await page.getByText('gone.pdf').waitFor();
await call('DELETE', `/files/${gone.id}`, token);
const row = page.locator('tr', { hasText: 'gone.pdf' });
await row.getByRole('button').last().click();
const download = page.getByRole('menuitem', { name: 'Download' });
if (await download.isVisible().catch(() => false)) await download.click();
await page.waitForTimeout(2500);
const toast = await page.locator('[data-sonner-toast]').allInnerTexts();
const stillListed = await row.count();
await page.screenshot({ path: `${shots}bug-13-deleted-file-still-listed.png` });
console.log(`[BUG-13] after owner deleted gone.pdf: toast=${JSON.stringify(toast)} | row still listed: ${stillListed > 0}`);

// BUG-14: invalid token page
await page.goto(`${WEB}/share/not-a-real-token-${run}`);
await page.waitForLoadState('networkidle');
const text = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
const retry = await page.getByRole('button', { name: /retry/i }).count();
await page.screenshot({ path: `${shots}bug-14-invalid-link-retry.png` });
console.log(`[BUG-14] invalid link page: "${text.slice(0, 160)}" | Retry buttons: ${retry}`);

await browser.close();
console.log(`(keep.pdf ${keep.completeStatus}; account qa-${run}-xc@example.com)`);
