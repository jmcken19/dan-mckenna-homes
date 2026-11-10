// WORDING – every piece of visible text on the website goes through t() / tBlock() / tList() below.
//
// The words live in content/text.json → "text" (headings, buttons, menu labels, footer lines…), or – for business
// facts that already have a field – in content/site.json (name, phone, email, about…; listed in text.json →
// "siteFields" and used as key "site.<field>"). On the real website these helpers only print the escaped words.
// In the editor's preview they also mark them with data-edit="text", so the owner can click any words and change
// them in place. A test (tests/text-coverage.test.mjs) renders every page in edit mode and FAILS if any visible
// words are not marked – so every page, part and layout must use these helpers. Never hard-code visible words.
//
//   t(ctx, 'home.title')            one line (heading, button label, menu item, footer line…)
//   tBlock(ctx, 'site.about')       several paragraphs (<p> each); the value is a list in the file
//   tList(ctx, 'about.awards')      a <ul>/<ol> whose items are a list in the file
//   tText(ctx, 'site.name')         the plain words (for attributes like alt/aria-label; you escape them)
//
// Runs in Node (build, tests) and in the editor Worker (preview, saving).
import { escapeHtml as e } from './listing.mjs';
import { editMark } from './editables.mjs';

export const TEXT_FILE = 'content/text.json';
export const TEXT_LIMITS = { line: 300, para: 3000, paras: 60, total: 20000 };
const KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/;
const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The rules part of content/text.json (which site.json fields are wording, phone/email fields, lines that must stay). */
export function textRules(file) {
  return { siteFields: file?.siteFields || [], kinds: file?.kinds || {}, mustStay: file?.mustStay || [] };
}

/** Extra facts about a key: { kind: 'phone'|'email'|'', must: true when it is a legal/compliance line }. */
export function textMeta(file, key) {
  const r = textRules(file);
  return { kind: r.kinds[key] || '', must: r.mustStay.includes(key) };
}

function lookup(ctx, key) {
  const file = ctx.text;
  if (!file || typeof file !== 'object') throw new Error(`No wording loaded for "${key}": pass content/text.json to the page as ctx.text`);
  if (key.startsWith('site.')) {
    const f = key.slice(5);
    if (!textRules(file).siteFields.includes(f)) throw new Error(`"${key}": add "${f}" to content/text.json → siteFields (so the owner can change it)`);
    const v = ctx.site?.[f];
    if (typeof v !== 'string' && !isList(v)) throw new Error(`"${key}": content/site.json has no text in "${f}"`);
    return v;
  }
  const v = file.text?.[key];
  if (typeof v !== 'string' && !isList(v)) throw new Error(`content/text.json has no wording for "${key}" – add "${key}": "<the client's own words>" to its "text"`);
  return v;
}

function marks(ctx, key, label, multi = '') {
  if (!ctx.editMode) return '';
  const m = textMeta(ctx.text, key);
  return `${editMark(ctx, 'text', key, label)}${multi ? ` data-text-multi="${multi}"` : ''}${m.kind ? ` data-text-kind="${e(m.kind)}"` : ''}${m.must ? ' data-text-must="1"' : ''}`;
}

/** One line of words. In the editor: <span data-edit="text" …>words</span>; on the website: just the words. */
export function t(ctx, key, { label = '' } = {}) {
  const v = lookup(ctx, key);
  if (typeof v !== 'string') throw new Error(`"${key}" has several paragraphs – use tBlock() or tList()`);
  return ctx.editMode ? `<span${marks(ctx, key, label)}>${e(v)}</span>` : e(v);
}

/** Several paragraphs, each a <p>. In the editor they sit in one <div data-edit="text"> (the website has no wrapper). */
export function tBlock(ctx, key, { label = '', className = '' } = {}) {
  const v = lookup(ctx, key);
  if (!Array.isArray(v)) throw new Error(`"${key}" is one line – make it a list of paragraphs in the file, or use t()`);
  const cls = className ? ` class="${e(className)}"` : '';
  const html = v.map((p) => `<p${cls}>${e(p)}</p>`).join('\n');
  return ctx.editMode ? `<div class="jt-block"${marks(ctx, key, label, 'p')}>${html}</div>` : html;
}

/** A list (<ul> by default) with one item per entry. */
export function tList(ctx, key, { label = '', className = '', tag = 'ul' } = {}) {
  const v = lookup(ctx, key);
  if (!Array.isArray(v)) throw new Error(`"${key}" is one line – make it a list in the file, or use t()`);
  return `<${tag}${className ? ` class="${e(className)}"` : ''}${marks(ctx, key, label, 'li')}>${v.map((x) => `<li>${e(x)}</li>`).join('')}</${tag}>`;
}

/** The plain words (not escaped, not marked) – for attributes (alt, aria-label…) and logic. */
export function tText(ctx, key) {
  const v = lookup(ctx, key);
  return Array.isArray(v) ? v.join('\n\n') : v;
}

/** tel:/sms: addresses for a phone number as typed ("704-441-4556" → "tel:+17044414556" when the site uses +1 links). */
export function phoneHref(phone, scheme = 'tel', international = false) {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (international && !d.startsWith('+')) d = d.length === 10 ? '+1' + d : d.length === 11 && d.startsWith('1') ? '+' + d : d;
  return `${scheme}:${d}`;
}

/** Keep a site's phone links (site.json → phoneHref / smsHref, when it has them) matching a changed phone number. */
export function withPhoneLinks(site, oldSite = site) {
  if (!site || site.phone === oldSite?.phone) return site;
  const out = { ...site };
  const intl = (h) => /^(tel|sms):\+/.test(h || '');
  if (typeof site.phoneHref === 'string') out.phoneHref = phoneHref(site.phone, 'tel', intl(site.phoneHref));
  if (typeof site.smsHref === 'string') out.smsHref = phoneHref(site.phone, 'sms', intl(site.smsHref));
  return out;
}

const tagRe = /<\/?[a-z!?][^<>]*>/gi;
const ctrlRe = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200d\u2028\u2029\ufeff]/g;
const oneLine = (s) => String(s).replace(tagRe, '').replace(ctrlRe, '').replace(/\s+/g, ' ').trim();

/**
 * Check and tidy the words the owner typed. meta: { multi: false | 'p' | 'li', kind, must }.
 * Returns { value } (a string, or a list for multi) or { error } (a plain-English message).
 * Plain text only: HTML tags are removed (the website escapes everything anyway); spaces are tidied;
 * for paragraphs a blank line starts a new paragraph (for lists every line is an item).
 */
export function cleanText(input, meta = {}) {
  let value;
  if (meta.multi) {
    const parts = Array.isArray(input) ? input.map((x) => String(x ?? '')) : [String(input ?? '')];
    const split = meta.multi === 'li' ? /\r?\n+/ : /\r?\n[ \t]*\r?\n/;
    value = parts.flatMap((p) => p.replace(/\r\n?/g, '\n').split(split)).map(oneLine).filter(Boolean);
    if (!value.length) return { error: emptyMessage(meta) };
    if (value.length > TEXT_LIMITS.paras) return { error: `That is a lot of ${meta.multi === 'li' ? 'lines' : 'paragraphs'} – please keep it to ${TEXT_LIMITS.paras} or fewer.` };
    if (value.some((p) => p.length > TEXT_LIMITS.para)) return { error: `One ${meta.multi === 'li' ? 'line' : 'paragraph'} is very long – please split it with a blank line (at most ${TEXT_LIMITS.para} letters each).` };
    if (value.join('').length > TEXT_LIMITS.total) return { error: 'That is too much text for one place on the page – please shorten it.' };
  } else {
    if (Array.isArray(input)) input = input.join(' ');
    value = oneLine(input ?? '');
    if (!value) return { error: emptyMessage(meta) };
    if (value.length > TEXT_LIMITS.line) return { error: `Please keep this short – at most ${TEXT_LIMITS.line} letters (it has ${value.length}).` };
    if (meta.kind === 'phone') {
      const digits = value.replace(/\D/g, '');
      if (!/^[+()\d\s.\-]+$/.test(value) || digits.length < 7 || digits.length > 15) return { error: 'Please type a phone number using numbers only, for example 704-555-0100. The Call and Text buttons use it.' };
    }
    if (meta.kind === 'email' && !/^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}$/i.test(value)) return { error: 'Please type an email address, for example name@example.com. The Email buttons use it.' };
  }
  return { value };
}

function emptyMessage(meta) {
  return meta.must
    ? 'This must stay on your website. You can change the words, but not remove them.'
    : 'This can\'t be empty. Type the words you want here (or click Cancel).';
}

/** Check content/text.json (the build stops on a problem). */
export function validateText(file, site) {
  const p = [];
  if (!file || typeof file !== 'object' || typeof file.text !== 'object' || Array.isArray(file.text)) return ['content/text.json needs a "text" object'];
  const r = textRules(file);
  for (const [k, v] of Object.entries(file.text)) {
    if (!KEY_RE.test(k) || k.startsWith('site.')) p.push(`text.json: key "${k}" must look like "page.thing" (letters, numbers, dots; not "site.")`);
    if (typeof v !== 'string' && !isList(v)) p.push(`text.json: "${k}" must be words or a list of paragraphs`);
    else if (!(Array.isArray(v) ? v.length && v.every((x) => x.trim()) : v.trim())) p.push(`text.json: "${k}" is empty`);
  }
  for (const f of r.siteFields) if (site?.[f] != null && typeof site[f] !== 'string' && !isList(site[f])) p.push(`text.json → siteFields: site.json "${f}" is not text`);
  for (const [k, kind] of Object.entries(r.kinds)) if (!['phone', 'email'].includes(kind)) p.push(`text.json → kinds: "${k}" must be "phone" or "email"`);
  return p;
}

/** Every key the owner can change, with its value and meta (used by the editor server and tests). */
export function textEntries(file, site) {
  const r = textRules(file);
  const out = {};
  for (const [k, v] of Object.entries(file?.text || {})) out[k] = v;
  // Empty site fields (no address yet…) are not on the page, so there is nothing to change.
  for (const f of r.siteFields) if ((typeof site?.[f] === 'string' && site[f].trim()) || (isList(site?.[f]) && site[f].length)) out[`site.${f}`] = site[f];
  return out;
}
