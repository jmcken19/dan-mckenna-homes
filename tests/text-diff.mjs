#!/usr/bin/env node
// Compare the words of two builds, page by page:  node tests/text-diff.mjs <before-dir> <after-dir>
// (visible text in order, plus title / alt / aria-label / meta description). Build ids are ignored.
// Use it when moving wording into content/text.json: the website must read exactly the same afterwards.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pageText } from './html-text.mjs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: node tests/text-diff.mjs <before-dir> <after-dir>'); process.exit(2); }
const pages = (dir) => { const out = []; const go = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) go(p); else if (f.endsWith('.html')) out.push(relative(dir, p)); } }; go(dir); return out.sort(); };
const pa = pages(a), pb = pages(b);
let diffs = 0;
for (const p of new Set([...pa, ...pb])) {
  if (!existsSync(join(a, p)) || !existsSync(join(b, p))) { console.log(`✗ ${p}: only in ${existsSync(join(a, p)) ? 'before' : 'after'}`); diffs++; continue; }
  const strip = (h) => h.replace(/\?v=[\w-]+/g, '?v=X');
  const x = pageText(strip(readFileSync(join(a, p), 'utf8'))), y = pageText(strip(readFileSync(join(b, p), 'utf8')));
  if (x.text !== y.text) {
    diffs++;
    let i = 0; while (x.text[i] === y.text[i]) i++;
    console.log(`✗ ${p}: words differ at character ${i}\n   before: …${x.text.slice(Math.max(0, i - 60), i + 80)}…\n   after:  …${y.text.slice(Math.max(0, i - 60), i + 80)}…`);
  }
  const ex = x.extra.join('\n'), ey = y.extra.join('\n');
  if (ex !== ey) { diffs++; const ax = new Set(x.extra), ay = new Set(y.extra); console.log(`✗ ${p}: attributes differ\n   only before: ${x.extra.filter((v) => !ay.has(v)).join(' | ')}\n   only after: ${y.extra.filter((v) => !ax.has(v)).join(' | ')}`); }
}
console.log(diffs ? `${diffs} difference(s) in ${pa.length} pages` : `✓ identical words on all ${pa.length} pages (${a} → ${b})`);
process.exit(diffs ? 1 : 0);
