// Tiny HTML reader for tests (no dependencies): walks the text of a page with its open elements.
// Used by tests/text-coverage.test.mjs ("every visible word is editable") and tests/text-diff.mjs (before/after).
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'noscript']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figure', 'figcaption', 'form', 'label', 'br', 'table', 'tr', 'td', 'th', 'button', 'a']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', rarr: '→', larr: '←' };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => (c[0] === '#' ? String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ENT[c.toLowerCase()] ?? m));

function attrs(src) {
  const a = {};
  for (const m of src.matchAll(/([^\s=/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) a[m[1].toLowerCase()] = m[2] ? decode(m[2].replace(/^["']|["']$/g, '')) : '';
  return a;
}

/**
 * Calls onText(text, stack) for every text node, and onTag(name, attrs, stack, closing) for every tag.
 * stack = the open elements [{ tag, a }] from <html> down. Text inside script/style/textarea/title is skipped.
 */
export function walk(html, { onText = () => {}, onTag = () => {} } = {}) {
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</gi;
  let m;
  while ((m = re.exec(html))) {
    const s = m[0];
    if (s.startsWith('<!')) continue;
    if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) { // closing tag: pop to the matching element
        const i = stack.map((x) => x.tag).lastIndexOf(tag);
        onTag(tag, {}, stack, true);
        if (i >= 0) stack.length = i;
        continue;
      }
      const a = attrs(m[3] || '');
      onTag(tag, a, stack, false);
      if (VOID.has(tag) || /\/\s*$/.test(m[3] || '')) continue;
      stack.push({ tag, a });
      if (RAW.has(tag)) { // skip to its end
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        re.lastIndex = end < 0 ? html.length : end;
      }
      continue;
    }
    if (stack.some((x) => x.tag === 'head' || RAW.has(x.tag))) continue;
    onText(decode(s), stack);
  }
}

/** The words a visitor sees, in order (block elements separated), plus the text of title/alt/aria-label/description. */
export function pageText(html) {
  let out = '';
  const extra = [];
  walk(html, {
    onText: (t) => { out += t; },
    onTag: (tag, a, stack, closing) => {
      if (BLOCK.has(tag)) out += ' ';
      if (closing) return;
      if (tag === 'img' && 'alt' in a) extra.push(`alt: ${a.alt}`);
      if (a['aria-label']) extra.push(`aria-label: ${a['aria-label']}`);
      if (tag === 'meta' && a.name === 'description') extra.push(`description: ${a.content}`);
    },
  });
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return { text: out.replace(/\s+/g, ' ').trim(), extra: [`title: ${decode(title || '')}`, ...extra] };
}

/**
 * Visible words that the owner could NOT change in the editor (page rendered in edit mode).
 * Words count when they contain a letter. They are fine when an element around them is
 *   data-edit="text" (drawn by t()/tBlock()/tList()) or data-edit-owned="…" (another editor owns them, e.g. reviews,
 *   or they only exist on previews, like the testing banner) – and skipped inside aria-hidden="true" (spam traps…).
 */
export function uncoveredText(html) {
  const bad = [];
  walk(html, {
    onText: (t, stack) => {
      if (!/\p{L}/u.test(t)) return;
      if (stack.some((x) => x.a['aria-hidden'] === 'true')) return;
      if (stack.some((x) => x.a['data-edit'] === 'text' || 'data-edit-owned' in x.a)) return;
      bad.push({ text: t.replace(/\s+/g, ' ').trim(), where: stack.slice(-3).map((x) => x.tag + (x.a.class ? '.' + x.a.class.split(' ')[0] : '')).join(' > ') });
    },
  });
  return bad;
}

/** The text keys marked in an edit-mode page: [{ key, multi, kind, must }]. */
export function textMarks(html) {
  const out = [];
  walk(html, { onTag: (tag, a, s, closing) => { if (!closing && a['data-edit'] === 'text') out.push({ key: a['data-edit-key'], multi: a['data-text-multi'] || '', kind: a['data-text-kind'] || '', must: 'data-text-must' in a }); } });
  return out;
}
