#!/usr/bin/env node
// Builds the public website into dist/.
//   BASE_PATH  – path prefix, e.g. "/dan-mckenna-homes" on GitHub Pages ("" for a real domain)
//   PREVIEW    – "1" adds the testing banner and asks search engines not to index
//   SITE_URL   – full public URL (used for canonical links / sitemap in production)
//   BUILD_ID   – usually the git commit SHA; written to /version.json so the editor can
//                confirm a change is live.
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { validatePublicListing, validateHomepage, HERO_SIZES } from '../src/lib/listing.mjs';
import { PHOTO_SPOTS, sitePhoto, validatePhotos } from '../src/lib/photos.mjs';
import { layout } from '../src/templates/layout.mjs';
import { listingDetail } from '../src/templates/listing.mjs';
import * as P from '../src/templates/pages.mjs';
import { luxLayout, luxHome } from '../src/templates/luxury.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.env.OUT_DIR || 'dist');

const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PREVIEW = process.env.PREVIEW === '1';
const SITE_URL = process.env.SITE_URL || '';
const THEME = process.env.THEME === 'luxury' ? 'luxury' : 'classic';
const ALT_URL = process.env.ALT_URL || '';
let BUILD_ID = process.env.BUILD_ID || '';
if (!BUILD_ID) { try { BUILD_ID = execSync('git rev-parse HEAD', { cwd: root }).toString().trim(); } catch { BUILD_ID = 'dev'; } }

const readJson = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));

export async function loadContent() {
  const site = await readJson('content/site.json');
  const tFile = await readJson('content/testimonials.json');
  const testimonials = tFile.items;
  const removedReviewSlugs = (tFile.removedSlugs || []).filter((s) => /^[a-z0-9-]+$/.test(s) && !testimonials.some((t) => t.slug === s));
  const removed = (await readJson('content/removed.json')).items;
  const dir = join(root, 'content/listings');
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')) : [];
  const listings = [];
  const problems = [];
  const heroProblems = validateHomepage(site);
  for (const sl of site.heroSlides || []) for (const w of HERO_SIZES) {
    if (sl.src && !existsSync(join(root, 'public', `${sl.src}-${w}.jpg`))) heroProblems.push(`missing image file public${sl.src}-${w}.jpg`);
  }
  for (const pr of validatePhotos(site)) heroProblems.push(pr);
  for (const k of Object.keys(PHOTO_SPOTS)) for (const f of ['small', 'large']) {
    const src = sitePhoto(site, k)[f];
    if (!existsSync(join(root, 'public', src))) heroProblems.push(`missing image file public${src} (photos.${k})`);
  }
  if (heroProblems.length) problems.push(`content/site.json (homepage slideshow):\n  - ${heroProblems.join('\n  - ')}`);
  for (const f of files) {
    const l = JSON.parse(await readFile(join(dir, f), 'utf8'));
    const errs = validatePublicListing(l);
    if (f !== `${l.id}.json`) errs.push(`file name must be ${l.id}.json`);
    for (const ph of l.photos || []) for (const k of ['large', 'small']) {
      if (ph[k] && !existsSync(join(root, 'public', ph[k]))) errs.push(`missing image file public${ph[k]}`);
    }
    if (errs.length) problems.push(`${f}:\n  - ${errs.join('\n  - ')}`);
    listings.push(l);
  }
  const slugs = new Set();
  for (const l of listings) { if (slugs.has(l.slug)) problems.push(`duplicate slug ${l.slug}`); slugs.add(l.slug); }
  for (const r of removed) if (slugs.has(r.slug)) problems.push(`removed.json still lists ${r.slug}, which is published`);
  if (problems.length) throw new Error('Listing content has problems:\n' + problems.join('\n'));
  const order = { active: 0, pending: 1, sold: 2 };
  listings.sort((a, b) => order[a.status] - order[b.status] || b.updatedAt.localeCompare(a.updatedAt));
  return { site, testimonials, removed, listings, removedReviewSlugs };
}

async function writePage(path, html) {
  const file = path.endsWith('.html') ? join(out, path) : join(out, path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

async function main() {
  const content = await loadContent();
  const ctx = {
    ...content,
    preview: PREVIEW,
    siteUrl: SITE_URL,
    buildId: BUILD_ID.slice(0, 12),
    theme: THEME,
    altUrl: ALT_URL,
    url: (p) => (/^(https?:|mailto:|tel:|sms:)/.test(p) ? p : BASE + p),
  };
  if (existsSync(out)) await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(root, 'public'), out, { recursive: true });
  const page = THEME === 'luxury' ? luxLayout : layout;
  if (THEME === 'luxury') {
    const base = await readFile(join(root, 'public/assets/css/site.css'), 'utf8');
    const lux = await readFile(join(root, 'src/styles/luxury.css'), 'utf8');
    await writeFile(join(out, 'assets/css/luxury.css'), base + '\n' + lux);
  }

  const pages = [
    ['/', 'Home', THEME === 'luxury' ? luxHome : P.homePage, { bodyClass: 'home' }],
    ['/about-us/', 'About us', P.aboutPage, { description: 'Meet Dan McKenna, full-time NC/SC Broker/REALTOR® with Keller Williams Ballantyne Area in Charlotte, NC, a CLHMS and GUILD member, serving the Charlotte area.' }],
    ['/new-construction/', 'New Construction Buyer Agent', P.newConstructionPage, { description: 'Why work with an experienced buyer\'s agent when purchasing new construction in the Charlotte area.' }],
    ['/luxury-home-marketing/', 'Luxury Home Marketing', P.luxuryPage, { description: 'Luxury home marketing in the Charlotte area by Dan McKenna, Certified Luxury Home Marketing Specialist and GUILD member.' }],
    ['/testimonials/', 'Testimonials', P.testimonialsPage, { description: 'What clients say about working with Dan McKenna.' }],
    ['/contact/', 'Contact', P.contactPage, { description: 'Call, text, or email Dan McKenna: 704-441-4556, danmckenna@kw.com.' }],
    ['/accessibility-2/', 'Accessibility', P.accessibilityPage, {}],
    ['/dmca-compliance-2/', 'Copyright', P.dmcaPage, {}],
  ];
  for (const [path, title, fn, opts] of pages) {
    await writePage(path, page(ctx, { path, title, body: fn(ctx), ...opts }));
  }
  for (const t of content.testimonials) {
    const path = `/testimonial/${t.slug}/`;
    await writePage(path, page(ctx, { path, title: t.title, description: t.text[0].slice(0, 150), body: P.testimonialPage(ctx, t) }));
  }
  for (const l of content.listings) {
    const path = `/listings/${l.slug}/`;
    const desc = `${l.address.street}, ${l.address.city}, ${l.address.state}. ${(l.description || '').slice(0, 120)}`;
    await writePage(path, page(ctx, { path, title: `${l.address.street}, ${l.address.city}`, description: desc, body: listingDetail(ctx, l), ogImage: SITE_URL ? SITE_URL.replace(/\/$/, '') + l.photos[0].large : '' }));
  }
  for (const r of content.removed) {
    const path = `/listings/${r.slug}/`;
    await writePage(path, page(ctx, { path, title: 'Home no longer available', body: P.removedListingPage(ctx, r) }));
  }
  // Reviews Dan removed: their old address forwards to the reviews page.
  for (const s of content.removedReviewSlugs || []) {
    const to = ctx.url('/testimonials/');
    await writePage(`/testimonial/${s}/`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Client reviews</title><meta name="robots" content="noindex"><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"></head><body><p><a href="${to}">See Dan's client reviews</a></p></body></html>`);
  }
  // Listings were removed from the website: the old address sends visitors to the homepage.
  { const home = ctx.url('/'); await writePage('/listings/', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dan McKenna Homes</title><meta name="robots" content="noindex"><link rel="canonical" href="${home}"><meta http-equiv="refresh" content="0; url=${home}"></head><body><p><a href="${home}">Continue to Dan McKenna Homes</a></p></body></html>`); }
  await writePage('404.html', page(ctx, { path: '/404', title: 'Page not found', body: P.notFoundPage(ctx) }));

  // Machine-readable files used by the owner editor to confirm a change is live.
  await writeFile(join(out, 'version.json'), JSON.stringify({ build: BUILD_ID, builtAt: new Date().toISOString() }));
  await writeFile(join(out, 'listings.json'), JSON.stringify({
    build: BUILD_ID,
    listings: content.listings.map((l) => ({ id: l.id, slug: l.slug, revision: l.revision, status: l.status, price: l.price, cover: l.photos[0].id, photos: l.photos.map((p) => p.id) })),
    removed: content.removed.map((r) => r.slug),
  }));
  await writeFile(join(out, '.nojekyll'), '');
  if (PREVIEW || !SITE_URL) {
    await writeFile(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  } else {
    const urls = [...pages.map((p) => p[0]), ...content.testimonials.map((t) => `/testimonial/${t.slug}/`), ...content.listings.map((l) => `/listings/${l.slug}/`)];
    const base = SITE_URL.replace(/\/$/, '');
    await writeFile(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
    await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
  }
  console.log(`Built ${pages.length} pages, ${content.testimonials.length} testimonials, ${content.listings.length} listings, ${content.removed.length} removed → ${out} (base "${BASE}", preview ${PREVIEW})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}
