#!/usr/bin/env node
// Browser check of changing WORDS on the page (the "text" kind): hover shows a small ✎, clicking words edits them in
// place with a toolbar (Save – show it on my page / Cancel), Enter saves (or starts a new paragraph in paragraphs),
// a footer line that must stay can't be emptied, a menu label keeps its link, phone numbers are checked, Escape and
// clicking elsewhere ask before throwing typing away, Publish writes content/text.json, Undo all puts the words back.
// Adapts to THIS client: it looks for the kinds of words its pages have. Screenshots: /tmp/ui-text (look at them).
// Run: npm run test:visual   (needs Chrome at /usr/bin/google-chrome or CHROME_PATH)
import assert from 'node:assert/strict';
import { openEditor, sleep } from './browser.mjs';

const out = process.env.SHOT_W ? `/tmp/ui-text-${process.env.SHOT_W}x${process.env.SHOT_H}` : '/tmp/ui-text';
const W = Number(process.env.SHOT_W) || 1366, Hh = Number(process.env.SHOT_H) || 768;
const { E, page, frame, waitFrame, shot, errors, close } = await openEditor({ out, width: W, height: Hh });
const pickPage = async (p) => {
  if (await page.$eval('#vpages', (el) => el.classList.contains('is-select'))) return page.select('#pagesel', p);
  if (await page.$(`[data-page="${p}"]`)) return page.click(`[data-page="${p}"]`);
  return page.select('#pagemore', p);
};
const ready = (p) => waitFrame((q) => location.search.includes(`path=${q}&`) && document.readyState === 'complete' && !!document.querySelector('.jte-tpen'), encodeURIComponent(p));
const repoText = () => JSON.parse(E.gh.read('content/text.json').toString());
const T = async () => (await E.call('GET', '/api/text')).data;
const editing = async () => (await frame()).evaluate(() => { const el = document.querySelector('.jte-editing'); return el ? { key: el.dataset.editKey, ce: el.getAttribute('contenteditable'), bar: false } : null; });
const barText = async () => page.$eval('.jte-tbar', (b) => b.innerText);
const selectAll = async () => { await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); };
const clickWords = async (sel) => { const f = await frame(); await f.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await sleep(150); await (await f.$(sel)).click(); await sleep(250); };
const wordsOf = async (sel) => (await frame()).$eval(sel, (el) => el.innerText.trim());
const savedTo = async (key, want) => { for (let i = 0; i < 80; i++) { const s = await T(); const v = key.startsWith('site.') ? s.draft.site[key.slice(5)] : s.draft.text[key]; if (JSON.stringify(v) === JSON.stringify(want)) return s; await sleep(100); } throw new Error(`${key} was not saved as ${JSON.stringify(want)}`); };
const dialog = async (value) => { await page.waitForSelector('dialog[open]'); await page.click(`dialog[open] button[value="${value}"]`); await sleep(200); };
const ran = [];

try {
  await page.goto(E.url + '/', { waitUntil: 'networkidle0' });
  let f = await ready('/');
  const start = await T();

  // 0. Outlines never cover words: the reviews list (not full width) gets its outline outside its edge.
  for (const p of await page.$$eval('#pagesel option', (o) => o.map((x) => x.value))) {
    await pickPage(p); f = await ready(p);
    const box = await f.evaluate(() => { const el = [...document.querySelectorAll('[data-edit="reviews"], [data-edit="photo"]')].find((x) => !x.classList.contains('jte-wide')); if (!el) return null; el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); const r = el.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 60, kind: el.dataset.edit }; });
    if (!box || box.kind !== 'reviews') continue;
    await page.mouse.move(0, 0);
    await f.$eval('[data-edit="reviews"]', (el) => el.classList.add('jte-hover'));
    await sleep(250);
    const o = await f.$eval('[data-edit="reviews"]', (el) => ({ off: parseFloat(getComputedStyle(el).outlineOffset), color: getComputedStyle(el).outlineColor }));
    assert.ok(o.off >= 0, `the reviews list outline sits outside it (offset ${o.off}px), so it never covers the first letters`);
    await shot('t00-reviews-outline');
    await f.$eval('[data-edit="reviews"]', (el) => el.classList.remove('jte-hover'));
    ran.push('outline outside');
    break;
  }
  await pickPage('/'); f = await ready('/');

  // 1. Hover a heading: dashed outline + the small ✎; the words are keyboard-focusable with a clear label.
  const H = await f.evaluate(() => { const el = [...document.querySelectorAll('h1 [data-edit="text"], h2 [data-edit="text"]')][0]; el.id = 'jt-heading'; return { key: el.dataset.editKey, words: el.innerText.trim() }; });
  await f.hover('#jt-heading'); await sleep(250);
  assert.ok(await f.$eval('.jte-tpen', (p) => p.classList.contains('is-on')), 'the small ✎ shows on hover');
  assert.ok(await f.$eval('#jt-heading', (el) => el.classList.contains('jte-hover') && getComputedStyle(el).outlineStyle === 'dashed'), 'outline on hover');
  assert.match(await f.$eval('#jt-heading', (el) => el.getAttribute('aria-label')), /^Change text: .+/);
  assert.equal(await f.$eval('#jt-heading', (el) => el.tabIndex), 0, 'keyboard can reach the words');
  assert.equal(await f.$$eval('.jte-pen', (a) => a.filter((p) => /^✎$/.test(p.textContent)).length), 0, 'words get no big pens (no clutter)');
  await shot('t01-hover-heading');

  // 2. Click the heading → typing right on the page, toolbar next to it; Enter saves; the page shows it.
  await clickWords('#jt-heading');
  let ed = await editing();
  assert.equal(ed.key, H.key); assert.equal(ed.ce, 'plaintext-only'); assert.ok(await page.$('#textbar:not([hidden]) .jte-tbar'), 'toolbar');
  assert.match(await barText(), /Save – show it on my page/); assert.match(await barText(), /Cancel/);
  assert.equal(await (await frame()).$('.jte-tbar'), null, 'the Save/Cancel strip is outside the page, never on top of the words');
  assert.ok(await page.$eval('#textbar', (t) => !t.hidden && t.getBoundingClientRect().top >= document.querySelector('#stage').getBoundingClientRect().bottom - 1), 'strip sits below the page');
  await selectAll(); await page.keyboard.type('Fresh heading words');
  await shot('t02-editing-heading');
  await page.keyboard.press('Enter');
  await savedTo(H.key, 'Fresh heading words');
  f = await waitFrame((k) => [...document.querySelectorAll(`[data-edit-key="${k}"]`)].some((x) => x.innerText.includes('Fresh heading words')) && !!document.querySelector('.jte-tpen'), H.key);
  assert.equal(await editing(), null, 'typing ended');
  assert.match(await page.$eval('#state', (s) => s.textContent), /not on the website yet/);
  assert.equal(await page.$eval('[data-publish]', (b) => b.disabled), false);
  await shot('t03-after-save');
  ran.push('heading');

  // 3. Several paragraphs (a bio / intro): Enter starts a new paragraph; saved as paragraphs.
  const multiPage = await (async () => { for (const p of (await page.$$eval('#pagesel option', (o) => o.map((x) => x.value)))) { await pickPage(p); const g = await ready(p); if (await g.$('[data-text-multi="p"]')) return p; } return null; })();
  if (multiPage) {
    f = await frame();
    const MK = await f.$eval('[data-text-multi="p"]', (el) => { el.id = 'jt-multi'; return el.dataset.editKey; });
    await clickWords('#jt-multi p:first-child');
    assert.match(await barText(), /Enter\s+starts a new paragraph/);
    await selectAll(); await page.keyboard.type('First new paragraph.');
    await page.keyboard.press('Enter'); await page.keyboard.type('Second new paragraph.');
    assert.equal(await f.$$eval('#jt-multi p', (ps) => ps.length), 2, 'Enter made a new paragraph on the page');
    await shot('t04-editing-paragraphs');
    await (await page.$('.jte-tbar [data-save]')).click();
    await savedTo(MK, ['First new paragraph.', 'Second new paragraph.']);
    f = await waitFrame((k) => document.querySelectorAll(`[data-edit-key="${k}"] p`).length === 2 && !!document.querySelector('.jte-tpen'), MK);
    ran.push('paragraphs');
  }

  // 4. A footer line that must stay (legal/compliance): note in the toolbar, can't be emptied.
  await pickPage('/'); f = await ready('/');
  const foot = await f.evaluate(() => { const el = document.querySelector('footer [data-text-must]') || document.querySelector('footer [data-edit="text"]'); el.id = 'jt-foot'; return { key: el.dataset.editKey, must: el.dataset.textMust === '1', words: el.innerText.trim() }; });
  await clickWords('#jt-foot');
  if (foot.must) {
    assert.match(await barText(), /This must stay on your website/);
    await selectAll(); await page.keyboard.press('Backspace');
    await (await page.$('.jte-tbar [data-save]')).click(); await sleep(200);
    assert.match(await page.$eval('.jte-tbar__err', (x) => x.innerText), /must stay on your website/, 'can\'t be emptied');
  }
  await selectAll(); await page.keyboard.type(`${foot.words} Ltd`);
  await shot('t05-footer-edit');
  await page.keyboard.press('Enter');
  await savedTo(foot.key, `${foot.words} Ltd`);
  f = await ready('/');
  ran.push('footer');

  // 5. A menu label: only the words change; the link still goes to the same page (and the toolbar can open it).
  const nav = await f.evaluate(() => { const el = [...document.querySelectorAll('nav [data-edit="text"]')].find((x) => x.closest('a').getAttribute('href') !== document.querySelector('nav a')?.getAttribute('href')) || document.querySelector('nav [data-edit="text"]'); el.id = 'jt-nav'; return { key: el.dataset.editKey, href: el.closest('a').getAttribute('href'), words: el.innerText.trim() }; });
  await clickWords('#jt-nav');
  assert.match(await barText(), /Only the words change – the link still goes to the same place/);
  await selectAll(); await page.keyboard.type(`${nav.words} Us`);
  await page.keyboard.press('Enter');
  await savedTo(nav.key, `${nav.words} Us`);
  f = await ready('/');
  assert.equal(await f.$eval(`nav a[href="${nav.href}"]`, (a) => a.innerText.trim()), `${nav.words} Us`, 'new label, same link address');
  await clickWords(`nav a[href="${nav.href}"] [data-edit="text"]`);
  const go = await page.$('.jte-tbar [data-go]');
  if (go) {
    await go.click();
    const target = await page.evaluate(() => document.querySelector('#pagesel').value);
    assert.notEqual(target, '/', 'the link opened its page');
    f = await ready(target);
  } else await (await page.$('.jte-tbar [data-cancel]')).click();
  ran.push('menu label');

  // 6. Phone number: letters are refused with a clear message; Escape asks before throwing typing away.
  await pickPage('/'); f = await ready('/');
  const ph = await f.evaluate(() => { const el = document.querySelector('[data-text-kind="phone"]'); if (!el) return null; el.id = 'jt-phone'; return { key: el.dataset.editKey, words: el.innerText.trim() }; });
  if (ph) {
    await clickWords('#jt-phone');
    assert.match(await barText(), /phone number/);
    await selectAll(); await page.keyboard.type('call me');
    await page.keyboard.press('Enter'); await sleep(200);
    assert.match(await page.$eval('.jte-tbar__err', (x) => x.innerText), /phone number using numbers only/);
    assert.ok(await editing(), 'still typing after a refused save');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('dialog[open]', (d) => d.innerText), /Throw away your typing/);
    await shot('t06-escape-asks');
    await dialog('no'); // keep typing
    assert.ok(await editing(), 'Keep typing keeps the words');
    await page.keyboard.press('Escape'); await dialog('yes');
    assert.equal(await editing(), null);
    assert.equal(await wordsOf('#jt-phone'), ph.words, 'old number back');
    ran.push('phone check + Escape');
  }

  // 7. Typing, then doing something else: asked to Save / Don't save / Keep typing (page switch, Publish, another click).
  f = await frame();
  await clickWords('#jt-heading, [data-edit-key="' + H.key + '"]');
  await selectAll(); await page.keyboard.type('Unsaved words');
  const other = (await page.$$eval('#pagesel option', (o) => o.map((x) => x.value))).find((p) => p !== '/');
  await pickPage(other);
  await page.waitForSelector('dialog[open]');
  assert.match(await page.$eval('dialog[open]', (d) => d.innerText), /Save your new words\?/);
  await shot('t07-unsaved-asks');
  await dialog('keep');
  assert.equal(await page.$eval('#pagesel', (s) => s.value), '/', 'stayed on the page');
  await page.click('[data-publish]'); await sleep(200);
  assert.match(await page.$eval('#vmsg', (m) => m.innerText), /save or cancel the words you are typing/);
  // Click other words on the page: asked; "Don't save" puts the old words back and starts on the clicked words.
  await (await (await frame()).$('#jt-foot, footer [data-edit="text"]')).click();
  await dialog('discard');
  await sleep(300);
  assert.equal(await wordsOf(`[data-edit-key="${H.key}"]`), 'Fresh heading words', 'unsaved typing thrown away');
  assert.ok(await editing(), 'now typing in the clicked words');
  await page.keyboard.press('Escape'); await sleep(200);
  if (await page.$('dialog[open]')) await dialog('yes');
  ran.push('unsaved guards');

  // 8. A button label (words inside a <button>): typed in a box in the toolbar.
  for (const p of await page.$$eval('#pagesel option', (o) => o.map((x) => x.value))) {
    await pickPage(p); f = await ready(p);
    const B = await f.evaluate(() => { const el = [...document.querySelectorAll('button [data-edit="text"]')].find((x) => x.getBoundingClientRect().width > 20 && !x.closest('.sr-focus, [hidden]')); if (!el) return null; el.id = 'jt-btn'; return { key: el.dataset.editKey, words: el.innerText.trim() }; });
    if (!B) continue;
    await clickWords('#jt-btn');
    assert.ok(await page.$('.jte-tbar .jte-tbar__input'), 'a box to type in');
    await page.$eval('.jte-tbar__input', (i) => i.select());
    await page.keyboard.type(`${B.words} now`);
    await page.keyboard.press('Enter');
    await savedTo(B.key, `${B.words} now`);
    f = await ready(p);
    ran.push('button label');
    break;
  }

  // 9. Publish → one commit writes the words to content/text.json (and site.json fields).
  await page.click('[data-publish]'); await dialog('yes');
  await page.waitForFunction(() => /Done|Publishing/.test(document.querySelector('#vpub')?.innerText || ''), { timeout: 30000 });
  const tf = repoText();
  if (!H.key.startsWith('site.')) assert.equal(tf.text[H.key], 'Fresh heading words', 'published to content/text.json');
  if (!nav.key.startsWith('site.')) assert.equal(tf.text[nav.key], `${nav.words} Us`);
  assert.equal((await T()).hasUnpublishedChanges, false);
  await shot('t08-published');
  ran.push('publish');

  // 10. Undo all puts unpublished words back to what is on the website.
  await pickPage('/'); f = await ready('/');
  await clickWords(`[data-edit-key="${H.key}"]`);
  await selectAll(); await page.keyboard.type('Words to undo');
  await page.keyboard.press('Enter');
  await savedTo(H.key, 'Words to undo');
  f = await ready('/');
  await page.click('[data-undo-all]'); await dialog('yes');
  await savedTo(H.key, 'Fresh heading words');
  f = await waitFrame((k) => document.querySelector(`[data-edit-key="${k}"]`)?.innerText.includes('Fresh heading words'), H.key);
  assert.equal((await T()).hasUnpublishedChanges, false);
  ran.push('undo all');

  assert.ok(start.revision >= 1);
  assert.deepEqual(errors, [], 'no script errors');
  console.log('text editing ok:', ran.join(', '), '– screenshots in', out);
} catch (err) {
  await shot('zz-text-fail').catch(() => {});
  throw err;
} finally {
  await close();
}
