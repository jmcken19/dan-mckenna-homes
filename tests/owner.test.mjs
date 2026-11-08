// API-level tests of the owner editor, running the real Worker code in Miniflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startEditor, accessToken, otherKey, testJpeg, OWNER, MAINT } from './harness.mjs';
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

test('change request when email is not configured says so instead of claiming success', async () => {
  const E2 = await startEditor({ resend: false });
  try {
    const fd = new FormData(); fd.append('message', 'Please fix a typo on the Contact page.');
    const r = await E2.call('POST', '/api/requests', { form: fd });
    assert.equal(r.status, 200);
    assert.equal(r.data.notified, false);
    assert.match(r.data.message, /did not go through/);
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
