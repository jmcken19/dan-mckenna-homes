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
import { testJpeg, clientSetup } from './harness.mjs';
import { openEditor, sleep } from './browser.mjs';

const out = '/tmp/ui-visual';
const C = await clientSetup(); // Dan's setup in the template's shape (reviews page /testimonials/, content/testimonials.json)
const enc = (p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
let reviewOrder = null; // the order arranged in step 5e (published in step 7)
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

  // 4b. The other photo pages each show one ✎ on their photo (and nothing else – words only get a ✎ on hover).
  for (const [path, key] of [['/new-construction/', 'construction'], ['/luxury-home-marketing/', 'luxury'], ['/contact/', 'headshot']]) {
    await pickPage(path);
    f = await onPage(path, () => document.querySelectorAll('.jte-pen').length === 1);
    assert.equal(await f.$eval('[data-edit]:not([data-edit="text"])', (el) => el.dataset.editKey), key, path + ' photo spot');
    await f.$eval('[data-edit]:not([data-edit="text"])', (el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120)); await sleep(300);
    await shot('04b-' + key + (path === '/contact/' ? '-contact' : ''));
  }

  // 5. Clicking a menu link's words inside the page edits the words (never leaves the editor); the toolbar's
  //    "Open …" button switches the editor to the page the link goes to.
  if (await page.$eval('#pagesel', (s) => s.value) === '/about-us/') { await pickPage('/'); await onPage('/'); }
  f = await frame();
  const homeLink = await f.$('header a[href$="/about-us/"]');
  assert.ok(homeLink, 'the page has a menu link to About us');
  await homeLink.click();
  await page.waitForSelector('.jte-tbar [data-go]');
  await (await page.$('.jte-tbar [data-go]')).click();
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

  // 5e. Reviews order: Move down / Move up / keyboard / drag in the side panel – each saves straight away and the page follows.
  if (C.reviewsOn && C.reviews.length >= 2) {
    await pickPage(C.reviewsPath);
    f = await waitFrame((q) => location.search.includes(`path=${q}`) && !!document.querySelector('[data-edit="reviews"] .jte-pen--bar'), enc(C.reviewsPath));
    await f.click('[data-edit="reviews"] .jte-pen--bar');
    await page.waitForSelector('#drawer:not([hidden]) #rlist [data-move]');
    const panelOrder = () => page.$$eval('#drawer #rlist > li', (li) => li.map((x) => x.dataset.id));
    const pageOrderIs = (want) => waitFrame((w) => JSON.stringify([...document.querySelectorAll('[data-edit="review"]')].map((x) => x.dataset.editKey)) === w, JSON.stringify(want));
    const waitPanel = (want) => page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#drawer #rlist > li')].map((x) => x.dataset.id)) === w && !document.querySelector('#drawer [data-handle][disabled]'), { timeout: 20000 }, JSON.stringify(want));
    const savedNote = () => page.waitForFunction(() => /Order saved – shows on your page now\. Click Publish when you're happy\./.test(document.querySelector('#drawer .review__saved')?.textContent || ''), { timeout: 20000 });
    const inView = (slug) => page.evaluate((s) => { const box = document.querySelector('#drawer-body').getBoundingClientRect(); const r = [...document.querySelectorAll('#drawer #rlist > li')].find((x) => x.dataset.id === s).querySelector('.review__order').getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1; }, slug);
    let o = await panelOrder();
    await pageOrderIs(o);
    assert.match(await page.$eval('#drawer .order-hint', (p) => p.textContent), /^Drag or use Move up \/ Move down\. Review 1 shows first\.$/);
    assert.equal(await page.$eval('#drawer #rlist > li .review__pos', (p) => p.textContent.trim()), '1 – shows first');
    assert.equal(await page.$$eval('#drawer #rlist > li .review__pos', (p) => p[1].textContent.trim()), '2');
    assert.ok(await page.$eval('#drawer #rlist > li:first-child [data-move="up"]', (b) => b.disabled), 'Move up is off for the first review');
    assert.ok(await page.$eval('#drawer #rlist > li:last-child [data-move="down"]', (b) => b.disabled), 'Move down is off for the last review');
    const sizes = await page.$$eval('#drawer #rlist > li:nth-child(2) :is([data-move], [data-handle])', (bs) => bs.map((b) => b.getBoundingClientRect().height));
    assert.ok(sizes.length === 3 && sizes.every((h) => h >= 50), 'Drag, Move up and Move down are at least 50px tall: ' + sizes);
    assert.ok(await page.$eval('#drawer #rlist > li:nth-child(2) .review__order', (d) => d.scrollWidth <= d.clientWidth + 1), 'the order controls fit the panel');
    await shot('05e-reviews-order-panel');

    // Move down (mouse click): the first review becomes the second; focus stays on the pressed button.
    const first = o[0];
    await page.click(`#drawer [data-move="down"][data-slug="${first}"]`);
    let want = [o[1], o[0], ...o.slice(2)];
    await waitPanel(want); await savedNote();
    f = await pageOrderIs(want);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.move + '|' + document.activeElement?.dataset.slug), `${o.length > 2 ? 'down' : 'up'}|${first}`, 'focus stays on Move down of the moved review (Move up when it is now the last one)');
    assert.ok(await inView(first), 'the moved review stays in view');
    assert.equal(await page.$eval('#drawer #rlist > li:nth-child(2) .review__pos', (p) => p.textContent.trim()), '2');
    assert.match(await page.$eval('#state', (x) => x.textContent), /not on the website yet/);
    await shot('05f-reviews-moved-down');

    // Move up with the keyboard (Enter on the focused button): back where it was; focus moves to Move down (Move up is now off).
    await page.focus(`#drawer [data-move="up"][data-slug="${first}"]`);
    await page.keyboard.press('Enter');
    await waitPanel(o);
    f = await pageOrderIs(o);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.slug), first, 'focus stays on the moved review');
    // Arrow key on the ⠿ Drag handle also moves it.
    await page.focus(`#drawer #rlist > li[data-id="${first}"] [data-handle]`);
    await page.keyboard.press('ArrowDown');
    await waitPanel(want); f = await pageOrderIs(want);
    assert.ok(await page.evaluate(() => document.activeElement?.matches('[data-handle]') && document.activeElement.closest('li').dataset.id), 'focus stays on the handle');

    // Drag the last review to the top with the mouse (the panel scrolls by itself when the list is long).
    o = await panelOrder();
    const last = o[o.length - 1];
    await page.$eval(`#drawer #rlist > li[data-id="${last}"] [data-handle]`, (h) => h.scrollIntoView({ block: 'center' }));
    const hb = await (await page.$(`#drawer #rlist > li[data-id="${last}"] [data-handle]`)).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    const top = await page.$eval('#drawer-body', (b) => b.getBoundingClientRect().top);
    for (let y = hb.y; y > top + 8; y -= 40) { await page.mouse.move(hb.x + hb.width / 2, y); await sleep(30); }
    await page.mouse.move(hb.x + hb.width / 2, top + 8);
    await page.waitForFunction(() => document.querySelector('#drawer-body').scrollTop === 0, { timeout: 20000 });
    const fr = await page.$eval('#drawer #rlist > li:not(.is-dragging)', (li) => { const r = li.getBoundingClientRect(); return { y: r.top + 6 }; });
    await page.mouse.move(hb.x + hb.width / 2, fr.y, { steps: 4 });
    await page.mouse.up();
    want = [last, ...o.slice(0, -1)];
    await waitPanel(want); await savedNote();
    f = await pageOrderIs(want);
    assert.ok(await inView(last), 'the dragged review stays in view');
    await shot('05g-reviews-dragged');
    // Laptop with a short screen: everything still fits.
    await page.setViewport({ width: 1280, height: 585 });
    await sleep(400);
    assert.ok(await page.$eval('#drawer #rlist > li:nth-child(2) .review__order', (d) => d.scrollWidth <= d.clientWidth + 1), 'controls fit at 1280×585');
    await page.$eval('#drawer #rlist > li:nth-child(2)', (li) => li.scrollIntoView({ block: 'start' }));
    await shot('05h-reviews-order-1280x585');
    await page.setViewport({ width: 1366, height: 768 });
    reviewOrder = want;
    await page.click('#drawer [data-close]');
  }

  // "Website Editor" at the top always goes back to the Home page.
  { const away = (await page.$$eval('[data-page]', (bs) => bs.map((b) => b.dataset.page))).find((x) => x !== '/');
    if (away) { await page.evaluate((x) => { const b = document.querySelector(`[data-page="${x}"]`); if (b && b.offsetParent) b.click(); else { const s = document.querySelector('#pagesel'); s.value = x; s.dispatchEvent(new Event('change')); } }, away);
      await waitFrame((x) => location.search.includes('path=' + encodeURIComponent(x)), away);
      await page.click('.bar__home');
      await waitFrame(() => /[?&]path=%2F(&|$)/.test(location.search));
    } }

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
  if (reviewOrder) assert.deepEqual(rv.map((t) => t.slug), reviewOrder, 'the arranged order is published to the testimonials file');

  // 8. The real website never carries edit marks.
  const plain = await (await page.goto(E.url + '/api/homepage/preview')).text();
  assert.doesNotMatch(plain, /data-edit=|editor-preview/, 'normal preview has no edit marks');

  assert.deepEqual(errors, [], 'no script errors');
  console.log('visual editor ok – screenshots in', out);
} finally {
  await close();
}
