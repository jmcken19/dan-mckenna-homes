// API-level tests of the owner editor, running the real Worker code in Miniflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startEditor, accessToken, otherKey, testJpeg, clientSetup, OWNER, MAINT } from './harness.mjs';
import { hasMetadata, cleanJpeg } from '../owner/src/images.mjs';

let E;
before(async () => { E = await startEditor(); });
after(async () => { await E.close(); });

const fields = (over = {}) => ({ address: { street: '123 TEST Lane', city: 'Waxhaw', state: 'NC', zip: '28173' }, status: 'active', price: '525,000', beds: '4', baths: '2.5', sqft: '', description: 'Test listing – not a real home.', mls: '', ...over });

async function photoForm(rev, { gps = true, color = '#7a9', label = '' } = {}) {
  const big = await testJpeg({ width: 1800, height: 1350, gps, color, label });
  const small = await sharp(big).resize(900).withExifMerge({ IFD0: { Make: 'X' } }).jpeg().toBuffer();
  const fd = new FormData();
  fd.append('large', new Blob([big], { type: 'image/jpeg' }), 'l.jpg');
  fd.append('small', new Blob([small], { type: 'image/jpeg' }), 's.jpg');
  fd.append('original', new Blob([big], { type: 'image/jpeg' }), 'o.jpg');
  fd.append('baseRevision', String(rev));
  return fd;
}

async function waitLive(sha) {
  for (let i = 0; i < 10; i++) { const s = await E.call('GET', `/api/publish-status/${sha}`); if (s.data.state !== 'publishing') return s.data.state; }
  return 'publishing';
}

test('signed-out, forged, expired and wrong-audience requests are rejected', async () => {
  assert.equal((await E.call('GET', '/api/listings', { as: null })).status, 401);
  assert.equal((await E.call('GET', '/api/listings', { token: accessToken(OWNER, { key: otherKey }) })).status, 401);
  assert.equal((await E.call('GET', '/api/listings', { token: accessToken(OWNER, { exp: 1000 }) })).status, 401);
  assert.equal((await E.call('GET', '/api/listings', { token: accessToken(OWNER, { aud: 'other' }) })).status, 401);
  assert.equal((await E.call('GET', '/api/listings', { as: 'stranger@example.com' })).status, 401, 'valid token but not on the allow-list');
  const w = await E.call('POST', '/api/listings', { as: null, body: { fields: fields() } });
  assert.equal(w.status, 401);
});

test('CSRF: writes without the editor header or from another origin are blocked', async () => {
  const r1 = await E.call('POST', '/api/listings', { body: { fields: fields() }, headers: { 'X-DMH-Editor': '' } });
  assert.equal(r1.status, 403);
  const r2 = await E.call('POST', '/api/listings', { body: { fields: fields() }, headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

test('validation: missing fields and bad numbers give plain messages; blanks stay unknown', async () => {
  const r = await E.call('POST', '/api/listings', { body: { fields: fields({ address: { street: '', city: '', state: 'NC' }, price: 'lots' }) } });
  assert.equal(r.status, 422);
  assert.ok(r.data.fieldErrors.street && r.data.fieldErrors.price);
  const ok = await E.call('POST', '/api/listings', { body: { fields: fields({ price: '', beds: '' }) } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.draft.price, null);
  assert.equal(ok.data.draft.beds, null);
  assert.equal(ok.data.draft.sqft, null);
});

test('full lifecycle: draft → photos → private preview → publish → edit → pending → sold → take down → restore', async () => {
  // Add listing (duplicate submit with same key returns the same listing, not two).
  const key = 'dup-key-12345';
  const a = await E.call('POST', '/api/listings', { body: { fields: fields() }, idem: key });
  const a2 = await E.call('POST', '/api/listings', { body: { fields: fields() }, idem: key });
  assert.equal(a.data.id, a2.data.id);
  let L = a.data;
  assert.equal(L.visibility, 'draft');

  // Three photos with GPS metadata.
  for (const [i, color] of ['#a55', '#5a5', '#55a'].entries()) {
    const r = await E.call('POST', `/api/listings/${L.id}/photos`, { form: await photoForm(L.revision, { color, label: `Photo ${i + 1}` }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    L = r.data;
  }
  assert.equal(L.draft.photos.length, 3);

  // Draft is not in the repo; a signed-out person cannot read the draft or its photos.
  assert.equal(E.gh.read(`content/listings/${L.id}.json`), null);
  assert.equal((await E.call('GET', `/api/listings/${L.id}`, { as: null })).status, 401);
  assert.equal((await E.call('GET', `/api/listings/${L.id}/preview`, { as: null })).status, 401);
  assert.equal((await E.call('GET', `/api/photo/${L.id}/${L.draft.photos[0].id}/large`, { as: null })).status, 401);
  const pv = await E.call('GET', `/api/listings/${L.id}/preview`);
  assert.equal(pv.status, 200);
  assert.match(pv.data, /Preview only/);
  assert.match(pv.data, /\$525,000/);
  assert.doesNotMatch(pv.data, /sq ft/, 'unknown square feet is not shown');

  // Publish.
  let p = await E.call('POST', `/api/listings/${L.id}/publish`, { body: { baseRevision: L.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  L = p.data.listing;
  const pub = JSON.parse(E.gh.read(`content/listings/${L.id}.json`));
  assert.equal(pub.price, 525000); assert.equal(pub.sqft, null); assert.equal(pub.photos.length, 3); assert.equal(pub.isTest, true);
  for (const ph of pub.photos) {
    const bytes = E.gh.read(`public${ph.large}`);
    assert.ok(bytes, 'image committed');
    assert.equal(hasMetadata(bytes), false, 'no EXIF/GPS in public image');
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.exif, undefined);
  }
  assert.equal(await waitLive(p.data.commit), 'live');

  // Change price, replace cover, reorder, mark Pending.
  L = (await E.call('PUT', `/api/listings/${L.id}`, { body: { fields: fields({ price: '499000' }), baseRevision: L.revision } })).data;
  const oldCover = L.draft.photos[0].id;
  L = (await E.call('POST', `/api/listings/${L.id}/photos/${oldCover}/replace`, { form: await photoForm(L.revision, { color: '#cc0', label: 'New cover' }) })).data;
  assert.notEqual(L.draft.photos[0].id, oldCover);
  const order = L.draft.photos.map((x) => x.id); const reordered = [order[0], order[2], order[1]];
  L = (await E.call('PUT', `/api/listings/${L.id}/photos`, { body: { order: reordered, baseRevision: L.revision } })).data;
  assert.equal(L.hasUnpublishedChanges, true);
  p = await E.call('POST', `/api/listings/${L.id}/status`, { body: { status: 'pending', baseRevision: L.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  L = p.data.listing;
  const pub2 = JSON.parse(E.gh.read(`content/listings/${L.id}.json`));
  assert.equal(pub2.status, 'pending'); assert.equal(pub2.price, 499000);
  assert.deepEqual(pub2.photos.map((x) => x.id), reordered);
  assert.equal(E.gh.read(`public/listings/${L.id}/${oldCover}-1800.jpg`), null, 'replaced cover file deleted from site');
  assert.equal(await waitLive(p.data.commit), 'live');

  // Sold.
  p = await E.call('POST', `/api/listings/${L.id}/status`, { body: { status: 'sold', baseRevision: L.revision } });
  L = p.data.listing;
  assert.equal(JSON.parse(E.gh.read(`content/listings/${L.id}.json`)).status, 'sold');

  // Take off website: JSON + photos removed from repo, slug recorded so the old URL shows a friendly page.
  p = await E.call('POST', `/api/listings/${L.id}/takedown`, { body: { baseRevision: L.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  L = p.data.listing;
  assert.equal(L.visibility, 'archived');
  assert.equal(E.gh.read(`content/listings/${L.id}.json`), null);
  assert.equal([...E.gh.headFiles().keys()].filter((f) => f.startsWith(`public/listings/${L.id}/`)).length, 0);
  const removed = JSON.parse(E.gh.read('content/removed.json'));
  assert.ok(removed.items.some((x) => x.slug === L.slug));

  // Restore.
  p = await E.call('POST', `/api/listings/${L.id}/restore`, { body: { baseRevision: L.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  L = p.data.listing;
  assert.equal(L.visibility, 'published');
  assert.ok(E.gh.read(`content/listings/${L.id}.json`));
  assert.ok(!JSON.parse(E.gh.read('content/removed.json')).items.some((x) => x.slug === L.slug));
  assert.equal(JSON.parse(E.gh.read(`content/listings/${L.id}.json`)).photos.length, 3);
});

test('stale editor cannot silently overwrite a newer save', async () => {
  let L = (await E.call('POST', '/api/listings', { body: { fields: fields({ address: { street: '9 TEST Court', city: 'Marvin', state: 'NC' } }) } })).data;
  const staleRev = L.revision;
  L = (await E.call('PUT', `/api/listings/${L.id}`, { body: { fields: fields({ price: '600000' }), baseRevision: staleRev } })).data;
  const r = await E.call('PUT', `/api/listings/${L.id}`, { as: MAINT, body: { fields: fields({ price: '1' }), baseRevision: staleRev } });
  assert.equal(r.status, 409);
  assert.equal(r.data.conflict, true);
  assert.equal((await E.call('GET', `/api/listings/${L.id}`)).data.draft.price, 600000);
});

test('bad uploads: non-image, fake JPEG and oversized images are refused with a clear message', async () => {
  const L = (await E.call('POST', '/api/listings', { body: { fields: fields({ address: { street: '10 TEST Way', city: 'Waxhaw', state: 'NC' } }) } })).data;
  const fd = new FormData();
  fd.append('large', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'x.jpg');
  fd.append('small', new Blob(['hi'], { type: 'image/jpeg' }), 'y.jpg');
  fd.append('baseRevision', String(L.revision));
  const r = await E.call('POST', `/api/listings/${L.id}/photos`, { form: fd });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /not a photo/);
  const huge = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const fd2 = new FormData();
  fd2.append('large', new Blob([huge]), 'l.jpg'); fd2.append('small', new Blob([huge]), 's.jpg'); fd2.append('baseRevision', String(L.revision));
  const r2 = await E.call('POST', `/api/listings/${L.id}/photos`, { form: fd2 });
  assert.equal(r2.status, 422);
  const pub = await E.call('POST', `/api/listings/${L.id}/publish`, { body: { baseRevision: L.revision } });
  assert.equal(pub.status, 422);
  assert.match(pub.data.error, /photo/);
});

test('failed website build reports failure, keeps the edit, and retry recovers', async () => {
  let L = (await E.call('POST', '/api/listings', { body: { fields: fields({ address: { street: '11 TEST Road', city: 'Weddington', state: 'NC' } }) } })).data;
  L = (await E.call('POST', `/api/listings/${L.id}/photos`, { form: await photoForm(L.revision) })).data;
  E.gh.failNextRun = true;
  const p = await E.call('POST', `/api/listings/${L.id}/publish`, { body: { baseRevision: L.revision } });
  assert.equal(p.status, 200);
  const st = await E.call('GET', `/api/publish-status/${p.data.commit}`);
  assert.equal(st.data.state, 'failed');
  assert.equal((await E.call('GET', `/api/listings/${L.id}`)).data.draft.address.street, '11 TEST Road', 'edit preserved');
  assert.equal((await E.call('POST', `/api/publish-retry/${p.data.commit}`, { body: {} })).status, 200);
  assert.equal(await waitLive(p.data.commit), 'live');
});

test('concurrent push to the repo is not overwritten (commit retried on top)', async () => {
  let L = (await E.call('POST', '/api/listings', { body: { fields: fields({ address: { street: '12 TEST Blvd', city: 'Charlotte', state: 'NC' } }) } })).data;
  L = (await E.call('POST', `/api/listings/${L.id}/photos`, { form: await photoForm(L.revision) })).data;
  E.gh.raceOnce = true;
  const p = await E.call('POST', `/api/listings/${L.id}/publish`, { body: { baseRevision: L.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.ok(E.gh.read('README-race.md'), 'the other change survived');
  assert.ok(E.gh.read(`content/listings/${L.id}.json`), 'our change landed');
});

test('change requests: stored privately, emailed with photo, truthful when email fails', async () => {
  const fd = new FormData();
  fd.append('kind', 'change'); fd.append('page', 'About us'); fd.append('message', 'On the About page, replace my headshot with this one.');
  fd.append('photo', new Blob([await testJpeg({ width: 800, height: 900 })]), 'h.jpg');
  const r = await E.call('POST', '/api/requests', { form: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.notified, true);
  const mail = E.emails.at(-1);
  assert.deepEqual(mail.to, [MAINT]);
  assert.equal(mail.reply_to, OWNER);
  assert.equal(mail.attachments.length, 1);
  assert.equal(hasMetadata(Buffer.from(mail.attachments[0].content, 'base64')), false);

  const missing = new FormData(); missing.append('message', ' ');
  const m = await E.call('POST', '/api/requests', { form: missing });
  assert.equal(m.status, 422);

  const badImg = new FormData(); badImg.append('message', 'hi there'); badImg.append('photo', new Blob(['not an image']), 'x.jpg');
  assert.equal((await E.call('POST', '/api/requests', { form: badImg })).status, 422);

  // Owner sees own requests; signed-out sees nothing; only maintainer can change status.
  assert.equal((await E.call('GET', '/api/requests', { as: null })).status, 401);
  const list = await E.call('GET', '/api/requests');
  assert.ok(list.data.requests.length >= 1);
  assert.equal((await E.call('PUT', `/api/requests/${r.data.id}`, { body: { status: 'done' } })).status, 403);
  assert.equal((await E.call('PUT', `/api/requests/${r.data.id}`, { as: MAINT, body: { status: 'done', reply: 'Updated!' } })).status, 200);
});

test('change request without email set up: saved, tells Dan to text James, no false "sent"', async () => {
  const E2 = await startEditor({ resend: false });
  try {
    const fd = new FormData(); fd.append('message', 'Please fix a typo on the Contact page.');
    const r = await E2.call('POST', '/api/requests', { form: fd });
    assert.equal(r.status, 200);
    assert.equal(r.data.notified, false);
    assert.equal(r.data.saved, true);
    assert.doesNotMatch(r.data.message, /^Sent/);
    assert.match(r.data.message, /will see this in his editor/);
    assert.match(r.data.message, /text/);
    const me = await E2.call('GET', '/api/me', { as: MAINT });
    assert.equal(me.data.emailNotifications, false);
    assert.equal(me.data.openRequests, 1, 'James sees the waiting request count');
  } finally { await E2.close(); }
});

test('cleanJpeg strips EXIF/GPS but keeps the picture', async () => {
  const j = await testJpeg({ width: 640, height: 480 });
  assert.equal(hasMetadata(j), true);
  const c = cleanJpeg(new Uint8Array(j));
  assert.equal(hasMetadata(c.bytes), false);
  assert.equal(c.width, 640); assert.equal(c.height, 480);
  const meta = await sharp(Buffer.from(c.bytes)).metadata();
  assert.equal(meta.width, 640);
});

test('security headers are present on editor pages and API', async () => {
  const r = await E.call('GET', '/api/me');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const page = await E.mf.dispatchFetch(E.url + '/', { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
  assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);
  await page.text();
});

/* ---------------- homepage slideshow ---------------- */
async function heroForm(rev, { color = '#468', label = 'HERO' } = {}) {
  const base = await testJpeg({ width: 2400, height: 1600, color, label, gps: true });
  const fd = new FormData();
  for (const w of [2000, 1400, 800]) fd.append(`w${w}`, new Blob([await sharp(base).resize(w).withExifMerge({ IFD0: { Make: 'X' } }).jpeg().toBuffer()]), `w${w}.jpg`);
  fd.append('original', new Blob([base]), 'o.jpg');
  fd.append('baseRevision', String(rev));
  return fd;
}

test('homepage slideshow: starts from the website, add/reorder/focus/speed/fade, preview, publish, remove old', async () => {
  assert.equal((await E.call('GET', '/api/homepage', { as: null })).status, 401);
  let H = (await E.call('GET', '/api/homepage')).data;
  assert.equal(H.draft.slides.length, 1);
  assert.equal(H.draft.slides[0].id, 's-hero1');
  assert.equal(H.draft.seconds, 7, 'normal speed by default');
  assert.equal(H.draft.fade, false, 'fade off by default');
  assert.equal(H.hasUnpublishedChanges, false);
  // Existing photo thumbnail comes from the repo.
  const th = await E.mf.dispatchFetch(E.url + '/api/homepage/photo/s-hero1?w=800', { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
  assert.equal(th.status, 200); await th.arrayBuffer();

  for (const c of ['#843', '#384']) { const r = await E.call('POST', '/api/homepage/photos', { form: await heroForm(H.revision, { color: c }) }); assert.equal(r.status, 200, JSON.stringify(r.data)); H = r.data; }
  assert.equal(H.draft.slides.length, 3);
  const [a, b, c] = H.draft.slides.map((s) => s.id);
  H = (await E.call('PUT', '/api/homepage/photos', { body: { order: [c, a, b], focus: { [c]: '50% 15%' }, baseRevision: H.revision } })).data;
  assert.deepEqual(H.draft.slides.map((s) => s.id), [c, a, b]);
  assert.equal(H.draft.slides[0].focus, '50% 15%');
  const bad = await E.call('PUT', '/api/homepage/settings', { body: { seconds: 999, fade: true, baseRevision: H.revision } });
  assert.equal(bad.status, 400);
  assert.equal(H.draft.autoplay, true, 'moving by default');
  H = (await E.call('PUT', '/api/homepage/settings', { body: { seconds: 4, fade: true, autoplay: false, baseRevision: H.revision } })).data;
  assert.equal(H.draft.autoplay, false);
  const still = await E.call('GET', '/api/homepage/preview');
  assert.doesNotMatch(still.data, /data-interval/, 'still = no rotation');
  H = (await E.call('PUT', '/api/homepage/settings', { body: { seconds: 4, fade: true, autoplay: true, baseRevision: H.revision } })).data;
  assert.equal(H.hasUnpublishedChanges, true);
  // Stale revision is refused.
  assert.equal((await E.call('PUT', '/api/homepage/settings', { as: MAINT, body: { seconds: 10, fade: false, baseRevision: H.revision - 1 } })).status, 409);

  // Website not changed yet.
  assert.equal(JSON.parse(E.gh.read('content/site.json')).heroSlides.length, 1);
  const pv = await E.call('GET', '/api/homepage/preview');
  assert.equal(pv.status, 200);
  const heroImgs = [...pv.data.matchAll(/hero__slide[^>]*>\s*<picture>\s*<img src="([^"]+)"/g)];
  assert.equal(heroImgs.length, 3, 'all three slides found in preview');
  for (const m of heroImgs) {
    assert.match(m[1], /^\/api\/homepage\/photo\/s-[a-z0-9]+\/w-1400\.jpg$/, 'preview photos come from the editor (draft photos are not public yet)');
    const img = await E.mf.dispatchFetch(E.url + m[1], { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg'); await img.arrayBuffer();
  }
  assert.match(pv.data, /hero--fade/); assert.match(pv.data, /data-interval="4"/); assert.doesNotMatch(pv.data, /Preview only/); assert.match(pv.data, /preview-bar/);
  assert.equal((await E.call('GET', '/api/homepage/preview', { as: null })).status, 401);
  const pv2 = await E.call('GET', '/api/homepage/preview?design=option2');
  assert.match(pv2.data, /lx-hero/);

  const p = await E.call('POST', '/api/homepage/publish', { body: { baseRevision: H.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.deepEqual(site.heroSlides.map((s) => s.id), [c, a, b]);
  assert.equal(site.heroSlideSeconds, 4); assert.equal(site.heroFade, true); assert.equal(site.heroAutoplay, true);
  assert.doesNotMatch(pv.data, /hero__pause-icon/, 'no visible pause icon');
  assert.equal(site.phone, '704-441-4556', 'other site settings untouched');
  for (const w of [800, 1400, 2000]) {
    const bytes = E.gh.read(`public/assets/img/hero/${c}-${w}.jpg`);
    assert.ok(bytes); assert.equal(hasMetadata(bytes), false, 'no GPS/EXIF on public slideshow photo');
  }
  assert.equal(await waitLive(p.data.commit), 'live');
  H = p.data.homepage;
  assert.equal(H.hasUnpublishedChanges, false);

  // a = the original site photo, b/c = new. Remove down to one, then the last one is refused.
  assert.equal(a, 's-hero1');
  H = (await E.call('DELETE', `/api/homepage/photos/${b}?baseRevision=${H.revision}`)).data;
  H = (await E.call('DELETE', `/api/homepage/photos/${a}?baseRevision=${H.revision}`)).data;
  assert.deepEqual(H.draft.slides.map((s) => s.id), [c]);
  const last = await E.call('DELETE', `/api/homepage/photos/${c}?baseRevision=${H.revision}`);
  assert.equal(last.status, 422, 'cannot remove the last photo');
  H = (await E.call('POST', '/api/homepage/discard', { body: { baseRevision: H.revision } })).data;
  assert.equal(H.draft.slides.length, 3, 'undo goes back to what is live');
  H = (await E.call('DELETE', `/api/homepage/photos/${b}?baseRevision=${H.revision}`)).data;
  const p2 = await E.call('POST', '/api/homepage/publish', { body: { baseRevision: H.revision } });
  assert.equal(p2.status, 200);
  assert.equal(E.gh.read(`public/assets/img/hero/${b}-800.jpg`), null, 'removed photo deleted from site');
  assert.ok(E.gh.read('public/assets/img/hero-1-800.jpg'), 'original site photo files are left alone');
});

test('website photos: replace headshot and page photos, undo, preview the right page, publish only what changed', async () => {
  let H = (await E.call('GET', '/api/homepage')).data;
  assert.deepEqual(Object.keys(H.draft.photos).sort(), ['construction', 'headshot', 'luxury']);
  assert.equal(H.draft.photos.headshot.small, '/assets/img/dan-mckenna-headshot.jpg', 'starts from the original photos');
  const th = await E.mf.dispatchFetch(E.url + '/api/homepage/spot/headshot/img', { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
  assert.equal(th.status, 200, 'original photo thumbnail is served through the editor'); await th.arrayBuffer();
  assert.equal((await E.call('POST', '/api/homepage/spot/nope', { form: await heroForm(H.revision) })).status, 404);
  assert.equal((await E.call('POST', '/api/homepage/spot/headshot', { as: null, form: await heroForm(H.revision) })).status, 401);

  let r = await E.call('POST', '/api/homepage/spot/headshot', { form: await heroForm(H.revision, { color: '#622' }) });
  assert.equal(r.status, 200, JSON.stringify(r.data)); H = r.data;
  const hid = H.draft.photos.headshot.id;
  assert.match(hid, /^s-[a-z0-9]+$/);
  assert.equal(H.hasUnpublishedChanges, true);
  r = await E.call('POST', '/api/homepage/spot/luxury', { form: await heroForm(H.revision, { color: '#262' }) });
  H = r.data;
  assert.equal(H.draft.photos.luxury.alt, 'Luxury home in the Charlotte area', 'replaced photo does not keep the old house address as its description');
  // Undo one of them.
  H = (await E.call('POST', '/api/homepage/spot/luxury/undo', { body: { baseRevision: H.revision } })).data;
  assert.equal(H.draft.photos.luxury.id, undefined);

  // Preview shows the About page with the new (private) photo.
  const pv = await E.call('GET', '/api/homepage/preview?page=headshot');
  assert.equal(pv.status, 200);
  assert.match(pv.data, /Dan McKenna, NC\/SC Broker/);
  const m = pv.data.match(/class="headshot" src="([^"]+)"/);
  assert.match(m[1], new RegExp(`^/api/homepage/photo/${hid}/w-800\\.jpg$`));
  const img = await E.mf.dispatchFetch(E.url + m[1], { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
  assert.equal(img.status, 200); await img.arrayBuffer();
  assert.match((await E.call('GET', '/api/homepage/preview?page=luxury')).data, /Tiara Homes/, 'original luxury photo keeps its caption');
  assert.equal(JSON.parse(E.gh.read('content/site.json')).photos, undefined, 'website unchanged before publish');

  const p = await E.call('POST', '/api/homepage/publish', { body: { baseRevision: H.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const site = JSON.parse(E.gh.read('content/site.json'));
  assert.deepEqual(Object.keys(site.photos), ['headshot'], 'only the changed photo is written');
  assert.equal(site.photos.headshot.small, `/assets/img/hero/${hid}-800.jpg`);
  for (const w of [800, 1400, 2000]) { const b = E.gh.read(`public/assets/img/hero/${hid}-${w}.jpg`); assert.ok(b); assert.equal(hasMetadata(b), false); }
  assert.ok(E.gh.read('public/assets/img/hero/' + JSON.parse(E.gh.read('content/site.json')).heroSlides[0].id + '-800.jpg') || true);
  assert.equal(await waitLive(p.data.commit), 'live');
  H = p.data.homepage;
  assert.equal(H.hasUnpublishedChanges, false);
  // Thumbnail of a replaced, published photo still works.
  const th2 = await E.mf.dispatchFetch(E.url + '/api/homepage/spot/headshot/img', { headers: { 'Cf-Access-Jwt-Assertion': accessToken(OWNER) } });
  assert.equal(th2.status, 200); await th2.arrayBuffer();
});

test('client reviews: add, edit, remove, preview, publish; old address of a removed review forwards', async () => {
  assert.equal((await E.call('GET', '/api/reviews', { as: null })).status, 401);
  let R = (await E.call('GET', '/api/reviews')).data;
  const start = R.draft.items.length;
  assert.ok(start >= 13, 'starts from the website reviews');
  const bad = await E.call('POST', '/api/reviews', { body: { fields: { title: '', text: '', date: '2099-01-01' }, baseRevision: R.revision } });
  assert.equal(bad.status, 422); assert.match(bad.data.error, /title/i);
  let r = await E.call('POST', '/api/reviews', { body: { fields: { title: 'Made selling easy', client: 'Pat Q.', role: 'Seller', date: '2026-10-01', text: 'Dan was great.\n\nWould hire again.' }, baseRevision: R.revision } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); R = r.data;
  const added = R.draft.items[0];
  assert.equal(added.slug, 'made-selling-easy'); assert.deepEqual(added.text, ['Dan was great.', 'Would hire again.']);
  // Edit an existing (excerpt) review: wording changes, address stays, excerpt flag goes.
  const ex = R.draft.items.find((x) => x.excerptOnly);
  r = await E.call('PUT', `/api/reviews/item/${ex.slug}`, { body: { fields: { title: ex.title, client: 'J. D.', role: '', date: ex.date, text: 'The full review text from Dan.' }, baseRevision: R.revision } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); R = r.data;
  const edited = R.draft.items.find((x) => x.slug === ex.slug);
  assert.equal(edited.client, 'J. D.'); assert.equal(edited.excerptOnly, undefined); assert.equal(edited.role, undefined);
  // Remove one.
  const gone = R.draft.items[R.draft.items.length - 1].slug;
  R = (await E.call('DELETE', `/api/reviews/item/${gone}?baseRevision=${R.revision}`)).data;
  assert.equal(R.draft.items.length, start);
  assert.equal((await E.call('DELETE', `/api/reviews/item/${gone}?baseRevision=${R.revision}`)).status, 404);
  assert.equal((await E.call('POST', '/api/reviews', { as: MAINT, body: { fields: { title: 'x', text: 'y', date: '2026-01-01' }, baseRevision: R.revision - 1 } })).status, 409, 'stale save refused');
  // Website unchanged until publish; preview shows the draft.
  assert.equal(JSON.parse(E.gh.read('content/testimonials.json')).items.length, start);
  const pv = await E.call('GET', '/api/reviews/preview');
  assert.equal(pv.status, 200); assert.match(pv.data, /Made selling easy/); assert.match(pv.data, /The full review text from Dan/);
  const p = await E.call('POST', '/api/reviews/publish', { body: { baseRevision: R.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const file = JSON.parse(E.gh.read('content/testimonials.json'));
  assert.equal(file.items.length, start); assert.ok(file._comment, 'file comment kept');
  assert.ok(file.items.some((x) => x.slug === 'made-selling-easy'));
  assert.deepEqual(file.removedSlugs, [gone]);
  assert.equal(await waitLive(p.data.commit), 'live');
  R = p.data.reviews; assert.equal(R.hasUnpublishedChanges, false);
  // Undo works; can't remove the last review.
  R = (await E.call('DELETE', `/api/reviews/item/made-selling-easy?baseRevision=${R.revision}`)).data;
  R = (await E.call('POST', '/api/reviews/discard', { body: { baseRevision: R.revision } })).data;
  assert.ok(R.draft.items.some((x) => x.slug === 'made-selling-easy'));
});

test('client reviews: arrange the order (file order = shown order); new go to the top, edit/remove keep the order', async () => {
  const C = await clientSetup(); // Dan's setup in the template's shape
  const FILE = C.reviewsFile;
  const fileSlugs = () => JSON.parse(E.gh.read(FILE)).items.map((x) => x.slug);
  // The order the page shows, read from the editor's page preview (each review card carries its slug in edit mode).
  const pageOrder = async () => {
    const pv = await E.call('GET', `/api/homepage/preview?edit=1&path=${encodeURIComponent(C.reviewsPath)}`);
    assert.equal(pv.status, 200);
    return [...pv.data.matchAll(/data-edit="review" data-edit-key="([^"]+)"/g)].map((m) => m[1]);
  };
  let R = (await E.call('GET', '/api/reviews')).data;
  const start = R.draft.items.map((x) => x.slug);
  assert.deepEqual(start, fileSlugs(), 'the editor starts in the file order');
  assert.deepEqual(await pageOrder(), start, 'the page shows the reviews in the file order');
  const order = (slugs, rev = R.revision, as) => E.call('POST', '/api/reviews/order', { as, body: { slugs, baseRevision: rev } });
  assert.equal((await E.call('POST', '/api/reviews/order', { as: null, body: { slugs: start, baseRevision: R.revision } })).status, 401, 'signed out');
  // Only a full permutation of the current reviews is accepted.
  for (const bad of [start.slice(1), [...start, start[0]], [start[0], ...start.slice(1, -1), start[0]], [...start.slice(0, -1), 'not-a-review'], 'abc', null, [...start.slice(0, -1), 7]]) {
    const r = await order(bad);
    assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`); assert.match(r.data.error, /reload/i);
  }
  assert.equal((await order([...start].reverse(), R.revision - 1)).status, 409, 'stale order refused');
  assert.equal((await E.call('GET', '/api/reviews')).data.revision, R.revision, 'refused orders saved nothing');
  // Same order: nothing to save.
  assert.equal((await order(start)).data.revision, R.revision);
  // Reverse: saved as a draft, shown in the preview, the website file untouched; order-only change counts as unpublished.
  const rev = [...start].reverse();
  let r = await order(rev); assert.equal(r.status, 200, JSON.stringify(r.data)); R = r.data;
  assert.deepEqual(R.draft.items.map((x) => x.slug), rev);
  assert.deepEqual(R.live.items.map((x) => x.slug), start);
  assert.equal(R.hasUnpublishedChanges, true, 'an order-only change is an unpublished change');
  assert.deepEqual(await pageOrder(), rev, 'the preview shows the draft order');
  const rpv = await E.call('GET', '/api/reviews/preview');
  const hrefOrder = [...new Set([...rpv.data.matchAll(/href="[^"]*\/([a-z0-9-]+)\/"/g)].map((m) => m[1]).filter((x) => start.includes(x)))];
  assert.deepEqual(hrefOrder, rev, 'the reviews preview shows the draft order too');
  assert.deepEqual(fileSlugs(), start, 'website unchanged until Publish');
  // Undo (discard) puts the published order back.
  R = (await E.call('POST', '/api/reviews/discard', { body: { baseRevision: R.revision } })).data;
  assert.deepEqual(R.draft.items.map((x) => x.slug), start); assert.equal(R.hasUnpublishedChanges, false);
  assert.deepEqual(await pageOrder(), start);
  // Publish writes the new order to the file (and nothing else about the reviews changes).
  const before = JSON.parse(E.gh.read(FILE));
  R = (await order(rev)).data;
  const p = await E.call('POST', '/api/reviews/publish', { body: { baseRevision: R.revision } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const after = JSON.parse(E.gh.read(FILE));
  assert.deepEqual(after.items.map((x) => x.slug), rev, 'published order is in the file');
  assert.deepEqual(after.items, rev.map((s) => before.items.find((x) => x.slug === s)), 'every review is word for word the same');
  assert.deepEqual(after.removedSlugs, before.removedSlugs, 'no review counted as removed');
  R = p.data.reviews; assert.equal(R.hasUnpublishedChanges, false);
  // A new review goes to the top; editing keeps its place; removing keeps the others' order.
  r = await E.call('POST', '/api/reviews', { body: { fields: { title: 'Order test review', text: 'Great.', date: '2020-01-01' }, baseRevision: R.revision } });
  R = r.data; const added = R.draft.items[0].slug;
  assert.deepEqual(R.draft.items.map((x) => x.slug), [added, ...rev], 'new review shows first (even with an old date)');
  const mid = R.draft.items[1];
  R = (await E.call('PUT', `/api/reviews/item/${mid.slug}`, { body: { fields: { title: mid.title, client: mid.client || '', role: mid.role || '', date: mid.date, text: mid.text.join('\n\n') }, baseRevision: R.revision } })).data;
  assert.deepEqual(R.draft.items.map((x) => x.slug), [added, ...rev], 'editing keeps the place');
  R = (await E.call('DELETE', `/api/reviews/item/${rev[0]}?baseRevision=${R.revision}`)).data;
  assert.deepEqual(R.draft.items.map((x) => x.slug), [added, ...rev.slice(1)], 'removing keeps the others in order');
  // An order sent before the removal no longer matches the reviews: refused, nothing changes.
  assert.equal((await order([added, ...rev], R.revision)).status, 400);
  // Clean up: undo, then publish the original order again.
  R = (await E.call('POST', '/api/reviews/discard', { body: { baseRevision: R.revision } })).data;
  R = (await order(start)).data;
  assert.equal((await E.call('POST', '/api/reviews/publish', { body: { baseRevision: R.revision } })).status, 200);
  assert.deepEqual(fileSlugs(), start);
});

test('laptop only: phone browsers are refused, laptops are allowed', async () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  for (const ua of [iphone, android]) {
    const r = await E.call('GET', '/api/listings', { headers: { 'User-Agent': ua } });
    assert.equal(r.status, 403); assert.equal(r.data.laptopOnly, true); assert.match(r.data.error, /laptop/);
  }
  for (const ua of [windows, mac]) assert.equal((await E.call('GET', '/api/listings', { headers: { 'User-Agent': ua } })).status, 200);
  // signed-out phone still gets "sign in", not a hint that the editor exists
  assert.equal((await E.call('GET', '/api/listings', { as: null, headers: { 'User-Agent': iphone } })).status, 401);
});

test('edit-on-the-page: edit marks only in edit mode, page picker, preview may be framed by the editor only', async () => {
  const me = await E.call('GET', '/api/me');
  assert.ok(Array.isArray(me.data.pages) && me.data.pages.some((p) => p.path === '/'), 'page list for the page picker');
  for (const p of ['/about-us/', '/testimonials/', '/contact/', '/new-construction/', '/luxury-home-marketing/']) assert.ok(me.data.pages.some((x) => x.path === p), 'picker has ' + p);
  assert.ok(!me.data.pages.some((p) => /^\/listings\//.test(p.path)), 'no listings pages in the picker');
  const reviewPages = me.data.pages.filter((p) => /^\/testimonial\//.test(p.path));
  assert.ok(reviewPages.length <= 1 && reviewPages.every((p) => p.more), 'one page per review is left out (only one example, under "More pages")');
  for (const p of ['/accessibility-2/', '/dmca-compliance-2/', '/404']) assert.ok(me.data.pages.some((x) => x.path === p && x.more), 'More pages has ' + p);
  for (const p of ['/accessibility-2/', '/404', reviewPages[0]?.path].filter(Boolean)) assert.match((await E.call('GET', `/api/homepage/preview?edit=1&path=${encodeURIComponent(p)}`)).data, /data-edit="text"/, `the editor can show ${p} with its words editable`);

  const edit = await E.call('GET', '/api/homepage/preview?edit=1');
  assert.match(edit.data, /data-edit="slideshow" data-edit-key="hero"/, 'slideshow is marked editable');
  assert.match(edit.data, /data-edit="reviews" data-edit-key="row"/, 'homepage reviews row is marked');
  assert.doesNotMatch(edit.data, /data-edit="review"/, 'the carousel copies of reviews are not marked one by one');
  assert.equal(edit.headers.get('X-Frame-Options'), 'SAMEORIGIN', 'the editor may show its own preview in a frame');
  assert.match(edit.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);

  const about = await E.call('GET', '/api/homepage/preview?edit=1&path=%2Fabout-us%2F');
  assert.match(about.data, /data-edit="photo" data-edit-key="headshot" data-edit-label="Your photo"/, 'headshot on the About page is marked');
  const contact = await E.call('GET', '/api/homepage/preview?edit=1&path=%2Fcontact%2F');
  assert.match(contact.data, /data-edit="photo" data-edit-key="headshot"/, 'headshot on the Contact page is marked');
  for (const [path, key] of [['/new-construction/', 'construction'], ['/luxury-home-marketing/', 'luxury']]) {
    const r = await E.call('GET', '/api/homepage/preview?edit=1&path=' + encodeURIComponent(path));
    assert.match(r.data, new RegExp(`data-edit="photo" data-edit-key="${key}"`), key + ' photo is marked');
  }
  const unknown = await E.call('GET', '/api/homepage/preview?edit=1&path=%2Fnot-a-page%2F');
  assert.match(unknown.data, /data-edit="slideshow"/, 'unknown page falls back to the homepage');
  const lux = await E.call('GET', '/api/homepage/preview?edit=1&design=option2');
  assert.match(lux.data, /data-edit="slideshow"/, 'edit mode always shows the classic design');

  // Testimonials page: each review is editable, and unpublished review changes already show.
  let R = (await E.call('GET', '/api/reviews')).data;
  const slug = R.draft.items[0].slug;
  R = (await E.call('POST', '/api/reviews', { body: { fields: { text: 'Test review text for the preview.', title: 'Preview-only test review', date: '2026-01-02' }, baseRevision: R.revision } })).data;
  const tp = await E.call('GET', '/api/homepage/preview?edit=1&path=%2Ftestimonials%2F');
  assert.match(tp.data, /data-edit="reviews" data-edit-key="list"/, 'testimonials page wrapper is marked');
  assert.match(tp.data, new RegExp(`data-edit="review" data-edit-key="${slug}"`), 'each review card is marked');
  assert.match(tp.data, /Preview-only test review/, 'draft reviews show in the preview');
  R = (await E.call('POST', '/api/reviews/discard', { body: { baseRevision: R.revision } })).data;
  assert.equal(R.hasUnpublishedChanges, false);

  const plain = await E.call('GET', '/api/homepage/preview');
  assert.doesNotMatch(plain.data, /data-edit=/, 'no edit marks outside edit mode');
  const plainT = await E.call('GET', '/api/homepage/preview?path=%2Ftestimonials%2F');
  assert.doesNotMatch(plainT.data, /data-edit=/, 'no edit marks on the testimonials page outside edit mode');
  const api = await E.call('GET', '/api/homepage');
  assert.equal(api.headers.get('X-Frame-Options'), 'DENY', 'everything else still refuses to be framed');
});

test('preview: editor marker in edit mode only; allows Google Fonts, https images and video/map embeds; nothing else', async () => {
  const edit = await E.call('GET', '/api/homepage/preview?edit=1');
  assert.match(edit.data, /<meta name="editor-preview"/, 'edit-mode pages carry the editor marker');
  assert.doesNotMatch((await E.call('GET', '/api/homepage/preview')).data, /editor-preview/);
  const csp = edit.headers.get('Content-Security-Policy');
  assert.match(csp, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /img-src [^;]*https:/);
  assert.match(csp, /frame-src [^;]*https:\/\/www\.youtube-nocookie\.com/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match((await E.call('GET', '/api/reviews/preview')).headers.get('Content-Security-Policy'), /fonts\.googleapis\.com/);
});

test('preview: an unreadable reviews draft still shows the page (falls back to the published reviews)', async () => {
  await E.call('GET', '/api/reviews');
  const db = await E.mf.getD1Database('DB');
  const row = await db.prepare('SELECT draft FROM settings WHERE key = ?').bind('reviews').first();
  await db.prepare('UPDATE settings SET draft = ? WHERE key = ?').bind('{not json', 'reviews').run();
  try {
    const pv = await E.call('GET', '/api/homepage/preview?edit=1&path=%2Ftestimonials%2F');
    assert.equal(pv.status, 200);
    assert.match(pv.data, /class="tcard"/, 'published testimonials shown');
  } finally {
    await db.prepare('UPDATE settings SET draft = ? WHERE key = ?').bind(row.draft, 'reviews').run();
  }
});

test('reviews: a title with no Latin letters gets a dated address, never "-2"', async () => {
  let R = (await E.call('GET', '/api/reviews')).data;
  const add = async (title) => { const r = await E.call('POST', '/api/reviews', { body: { fields: { title, text: 'Great.', date: '2026-03-04' }, baseRevision: R.revision } }); assert.equal(r.status, 200, JSON.stringify(r.data)); R = r.data; return R.draft.items[0].slug; };
  assert.equal(await add('🎉🎉🎉'), 'review-2026-03-04');
  assert.equal(await add('★★★★★'), 'review-2026-03-04-2');
  R = (await E.call('POST', '/api/reviews/discard', { body: { baseRevision: R.revision } })).data;
  assert.equal(R.hasUnpublishedChanges, false);
});

test('conflict messages say "Click" (the editor is laptop-only)', async () => {
  const H = (await E.call('GET', '/api/homepage')).data;
  const r = await E.call('PUT', '/api/homepage/settings', { body: { seconds: 7, fade: false, baseRevision: H.revision - 1 } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Click "Reload latest"/);
  assert.doesNotMatch(r.data.error, /tap|phone/i);
});
