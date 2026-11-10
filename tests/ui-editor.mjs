#!/usr/bin/env node
// Laptop-size UI check of the editor against the local Miniflare editor + fake GitHub.
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
// Dan edits on a laptop: 1366x768 is the most common laptop screen. (A touchscreen laptop still counts as a laptop.)
await page.emulate({ viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: true }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const ids = (sel) => page.$$eval(`${sel} > li[data-id]`, (a) => a.map((x) => x.dataset.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (sel) => { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); };

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

async function mouseDrag(fromSel, toSel) {
  const a = await (await page.$(fromSel)).boundingBox();
  const b = await (await page.$(toSel)).boundingBox();
  const x = a.x + a.width / 2, y = a.y + a.height / 2, ty = Math.max(b.y + b.height * 0.25, 20);
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x, y + ((ty - y) * i) / 12); await sleep(16); }
  if (ty === 20) await sleep(1200);
  await page.mouse.up(); await sleep(800);
}

try {
  const imgs = [];
  for (const [i, c] of ['#7a5', '#a75', '#57a'].entries()) { const f = `${out}/hero-${i + 1}.jpg`; writeFileSync(f, await testJpeg({ width: 3000, height: 2000, color: c, label: `SLIDE ${i + 1}` })); imgs.push(f); }
  const tall = `${out}/tall.jpg`; writeFileSync(tall, await testJpeg({ width: 1500, height: 2600, color: '#555', label: 'TALL' }));

  await page.goto(E.url + '/#/list', { waitUntil: 'networkidle0' });
  await shot('01-start');
  assert.match(await page.$eval('main', (m) => m.innerText), /Your website/);
  assert.doesNotMatch(await page.$eval('main', (m) => m.innerText), /Manage listings|Request a website change/, 'photos only');
  assert.equal(await page.$$eval('.spot', (a) => a.length), 5, 'slideshow + 3 photo spots + reviews');
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
  await click(`[data-first="${last}"]`);
  await page.waitForFunction((id) => document.querySelector('#hphotos > li[data-id]').dataset.id === id, {}, last);
  await click(`[data-focus="${last}"][data-v="50% 15%"]`);
  await page.waitForFunction((id) => document.querySelector(`[data-focus="${id}"][data-v="50% 15%"]`)?.classList.contains('is-on'), {}, last);
  // Speed fast + fade on.
  await click('input[name=speed][value="4"]'); await sleep(700);
  await click('input[name=fade][value="on"]'); await sleep(700);
  const H = (await E.call('GET', '/api/homepage')).data;
  assert.equal(H.draft.slides[0].id, last); assert.equal(H.draft.slides[0].focus, '50% 15%');
  assert.equal(H.draft.seconds, 4); assert.equal(H.draft.fade, true);
  await shot('03-hero-arranged');
  // Remove one.
  await click(`[data-remove="${H.draft.slides[4].id}"]`); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => document.querySelectorAll('#hphotos > li[data-id]').length === 4);
  // Publish.
  await click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.body.innerText), { timeout: 60000 });
  await shot('04-hero-published');
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.equal(site.heroSlides.length, 4); assert.equal(site.heroSlideSeconds, 4); assert.equal(site.heroFade, true); assert.equal(site.heroSlides[0].id, last);
  console.log('homepage ok:', site.heroSlides.map((s) => s.id).join(','), site.heroSlideSeconds, site.heroFade);

  // Website photos: replace the headshot by clicking, the luxury photo by dropping a file on its card.
  await page.goto(E.url + '/#/list', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-spot="headshot"]');
  const portrait = `${out}/portrait.jpg`; writeFileSync(portrait, await testJpeg({ width: 1200, height: 1500, color: '#a55', label: 'DAN' }));
  await (await page.$('[data-spot-file="headshot"]')).uploadFile(portrait);
  await page.waitForFunction(() => /New photo added to Your photo/.test(document.body.innerText), { timeout: 60000 });
  assert.ok(await page.$('[data-spot="headshot"].spot--changed'), 'card shows it changed');
  await page.evaluate(async () => {
    const blob = await (await fetch('/api/homepage/spot/headshot/img')).blob();
    const big = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = 2000; c.height = 1400; c.getContext('2d').drawImage(big, 0, 0, 2000, 1400);
    const file = new File([await new Promise((r) => c.toBlob(r, 'image/jpeg'))], 'house.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(file);
    const z = document.querySelector('[data-spot="luxury"]');
    z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => /New photo added to Luxury home photo/.test(document.body.innerText), { timeout: 60000 });
  await shot('05-photos-changed');
  const pv = await (await page.goto(E.url + '/api/homepage/preview?page=headshot')).text();
  assert.match(pv, /\/api\/homepage\/photo\/s-[a-z0-9]+\/w-800\.jpg/, 'preview shows the new headshot');
  await page.goto(E.url + '/#/list', { waitUntil: 'networkidle0' });
  await click('[data-publish]');
  assert.match(await page.$eval('dialog[open]', (d) => d.innerText), /your photo, luxury home photo/);
  await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.body.innerText), { timeout: 60000 });
  await shot('06-photos-published');
  const site2 = JSON.parse(E.gh.read('content/site.json'));
  assert.deepEqual(Object.keys(site2.photos).sort(), ['headshot', 'luxury']);
  console.log('website photos ok');

  // Reviews: add one, edit it, remove another, publish.
  await page.goto(E.url + '/#/list', { waitUntil: 'networkidle0' });
  await click('a[href="#/reviews"]');
  await page.waitForSelector('.reviews');
  const n0 = await page.$$eval('.review', (a) => a.length);
  await click('a[href="#/reviews/new"]');
  await page.waitForSelector('#r-text');
  await page.click('#r-title'); await page.keyboard.press('Enter'); // submitting empty shows a plain error
  await page.type('#r-text', 'Dan made our move painless.\n\nHighly recommend.');
  await click('button[type=submit]');
  await page.waitForFunction(() => /title/i.test(document.getElementById('msg').innerText));
  await page.type('#r-title', 'Painless move'); await page.type('#r-client', 'The Smiths'); await page.select('#r-role', 'Buyer');
  await click('button[type=submit]');
  await page.waitForFunction((n) => document.querySelectorAll('.review').length === n + 1, {}, n0);
  assert.match(await page.$eval('.reviews', (u) => u.innerText), /Painless move[\s\S]*New – not published yet/);
  await shot('08-reviews-added');
  await click('a[href="#/reviews/edit/painless-move"]');
  await page.waitForSelector('#r-client');
  await page.$eval('#r-client', (i) => { i.value = ''; }); await page.type('#r-client', 'J. and K. Smith');
  await click('button[type=submit]');
  await page.waitForFunction(() => /J\. and K\. Smith/.test(document.querySelector('.reviews')?.innerText || ''));
  const lastReview = await page.$$eval('[data-remove]', (b) => b[b.length - 1].dataset.remove);
  await click(`[data-remove="${lastReview}"]`); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction((n) => document.querySelectorAll('.review').length === n, {}, n0);
  // The new review went to the top; Move down puts it second – saved straight away, focus stays on the button.
  let rorder = await ids('#rlist');
  assert.equal(rorder[0], 'painless-move', 'a new review shows first');
  if (rorder.length >= 2) {
    assert.match(await page.$eval('#rlist > li:first-child .review__pos', (p) => p.textContent), /1 – shows first/);
    await click('[data-move="down"][data-slug="painless-move"]');
    rorder = [rorder[1], rorder[0], ...rorder.slice(2)];
    await page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#rlist > li')].map((x) => x.dataset.id)) === w && /Order saved/.test(document.querySelector('.review__saved')?.textContent || ''), {}, JSON.stringify(rorder));
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.slug), 'painless-move', 'focus stays on the moved review');
    assert.match(await page.$eval('.actions__state', (x) => x.textContent), /not on the website yet/);
    const one = await page.$eval('#rlist > li:nth-child(2) .review__order', (d) => { const r = (s) => d.querySelector(s).getBoundingClientRect().top; return Math.abs(r('[data-handle]') - r('[data-move="up"]')) < 2; });
    assert.ok(one, 'on the full screen the order controls sit on one line');
    await shot('08b-reviews-order');
  }
  await click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.body.innerText), { timeout: 60000 });
  await shot('09-reviews-published');
  const tf = JSON.parse(E.gh.read('content/testimonials.json'));
  assert.deepEqual(tf.items.map((x) => x.slug), rorder, 'the arranged order is published');
  assert.ok(tf.items.some((x) => x.slug === 'painless-move' && x.client === 'J. and K. Smith' && x.role === 'Buyer'));
  assert.deepEqual(tf.removedSlugs, [lastReview]);
  console.log('reviews ok');

  // A phone gets the friendly laptop-only screen.
  const phone = await browser.newPage();
  await phone.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
  await phone.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
  await phone.goto(E.url + '/#/', { waitUntil: 'networkidle0' });
  assert.match(await phone.$eval('main', (m) => m.innerText), /Please use your laptop/);
  await phone.screenshot({ path: `${out}/07-phone-refused.png` });
  await phone.close();

  // Desktop: drop files onto the upload box.
  await page.emulate({ viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' });
  await page.goto(E.url + '/?reload=1#/homepage', { waitUntil: 'networkidle0' }); // a real page load (a hash-only change returns before the screen is drawn)
  await page.waitForSelector('#hphotos > li[data-id]');
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
  await shot('07-desktop-drop');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('ALL UI CHECKS PASSED', dropped);
} finally { await browser.close(); await E.close(); }
