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
