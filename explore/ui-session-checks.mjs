// Two session checks:
//  1. Cross-user cache: after A signs out and B signs in, A's data must never render, not even for one frame.
//  2. PI-10: signed-out visit to /shared-with-me -> sign in -> where do we land?
import { chromium } from '@playwright/test';

const WEB = 'https://virtual-data-room-ten.vercel.app';
const API = 'https://virtual-data-room-production.up.railway.app';
const run = Date.now().toString(36);
const call = async (method, path, token, body) =>
  (await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })).json();

async function register(tag) {
  const email = `qa-${run}-${tag}@example.com`;
  const { accessToken } = await call('POST', '/auth/register', null, { name: `QA ${tag}`, email, password: 'Passw0rd!' });
  const roomId = (await call('GET', '/data-rooms', accessToken)).items[0].id;
  return { email, token: accessToken, roomId };
}

const a = await register('cacheA');
const b = await register('cacheB');
const secret = `SECRET-A-${run}`;
const folder = await call('POST', '/folders', a.token, { name: secret, dataRoomId: a.roomId });
await call('POST', '/folders', a.token, { name: `${secret}-child`, dataRoomId: a.roomId, parentId: folder.id });
await call('POST', '/folders', b.token, { name: `B-own-${run}`, dataRoomId: b.roomId });

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
// Record every moment A's secret appears in the DOM (MutationObserver catches single-frame flashes).
// Reported to Node via exposeFunction so the log survives full-page navigations.
const leaks = [];
let phase = 'A';
await page.exposeFunction('__reportLeak', (path) => leaks.push({ phase, path }));
await page.addInitScript((needle) => {
  let reported = false;
  new MutationObserver(() => {
    if (!reported && document.body?.innerText.includes(needle)) { reported = true; window.__reportLeak(location.pathname); }
    if (document.body && !document.body.innerText.includes(needle)) reported = false;
  }).observe(document, { subtree: true, childList: true, characterData: true });
}, secret);

async function login(email) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Passw0rd!');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

// --- 1. cache leak
await page.goto(WEB + '/login');
await login(a.email);
await page.locator('main').getByText(secret, { exact: true }).click();
await page.getByText(`${secret}-child`).waitFor();
const seenAsA = leaks.length > 0;
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForURL(/\/login/);
phase = 'B';
await login(b.email);
await page.getByText(`B-own-${run}`).waitFor();
// also visit A's folder URL as B and the browser back button
await page.goBack();
await page.waitForTimeout(1500);
await page.goto(WEB + `/folder/${folder.id}`);
await page.waitForTimeout(2000);
// the init script re-runs per navigation, so count only post-B-login documents
console.log('[CACHE] secret seen while signed in as A (sanity):', seenAsA);
console.log('[CACHE] DOM appearances of A data after sign-out (incl. B session):', JSON.stringify(leaks.filter((l) => l.phase === 'B')));
console.log('[CACHE] final page as B on A folder URL:', (await page.locator('main').innerText()).slice(0, 120).replace(/\n/g, ' | '));

// --- 2. PI-10 return-to after login
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForURL(/\/login/);
await page.goto(WEB + '/shared-with-me');
await page.waitForURL(/\/login/);
await login(b.email);
await page.waitForLoadState('networkidle');
console.log('[PI-10] landed on after sign-in:', new URL(page.url()).pathname);

await browser.close();
