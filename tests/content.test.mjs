import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../scripts/build.mjs';
import { normaliseFields, parseOptionalNumber, factsList, escapeHtml, listingSlug, validatePublicListing } from '../src/lib/listing.mjs';

test('repo content is valid and loads', async () => {
  const c = await loadContent();
  assert.equal(c.site.phone, '704-441-4556');
  assert.equal(c.site.email, 'danmckenna@kw.com');
  assert.ok(c.testimonials.length >= 13);
  for (const t of c.testimonials) assert.ok(t.text.join('').length > 10, t.slug);
  assert.ok(c.site.heroSlides.length >= 1);
});

test('blank numbers are unknown (null), never zero', () => {
  assert.deepEqual(parseOptionalNumber('', { label: 'Price', max: 10 }), { value: null });
  assert.deepEqual(parseOptionalNumber('  ', { label: 'Price', max: 10 }), { value: null });
  assert.ok(parseOptionalNumber('0', { label: 'Beds', max: 10 }).error);
  assert.equal(parseOptionalNumber('$525,000', { label: 'Price', max: 1e8, integer: true }).value, 525000);
  assert.ok(parseOptionalNumber('2.3', { label: 'Baths', max: 50, allowHalf: true }).error);
  assert.equal(parseOptionalNumber('2.5', { label: 'Baths', max: 50, allowHalf: true }).value, 2.5);
  assert.ok(parseOptionalNumber('three', { label: 'Beds', max: 50 }).error);
});

test('facts line leaves out unknown values', () => {
  assert.deepEqual(factsList({ beds: 3, baths: null, sqft: 2400 }), ['3 beds', '2,400 sq ft']);
  assert.deepEqual(factsList({ beds: null, baths: null, sqft: null }), []);
});

test('required fields give plain-English errors', () => {
  const { errors } = normaliseFields({ address: { street: '', city: '', state: 'XX' }, status: 'nope', price: 'abc' });
  assert.match(errors.street, /required/);
  assert.match(errors.state, /NC or SC/);
  assert.match(errors.status, /For Sale/);
  assert.match(errors.price, /number/);
});

test('escaping and slugs', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  assert.equal(listingSlug({ street: '2515 Forest Lawn Drive', city: 'Weddington', state: 'NC' }), '2515-forest-lawn-drive-weddington-nc');
});

test('public listing validation rejects bad paths and zero values', () => {
  const bad = { id: 'lst-abc123', slug: 'x', revision: 1, status: 'active', address: { street: '1 A St', city: 'B', state: 'NC', zip: '' }, price: 0, beds: null, baths: null, sqft: null, photos: [{ id: 'p-abcdef', large: '../../etc/passwd', small: '/x.jpg', width: 1, height: 1 }], updatedAt: '2026-01-01T00:00:00Z' };
  const p = validatePublicListing(bad);
  assert.ok(p.some((m) => m.startsWith('price')));
  assert.ok(p.some((m) => m.includes('path')));
});

test('favicon set is present and linked', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  for (const f of ['public/favicon.ico', 'public/assets/img/favicon-32.png', 'public/assets/img/apple-touch-icon.png', 'public/assets/img/icon-192.png', 'public/assets/img/icon-512.png', 'public/site.webmanifest', 'owner/ui/favicon.ico', 'owner/ui/apple-touch-icon.png']) assert.ok(existsSync(f), f);
  for (const t of ['src/templates/layout.mjs', 'src/templates/luxury.mjs']) {
    const s = readFileSync(t, 'utf8');
    assert.match(s, /favicon\.ico/); assert.match(s, /apple-touch-icon/); assert.match(s, /site\.webmanifest/);
  }
});

test('website photos: a replaced photo shows on its pages; the house caption only stays with the original photo', async () => {
  const { sitePhoto, validatePhotos } = await import('../src/lib/photos.mjs');
  const P = await import('../src/templates/pages.mjs');
  const site = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../content/site.json', import.meta.url), 'utf8'));
  const ctx = (s) => ({ site: s, url: (p) => p, listings: [], removed: [], testimonials: [] });
  assert.match(P.luxuryPage(ctx(site)), /Tiara Homes/);
  const changed = { ...site, photos: { luxury: { id: 's-abc123', small: '/assets/img/hero/s-abc123-800.jpg', large: '/assets/img/hero/s-abc123-1400.jpg', alt: 'Luxury home in the Charlotte area' }, headshot: { id: 's-def456', small: '/assets/img/hero/s-def456-800.jpg', large: '/assets/img/hero/s-def456-1400.jpg', alt: 'Dan McKenna' } } };
  assert.deepEqual(validatePhotos(changed), []);
  const lux = P.luxuryPage(ctx(changed));
  assert.match(lux, /s-abc123-1400\.jpg/); assert.doesNotMatch(lux, /Tiara Homes/);
  assert.match(P.aboutPage(ctx(changed)), /s-def456-800\.jpg/);
  assert.match(P.contactPage(ctx(changed)), /s-def456-800\.jpg/);
  assert.equal(sitePhoto(site, 'construction').small, '/assets/img/construction.jpg');
  assert.ok(validatePhotos({ photos: { luxury: { small: 'https://evil.example/x.jpg', large: '/assets/img/a.jpg' } } }).length);
  assert.ok(validatePhotos({ photos: { banner: {} } }).length);
});

test('reviews show in the order of content/testimonials.json (Dan arranges it) on the homepage (both designs) and the Testimonials page', async () => {
  const P = await import('../src/templates/pages.mjs');
  const { luxHome } = await import('../src/templates/luxury.mjs');
  const site = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../content/site.json', import.meta.url), 'utf8'));
  // Deliberately not sorted by date: the file order must win. Long text so the luxury quotes link to the full review.
  const long = 'x '.repeat(200).trim();
  const testimonials = [['b-old', '2019-05-05'], ['a-new', '2025-01-01'], ['c-mid', '2022-03-03']].map(([slug, date]) => ({ slug, title: `Title ${slug}`, date, text: [`${slug} ${long}`] }));
  const ctx = { site, url: (p) => p, listings: [], removed: [], testimonials };
  const order = (html) => [...new Set([...html.matchAll(/href="\/testimonial\/([a-z-]+)\/"/g)].map((m) => m[1]))];
  for (const [name, html] of [['classic homepage', P.homePage(ctx)], ['Testimonials page', P.testimonialsPage(ctx)], ['design 2 homepage', luxHome(ctx)]]) {
    assert.deepEqual(order(html), ['b-old', 'a-new', 'c-mid'], name);
  }
});
