// "Every visible word is editable" – the guarantee behind the editor's word editing.
// Renders EVERY page of the site (classic design, the one the editor shows) in edit mode and fails when any visible
// words are not inside a data-edit="text" element (drawn by t()/tBlock()/tList() from src/lib/text.mjs) or an element
// another editor owns (ownedBy(ctx, 'reviews') – review words; ownedBy(ctx, 'preview') – the testing banner).
// So a page or template that hard-codes words fails here, before it can be deployed.
// Also checks: every marked key exists in content/text.json / site.json, and the real website (both designs) has no marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, mainPages, extraPages } from '../scripts/build.mjs';
import { layout } from '../src/templates/layout.mjs';
import { luxLayout } from '../src/templates/luxury.mjs';
import * as P from '../src/templates/pages.mjs';
import { textEntries, cleanText, textMeta } from '../src/lib/text.mjs';
import { uncoveredText, textMarks } from './html-text.mjs';

const content = await loadContent();
function pages({ editMode, preview = true, theme = 'classic' }) {
  const ctx = { ...content, preview, editMode, siteUrl: '', buildId: 'test', url: (p) => p };
  const page = theme === 'luxury' ? luxLayout : layout;
  return [
    ...mainPages(theme).map(([path, title, fn, opts]) => ({ path, html: page(ctx, { path, title, body: fn(ctx), ...opts }) })),
    ...extraPages(ctx, page),
    { path: '/404', html: page(ctx, { path: '/404', title: 'Page not found', body: P.notFoundPage(ctx) }) },
  ];
}

test('every visible word on every page can be changed by Dan (edit mode marks it)', () => {
  const entries = textEntries(content.text, content.site);
  const problems = [];
  const used = new Set();
  for (const { path, html } of pages({ editMode: true })) {
    for (const u of uncoveredText(html)) problems.push(`${path}: "${u.text}" (in ${u.where}) can't be changed by Dan – put it through t(ctx, '<key>') with the words in content/text.json (or, if another editor owns it, mark it with ownedBy(ctx, '<kind>'))`);
    for (const m of textMarks(html)) {
      used.add(m.key);
      if (!(m.key in entries)) problems.push(`${path}: text key "${m.key}" is not in content/text.json / site.json siteFields`);
      else if (Array.isArray(entries[m.key]) !== !!m.multi) problems.push(`${path}: "${m.key}" – a list of paragraphs needs tBlock()/tList(), one line needs t()`);
    }
  }
  assert.deepEqual(problems, [], '\n' + problems.join('\n'));
  assert.ok(used.size > 50, 'pages use t() for their words');
});

test('the real website and the testing link carry no edit marks, in both designs', () => {
  for (const theme of ['classic', 'luxury']) for (const preview of [false, true]) {
    for (const { path, html } of pages({ editMode: false, preview, theme })) assert.doesNotMatch(html, /data-edit|data-text-/, `${theme} ${path}`);
  }
});

test('every word in content/text.json passes the editor\'s own checks (so Dan can save it unchanged)', () => {
  for (const [k, v] of Object.entries(textEntries(content.text, content.site))) {
    const meta = { multi: Array.isArray(v) ? 'p' : false, ...textMeta(content.text, k) };
    const r = cleanText(v, meta);
    assert.ok(!r.error, `${k}: ${r.error}`);
    assert.deepEqual(r.value, v, `${k}: the stored words are already tidy (no double spaces, no HTML)`);
  }
});

test('the coverage check itself: hard-coded words are caught; marked, owned, hidden and non-word text is fine', () => {
  const html = `<html><head><title>T</title><style>p{}</style></head><body><h1>Hard coded</h1><p data-edit="text" data-edit-key="a.b">ok</p>
<div data-edit-owned="reviews"><p>Review words</p></div><div aria-hidden="true">spam trap</div><p>© 2026 · 704-555-0100</p><script>var x = "words";</script>
<a href="/">Link <span data-edit="text">ok</span></a></body></html>`;
  assert.deepEqual(uncoveredText(html).map((u) => u.text), ['Hard coded', 'Link']);
});
