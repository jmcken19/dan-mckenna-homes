#!/usr/bin/env node
// Browser check of the "edit on the page" editor (owner/ui/app.js → visualScreen) against the local
// Miniflare editor + fake GitHub (ported from client-site-template). Dan's public site's CSS/JS/images are served from public/ so the page
// in the frame looks real. Covers: ✎ buttons appear only on editable parts, the slideshow panel
// (add, still vs slideshow), a photo spot panel (replace), the page refreshing by itself after each
// change, page switching, phone view, publish, and that the real website never gets edit marks.
// Run: npm run test:visual   (needs Chrome at /usr/bin/google-chrome or CHROME_PATH)
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEditor, accessToken, testJpeg, OWNER, SITE } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = '/tmp/ui-visual'; mkdirSync(out, { recursive: true });
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const E = await startEditor({ port: 8793 });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.origin !== SITE) return req.continue();
  const f = join(root, 'public', decodeURIComponent(u.pathname).replace(/\.\.+/g, ''));
  if (!existsSync(f)) return req.respond({ status: 404, body: 'not found' });
  return req.respond({ status: 200, contentType: MIME[extname(f)] || 'application/octet-stream', body: readFileSync(f) });
});
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const frame = async () => { const h = await page.$('#frame'); return h.contentFrame(); };
const waitFrame = async (pred, arg) => { for (let i = 0; i < 200; i++) { try { const f = await frame(); if (f && await f.evaluate(pred, arg)) return f; } catch { /* reloading */ } await sleep(100); } throw new Error('frame condition not met: ' + pred); };

try {
  const big = `${out}/new-slide.jpg`; writeFileSync(big, await testJpeg({ width: 3000, height: 2000, color: '#3a6ea5', label: 'NEW SLIDE' }));
  const portrait = `${out}/portrait.jpg`; writeFileSync(portrait, await testJpeg({ width: 1400, height: 1800, color: '#a5573a', label: 'NEW HEADSHOT' }));

  // 1. Opens straight onto the page, with ✎ buttons on the editable parts only.
  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#frame');
  let f = await waitFrame(() => document.querySelectorAll('.jte-pen').length >= 2);
  const pens = await f.$$eval('.jte-pen', (a) => a.map((x) => x.textContent));
  assert.ok(pens.includes('✎ Change these photos'), 'slideshow has a ✎ button: ' + pens);
  assert.ok(pens.includes('✎ Change reviews'), 'reviews row has a ✎ button: ' + pens);
  assert.equal(pens.length, 2, 'homepage: slideshow + reviews only (carousel reviews have no ✎ of their own): ' + pens);
  assert.ok(await f.$eval('link[rel=stylesheet]', (l) => !!l.sheet), "Dan's site CSS loads in the frame");
  assert.equal(await f.$eval('.preview-bar', (b) => getComputedStyle(b).display), 'none', 'testing banner hidden inside the editor');
  assert.ok(await page.$eval('[data-publish]', (b) => b.disabled), 'nothing to publish yet');
  await shot('01-page-with-pencils');

  // 2. Slideshow panel: add a photo → the page refreshes by itself and now has 2 slides.
  await f.click('.hero .jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) #hphotos');
  assert.match(await page.$eval('#drawer-title', (h) => h.textContent), /Homepage photos/);
  await shot('02-slideshow-panel');
  await (await page.$('#drawer #addhero')).uploadFile(big);
  await page.waitForFunction(() => document.querySelectorAll('#drawer #hphotos > li[data-id]').length === 2, { timeout: 120000 });
  f = await waitFrame(() => document.querySelectorAll('.hero__slide').length === 2);
  assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), false, 'Publish is ready');
  assert.match(await page.$eval('#state', (s) => s.textContent), /not on the website yet/);
  await shot('03-added-photo-shows-on-page');

  // 3. One still photo: the page stops being a slideshow (no timer on the hero).
  await page.click('#drawer input[name=autoplay][value=off]');
  f = await waitFrame(() => { const h = document.querySelector('.hero'); return h && !h.hasAttribute('data-interval'); });
  await page.click('#drawer input[name=autoplay][value=on]');
  f = await waitFrame(() => document.querySelector('.hero')?.hasAttribute('data-interval'));
  await page.click('#drawer [data-close]');
  assert.ok(await page.$eval('#drawer', (d) => d.hidden), 'Done closes the panel');

  // 4. Another page: the headshot photo spot on About us.
  await page.click('[data-page="/about-us/"]');
  f = await waitFrame(() => location.search.includes('path=%2Fabout-us%2F') && !!document.querySelector('img[data-edit="photo"] ~ .jte-pen, .jte-pen'));
  assert.deepEqual(await f.$$eval('.jte-pen', (a) => a.map((x) => x.textContent)), ['✎ Change photo'], 'About us: just the headshot');
  await shot('04a-about-with-pencil');
  await f.click('.jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) #pfile');
  await shot('04-photo-panel');
  await (await page.$('#drawer #pfile')).uploadFile(portrait);
  await page.waitForFunction(() => /New photo is on your page/.test(document.querySelector('#drawer')?.innerText || ''), { timeout: 120000 });
  f = await waitFrame(() => /\/api\/homepage\/photo\/s-/.test(document.querySelector('img[data-edit="photo"]')?.src || ''));
  await shot('05-headshot-replaced');
  await page.click('#drawer [data-close]');

  // 4b. The other photo pages each show one ✎ on their photo (and nothing else).
  for (const [path, key] of [['/new-construction/', 'construction'], ['/luxury-home-marketing/', 'luxury'], ['/contact/', 'headshot']]) {
    await page.click(`[data-page="${path}"]`);
    f = await waitFrame((p) => location.search.includes('path=' + encodeURIComponent(p)) && document.querySelectorAll('.jte-pen').length === 1, path);
    assert.equal(await f.$eval('[data-edit]', (el) => el.dataset.editKey), key, path + ' photo spot');
    await f.$eval('[data-edit]', (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120)); await sleep(300);
    await shot('04b-' + key + (path === '/contact/' ? '-contact' : ''));
  }
  await page.click('[data-page="/about-us/"]');
  await waitFrame(() => location.search.includes('path=%2Fabout-us%2F') && !!document.querySelector('.jte-pen'));

  // 5. Clicking a menu link inside the page switches page instead of leaving the editor.
  f = await frame();
  const homeLink = await f.$('header a[href$="/"]');
  if (homeLink) { await homeLink.click(); await waitFrame(() => location.search.includes('path=%2F&') || location.search.includes('path=%2F%26')); }

  // 5b. Reviews: on the Testimonials page each review has its own ✎ Edit; edit one, add one, remove one – the page follows.
  await page.click('[data-page="/testimonials/"]');
  f = await waitFrame(() => location.search.includes('path=%2Ftestimonials%2F') && document.querySelectorAll('article.tcard .jte-pen').length >= 2);
  const before = await f.$$eval('article.tcard', (a) => a.length);
  await shot('05b-reviews-page');
  await f.click('article.tcard .jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) #rform');
  assert.match(await page.$eval('#drawer-title', (h) => h.textContent), /Edit this review/);
  await page.$eval('#drawer #r-title', (i) => { i.value = ''; });
  await page.type('#drawer #r-title', 'Edited right on the page');
  await shot('05c-review-form');
  await page.click('#drawer #rform button[type=submit]');
  f = await waitFrame(() => /Edited right on the page/.test(document.body.innerText));
  await page.waitForSelector('#drawer [data-add]');
  await page.click('#drawer [data-add]');
  await page.waitForSelector('#drawer #rform');
  assert.match(await page.$eval('#drawer-title', (h) => h.textContent), /Add a review/);
  await page.type('#drawer #r-text', 'They answered every question and made the whole thing easy.');
  await page.type('#drawer #r-title', 'Brand new review');
  await page.click('#drawer #rform button[type=submit]');
  f = await waitFrame((n) => document.querySelectorAll('article.tcard').length === n + 1 && /Brand new review/.test(document.body.innerText), before);
  await page.waitForSelector('#drawer [data-remove]');
  const victim = await page.$$eval('#drawer [data-remove]', (bs) => bs[bs.length - 1].dataset.remove);
  await page.click(`#drawer [data-remove="${victim}"]`); await page.click('dialog[open] button[value=yes]');
  f = await waitFrame((n) => document.querySelectorAll('article.tcard').length === n, before);
  await shot('05d-reviews-changed');
  await page.click('#drawer [data-close]');
  // The homepage reviews row opens the same list.
  await page.click('[data-page="/"]');
  f = await waitFrame(() => !!document.querySelector('.home-testimonials .jte-pen'));
  await f.$eval('.home-testimonials', (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20)); await sleep(400);
  await shot('05e-home-reviews-row');
  await f.click('.home-testimonials .jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) [data-add]');
  await page.click('#drawer [data-close]');

  // 6. Phone view.
  await page.click('[data-device="phone"]');
  assert.equal(await page.$eval('#frame', (fr) => fr.getBoundingClientRect().width), 390);
  await sleep(500); await shot('06-phone-view');
  await page.click('[data-device="laptop"]');

  // 7. Publish everything.
  await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.body.innerText), { timeout: 60000 });
  await shot('07-published');
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.equal(site.heroSlides.length, 2, 'two slides published');
  assert.ok(site.photos?.headshot?.id, 'new headshot published');
  const rv = JSON.parse(E.gh.read('content/testimonials.json')).items;
  assert.ok(rv.some((t) => t.title === 'Edited right on the page'), 'edited review published');
  assert.ok(rv.some((t) => t.title === 'Brand new review'), 'new review published');

  // 8. The real website never carries edit marks.
  const plain = await (await page.goto(E.url + '/api/homepage/preview')).text();
  assert.doesNotMatch(plain, /data-edit=/, 'normal preview has no edit marks');

  assert.deepEqual(errors, [], 'no script errors');
  console.log('visual editor ok – screenshots in', out);
} finally {
  await browser.close(); await E.close();
}
