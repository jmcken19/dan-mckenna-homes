#!/usr/bin/env node
// Edge cases of the "edit on the page" editor, in a real browser (regression tests for the Nov 2026 review):
// unsaved review typing is never thrown away silently, Escape in a dialog / in the page, a slow upload never
// lands in another panel and Publish waits for it, a partly failed Publish says which part went live,
// "Reload latest" and 409 conflicts, a broken or signed-out preview shows a message, publishing twice,
// Undo all (also partly failing), the page's own buttons, and links on a site under a sub-path.
// Adapts to THIS client: scenarios that need a switched-off feature are skipped.
// Run: npm run test:visual (runs ui-visual.mjs, then this file)
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { testJpeg, clientSetup, MAINT, SITE } from './harness.mjs';
import { openEditor, sleep } from './browser.mjs';

const out = '/tmp/ui-visual-edge';
const C = await clientSetup();
const SPOT = C.spots[0];
const hasSlides = C.slideshow && C.site.heroSlides?.length;
const hasReviews = C.reviewsOn && C.reviews.length > 0;
const enc = (p) => encodeURIComponent(p);
const ran = [];

// Requests the test answers itself: [{ when(url, req) → bool, answer(req) }]. answer may delay or fail.
const rules = [];
const intercept = async (req, u) => {
  const r = rules.find((x) => x.when(u, req));
  if (!r) return false;
  await r.answer(req);
  return true;
};
const failWith = (status, body, headers = {}) => (req) => req.respond({ status, contentType: 'application/json', headers: { 'X-Frame-Options': 'DENY', ...headers }, body: JSON.stringify(body) });
const isApi = (method, path) => (u, req) => req.method() === method && u.pathname === '/api' + path;

const { E, page, frame, waitFrame, shot, errors, close } = await openEditor({ out, intercept });
const drawerOpen = () => page.$eval('#drawer', (d) => !d.hidden);
const dialogOpen = () => page.$('dialog[open]').then(Boolean);
const pickPage = async (p) => { if (await page.$eval('#vpages', (el) => el.classList.contains('is-select'))) await page.select('#pagesel', p); else await page.click(`[data-page="${p}"]`); };
const onPage = (p) => waitFrame((q) => location.search.includes(`path=${q}&`) && !!document.querySelector('meta[name="editor-preview"]') && document.readyState === 'complete', enc(p));
const openPen = async (sel) => { const f = await frame(); await f.$eval(sel, (el) => { const host = el.tagName === 'IMG' ? el.parentElement : el; const pen = el.querySelector(':scope > .jte-pen, :scope > .wrap > .jte-pen') || [...host.querySelectorAll(':scope > .jte-pen')].pop(); pen.click(); }); };
const barText = () => page.$eval('.vis__bar', (b) => b.innerText);
const reload = async () => { await page.goto(E.url + '/', { waitUntil: 'networkidle0' }); await onPage(await page.$eval('#pagesel', (s) => s.value)); };
const H = async () => (await E.call('GET', '/api/homepage')).data;
const R = async () => (await E.call('GET', '/api/reviews')).data;
const slowPhoto = `${out}/slow.jpg`;
// One unpublished photo change made "from this editor" through the API (a photo spot, or else a slideshow photo).
async function photoChange(color) {
  const h = await H(); const sharp = (await import('sharp')).default; const base = await testJpeg({ width: 2400, height: 1600, color }); const fd = new FormData();
  for (const w of [2000, 1400, 800]) fd.append(`w${w}`, new Blob([await sharp(base).resize(w).jpeg().toBuffer()]), `w${w}.jpg`);
  fd.append('baseRevision', String(h.revision));
  const r = await E.call('POST', SPOT ? `/api/homepage/spot/${SPOT}` : '/api/homepage/photos', { form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const addReview = async (title, as) => { const r = await R(); const x = await E.call('POST', '/api/reviews', { ...(as ? { as } : {}), body: { fields: { title, text: title + '.', date: '2026-01-02' }, baseRevision: r.revision } }); assert.equal(x.status, 200, JSON.stringify(x.data)); };

try {
  writeFileSync(slowPhoto, await testJpeg({ width: 1400, height: 1800, color: '#3a8', label: 'SLOW' }));
  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  await onPage('/');

  /* 1. Unsaved review typing is never thrown away without asking (Done, Escape, another ✎, page switch, Publish). */
  if (hasReviews) {
    await addReview('Something to publish'); // so Publish has work to do later in this step
    await reload();
    await pickPage(C.reviewsPath); await onPage(C.reviewsPath);
    await openPen('[data-edit="review"]');
    await page.waitForSelector('#drawer #rform');
    assert.equal(await page.evaluate(() => document.querySelector('.vis').getBoundingClientRect().top >= 0 && scrollY === 0), true, 'opening the form does not scroll the editor');
    await page.type('#drawer #r-text', ' plus my new words');
    // Done → asks; "Keep typing" keeps the form and the text.
    await page.click('#drawer [data-close]');
    await page.waitForSelector('dialog[open]');
    // Escape inside the dialog closes only the dialog, not the panel.
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await dialogOpen(), false); assert.equal(await drawerOpen(), true, 'Escape in a dialog keeps the panel open');
    assert.match(await page.$eval('#drawer #r-text', (t) => t.value), /my new words/);
    // Escape on the page → asks too.
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] button[value=no]');
    assert.equal(await drawerOpen(), true);
    // Another ✎ → asks.
    await openPen('[data-edit="reviews"]');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] button[value=no]');
    assert.equal(await page.$('#drawer #rform') !== null, true, 'another ✎ did not replace the form');
    // Page switch → asks, and stays on this page.
    await pickPage('/');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] button[value=no]');
    assert.equal(await page.$eval('#pagesel', (s) => s.value), C.reviewsPath);
    await shot('01-unsaved-typing');
    // Leave → panel closes and the guard is gone: going to the list view asks nothing.
    await page.click('#drawer [data-close]');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog[open] button[value=yes]');
    assert.equal(await drawerOpen(), false);
    await page.evaluate(() => { location.hash = '#/list'; });
    await page.waitForFunction(() => /list view/i.test(document.querySelector('main').innerText));
    assert.equal(await dialogOpen(), false, 'no stale "Leave without saving?" after the panel closed');
    await page.evaluate(() => { location.hash = '#/'; });
    await onPage(C.reviewsPath);
    // Publish while typing: refused with a plain note.
    await openPen('[data-edit="review"]');
    await page.waitForSelector('#drawer #rform');
    await page.type('#drawer #r-text', ' more');
    assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), false, 'there are changes to publish');
    await page.click('[data-publish]');
    await sleep(200);
    assert.equal(await dialogOpen(), false, 'no publish confirm while typing');
    assert.match(await page.$eval('#vmsg', (m) => m.innerText), /save or cancel the review/i);
    await page.click('#drawer [data-cancel]');
    await page.waitForSelector('dialog[open]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForSelector('#drawer [data-add]');
    await page.click('#drawer [data-close]');
    const r = await R(); await E.call('POST', '/api/reviews/discard', { body: { baseRevision: r.revision } });
    await reload();
    ran.push('unsaved typing');
  }

  /* 2. Escape with focus inside the page closes the panel; focus goes back to the ✎ that opened it. */
  if (hasSlides || SPOT) {
    const p = hasSlides ? '/' : C.config.photoSpots[SPOT].page;
    const sel = hasSlides ? '[data-edit="slideshow"]' : `[data-edit="photo"][data-edit-key="${SPOT}"]`;
    await pickPage(p); await onPage(p);
    await openPen(sel);
    await page.waitForSelector('#drawer:not([hidden])');
    assert.equal(await page.$eval('#drawer', (d) => d.getAttribute('role')), 'region');
    const f = await frame();
    await f.focus('.jte-pen');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#drawer').hidden);
    assert.equal(await (await frame()).evaluate(() => document.activeElement?.classList.contains('jte-pen')), true, 'focus is back on a ✎ button');
    ran.push('escape in page');
  }

  /* 3. The page's own buttons work normally (they don't open the panel). */
  if (hasSlides) {
    await pickPage('/'); await onPage('/');
    let f = await frame();
    if (!(await f.$('.hero__pause'))) {
      // needs 2+ slides moving: add one through the API
      const h = await H(); const sharp = (await import('sharp')).default; const base = await testJpeg({ width: 2400, height: 1600, color: '#468' }); const fd = new FormData();
      for (const w of [2000, 1400, 800]) fd.append(`w${w}`, new Blob([await sharp(base).resize(w).jpeg().toBuffer()]), `w${w}.jpg`);
      fd.append('baseRevision', String(h.revision));
      await E.call('POST', '/api/homepage/photos', { form: fd });
      await E.call('PUT', '/api/homepage/settings', { body: { seconds: 7, fade: false, autoplay: true, baseRevision: (await H()).revision } });
      await reload();
      f = await frame();
    }
    await f.$eval('.hero__pause', (b) => b.click());
    await sleep(300);
    assert.equal(await drawerOpen(), false, 'the slideshow pause button does not open the panel');
    assert.equal(await f.$eval('.hero__pause', (b) => b.getAttribute('aria-pressed')), 'true', 'the pause button did its job');
    ran.push('page buttons');
  }

  /* 4. A slow upload never lands in another panel, Publish waits for it, and its result is reported. */
  if (SPOT) {
    const p = C.config.photoSpots[SPOT].page;
    await pickPage(p); await onPage(p);
    await openPen(`[data-edit="photo"][data-edit-key="${SPOT}"]`);
    await page.waitForSelector('#drawer #pfile');
    rules.push({ when: isApi('POST', `/homepage/spot/${SPOT}`), answer: async (req) => { rules.shift(); await sleep(3000); req.continue(); } });
    await (await page.$('#drawer #pfile')).uploadFile(slowPhoto);
    await page.waitForFunction(() => /Uploading/.test(document.querySelector('#drawer').innerText), { timeout: 30000 });
    assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), true, 'Publish waits while a photo is uploading');
    assert.match(await page.$eval('#state', (s) => s.textContent), /Saving/);
    // Meanwhile: open something else.
    if (hasReviews) { await pickPage(C.reviewsPath); await onPage(C.reviewsPath); await openPen('[data-edit="review"]'); await page.waitForSelector('#drawer #rform'); }
    else { await page.click('#drawer [data-close]'); }
    await page.waitForFunction(() => /new photo/i.test(document.querySelector('#flash')?.textContent || ''), { timeout: 60000 });
    if (hasReviews) {
      assert.ok(await page.$('#drawer #rform'), 'the review form is still there');
      assert.equal(await page.$('#drawer #pfile'), null, 'the photo panel did not take over');
      assert.match(await page.$eval('#drawer-title', (t) => t.textContent), /review/i);
      await page.click('#drawer [data-close]');
    }
    assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), false, 'Publish is ready after the upload');
    assert.ok((await H()).draft.photos[SPOT].id, 'the photo was saved');
    await shot('04-slow-upload-reported');
    ran.push('slow upload / busy');
  }

  /* 5. Publish partly fails: the photos go live and are watched; the reviews say plainly they are not published. */
  if ((SPOT || hasSlides) && hasReviews) {
    if (!(await H()).hasUnpublishedChanges) await photoChange('#a16');
    await addReview('Partly published');
    await reload();
    rules.push({ when: isApi('POST', '/reviews/publish'), answer: failWith(500, { error: 'Something went wrong on our side.' }) });
    await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => /not published yet/.test(document.querySelector('#vmsg').innerText), { timeout: 30000 });
    const m = await page.$eval('#vmsg', (x) => x.innerText);
    assert.match(m, /Photos: being published now/);
    assert.match(m, /Reviews: saved, but not published yet/);
    assert.match(await barText(), /Publishing…|Done/, 'the photos publish is being watched');
    assert.ok(JSON.parse(E.gh.read('content/site.json')).photos || JSON.parse(E.gh.read('content/site.json')).heroSlides, 'photos commit landed');
    assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), false, 'reviews can still be published');
    await shot('05-partial-publish');
    rules.length = 0;
    await page.click('[data-retry-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => document.querySelector('[data-undo-all]').hidden && !document.querySelector('#vmsg').innerText.trim(), { timeout: 30000 }); // nothing left to publish
    assert.ok(JSON.parse(E.gh.read(C.reviewsFile)).items.some((t) => t.title === 'Partly published'), 'Try again published the reviews');
    await page.waitForFunction(() => /✓ Done/.test(document.querySelector('.vis__bar').innerText), { timeout: 60000 });
    ran.push('partial publish');
  }

  /* 6. Two publishes in a row: one watcher, no early "Done" for the second, the stored job is the newest. */
  if (SPOT || hasSlides) {
    const change = photoChange;
    E.site.deploy = false; // the website "build" takes a while
    await change('#814'); await reload();
    await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => /Publishing…/.test(document.querySelector('.vis__pub').innerText) && (localStorage.getItem('site-publishing') || localStorage.getItem('dmh-publishing')), { timeout: 30000 });
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('site-publishing') || localStorage.getItem('dmh-publishing')).commit);
    await change('#148'); await reload();
    const polled = new Map();
    page.on('request', (q) => { const m = /\/api\/publish-status\/(\w+)/.exec(q.url()); if (m) polled.set(m[1], (polled.get(m[1]) || 0) + 1); });
    await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction((c) => { const j = JSON.parse(localStorage.getItem('site-publishing') || localStorage.getItem('dmh-publishing') || 'null'); return j && j.commit !== c; }, { timeout: 30000 }, first);
    const second = await page.evaluate(() => JSON.parse(localStorage.getItem('site-publishing') || localStorage.getItem('dmh-publishing')).commit);
    polled.clear();
    await sleep(7000); // more than one polling round
    assert.equal(polled.get(first) || 0, 0, 'the first publish is no longer watched');
    assert.ok((polled.get(second) || 0) >= 1, 'the second publish is watched');
    assert.equal(await page.$$eval('.vis__pub .publine', (a) => a.length), 1, 'one publishing line');
    E.site.deploy = true;
    await page.waitForFunction(() => /✓ Done/.test(document.querySelector('.vis__bar').innerText), { timeout: 60000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('site-publishing') || localStorage.getItem('dmh-publishing')), null, 'job cleared only when the newest commit is live');
    ran.push('double publish');
  }

  /* 7. Conflicts: a slideshow choice saved elsewhere snaps back; "Reload latest" fixes Publish for good. */
  if (hasSlides) {
    await pickPage('/'); await onPage('/');
    await openPen('[data-edit="slideshow"]');
    await page.waitForSelector('#drawer input[name=autoplay]');
    const was = await page.$eval('#drawer input[name=autoplay]:checked', (r) => r.value);
    const h = await H();
    await E.call('PUT', '/api/homepage/settings', { as: MAINT, body: { seconds: 10, fade: !h.draft.fade, autoplay: h.draft.autoplay, baseRevision: h.revision } });
    await page.click(`#drawer input[name=autoplay][value=${was === 'on' ? 'off' : 'on'}]`);
    await page.waitForFunction(() => /another computer/.test(document.querySelector('#drawer').innerText), { timeout: 30000 });
    assert.equal(await page.$eval('#drawer input[name=autoplay]:checked', (r) => r.value), was, 'the choice snapped back to what is saved');
    assert.equal(await page.$eval('#drawer input[name=speed]:checked', (r) => r.value), '10', 'shows the other computer\'s choice');
    assert.equal(await page.$eval('#flash', (f) => f.hidden || !/Saved/.test(f.textContent)), true, 'no stale "Saved" message');
    await shot('07-conflict');
    await page.click('#drawer [data-reload]');
    await page.waitForFunction(() => !/another computer/.test(document.querySelector('#drawer')?.innerText || '') && !!document.querySelector('#drawer:not([hidden]) input[name=autoplay]'), { timeout: 30000 });
    ran.push('slideshow 409');
  }
  if (hasReviews) {
    await addReview('Mine');
    await reload();
    await addReview('Theirs', MAINT); // from another computer
    await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForSelector('#vmsg [data-reload]', { timeout: 30000 });
    await page.click('#vmsg [data-reload]');
    await page.waitForFunction(() => !document.querySelector('#vmsg').innerText.trim());
    await page.click('[data-publish]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => document.querySelector('[data-undo-all]').hidden && !document.querySelector('#vmsg').innerText.trim(), { timeout: 30000 }); // nothing left to publish
    const items = JSON.parse(E.gh.read(C.reviewsFile)).items.map((t) => t.title);
    assert.ok(items.includes('Mine') && items.includes('Theirs'), 'after Reload latest, Publish works and keeps both changes');
    ran.push('reviews 409 + reload');
  }

  /* 8. Undo all: everything goes back; when one part fails, it says which. */
  if ((SPOT || hasSlides) && hasReviews) {
    await addReview('To be undone');
    await photoChange('#61a');
    await reload();
    rules.push({ when: isApi('POST', '/reviews/discard'), answer: failWith(500, { error: 'Something went wrong on our side.' }) });
    await page.click('[data-undo-all]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => /could not be undone/.test(document.querySelector('#vmsg').innerText), { timeout: 30000 });
    assert.match(await page.$eval('#vmsg', (m) => m.innerText), /Photos: back to what is on the website[\s\S]*Reviews: could not be undone/);
    assert.equal((await H()).hasUnpublishedChanges, false);
    rules.length = 0;
    await page.click('[data-undo-all]'); await page.click('dialog[open] button[value=yes]');
    await page.waitForFunction(() => document.querySelector('[data-undo-all]').hidden && document.querySelector('[data-publish]').disabled, { timeout: 30000 }); // nothing left to undo
    assert.equal((await R()).hasUnpublishedChanges, false, 'Undo all undid the reviews too');
    assert.equal(await page.$eval('[data-undo-all]', (b) => b.hidden), true);
    ran.push('undo all');
  }

  /* 9. A preview that can't be shown says so (server error, then signed out), with Try again. */
  rules.push({ when: (u) => u.pathname === '/api/homepage/preview', answer: failWith(500, { error: 'Something went wrong on our side.' }) });
  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#over').hidden, { timeout: 30000 });
  assert.match(await page.$eval('#over', (o) => o.innerText), /couldn't be shown/);
  await shot('09-preview-error');
  rules.length = 0;
  rules.push({ when: (u) => u.pathname === '/api/homepage/preview', answer: (req) => req.respond({ status: 302, headers: { Location: 'https://site-test.cloudflareaccess.com/cdn-cgi/access/login/editor' }, body: '' }) });
  rules.push({ when: (u) => u.host === 'site-test.cloudflareaccess.com', answer: (req) => req.respond({ status: 200, contentType: 'text/html', headers: { 'X-Frame-Options': 'DENY' }, body: '<h1>Sign in</h1>' }) });
  await page.click('#over [data-retry-page]');
  await page.waitForFunction(() => /signed out/.test(document.querySelector('#over').innerText), { timeout: 30000 });
  assert.ok(await page.$('#over a[href="/"][target=_blank]'), 'Sign in again link');
  await shot('09b-signed-out');
  rules.length = 0;
  await page.click('#over [data-retry-page]');
  await page.waitForFunction(() => document.querySelector('#over').hidden || /Nothing to change/.test(document.querySelector('#over').innerText), { timeout: 30000 });
  ran.push('preview errors');

  assert.deepEqual(errors, [], 'no script errors');
} finally {
  await close();
}

/* 10. A site under a sub-path (GitHub Pages testing link): links in the page still switch pages;
   relative and root-relative links too; #anchors stay; a <button> inside a link doesn't leave the editor. */
{
  const S = await openEditor({ out: out + '/subpath', siteUrl: SITE + '/calm-site' });
  try {
    const { page: p, waitFrame: wf, frame: fr } = S;
    await p.goto(S.E.url + '/', { waitUntil: 'networkidle0' });
    await wf(() => !!document.querySelector('meta[name="editor-preview"]') && document.readyState === 'complete');
    const pages = await p.$$eval('#pagesel option', (o) => o.map((x) => x.value));
    const other = pages.find((x) => x !== '/');
    const f = await fr();
    assert.match(await f.$eval(`a[href$="${other}"]`, (a) => a.href), /\/calm-site\//, 'links carry the sub-path');
    await f.click(`a[href$="${other}"]`); // clicking a link's words edits them; the toolbar opens the page it goes to
    await p.waitForSelector('.jte-tbar [data-go]');
    await (await p.$('.jte-tbar [data-go]')).click();
    await wf((q) => location.search.includes(`path=${q}&`), encodeURIComponent(other));
    // Hand-written links of other kinds, as copied client sites often have.
    const add = async (html) => (await fr()).evaluate((h) => { const d = document.createElement('div'); d.id = 'jte-test-links'; d.innerHTML = h; document.querySelector('main').prepend(d); }, html);
    const back = async (q) => wf((x) => location.search.includes(`path=${x}&`), encodeURIComponent(q));
    await add('<a id="l-rel" href="../">Home (relative)</a>');
    await (await fr()).click('#l-rel'); await back('/');
    await add(`<a id="l-root" href="${other}">root-relative, no sub-path</a> <a id="l-anchor" href="#main">anchor</a> <a id="l-btn" href="${other}"><button type="button">Book now</button></a>`);
    await (await fr()).click('#l-anchor'); await sleep(300);
    assert.match(await (await fr()).evaluate(() => location.search), /path=%2F&/, '#anchor stays on the page');
    await (await fr()).click('#l-btn button'); await back(other);
    await add('<a id="l-root2" href="/">root</a>');
    await (await fr()).click('#l-root2'); await back('/');
    assert.deepEqual(S.errors, [], 'no script errors');
    ran.push('sub-path links');
  } finally { await S.close(); }
}

console.log('editor edge cases ok:', ran.join(', '), '– screenshots in', out);
