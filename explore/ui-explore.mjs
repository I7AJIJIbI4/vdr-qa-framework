// Exploratory UI walk-through: drives prod, logs observations, saves screenshots.
import { chromium } from '@playwright/test';

const WEB = 'https://virtual-data-room-ten.vercel.app';
const API = 'https://virtual-data-room-production.up.railway.app';
const run = Date.now().toString(36);
const dir = new URL('.', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const log = (...a) => console.log('[ui]', ...a);

async function apiRegister(tag) {
  const email = `qa-${run}-${tag}@example.com`;
  const r = await fetch(API + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'QA ' + tag, email, password: 'Passw0rd!' }) });
  return { email, token: (await r.json()).accessToken };
}

const browser = await chromium.launch();
const owner = await apiRegister('uiowner');
const viewer = await apiRegister('uiviewer');

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${dir}shots/${n}.png`, fullPage: true });

// Login via UI
await page.goto(WEB + '/login');
await page.getByLabel('Email').fill(owner.email);
await page.getByLabel('Password').fill('Passw0rd!');
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL(WEB + '/');
await page.waitForLoadState('networkidle');
await shot('01-empty-room');
log('empty room text:', (await page.locator('main').innerText()).slice(0, 200).replace(/\n/g, ' | '));

// Create folder with HTML-ish name
await page.getByRole('button', { name: 'New folder' }).first().click();
await page.getByLabel('Folder name').fill('<img src=x onerror=alert(1)> Legal');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await shot('02-folder-created');
// Duplicate folder name (case-insensitive)
await page.getByRole('button', { name: 'New folder' }).first().click();
await page.getByLabel('Folder name').fill('<IMG src=x onerror=alert(1)> legal');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await shot('03-folder-duplicate');
log('dup folder dialog/toast:', (await page.locator('body').innerText()).match(/already exists[^\n]*/)?.[0]);
await page.keyboard.press('Escape');

// Upload valid + invalid files via the hidden input
const input = page.locator('input[type=file]');
await input.setInputFiles([`${dir}../fixtures/files/Term Sheet.pdf`, `${dir}../fixtures/files/Financials Q3.pdf`, `${dir}../fixtures/files/notes.txt`]);
await page.waitForTimeout(500);
await shot('04-upload-in-progress');
await page.waitForTimeout(5000);
await shot('05-upload-done');
log('after upload body:', (await page.locator('body').innerText()).slice(0, 600).replace(/\n/g, ' | '));

// Same-name upload twice in quick succession (two separate drops)
await input.setInputFiles([`${dir}../fixtures/files/NDA.pdf`]);
await input.setInputFiles([`${dir}../fixtures/files/NDA.pdf`]);
await page.waitForTimeout(6000);
await page.reload();
await page.waitForLoadState('networkidle');
const names = await page.locator('table tbody tr').allInnerTexts();
log('rows after double NDA upload:', JSON.stringify(names.map((n) => n.split('\n')[0])));
await shot('06-double-upload');

// Open a file in the viewer
await page.getByText('Term Sheet.pdf').click();
await page.waitForTimeout(3000);
await shot('07-viewer');
log('viewer url:', page.url());
await page.goBack();
await page.waitForLoadState('networkidle');

// Share the room: public link + viewer by email
await page.getByRole('button', { name: 'Share' }).first().click();
await page.waitForTimeout(1500);
await shot('08-share-dialog');
const createLink = page.getByRole('button', { name: /create.*link|create/i }).first();
if (await createLink.isVisible()) await createLink.click();
await page.waitForTimeout(1500);
const linkValue = await page.locator('input[readonly]').first().inputValue().catch(() => null);
log('public link:', linkValue);
await page.getByLabel('Email').fill(viewer.email.toUpperCase());
await page.getByRole('button', { name: 'Share', exact: true }).last().click();
await page.waitForTimeout(1500);
await page.getByLabel('Email').fill(owner.email);
await page.getByRole('button', { name: 'Share', exact: true }).last().click();
await page.waitForTimeout(1500);
await shot('09-share-people');
log('share dialog text:', (await page.getByRole('dialog').innerText()).replace(/\n/g, ' | '));
await page.keyboard.press('Escape');

// Anonymous visitor opens the public link
const anon = await browser.newContext();
const ap = await anon.newPage();
await ap.goto(linkValue);
await ap.waitForLoadState('networkidle');
await ap.screenshot({ path: `${dir}shots/10-public-view.png`, fullPage: true });
log('public view:', (await ap.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | '));
log('public view has edit controls:', await ap.getByRole('button', { name: /upload|new folder|rename|delete/i }).count());

// Owner's own "Shared with me" (self-share)
await page.goto(WEB + '/shared-with-me');
await page.waitForLoadState('networkidle');
await shot('11-owner-shared-with-me');
log('owner shared-with-me:', (await page.locator('main').innerText()).slice(0, 200).replace(/\n/g, ' | '));

// Viewer: shared-with-me, open room, sees no edit controls
const vctx = await browser.newContext();
const vp = await vctx.newPage();
await vp.goto(WEB + '/login');
await vp.getByLabel('Email').fill(viewer.email);
await vp.getByLabel('Password').fill('Passw0rd!');
await vp.getByRole('button', { name: /sign in|log in/i }).click();
await vp.waitForURL(WEB + '/');
await vp.goto(WEB + '/shared-with-me');
await vp.waitForLoadState('networkidle');
await vp.screenshot({ path: `${dir}shots/12-viewer-shared-with-me.png`, fullPage: true });
log('viewer shared-with-me:', (await vp.locator('main').innerText()).slice(0, 200).replace(/\n/g, ' | '));
await vp.locator('main').getByText('My Data Room', { exact: true }).first().click();
await vp.waitForLoadState('networkidle');
await vp.locator('main').getByText('Legal').first().click();
await vp.waitForLoadState('networkidle');
await vp.screenshot({ path: `${dir}shots/13-viewer-in-folder.png`, fullPage: true });
const viewerFolderUrl = vp.url();
log('viewer folder url:', viewerFolderUrl, 'edit buttons:', await vp.getByRole('button', { name: /upload|new folder/i }).count());

// Owner deletes the folder the viewer is currently looking at, then viewer interacts
await page.goto(WEB + '/');
await page.waitForLoadState('networkidle');
await page.locator('table tbody tr', { hasText: 'Legal' }).getByRole('button').last().click();
await page.getByRole('menuitem', { name: 'Delete' }).click();
await page.waitForTimeout(1500);
await shot('14-delete-folder-dialog');
log('delete dialog:', (await page.getByRole('dialog').innerText()).replace(/\n/g, ' | '));
await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(1500);
await vp.reload();
await vp.waitForLoadState('networkidle');
await vp.screenshot({ path: `${dir}shots/15-viewer-after-delete.png`, fullPage: true });
log('viewer after folder deleted:', (await vp.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | '));

// Revoke the public link while the anonymous visitor has it open
await page.getByRole('button', { name: 'Share' }).first().click();
await page.waitForTimeout(1500);
await page.getByRole('dialog').getByRole('button', { name: /revoke/i }).first().click();
await page.waitForTimeout(1500);
await ap.reload();
await ap.waitForLoadState('networkidle');
await ap.screenshot({ path: `${dir}shots/16-public-after-revoke.png`, fullPage: true });
log('public after revoke:', (await ap.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | '));
await page.keyboard.press('Escape');

// Logout clears session; old token still valid at API level?
const tokenBefore = await page.evaluate(() => localStorage.getItem('dataroom_token'));
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForTimeout(1000);
const me = await fetch(API + '/auth/me', { headers: { authorization: 'Bearer ' + tokenBefore } });
log('token after sign out still accepted by API:', me.status);

// Mobile viewport
const mctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true });
const mp = await mctx.newPage();
await mp.goto(WEB + '/login');
await mp.getByLabel('Email').fill(owner.email);
await mp.getByLabel('Password').fill('Passw0rd!');
await mp.getByRole('button', { name: /sign in|log in/i }).click();
await mp.waitForURL(WEB + '/');
await mp.waitForLoadState('networkidle');
await mp.screenshot({ path: `${dir}shots/17-mobile-room.png`, fullPage: true });
log('mobile horizontal overflow px:', await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));

log('console errors:', JSON.stringify(consoleErrors.slice(0, 10)));
await browser.close();
