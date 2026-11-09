#!/usr/bin/env node
// Laptop-screen acceptance run of the owner editor UI against the REAL repo + GitHub Pages.
// Usage: node tests/acceptance-ui.mjs <phase> <mirror-clone-dir>
// Phases: add | edit | sold | takedown | restore | requests | failures | cleanup
// Not part of `npm test` (it pushes real commits). Screenshots go to /tmp/acc/.
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { startEditor, realMirror, accessToken, testJpeg, OWNER } from './harness.mjs';

const [phase, mirrorDir] = process.argv.slice(2);
const SITE = 'https://jmcken19.github.io/dan-mckenna-homes';
const out = '/tmp/acc'; mkdirSync(out, { recursive: true });
const stateFile = `${out}/state.json`;
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const mirror = realMirror(mirrorDir);
const E = await startEditor({ port: 8790, mirror, siteUrl: SITE, persist: `${out}/persist` });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
// Dan edits on a laptop.
await page.emulate({ viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER, { exp: Math.floor(Date.now() / 1000) + 7200 }) });
// The preview page loads the public site's stylesheet; serve it from the local build so screenshots are styled.
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith(SITE + '/assets/')) {
    const f = `/home/claude/dan-mckenna-homes/public${u.slice(SITE.length).split('?')[0]}`;
    if (existsSync(f)) return r.respond({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.woff2') ? 'font/woff2' : 'image/png', body: readFileSync(f) });
  }
  r.continue();
});
const log = (...a) => console.log(`[${phase}]`, ...a);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); log('screenshot', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (sel, text) => {
  const els = await page.$$(sel);
  for (const el of els) if ((await el.evaluate((n) => n.textContent.trim())).includes(text)) { await el.click(); return; }
  throw new Error(`no ${sel} with "${text}"`);
};
const confirmDialog = async () => { await page.waitForSelector('dialog[open] button[value=yes]'); await page.click('dialog[open] button[value=yes]'); };
const waitPublished = async (name) => {
  const t0 = Date.now();
  await page.waitForFunction(() => /Your changes are being published/.test(document.body.innerText), { timeout: 30000 });
  await shot(`${name}-publishing`);
  await page.waitForFunction(() => /✓ Done|didn't finish/.test(document.body.innerText), { timeout: 9 * 60 * 1000, polling: 2000 });
  const text = await page.evaluate(() => document.getElementById('pub').innerText);
  const link = await page.evaluate(() => document.querySelector('#pub a.btn')?.href || null);
  await shot(`${name}-done`);
  log(`publish result after ${Math.round((Date.now() - t0) / 1000)}s:`, text.split('\n')[0], link);
  if (!/✓ Done/.test(text)) throw new Error('publish did not finish');
  return link;
};
const openListing = async () => { await page.goto(`${E.url}/#/listing/${state.id}`, { waitUntil: 'networkidle0' }); await page.waitForSelector('#lform'); };

try {
  if (phase === 'add') {
    const imgs = [];
    for (const [i, c] of ['#6d8b74', '#8b6d6d', '#6d748b', '#a08a5a'].entries()) {
      const f = `${out}/test-photo-${i + 1}.jpg`;
      writeFileSync(f, await testJpeg({ width: 3024, height: 4032, color: c, label: `TEST PHOTO ${i + 1}`, gps: true }));
      imgs.push(f);
    }
    state.imgs = imgs; save();
    await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
    await shot('01-start');
    await clickText('a.big-choice', 'Manage listings');
    await page.waitForSelector('#q');
    await shot('02-listings-empty');
    await clickText('a.btn', 'Add a new home');
    await page.waitForSelector('#lform');
    // Missing required field first.
    await page.click('[data-save]');
    await page.waitForSelector('.field--error');
    await shot('03-missing-fields');
    await page.type('#f-street', '100 TEST Listing Lane');
    await page.type('#f-city', 'Waxhaw');
    await page.type('#f-zip', '28173');
    await page.type('#f-price', '525000');
    await page.type('#f-beds', '4');
    await page.type('#f-baths', '3');
    await page.type('#f-description', 'TEST LISTING created by the automated acceptance test. This is not a real home and will be removed.');
    const input = await page.$('#addphotos');
    await input.uploadFile(imgs[0], imgs[1], imgs[2]);
    await page.waitForFunction(() => /3 photos added/.test(document.body.innerText), { timeout: 120000 });
    await shot('04-draft-with-photos');
    state.id = await page.evaluate(() => location.hash.split('/')[2]); save();
    log('listing id', state.id);
    // Signed-out visitor cannot read the draft (no Access token).
    const anon = await fetch(`${E.url}/api/listings/${state.id}`);
    log('signed-out GET draft →', anon.status);
    const anonPrev = await fetch(`${E.url}/api/listings/${state.id}/preview`);
    log('signed-out GET preview →', anonPrev.status);
    // Preview.
    const pv = await browser.newPage();
    await pv.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' }); // buyer's phone view of the preview
    await pv.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
    await pv.setRequestInterception(true);
    pv.on('request', (r) => { const u = r.url(); if (u.startsWith(SITE + '/assets/')) { const f = `/home/claude/dan-mckenna-homes/public${u.slice(SITE.length).split('?')[0]}`; if (existsSync(f)) return r.respond({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.woff2') ? 'font/woff2' : 'image/png', body: readFileSync(f) }); } r.continue(); });
    await pv.goto(`${E.url}/api/listings/${state.id}/preview`, { waitUntil: 'networkidle0' });
    await pv.screenshot({ path: `${out}/05-preview.png`, fullPage: true });
    log('preview title', await pv.title());
    await pv.close();
    // Publish.
    await page.click('[data-publish]');
    await confirmDialog();
    state.url = await waitPublished('06-publish');
    save();
  }

  if (phase === 'edit') {
    await openListing();
    await page.$eval('#f-price', (el) => { el.value = ''; });
    await page.type('#f-price', '499,000');
    await page.click('[data-save]');
    await page.waitForFunction(() => /Saved as a draft/.test(document.body.innerText));
    const cover = await page.$('input[data-replace]');
    await cover.uploadFile(state.imgs[3]);
    await page.waitForFunction(() => /Photo added/.test(document.body.innerText), { timeout: 60000 });
    const before = await page.$$eval('.photo img', (a) => a.map((i) => i.src.split('/')[6]));
    const ups = await page.$$('[data-move][data-dir="-1"]'); await ups[ups.length - 1].click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await sleep(1500);
    const after = await page.$$eval('.photo img', (a) => a.map((i) => i.src.split('/')[6]));
    log('gallery order before', before, 'after', after);
    state.order = after; save();
    await shot('07-edited');
    await clickText('[data-status]', 'Mark Pending');
    await confirmDialog();
    await waitPublished('08-pending');
  }

  if (phase === 'sold') {
    await openListing();
    await clickText('[data-status]', 'Mark Sold');
    await confirmDialog();
    await waitPublished('09-sold');
  }

  if (phase === 'takedown') {
    await openListing();
    await page.click('[data-takedown]');
    await confirmDialog();
    await waitPublished('10-takedown');
  }

  if (phase === 'restore') {
    await openListing();
    await shot('11-archived');
    await page.click('[data-restore]');
    await confirmDialog();
    await waitPublished('12-restore');
  }

  if (phase === 'requests') {
    await page.goto(E.url + '/#/request', { waitUntil: 'networkidle0' });
    await page.click('#rform button[type=submit]');
    await page.waitForSelector('#rmsg .note--bad');
    await shot('13-request-missing');
    await page.type('#r-message', 'TEST REQUEST: On the About page, replace my headshot with this one.');
    await page.select('#r-page', 'About us');
    // Invalid image first.
    writeFileSync(`${out}/not-a-photo.jpg`, 'this is not an image');
    await (await page.$('#r-photo')).uploadFile(`${out}/not-a-photo.jpg`);
    await page.click('#rform button[type=submit]');
    await page.waitForFunction(() => /could not be opened/.test(document.body.innerText), { timeout: 20000 });
    await shot('14-request-bad-photo');
    const headshot = `${out}/test-headshot.jpg`;
    writeFileSync(headshot, await testJpeg({ width: 900, height: 1100, color: '#556', label: 'TEST HEADSHOT', gps: true }));
    await (await page.$('#r-photo')).uploadFile(headshot);
    await page.click('#rform button[type=submit]');
    await page.waitForFunction(() => /Sent\./.test(document.body.innerText), { timeout: 30000 });
    await shot('15-request-sent');
    const m = E.emails.at(-1);
    log('email to', m.to, 'reply_to', m.reply_to, 'subject', m.subject, 'attachments', m.attachments.length);
  }

  if (phase === 'failures') {
    // Bad photo in listing editor.
    await openListing();
    await (await page.$('#addphotos')).uploadFile(`${out}/not-a-photo.jpg`);
    await page.waitForFunction(() => /was not added/.test(document.body.innerText), { timeout: 30000 });
    await shot('16-bad-listing-photo');
    // Unauthorized edit: no Access token.
    const r = await fetch(`${E.url}/api/listings/${state.id}`, { method: 'PUT', headers: { 'X-DMH-Editor': '1', 'Content-Type': 'application/json' }, body: '{}' });
    log('unauthenticated PUT →', r.status, await r.text());
    // Signed-out browser session shows the sign-in message.
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 390, height: 844 });
    await p2.goto(E.url + '/#/listings', { waitUntil: 'networkidle0' });
    await p2.screenshot({ path: `${out}/17-signed-out.png` });
    log('signed-out screen:', (await p2.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, ' | '));
  }

  if (phase === 'cleanup') {
    await openListing();
    await page.click('[data-takedown]');
    await confirmDialog();
    await waitPublished('18-cleanup-takedown');
  }
} finally {
  await browser.close();
  await E.close();
}
