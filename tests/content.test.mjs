import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../scripts/build.mjs';
import { readFileSync as readTextFile } from 'node:fs';
const TEXT = JSON.parse(readTextFile(new URL('../content/text.json', import.meta.url), 'utf8'));
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
  const ctx = (s) => ({ site: s, text: TEXT, url: (p) => p, listings: [], removed: [], testimonials: [] });
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
  const ctx = { site, text: TEXT, url: (p) => p, listings: [], removed: [], testimonials };
  const order = (html) => [...new Set([...html.matchAll(/href="\/testimonial\/([a-z-]+)\/"/g)].map((m) => m[1]))];
  for (const [name, html] of [['classic homepage', P.homePage(ctx)], ['Testimonials page', P.testimonialsPage(ctx)], ['design 2 homepage', luxHome(ctx)]]) {
    assert.deepEqual(order(html), ['b-old', 'a-new', 'c-mid'], name);
  }
});

/* ---------- contact form + email links (spam protection) ---------- */
const formCtx = (site, extra = {}) => ({ site: { email: 'owner@example.org', ...site }, text: TEXT, url: (p) => p, siteUrl: 'https://www.danmckennahomes.com', ...extra });

test('contact form, old way (no turnstileSiteKey yet): unchanged FormSubmit form, same words', async () => {
  const { contactForm } = await import('../src/templates/layout.mjs');
  assert.equal(contactForm(formCtx({})), '', 'no form without an address or a key');
  const old = contactForm(formCtx({ contactFormTo: 'a@b.com', turnstileSiteKey: '' }));
  assert.match(old, /action="https:\/\/formsubmit\.co\/a%40b\.com" method="post" data-ajax="https:\/\/formsubmit\.co\/ajax\/a%40b\.com"/);
  assert.match(old, /name="_subject" value="New message from danmckennahomes\.com"/);
  assert.match(old, /name="_honey"/);
  assert.doesNotMatch(old, /data-api|data-sitekey|cform__nojs|name="_t"/);
  assert.match(old, /data-msg-ok="Thank you! Your message was sent\. Dan will get back to you soon\." data-msg-bad="Sorry, your message could not be sent right now\. Please call or text Dan instead\."/);
});

test('contact form, new way (turnstileSiteKey set): posts to /api/contact, no address in the page, call-or-text line without JavaScript, off on previews', async () => {
  const { contactForm } = await import('../src/templates/layout.mjs');
  const site = { contactFormTo: 'a@b.com', turnstileSiteKey: '0x4AAAAAAAtestkey' };
  const live = contactForm(formCtx(site), { id: 'contact' });
  assert.match(live, /<form class="cform cform--api" data-cform method="post" data-api="\/api\/contact" data-sitekey="0x4AAAAAAAtestkey"/);
  assert.doesNotMatch(live, /formsubmit|a@b\.com|a%40b\.com|_captcha|_subject/, 'FormSubmit and the address are gone from the page code');
  assert.match(live, /<input type="hidden" name="_t" value="">/); assert.match(live, /name="_honey"/); assert.match(live, /data-turnstile/);
  assert.match(live, /<p class="cform__nojs">Sorry, your message could not be sent right now\. Please call or text Dan instead\.<\/p>\s*<div class="cform__js">/);
  for (const [k, n] of [['name', 100], ['email', 200], ['phone', 40], ['message', 3000]]) assert.match(live, new RegExp(`name="${k}"[^>]*maxlength="${n}"`));
  for (const words of ['Or send Dan a message', '>Name<', '>Email<', 'Phone <span class="cform__opt">(optional)</span>', '>Message<', '>Send message</button>']) assert.ok(live.includes(words), words);
  assert.equal(contactForm(formCtx({ turnstileSiteKey: 'k' })).includes('data-api'), true, 'works without contactFormTo');
  const preview = contactForm(formCtx(site, { preview: true }));
  assert.match(preview, /switched off here/); assert.match(preview, / disabled>Send message/);
  assert.doesNotMatch(preview, /data-api|data-sitekey/, 'nothing can be sent from a testing preview');
  const edit = contactForm(formCtx(site, { preview: true, editMode: true }));
  assert.doesNotMatch(edit, / disabled>|data-api|cform__nojs/);
});

test('email links: no address or mailto: in the page code; the Contact page is the no-JavaScript fallback; the editor keeps the plain address', async () => {
  const { mailAttrs, mailText, scrambleMail } = await import('../src/lib/mail.mjs');
  const c = formCtx({ email: 'dan.o\'neil+web@kw.com' });
  const unscramble = (v) => decodeURIComponent(atob(v.split('').reverse().join(''))); // same as public/assets/js/site.js
  assert.equal(unscramble(scrambleMail(c.site.email)), c.site.email);
  assert.match(readTextFile(new URL('../public/assets/js/site.js', import.meta.url), 'utf8'), /decodeURIComponent\(atob\(v\.split\(''\)\.reverse\(\)\.join\(''\)\)\)/);
  const a = mailAttrs(c, { subject: 'Question about 1 Main St' }), words = mailText(c);
  assert.match(a, /^href="\/contact\/" data-mail="[A-Za-z0-9+/=]+" data-mail-subject="Question about 1 Main St"$/);
  assert.match(words, /^<span class="eml" data-mail-text="[A-Za-z0-9+/=]+">dan\.o&#39;neil\+web<span class="eml-at"><\/span>kw\.com<\/span>$/);
  assert.doesNotMatch(a + words, /mailto:|@/);
  assert.match(readTextFile(new URL('../public/assets/css/site.css', import.meta.url), 'utf8'), /\.eml-at::before \{ content: "@"; \}/);
  const ed = { ...c, editMode: true };
  assert.equal(mailAttrs(ed, { subject: 'Hi there' }), 'href="mailto:dan.o&#39;neil+web@kw.com?subject=Hi%20there"');
  assert.match(mailText(ed), /data-edit="text" data-edit-key="site\.email"/);
});

test('whole website: Dan\'s address is never written in a mailto: link; with the new form on it is nowhere in the page code', async () => {
  const { mainPages, extraPages } = await import('../scripts/build.mjs');
  const { layout } = await import('../src/templates/layout.mjs');
  const { luxLayout } = await import('../src/templates/luxury.mjs');
  const P = await import('../src/templates/pages.mjs');
  const content = await loadContent();
  const addr = /danmckenna(@|%40|&#64;|&commat;)kw\.com/i;
  const render = (site, theme, preview) => {
    const ctx = { ...content, site, preview, siteUrl: preview ? '' : 'https://www.danmckennahomes.com', buildId: 't', url: (p) => p };
    const page = theme === 'luxury' ? luxLayout : layout;
    return [...mainPages(theme).map(([path, title, fn, opts]) => ({ path, html: page(ctx, { path, title, body: fn(ctx), ...opts }) })), ...extraPages(ctx, page),
      { path: '/404', html: page(ctx, { path: '/404', title: 'Page not found', body: P.notFoundPage(ctx) }) }];
  };
  for (const theme of ['classic', 'luxury']) for (const preview of [false, true]) {
    for (const { path, html } of render({ ...content.site, turnstileSiteKey: '0x4AAAAAAAtestkey' }, theme, preview)) {
      assert.doesNotMatch(html, addr, `${theme} ${path}: address in the page code`);
      assert.doesNotMatch(html, /mailto:|formsubmit/i, `${theme} ${path}`);
    }
    // Today (key not set yet): the only place the address may still be is the old form's FormSubmit link.
    for (const { path, html } of render({ ...content.site, turnstileSiteKey: '' }, theme, preview)) {
      assert.doesNotMatch(html, /mailto:/i, `${theme} ${path}`);
      assert.doesNotMatch(html.replace(/https:\/\/formsubmit\.co\/(ajax\/)?danmckenna%40kw\.com/g, ''), addr, `${theme} ${path}`);
    }
  }
  const contact = render({ ...content.site, turnstileSiteKey: 'k' }, 'classic', false).find((p) => p.path === '/contact/').html;
  assert.match(contact, /<a class="btn" href="\/contact\/" data-mail="[^"]+">Email Dan<\/a>/, 'the Email Dan button is still a button');
  assert.match(contact, /danmckenna<span class="eml-at"><\/span>kw\.com/, 'the address still reads normally');
});

test('site.json: turnstileSiteKey is a public Turnstile site key or empty; the secrets are not in the repository', async () => {
  const c = await loadContent();
  assert.match(c.site.turnstileSiteKey ?? '', /^(|0x[0-9A-Za-z_-]{10,40}|[123]x0{19}[0-9A-F]{2})$/);
  const toml = readTextFile(new URL('../site/wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(toml.replace(/^\s*#.*$/gm, ''), /TURNSTILE_SECRET|CONTACT_TO|@kw\.com/, 'secrets and Dan\'s address are not in wrangler.toml');
  assert.match(toml, /CONTACT_FROM = "form@danmckennahomes\.com"/); assert.match(toml, /CONTACT_SUBJECT = "New message from danmckennahomes\.com"/);
});
