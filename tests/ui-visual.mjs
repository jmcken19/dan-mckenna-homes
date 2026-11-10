#!/usr/bin/env node
// Browser check of the "edit on the page" editor (owner/ui/app.js → visualScreen) against the local
// Miniflare editor + fake GitHub (ported from client-site-template). Dan's public site's CSS/JS/images are served
// from public/ so the page in the frame looks real. Covers: ✎ buttons appear only on editable parts, the slideshow
// panel (add, still vs slideshow), each photo spot, the page refreshing by itself after each change, page switching
// (picker and links in the page), the page staying at computer width beside the panel, phone view, publish, and
// that the real website never gets edit marks. Edge cases are in ui-visual-edge.mjs.
// Run: npm run test:visual   (needs Chrome at /usr/bin/google-chrome or CHROME_PATH)
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { testJpeg } from './harness.mjs';
import { openEditor, sleep } from './browser.mjs';

const out = '/tmp/ui-visual';
const { E, page, frame, waitFrame, shot, errors, close } = await openEditor({ out, port: Number(process.env.PORT) || 0 });
// Switch page with whatever the picker shows: page buttons, or the drop-down when they don't fit.
const pickPage = async (p) => { if (await page.$eval('#vpages', (el) => el.classList.contains('is-select'))) await page.select('#pagesel', p); else await page.click(`[data-page="${p}"]`); };
const onPage = (p, extra = () => true) => waitFrame((q, x) => location.search.includes('path=' + q + '&') && document.readyState === 'complete' && new Function('return ' + x)()(), encodeURIComponent(p), extra.toString());
const clickPen = (f, sel) => f.$eval(sel, (el) => { const host = el.tagName === 'IMG' ? el.parentElement : el; (el.querySelector(':scope > .jte-pen') || [...host.querySelectorAll(':scope > .jte-pen')].pop()).click(); });

try {
  const big = `${out}/new-slide.jpg`; writeFileSync(big, await testJpeg({ width: 3000, height: 2000, color: '#3a6ea5', label: 'NEW SLIDE' }));
  const portrait = `${out}/portrait.jpg`; writeFileSync(portrait, await testJpeg({ width: 1400, height: 1800, color: '#a5573a', label: 'NEW HEADSHOT' }));

  // 1. Opens straight onto the page, with ✎ buttons on the editable parts only.
  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  let f = await waitFrame(() => document.querySelectorAll('.jte-pen').length >= 2);
  const pens = await f.$$eval('.jte-pen', (a) => a.map((x) => x.textContent));
  assert.ok(pens.includes('✎ Change slideshow'), 'slideshow has a ✎ button: ' + pens);
  assert.ok(pens.some((p) => p.startsWith('✎ Change reviews')), 'reviews row has a ✎ button: ' + pens);
  assert.equal(pens.length, 2, 'homepage: slideshow + reviews only (carousel reviews have no ✎ of their own): ' + pens);
  assert.ok(await f.$eval('link[rel=stylesheet]', (l) => !!l.sheet), "Dan's site CSS loads in the frame");
  assert.equal(await f.$eval('.preview-bar', (b) => getComputedStyle(b).display), 'none', 'testing banner hidden inside the editor');
  assert.ok(await page.$eval('[data-publish]', (b) => b.disabled), 'nothing to publish yet');
  assert.ok(await page.$eval('[data-publish]', (b) => parseFloat(getComputedStyle(b).fontSize) >= 19 && Number(getComputedStyle(b).fontWeight) >= 700), 'Publish is big and bold');
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'the editor never scrolls as a whole');
  assert.doesNotMatch(await page.$eval('.vis__top', (t) => t.innerText), /design option/i);
  await shot('01-page-with-pencils');

  // 2. Slideshow panel: add a photo → the page refreshes by itself and now has 2 slides.
  const frameW = await page.$eval('#frame', (fr) => fr.contentWindow.innerWidth);
  await f.click('.hero .jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) #hphotos');
  assert.match(await page.$eval('#drawer-title', (h) => h.textContent), /Slideshow photos/);
  assert.equal(await page.$eval('#frame', (fr) => fr.contentWindow.innerWidth), frameW, 'opening the panel keeps the page at its computer width (no tablet layout)');
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
  await page.waitForSelector('#drawer input[name=autoplay][value=off]:checked');
  await page.click('#drawer input[name=autoplay][value=on]');
  f = await waitFrame(() => document.querySelector('.hero')?.hasAttribute('data-interval'));
  await page.click('#drawer [data-close]');
  assert.ok(await page.$eval('#drawer', (d) => d.hidden), 'Done closes the panel');

  // 4. Another page: the headshot photo spot on About us.
  await pickPage('/about-us/');
  f = await onPage('/about-us/', () => !!document.querySelector('.jte-pen'));
  assert.deepEqual(await f.$$eval('.jte-pen', (a) => a.map((x) => x.getAttribute('aria-label'))), ['Change photo: Your photo'], 'About us: just the headshot');
  await shot('04a-about-with-pencil');
  await clickPen(f, '[data-edit="photo"]');
  await page.waitForSelector('#drawer:not([hidden]) #pfile');
  assert.doesNotMatch(await page.$eval('#drawer', (d) => d.innerText), /design option/i);
  await shot('04-photo-panel');
  await (await page.$('#drawer #pfile')).uploadFile(portrait);
  await page.waitForFunction(() => /New photo is on your page/.test(document.querySelector('#drawer')?.innerText || ''), { timeout: 120000 });
  f = await waitFrame(() => /\/api\/homepage\/photo\/s-/.test(document.querySelector('img[data-edit="photo"]')?.src || ''));
  await shot('05-headshot-replaced');
  await page.click('#drawer [data-close]');

  // 4b. The other photo pages each show one ✎ on their photo (and nothing else).
  for (const [path, key] of [['/new-construction/', 'construction'], ['/luxury-home-marketing/', 'luxury'], ['/contact/', 'headshot']]) {
    await pickPage(path);
    f = await onPage(path, () => document.querySelectorAll('.jte-pen').length === 1);
    assert.equal(await f.$eval('[data-edit]', (el) => el.dataset.editKey), key, path + ' photo spot');
    await f.$eval('[data-edit]', (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120)); await sleep(300);
    await shot('04b-' + key + (path === '/contact/' ? '-contact' : ''));
  }

  // 5. Clicking a menu link inside the page switches page instead of leaving the editor.
  f = await frame();
  const homeLink = await f.$('header a[href$="/about-us/"]');
  assert.ok(homeLink, 'the page has a menu link to About us');
  await homeLink.click();
  await onPage('/about-us/');
  assert.equal(await page.$eval('#pagesel', (s) => s.value), '/about-us/', 'a link in the page switched the editor to that page');

  // 5b. Reviews: on the Testimonials page each review has its own ✎; change one, add one, remove one – the page follows.
  await pickPage('/testimonials/');
  f = await onPage('/testimonials/', () => document.querySelectorAll('article.tcard .jte-pen').length >= 2);
  const before = await f.$$eval('article.tcard', (a) => a.length);
  await shot('05b-reviews-page');
  await f.click('article.tcard .jte-pen');
  await page.waitForSelector('#drawer:not([hidden]) #rform');
  assert.match(await page.$eval('#drawer-title', (h) => h.textContent), /Change this review/);
  // The page is shown smaller beside the open panel: a real mouse click on another ✎ still hits it.
  const second = await f.$$eval('article.tcard', (a) => a[1].dataset.editLabel);
  assert.ok(await page.$eval('#frame', (fr) => /scale/.test(fr.style.transform)), 'the page is scaled while the panel is open');
  await f.$$eval('article.tcard .jte-pen', (p) => p[1].scrollIntoView({ block: 'center' }));
  const pt = await page.evaluate(() => {
    const fr = document.querySelector('#frame'); const box = fr.getBoundingClientRect(); const k = box.width / fr.offsetWidth;
    const r = fr.contentDocument.querySelectorAll('article.tcard .jte-pen')[1].getBoundingClientRect();
    return { x: box.left + (r.left + r.width / 2) * k, y: box.top + (r.top + r.height / 2) * k };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((t) => document.querySelector('#drawer #r-title')?.value === t, {}, second);
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
  const victim = await page.$$eval('#drawer .review', (li) => li.find((x) => !/Edited right on the page|Brand new review/.test(x.innerText)).querySelector('[data-remove]').dataset.remove);
  await page.click(`#drawer [data-remove="${victim}"]`); await page.click('dialog[open] button[value=yes]');
  f = await waitFrame((n) => document.querySelectorAll('article.tcard').length === n, before);
  await shot('05d-reviews-changed');
  await page.click('#drawer [data-close]');
  // The homepage reviews row opens the same list.
  await pickPage('/');
  f = await onPage('/', () => !!document.querySelector('.home-testimonials .jte-pen'));
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
  await page.click('[data-publish]');
  assert.ok(await page.$eval('dialog[open] .btn--primary', (b) => parseFloat(getComputedStyle(b).fontSize) >= 19), '"Yes, publish" is big');
  await page.click('dialog[open] button[value=yes]');
  await page.waitForFunction(() => /✓ Done/.test(document.querySelector('.vis__bar').innerText), { timeout: 60000 });
  await shot('07-published');
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.equal(site.heroSlides.length, 2, 'two slides published');
  assert.ok(site.photos?.headshot?.id, 'new headshot published');
  const rv = JSON.parse(E.gh.read('content/testimonials.json')).items;
  assert.ok(rv.some((t) => t.title === 'Edited right on the page'), 'edited review published');
  assert.ok(rv.some((t) => t.title === 'Brand new review'), 'new review published');

  // 8. The real website never carries edit marks.
  const plain = await (await page.goto(E.url + '/api/homepage/preview')).text();
  assert.doesNotMatch(plain, /data-edit=|editor-preview/, 'normal preview has no edit marks');

  assert.deepEqual(errors, [], 'no script errors');
  console.log('visual editor ok – screenshots in', out);
} finally {
  await close();
}
