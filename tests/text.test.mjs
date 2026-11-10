// API tests of the owner editor's "words" draft source (/api/text): every visible word on the website can be
// changed by the owner. Runs the real Worker in Miniflare with a fake GitHub (tests/harness.mjs).
// Adapts to THIS client: the keys come from its content/text.json and content/site.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startEditor, OWNER } from './harness.mjs';
import { textEntries, textRules } from '../src/lib/text.mjs';

const TEXT = JSON.parse(readFileSync(new URL('../content/text.json', import.meta.url), 'utf8'));
const SITE = JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'));
const ENTRIES = textEntries(TEXT, SITE);
const RULES = textRules(TEXT);
const LINE = Object.keys(TEXT.text).find((k) => typeof TEXT.text[k] === 'string'); // a one-line text key
const MULTI = Object.keys(ENTRIES).find((k) => Array.isArray(ENTRIES[k])); // a multi-paragraph key, if any
const PHONE = Object.keys(RULES.kinds).find((k) => RULES.kinds[k] === 'phone' && k in ENTRIES);
const EMAIL = Object.keys(RULES.kinds).find((k) => RULES.kinds[k] === 'email' && k in ENTRIES);
const MUST = RULES.mustStay.find((k) => k in ENTRIES);

let E;
before(async () => { E = await startEditor(); });
after(async () => { await E.close(); });

const T = async () => (await E.call('GET', '/api/text')).data;
const save = (key, value, rev, extra = {}) => E.call('POST', '/api/text/item', { body: { key, value, baseRevision: rev, ...extra } });
const repoJson = (p) => JSON.parse(E.gh.read(p).toString());
const preview = async (path = '/', edit = true) => (await E.call('GET', `/api/homepage/preview?${edit ? 'edit=1&' : ''}path=${encodeURIComponent(path)}`)).data;

test('words: starts from the website files, nothing unpublished; signed-out is refused', async () => {
  assert.equal((await E.call('GET', '/api/text', { as: null })).status, 401);
  const st = await T();
  assert.equal(st.hasUnpublishedChanges, false);
  assert.deepEqual(st.draft.text, TEXT.text, 'every key of content/text.json');
  for (const f of RULES.siteFields) if (`site.${f}` in ENTRIES) assert.deepEqual(st.draft.site[f], SITE[f], `site.json ${f}`);
  assert.ok(!('heroSlides' in st.draft.site) && !('contactFormTo' in st.draft.site), 'only the wording fields of site.json');
});

test('words: save one line → preview (edit mode and normal) shows it; unchanged save changes nothing; plain text only', async () => {
  let st = await T();
  const r = await save(LINE, '  New   <b>words</b> <script>alert(1)</script>here\n ', st.revision);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.draft.text[LINE], 'New words alert(1)here', 'HTML tags are removed, spaces tidied');
  assert.equal(r.data.hasUnpublishedChanges, true);
  assert.deepEqual(r.data.changed, [LINE]);
  st = r.data;
  const again = await save(LINE, 'New words alert(1)here', st.revision);
  assert.equal(again.data.revision, st.revision, 'the same words again is not a new change');
  // The word shows on whichever page uses it: look on every page of the picker.
  const me = (await E.call('GET', '/api/me')).data;
  let found = false;
  for (const p of me.pages) {
    const h = await preview(p.path);
    if (h.includes(`data-edit-key="${LINE}"`)) { found = true; assert.match(h, /New words alert\(1\)here/); assert.doesNotMatch(h, /<script>alert/); assert.match(await preview(p.path, false), /New words alert\(1\)here/, 'normal preview too'); break; }
  }
  assert.ok(found, `${LINE} is on one of the editor's pages`);
  const back = await save(LINE, TEXT.text[LINE], st.revision);
  assert.equal(back.data.hasUnpublishedChanges, false, 'typing the old words back = nothing to publish');
});

test('words: checks – unknown key, empty, too long, a line that must stay, stale revision (409)', async () => {
  const st = await T();
  assert.equal((await save('nope.key', 'x', st.revision)).status, 404);
  assert.equal((await save('site.heroSlides', 'x', st.revision)).status, 404, 'not a wording field');
  assert.equal((await save('site.contactFormTo', 'x', st.revision)).status, 404, 'the form address is not wording');
  const empty = await save(LINE, '   ', st.revision);
  assert.equal(empty.status, 422); assert.match(empty.data.error, /can't be empty/);
  const long = await save(LINE, 'x'.repeat(301), st.revision);
  assert.equal(long.status, 422); assert.match(long.data.error, /at most 300/);
  if (MUST) { const m = await save(MUST, '', st.revision); assert.equal(m.status, 422); assert.match(m.data.error, /must stay on your website/); }
  const ok = await save(LINE, 'Fresh words', st.revision);
  assert.equal(ok.status, 200);
  const stale = await save(LINE, 'Older words', st.revision);
  assert.equal(stale.status, 409); assert.equal(stale.data.conflict, true);
  await E.call('POST', '/api/text/discard', { body: { baseRevision: ok.data.revision } });
});

test('words: several paragraphs keep their blank-line paragraphs; lists keep one item per line', { skip: !MULTI && 'no multi-paragraph words' }, async () => {
  let st = await T();
  let r = await save(MULTI, 'First paragraph.\n\nSecond  paragraph\nstill second.\n\n\n', st.revision);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(MULTI.startsWith('site.') ? r.data.draft.site[MULTI.slice(5)] : r.data.draft.text[MULTI], ['First paragraph.', 'Second paragraph still second.']);
  r = await save(MULTI, ['One', '', ' Two '], r.data.revision);
  assert.deepEqual(MULTI.startsWith('site.') ? r.data.draft.site[MULTI.slice(5)] : r.data.draft.text[MULTI], ['One', 'Two'], 'a list from the page editor');
  r = await save(MULTI, ['a', 'b\nc'], r.data.revision, { list: true });
  assert.deepEqual(MULTI.startsWith('site.') ? r.data.draft.site[MULTI.slice(5)] : r.data.draft.text[MULTI], ['a', 'b', 'c'], 'list items: one per line');
  assert.equal((await save(MULTI, ['', ' '], r.data.revision)).status, 422, 'can\'t be emptied');
  st = await T();
  await E.call('POST', '/api/text/discard', { body: { baseRevision: st.revision } });
});

test('words: phone numbers and email addresses are checked, so Call / Text / Email keep working', { skip: !PHONE && !EMAIL && 'no phone or email' }, async () => {
  let st = await T();
  if (PHONE) {
    assert.equal((await save(PHONE, 'call me maybe', st.revision)).status, 422);
    assert.equal((await save(PHONE, '12', st.revision)).status, 422, 'too few digits');
    const r = await save(PHONE, '(704) 555-0199', st.revision);
    assert.equal(r.status, 200);
    st = r.data;
    const h = await preview('/');
    assert.match(h, /\(704\) 555-0199/, 'the new number shows');
    if (SITE.phoneHref) assert.match(h, /href="tel:\+?1?7045550199"/, 'the Call link follows the new number');
    else assert.match(h, /href="tel:7045550199"/, 'the Call link follows the new number');
  }
  if (EMAIL) {
    const bad = await save(EMAIL, 'not an email', st.revision);
    assert.equal(bad.status, 422); assert.match(bad.data.error, /email address/);
    const r = await save(EMAIL, 'new.owner@example.org', st.revision);
    assert.equal(r.status, 200);
    st = r.data;
    assert.match(await preview('/'), /mailto:new\.owner@example\.org/);
  }
  await E.call('POST', '/api/text/discard', { body: { baseRevision: st.revision } });
});

test('words: publish = one commit that changes only the changed words (other fields kept); discard; repo changes picked up', async () => {
  let st = await T();
  const siteBefore = repoJson('content/site.json');
  let r = await save(LINE, 'Published words', st.revision);
  if (PHONE) r = await save(PHONE, '704-555-0123', r.data.revision);
  const head0 = E.gh.head;
  const pub = await E.call('POST', '/api/text/publish', { body: { baseRevision: r.data.revision } });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.text.hasUnpublishedChanges, false);
  assert.notEqual(E.gh.head, head0);
  assert.equal(E.gh.commits.get(E.gh.head).parent, head0, 'exactly one commit');
  assert.match(E.gh.commits.get(E.gh.head).message, /Update website wording \(\d changes?\)/);
  const tf = repoJson('content/text.json');
  assert.equal(tf.text[LINE], 'Published words');
  for (const k of Object.keys(TEXT.text)) if (k !== LINE) assert.deepEqual(tf.text[k], TEXT.text[k], `${k} unchanged`);
  assert.deepEqual(tf.siteFields, TEXT.siteFields, 'the rules in text.json are kept');
  const sj = repoJson('content/site.json');
  for (const k of Object.keys(siteBefore)) if (!(PHONE && ['phone', 'phoneHref', 'smsHref'].includes(k))) assert.deepEqual(sj[k], siteBefore[k], `site.json ${k} kept`);
  if (PHONE) { assert.equal(sj.phone, '704-555-0123'); if (siteBefore.phoneHref) assert.equal(sj.phoneHref, 'tel:+17045550123'); if (siteBefore.smsHref) assert.equal(sj.smsHref, 'sms:+17045550123'); }

  // Discard goes back to the published words.
  st = (await save(LINE, 'Not wanted', pub.data.text.revision)).data;
  const d = await E.call('POST', '/api/text/discard', { body: { baseRevision: st.revision } });
  assert.equal(d.data.draft.text[LINE], 'Published words');
  assert.equal(d.data.hasUnpublishedChanges, false);

  // A helper adds a new page's wording in the repo: the editor offers it straight away, the owner's typing stays.
  st = (await save(LINE, 'Owner typing', d.data.revision)).data;
  const file = repoJson('content/text.json');
  file.text['extra.newWords'] = 'Brand new page words';
  E.gh.seed('content/text.json', JSON.stringify(file, null, 2));
  const fresh = await T();
  assert.equal(fresh.draft.text['extra.newWords'], 'Brand new page words');
  assert.equal(fresh.draft.text[LINE], 'Owner typing', 'unpublished typing kept on top');
  const n = await save('extra.newWords', 'Changed new words', fresh.revision);
  assert.equal(n.status, 200, 'new keys can be changed without any editor change');
  await E.call('POST', '/api/text/discard', { body: { baseRevision: n.data.revision } });
  assert.equal((await E.call('POST', '/api/text/publish', { body: { baseRevision: 1 }, as: OWNER })).status, 409, 'stale publish refused');
});
