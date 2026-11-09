#!/usr/bin/env node
// Phone-size UI check of the editor against the local Miniflare editor + fake GitHub.
// Covers: homepage photos (upload, finger-drag reorder, focus, speed, fade, preview, publish),
// listing photo finger-drag, and file drop onto the upload box. Run: node tests/ui-editor.mjs
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startEditor, accessToken, testJpeg, OWNER } from './harness.mjs';

const out = '/tmp/ui'; mkdirSync(out, { recursive: true });
const E = await startEditor({ port: 8792 });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const ids = (sel) => page.$$eval(`${sel} > li[data-id]`, (a) => a.map((x) => x.dataset.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fingerDrag(fromSel, toSel) {
  const a = await (await page.$(fromSel)).boundingBox();
  const b = await (await page.$(toSel)).boundingBox();
  const x = a.x + a.width / 2, y = a.y + a.height / 2, ty = Math.max(b.y + b.height * 0.25, 20);
  await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= 12; i++) { await page.touchscreen.touchMove(x, y + ((ty - y) * i) / 12); await sleep(16); }
  if (ty === 20) await sleep(1200); // hold near the top edge: page auto-scrolls
  await page.touchscreen.touchEnd();
  await sleep(800);
}

try {
  const imgs = [];
  for (const [i, c] of ['#7a5', '#a75', '#57a'].entries()) { const f = `${out}/hero-${i + 1}.jpg`; writeFileSync(f, await testJpeg({ width: 3000, height: 2000, color: c, label: `SLIDE ${i + 1}` })); imgs.push(f); }
  const tall = `${out}/tall.jpg`; writeFileSync(tall, await testJpeg({ width: 1500, height: 2600, color: '#555', label: 'TALL' }));

  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  await shot('01-start');
  assert.match(await page.$eval('main', (m) => m.innerText), /Homepage photos/);
  await page.click('a[href="#/homepage"]');
  await page.waitForSelector('#hphotos');
  assert.equal((await ids('#hphotos')).length, 1);
  assert.equal(await page.$eval('input[name=speed]:checked', (r) => r.value), '7', 'Normal is default');
  assert.equal(await page.$eval('input[name=fade]:checked', (r) => r.value), 'off', 'Fade off by default');
  await (await page.$('#addhero')).uploadFile(...imgs, tall);
  await page.waitForFunction(() => /photos added/.test(document.body.innerText), { timeout: 120000 });
  let order = await ids('#hphotos');
  assert.equal(order.length, 5);
  await shot('02-hero-added');

  // Finger-drag the last photo (TALL) to the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  const last = order[4];
  await page.$eval(`#hphotos > li[data-id="${last}"] [data-handle]`, (h) => h.scrollIntoView({ block: 'center' }));
  await fingerDrag(`#hphotos > li[data-id="${last}"] [data-handle]`, `#hphotos > li[data-id="${order[3]}"]`);
  let after = await ids('#hphotos');
  assert.equal(after.indexOf(last), 3, `finger drag moved photo up one: ${after}`);
  // Keyboard on the handle (accessibility fallback).
  await page.focus(`#hphotos > li[data-id="${last}"] [data-handle]`);
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction((id) => [...document.querySelectorAll('#hphotos > li[data-id]')].findIndex((x) => x.dataset.id === id) === 2, {}, last);
  // Show first + focus Top.
  await page.click(`[data-first="${last}"]`);
  await page.waitForFunction((id) => document.querySelector('#hphotos > li[data-id]').dataset.id === id, {}, last);
  await page.click(`[data-focus="${last}"][data-v="50% 15%"]`);
  await page.waitForFunction((id) => document.querySelector(`[data-focus="${id}"][data-v="50% 15%"]`)?.classList.contains('is-on'), {}, last);
  // Speed fast + fade on.
  await page.click('input[name=speed][value="4"]'); await sleep(700);
  await page.click('input[name=fade][value="on"]'); await sleep(700);
  const H = (await E.call('GET', '/api/homepage')).data;
  assert.equal(H.draft.slides[0].id, last); assert.equal(H.draft.slides[0].focus, '50% 15%');
  assert.equal(H.draft.seconds, 4); assert.equal(H.draft.fade, true);
  await shot('03-hero-arranged');
  // Remove one.
  await page.click(`[data-remove="${H.draft.slides[4].id}"]`); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => document.querySelectorAll('#hphotos > li[data-id]').length === 4);
  // Publish.
  await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.body.innerText), { timeout: 60000 });
  await shot('04-hero-published');
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.equal(site.heroSlides.length, 4); assert.equal(site.heroSlideSeconds, 4); assert.equal(site.heroFade, true); assert.equal(site.heroSlides[0].id, last);
  console.log('homepage ok:', site.heroSlides.map((s) => s.id).join(','), site.heroSlideSeconds, site.heroFade);

  // Listing photos: finger drag.
  await page.goto(E.url + '/#/new', { waitUntil: 'networkidle0' });
  await page.type('#f-street', '7 TEST Drag Ct'); await page.type('#f-city', 'Waxhaw');
  await (await page.$('#addphotos')).uploadFile(...imgs);
  await page.waitForFunction(() => /3 photos added/.test(document.body.innerText), { timeout: 120000 });
  order = await ids('#lphotos');
  await page.$eval(`#lphotos > li[data-id="${order[2]}"] [data-handle]`, (h) => h.scrollIntoView({ block: 'center' }));
  await fingerDrag(`#lphotos > li[data-id="${order[2]}"] [data-handle]`, `#lphotos > li[data-id="${order[1]}"]`);
  after = await ids('#lphotos');
  assert.deepEqual(after, [order[0], order[2], order[1]], 'listing finger drag reorders and saves');
  const id = await page.evaluate(() => location.hash.split('/')[2]);
  assert.deepEqual((await E.call('GET', `/api/listings/${id}`)).data.draft.photos.map((p) => p.id), after);
  await shot('05-listing-dragged');

  // Desktop: drop files onto the upload box.
  await page.emulate({ viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' });
  await page.goto(E.url + '/#/homepage', { waitUntil: 'networkidle0' });
  const dropped = await page.evaluate(async () => {
    const r = await fetch('/api/homepage/photo/' + document.querySelector('#hphotos > li[data-id]').dataset.id + '?w=2000');
    const blob = await r.blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.jpg', { type: 'image/jpeg' }));
    const z = document.querySelector('.dropzone');
    z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForFunction(() => /Photo added/.test(document.body.innerText), { timeout: 60000 });
  assert.equal((await ids('#hphotos')).length, 5, 'dropped file was uploaded');
  await shot('06-desktop-drop');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('ALL UI CHECKS PASSED', dropped);
} finally { await browser.close(); await E.close(); }
