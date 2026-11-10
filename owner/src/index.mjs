// Dan McKenna Homes – owner editor service (Cloudflare Worker).
// Everything here sits behind Cloudflare Access, and every API call re-checks the
// Access token itself (see auth.mjs). Write credentials (GitHub token, email API key)
// exist only as Worker secrets.
import { authenticate } from './auth.mjs';
import { github } from './github.mjs';
import { validateVariant, validateOriginal, sniffType } from './images.mjs';
import { normaliseFields, listingSlug, oneLineAddress, randomId, validatePublicListing, LIMITS } from '../../src/lib/listing.mjs';
import { layout } from '../../src/templates/layout.mjs';
import { listingDetail } from '../../src/templates/listing.mjs';
import siteContent from '../../content/site.json';
import { homepageRoutes, EDITOR_PAGES } from './homepage.mjs';
import { reviewsRoutes } from './reviews.mjs';
import { textRoutes } from './text.mjs';
import textContent from '../../content/text.json';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const DAILY_LIMITS = { upload: 400, request: 30, publish: 120, save: 1000 };

class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

const now = () => new Date().toISOString();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

function securityHeaders(res, { html = false } = {}) {
  const h = new Headers(res.headers);
  h.set('X-Content-Type-Options', 'nosniff');
  // The editor shows its own page preview in a frame; everything else may never be framed.
  h.set('X-Frame-Options', /frame-ancestors 'self'/.test(h.get('Content-Security-Policy') || '') ? 'SAMEORIGIN' : 'DENY');
  h.set('Referrer-Policy', 'same-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (html && !h.has('Content-Security-Policy')) {
    h.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        const res = await handleApi(request, env, url, ctx);
        return securityHeaders(res);
      }
      // Static editor screens. Cloudflare Access protects these too; the API check above is the real gate.
      const res = await env.ASSETS.fetch(request);
      return securityHeaders(res, { html: (res.headers.get('content-type') || '').includes('text/html') });
    } catch (err) {
      if (err instanceof HttpError) return securityHeaders(json({ error: err.message, ...err.extra }, err.status));
      console.error('unhandled', err && err.stack || err);
      return securityHeaders(json({ error: 'Something went wrong on our side. Your work is saved up to your last "Saved" message. Please try again in a minute.' }, 500));
    }
  },
};

// Dan edits on his laptop only (owner's decision). Phones get a friendly refusal.
// This is a house rule, not a security boundary – sign-in is the security boundary.
export function isPhone(ua) {
  ua = String(ua || '');
  return /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
}

async function handleApi(request, env, url, ctx) {
  const user = await authenticate(request, env);
  if (!user) throw new HttpError(401, 'Please sign in again.', { signIn: true });
  if (env.ALLOW_PHONES !== 'true' && isPhone(request.headers.get('User-Agent'))) {
    throw new HttpError(403, 'The website editor works on your laptop only. Please open your bookmark on your laptop.', { laptopOnly: true });
  }

  const method = request.method;
  if (!['GET', 'HEAD'].includes(method)) {
    // CSRF: browsers cannot add this header cross-site without a CORS preflight, which we never allow.
    if (request.headers.get('X-DMH-Editor') !== '1') throw new HttpError(403, 'Blocked request.');
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Blocked request.');
  }
  if (method === 'OPTIONS') throw new HttpError(405, 'Not allowed.');

  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const db = env.DB;
  const A = { env, db, user, url, request, ctx };

  if (parts[0] === 'me' && method === 'GET') {
    const open = user.role === 'maintainer' ? (await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status != 'done'").first())?.n || 0 : 0;
    return json({ email: user.email, role: user.role, support: supportInfo(env), site: { url: publicBase(env) }, emailNotifications: emailConfigured(env), openRequests: open, pages: EDITOR_PAGES });
  }
  if (parts[0] === 'listings') {
    if (parts.length === 1 && method === 'GET') return json(await listListings(A));
    if (parts.length === 1 && method === 'POST') return idempotent(A, () => createListing(A));
    const id = parts[1];
    if (!/^lst-[a-z0-9]{6,32}$/.test(id || '')) throw new HttpError(404, 'Listing not found.');
    if (parts.length === 2 && method === 'GET') return json(view(await getListing(db, id), env));
    if (parts.length === 2 && method === 'PUT') return json(await saveFields(A, id));
    if (parts[2] === 'preview' && method === 'GET') return previewHtml(A, id);
    if (parts[2] === 'photos' && parts.length === 3 && method === 'POST') return idempotent(A, () => addPhoto(A, id));
    if (parts[2] === 'photos' && parts.length === 3 && method === 'PUT') return json(await arrangePhotos(A, id));
    if (parts[2] === 'photos' && parts.length === 4 && method === 'DELETE') return json(await removePhoto(A, id, parts[3]));
    if (parts[2] === 'photos' && parts[4] === 'replace' && method === 'POST') return idempotent(A, () => replacePhoto(A, id, parts[3]));
    if (parts[2] === 'publish' && method === 'POST') return idempotent(A, () => publish(A, id, {}));
    if (parts[2] === 'status' && method === 'POST') return idempotent(A, () => changeStatusAndPublish(A, id));
    if (parts[2] === 'takedown' && method === 'POST') return idempotent(A, () => takeDown(A, id));
    if (parts[2] === 'restore' && method === 'POST') return idempotent(A, () => publish(A, id, { restoring: true }));
    if (parts[2] === 'discard' && method === 'POST') return json(await discardDraft(A, id));
  }
  if (parts[0] === 'homepage') return homepageHandler()(A, parts, method);
  if (parts[0] === 'reviews') return reviewsHandler()(A, parts, method, idempotent);
  if (parts[0] === 'text') return textHandler()(A, parts, method, idempotent);
  if (parts[0] === 'photo' && method === 'GET') return servePhoto(A, parts[1], parts[2], parts[3]);
  if (parts[0] === 'publish-status' && method === 'GET') return json(await publishStatus(A, parts[1]));
  if (parts[0] === 'publish-retry' && method === 'POST') return json(await publishRetry(A, parts[1]));
  if (parts[0] === 'requests') {
    if (parts.length === 1 && method === 'GET') return json(await listRequests(A));
    if (parts.length === 1 && method === 'POST') return idempotent(A, () => createRequest(A));
    if (parts.length === 2 && method === 'PUT') return json(await updateRequest(A, parts[1]));
    if (parts[2] === 'photo' && method === 'GET') return serveRequestPhoto(A, parts[1], parts[3]);
  }
  throw new HttpError(404, 'Not found.');
}

/* ---------- helpers ---------- */

let _reviews;
function reviewsHandler() {
  return (_reviews ||= reviewsRoutes({ HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent, publicBase }));
}

let _text;
function textHandler() {
  return (_text ||= textRoutes({ HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent, publicBase }));
}

let _homepage;
function homepageHandler() {
  return (_homepage ||= homepageRoutes({ HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent, idempotent, publicBase }));
}

function emailConfigured(env) { return !!(env.RESEND_API_KEY && String(env.NOTIFY_TO || '').trim()); }

function supportInfo(env) {
  return { name: env.SUPPORT_NAME || 'James McKenna', email: env.SUPPORT_EMAIL || '', phone: env.SUPPORT_PHONE || '' };
}
function publicBase(env) { return (env.PUBLIC_SITE_URL || '').replace(/\/$/, ''); }

async function logEvent(A, action, listingId = null, detail = null) {
  await A.db.prepare('INSERT INTO events (at, actor, listing_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(now(), A.user.email, listingId, action, detail ? JSON.stringify(detail).slice(0, 2000) : null).run();
}

async function rateLimit(A, kind) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const row = await A.db.prepare("SELECT COUNT(*) AS n FROM events WHERE actor = ? AND at > ? AND action LIKE ?").bind(A.user.email, since, kind + '%').first();
  if ((row?.n || 0) >= DAILY_LIMITS[kind]) throw new HttpError(429, 'That is a lot of changes for one day, so the editor paused to be safe. Please contact James if you need more today.');
}

/** Same request sent twice (double tap, flaky signal) returns the first result instead of doing it twice. */
async function idempotent(A, fn) {
  const key = A.request.headers.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new HttpError(400, 'Please refresh the page and try again.');
  const k = `${A.user.email}:${key}`;
  const existing = await A.db.prepare('SELECT response FROM idem WHERE key = ?').bind(k).first();
  if (existing) {
    if (existing.response) return json(JSON.parse(existing.response));
    throw new HttpError(409, 'This is still being processed. Please wait a moment.');
  }
  await A.db.prepare('INSERT INTO idem (key, actor, created_at) VALUES (?, ?, ?)').bind(k, A.user.email, Date.now()).run();
  try {
    const result = await fn();
    await A.db.prepare('UPDATE idem SET response = ? WHERE key = ?').bind(JSON.stringify(result), k).run();
    A.ctx?.waitUntil?.(A.db.prepare('DELETE FROM idem WHERE created_at < ?').bind(Date.now() - 2 * 86400_000).run());
    return json(result);
  } catch (e) {
    await A.db.prepare('DELETE FROM idem WHERE key = ?').bind(k).run(); // allow a real retry
    throw e;
  }
}

async function getListing(db, id) {
  const row = await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Listing not found.');
  return { ...row, draft: JSON.parse(row.draft), live: row.live ? JSON.parse(row.live) : null };
}

function stripForCompare(d) { return d ? JSON.stringify({ ...d, photos: (d.photos || []).map((p) => [p.id, p.alt || '']) }) : ''; }

function view(r, env) {
  const dirty = r.visibility !== 'published' ? true : stripForCompare(r.draft) !== stripForCompare(r.live);
  return {
    id: r.id, slug: r.slug, revision: r.revision, visibility: r.visibility,
    draft: r.draft, live: r.live, hasUnpublishedChanges: r.visibility === 'published' ? dirty : r.visibility === 'draft',
    lastCommit: r.last_commit, isTest: !!r.is_test, updatedAt: r.updated_at, updatedBy: r.updated_by,
    publicUrl: r.slug && r.visibility !== 'draft' ? `${publicBase(env)}/listings/${r.slug}/` : null,
  };
}

/** Write with an optimistic-concurrency check: fails if someone else saved first. */
async function writeListing(A, r, changes, expectedRevision) {
  const fields = { ...changes, updated_at: now(), updated_by: A.user.email };
  const cols = Object.keys(fields);
  const vals = cols.map((c) => (c === 'draft' || c === 'live') && fields[c] !== null && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]);
  const res = await A.db.prepare(`UPDATE listings SET ${cols.map((c) => `${c} = ?`).join(', ')}, revision = revision + 1 WHERE id = ? AND revision = ?`)
    .bind(...vals, r.id, expectedRevision).run();
  if (!res.meta.changes) {
    throw new HttpError(409, 'This listing was changed on another computer since you opened it. Your typing is still on screen — click "Reload latest" to see the newest version, then re-apply your change.', { conflict: true });
  }
  return getListing(A.db, r.id);
}

function needRevision(body) {
  const rev = Number(body?.baseRevision);
  if (!Number.isInteger(rev) || rev < 1) throw new HttpError(400, 'Please refresh the page and try again.');
  return rev;
}

async function readJsonBody(request, max = 64 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'That was too much text to save at once.');
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'That was too much text to save at once.');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Please refresh the page and try again.'); }
}

/* ---------- listings ---------- */

async function listListings(A) {
  let syncNote = null;
  try { await syncFromRepo(A); } catch (e) { console.error('sync failed', e.message); syncNote = 'Could not check the website for outside changes just now; showing what the editor has.'; }
  const rows = (await A.db.prepare('SELECT * FROM listings ORDER BY updated_at DESC').all()).results;
  return {
    syncNote,
    listings: rows.map((row) => {
      const r = { ...row, draft: JSON.parse(row.draft), live: row.live ? JSON.parse(row.live) : null };
      const v = view(r, A.env);
      return { id: v.id, slug: v.slug, revision: v.revision, visibility: v.visibility, address: r.draft.address, status: r.draft.status, liveStatus: r.live?.status || null, price: r.draft.price, cover: r.draft.photos?.[0]?.id || null, hasUnpublishedChanges: v.hasUnpublishedChanges, isTest: v.isTest, updatedAt: v.updatedAt, publicUrl: v.publicUrl };
    }),
  };
}

/** Pick up listings that were added or edited directly in the repo (e.g. by an AI assistant). */
async function syncFromRepo(A) {
  if (!A.env.GITHUB_TOKEN) return;
  const gh = github(A.env);
  const files = await gh.listDir('content/listings');
  for (const f of files) {
    const m = f.name.match(/^(lst-[a-z0-9]{6,32})\.json$/);
    if (!m) continue;
    const existing = await A.db.prepare('SELECT id, repo_sha, published_revision, revision FROM listings WHERE id = ?').bind(m[1]).first();
    const file = await gh.getFile(f.path);
    if (!file || (existing && existing.repo_sha === file.sha)) continue;
    const pub = JSON.parse(new TextDecoder().decode(file.bytes));
    if (validatePublicListing(pub).length) continue;
    if (existing && existing.published_revision >= pub.revision) {
      await A.db.prepare('UPDATE listings SET repo_sha = ? WHERE id = ?').bind(file.sha, pub.id).run();
      continue;
    }
    // Copy photo bytes into private storage so later edits/restores work without the repo.
    for (const p of pub.photos) {
      for (const [k, path] of [['large', p.large], ['small', p.small]]) {
        if (await A.env.PHOTOS.get(`img:${pub.id}:${p.id}:${k}`, 'arrayBuffer')) continue;
        const img = await gh.getFile(`public${path}`);
        if (img) await A.env.PHOTOS.put(`img:${pub.id}:${p.id}:${k}`, img.bytes);
      }
    }
    const fields = { address: pub.address, status: pub.status, price: pub.price, beds: pub.beds, baths: pub.baths, sqft: pub.sqft, description: pub.description || '', mls: pub.mls || '', photos: pub.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, alt: p.alt || '' })) };
    if (!existing) {
      await A.db.prepare('INSERT INTO listings (id, slug, revision, visibility, draft, live, published_revision, repo_sha, is_test, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(pub.id, pub.slug, pub.revision, 'published', JSON.stringify(fields), JSON.stringify(fields), pub.revision, file.sha, pub.isTest ? 1 : 0, pub.updatedAt, pub.updatedAt, 'repo').run();
    } else {
      const cur = await getListing(A.db, pub.id);
      const draftUntouched = stripForCompare(cur.draft) === stripForCompare(cur.live);
      await A.db.prepare('UPDATE listings SET live = ?, draft = ?, published_revision = ?, revision = ?, visibility = ?, repo_sha = ?, slug = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(JSON.stringify(fields), JSON.stringify(draftUntouched ? fields : cur.draft), pub.revision, Math.max(cur.revision + 1, pub.revision), 'published', file.sha, pub.slug, now(), 'repo', pub.id).run();
    }
    await logEvent(A, 'sync-import', pub.id, { revision: pub.revision });
  }
}

async function createListing(A) {
  await rateLimit(A, 'save');
  const body = await readJsonBody(A.request);
  const { listing, errors } = normaliseFields(body.fields || {});
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted boxes.', { fieldErrors: errors });
  const id = randomId('lst-', 10);
  const draft = { ...listing, photos: [] };
  const t = now();
  const isTest = /\bTEST\b/i.test(listing.address.street) ? 1 : 0;
  await A.db.prepare('INSERT INTO listings (id, revision, visibility, draft, is_test, created_at, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'draft', JSON.stringify(draft), isTest, t, t, A.user.email).run();
  await logEvent(A, 'save-create', id);
  return view(await getListing(A.db, id), A.env);
}

async function saveFields(A, id) {
  await rateLimit(A, 'save');
  const body = await readJsonBody(A.request);
  const rev = needRevision(body);
  const r = await getListing(A.db, id);
  const { listing, errors } = normaliseFields(body.fields || {});
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted boxes.', { fieldErrors: errors });
  const draft = { ...r.draft, ...listing, photos: r.draft.photos };
  const updated = await writeListing(A, r, { draft }, rev);
  await logEvent(A, 'save-fields', id);
  return view(updated, A.env);
}

async function discardDraft(A, id) {
  const body = await readJsonBody(A.request);
  const rev = needRevision(body);
  const r = await getListing(A.db, id);
  if (!r.live) throw new HttpError(400, 'This listing has never been published, so there is nothing to go back to.');
  const updated = await writeListing(A, r, { draft: r.live }, rev);
  await logEvent(A, 'save-discard', id);
  return view(updated, A.env);
}

/* ---------- photos ---------- */

async function readPhotoForm(A) {
  const len = Number(A.request.headers.get('content-length') || 0);
  if (len > 32 * 1024 * 1024) throw new HttpError(413, 'That photo is too large to upload. Please try a different photo.');
  let form;
  try { form = await A.request.formData(); } catch { throw new HttpError(400, 'The photo did not arrive completely. Please check your signal and try again.'); }
  const get = async (name) => { const f = form.get(name); return f && typeof f !== 'string' ? new Uint8Array(await f.arrayBuffer()) : null; };
  const large = validateVariant('large', await get('large'));
  if (large.error) throw new HttpError(422, large.error);
  const small = validateVariant('small', await get('small'));
  if (small.error) throw new HttpError(422, small.error);
  const original = await get('original');
  let origOk = null;
  if (original) { const o = validateOriginal(original); if (!o.error) origOk = { bytes: original, type: o.type }; }
  const alt = String(form.get('alt') || '').slice(0, LIMITS.alt);
  return { large, small, original: origOk, alt, baseRevision: Number(form.get('baseRevision')) };
}

async function storePhoto(A, listingId, pid, p) {
  await A.env.PHOTOS.put(`img:${listingId}:${pid}:large`, p.large.bytes);
  await A.env.PHOTOS.put(`img:${listingId}:${pid}:small`, p.small.bytes);
  if (p.original) await A.env.PHOTOS.put(`orig:${listingId}:${pid}`, p.original.bytes, { metadata: { type: p.original.type, by: A.user.email, at: now() } });
}

async function addPhoto(A, id) {
  await rateLimit(A, 'upload');
  const p = await readPhotoForm(A);
  if (!Number.isInteger(p.baseRevision)) throw new HttpError(400, 'Please refresh the page and try again.');
  let r = await getListing(A.db, id);
  if (r.draft.photos.length >= LIMITS.maxPhotos) throw new HttpError(422, `A listing can have up to ${LIMITS.maxPhotos} photos.`);
  const pid = randomId('p-', 10);
  await storePhoto(A, id, pid, p);
  // Photos are added one by one; retry a few times if another photo upload landed first.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      r = await getListing(A.db, id);
      const draft = { ...r.draft, photos: [...r.draft.photos, { id: pid, width: p.large.width, height: p.large.height, alt: p.alt }] };
      const updated = await writeListing(A, r, { draft }, r.revision);
      await logEvent(A, 'upload-photo', id, { pid });
      return view(updated, A.env);
    } catch (e) { if (!(e instanceof HttpError && e.status === 409)) throw e; }
  }
  throw new HttpError(409, 'Too many changes at once. Please try again.');
}

async function replacePhoto(A, id, pid) {
  await rateLimit(A, 'upload');
  const p = await readPhotoForm(A);
  const r = await getListing(A.db, id);
  const idx = r.draft.photos.findIndex((x) => x.id === pid);
  if (idx < 0) throw new HttpError(404, 'That photo is no longer on this listing. Please refresh.');
  const newId = randomId('p-', 10);
  await storePhoto(A, id, newId, p);
  const photos = r.draft.photos.slice();
  photos[idx] = { id: newId, width: p.large.width, height: p.large.height, alt: p.alt || photos[idx].alt };
  const updated = await writeListing(A, r, { draft: { ...r.draft, photos } }, p.baseRevision);
  await logEvent(A, 'upload-replace', id, { from: pid, to: newId });
  return view(updated, A.env);
}

async function arrangePhotos(A, id) {
  const body = await readJsonBody(A.request);
  const rev = needRevision(body);
  const r = await getListing(A.db, id);
  const order = Array.isArray(body.order) ? body.order : [];
  const byId = new Map(r.draft.photos.map((p) => [p.id, p]));
  if (order.length !== byId.size || !order.every((x) => byId.has(x))) throw new HttpError(409, 'The photos changed since you opened this page. Please tap "Reload latest".', { conflict: true });
  const alts = body.alts && typeof body.alts === 'object' ? body.alts : {};
  const photos = order.map((pid) => ({ ...byId.get(pid), alt: typeof alts[pid] === 'string' ? alts[pid].slice(0, LIMITS.alt) : byId.get(pid).alt }));
  const updated = await writeListing(A, r, { draft: { ...r.draft, photos } }, rev);
  await logEvent(A, 'save-photos', id);
  return view(updated, A.env);
}

async function removePhoto(A, id, pid) {
  const rev = Number(A.url.searchParams.get('baseRevision'));
  if (!Number.isInteger(rev)) throw new HttpError(400, 'Please refresh the page and try again.');
  const r = await getListing(A.db, id);
  const photos = r.draft.photos.filter((p) => p.id !== pid);
  if (photos.length === r.draft.photos.length) throw new HttpError(404, 'That photo was already removed.');
  // Bytes are kept (not deleted) so a published listing or a restore can still use them.
  const updated = await writeListing(A, r, { draft: { ...r.draft, photos } }, rev);
  await logEvent(A, 'save-photo-remove', id, { pid });
  return view(updated, A.env);
}

async function servePhoto(A, listingId, pid, size) {
  if (!/^lst-[a-z0-9]{6,32}$/.test(listingId || '') || !/^p-[a-z0-9]{6,32}$/.test(pid || '') || !['large', 'small'].includes(size)) throw new HttpError(404, 'Not found.');
  const bytes = await A.env.PHOTOS.get(`img:${listingId}:${pid}:${size}`, 'arrayBuffer');
  if (!bytes) throw new HttpError(404, 'Photo not found.');
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'inline' } });
}

/* ---------- preview ---------- */

function toPublic(r, draft, revision) {
  return {
    id: r.id,
    slug: r.slug || uniqueSlugCandidate(draft.address),
    revision,
    status: draft.status,
    address: draft.address,
    price: draft.price, beds: draft.beds, baths: draft.baths, sqft: draft.sqft,
    description: draft.description || '',
    ...(draft.mls ? { mls: draft.mls } : {}),
    ...(r.is_test ? { isTest: true } : {}),
    photos: draft.photos.map((p) => ({ id: p.id, large: `/listings/${r.id}/${p.id}-1800.jpg`, small: `/listings/${r.id}/${p.id}-900.jpg`, width: p.width, height: p.height, alt: p.alt || '' })),
    updatedAt: now(),
  };
}
function uniqueSlugCandidate(address) { return listingSlug(address) || 'home'; }

async function previewHtml(A, id) {
  const r = await getListing(A.db, id);
  if (!r.draft.photos.length) {
    return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;padding:2rem">Add at least one photo to see a preview.</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const pub = toPublic(r, r.draft, r.revision);
  const siteBase = publicBase(A.env);
  const ctx = {
    site: siteContent, text: textContent, preview: true, siteUrl: '', buildId: 'preview-' + Date.now(), listings: [], testimonials: [], removed: [],
    url: (p) => {
      const m = p.match(/^\/listings\/(lst-[a-z0-9]+)\/(p-[a-z0-9]+)-(1800|900)\.jpg$/);
      if (m) return `/api/photo/${m[1]}/${m[2]}/${m[3] === '1800' ? 'large' : 'small'}`;
      return siteBase + p;
    },
  };
  const html = layout(ctx, { path: `/listings/${pub.slug}/`, title: `Preview: ${pub.address.street}`, body: listingDetail(ctx, pub, { previewDraft: true }) });
  const origin = siteBase ? new URL(siteBase).origin : "'self'";
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; img-src 'self' ${origin}; style-src ${origin}; font-src ${origin}; script-src ${origin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
      'X-Robots-Tag': 'noindex',
    },
  });
}

/* ---------- publishing ---------- */

async function acquireLock(A, r) {
  const t = Date.now();
  const res = await A.db.prepare('UPDATE listings SET lock_until = ? WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)').bind(t + 90_000, r.id, t).run();
  if (!res.meta.changes) throw new HttpError(409, 'This listing is already being published. Please wait a minute.');
}
async function releaseLock(A, id) { await A.db.prepare('UPDATE listings SET lock_until = NULL WHERE id = ?').bind(id).run(); }

async function pickSlug(A, r, draft) {
  if (r.slug) return r.slug;
  const base = uniqueSlugCandidate(draft.address);
  for (let n = 1; n < 50; n++) {
    const s = n === 1 ? base : `${base}-${n}`;
    const clash = await A.db.prepare('SELECT id FROM listings WHERE slug = ? AND id != ?').bind(s, r.id).first();
    if (!clash) return s;
  }
  return `${base}-${r.id.slice(4, 10)}`;
}

async function readRemoved(gh) {
  const t = await gh.getText('content/removed.json');
  return t ? JSON.parse(t) : { items: [] };
}

async function publish(A, id, { restoring = false, statusOverride = null } = {}) {
  await rateLimit(A, 'publish');
  if (!A.env.GITHUB_TOKEN) throw new HttpError(503, 'Publishing is not connected yet. Your changes are saved as a draft. Please tell James.');
  const body = await readJsonBody(A.request);
  const rev = needRevision(body);
  let r = await getListing(A.db, id);
  if (r.revision !== rev) throw new HttpError(409, 'This listing was changed on another computer since you opened it. Click "Reload latest" first.', { conflict: true });
  const draft = statusOverride ? { ...r.draft, status: statusOverride } : r.draft;
  const { errors } = normaliseFields(draft);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted boxes before publishing.', { fieldErrors: errors });
  if (!draft.photos.length) throw new HttpError(422, 'Add at least one photo before publishing.');
  await acquireLock(A, r);
  try {
    const slug = await pickSlug(A, r, draft);
    const pub = toPublic({ ...r, slug }, draft, r.revision + 1);
    const problems = validatePublicListing(pub);
    if (problems.length) throw new HttpError(422, 'Something about this listing is not ready to publish: ' + problems[0]);
    const gh = github(A.env);
    const result = await gh.commit(`${restoring ? 'Restore' : 'Publish'} listing: ${oneLineAddress(draft.address)}\n\nBy ${A.user.email} via the owner editor.`, async () => {
      const existing = new Set((await gh.listDir(`public/listings/${id}`)).map((f) => f.name));
      const wanted = new Map();
      for (const p of draft.photos) { wanted.set(`${p.id}-1800.jpg`, [p.id, 'large']); wanted.set(`${p.id}-900.jpg`, [p.id, 'small']); }
      const changes = [{ path: `content/listings/${id}.json`, content: JSON.stringify(pub, null, 2) + '\n' }];
      for (const [name, [pid, size]] of wanted) {
        if (existing.has(name)) continue;
        const bytes = await A.env.PHOTOS.get(`img:${id}:${pid}:${size}`, 'arrayBuffer');
        if (!bytes) throw new HttpError(500, 'A photo is missing from storage. Please remove it and add it again.');
        changes.push({ path: `public/listings/${id}/${name}`, content: new Uint8Array(bytes) });
      }
      for (const name of existing) if (!wanted.has(name)) changes.push({ path: `public/listings/${id}/${name}`, content: null });
      const removed = await readRemoved(gh);
      if (removed.items.some((x) => x.slug === slug)) {
        removed.items = removed.items.filter((x) => x.slug !== slug);
        changes.push({ path: 'content/removed.json', content: JSON.stringify(removed, null, 2) + '\n' });
      }
      return changes;
    });
    // Revision is bumped by writeListing; the public file was written with revision + 1 to match.
    const updated = await writeListing(A, r, { draft, live: draft, visibility: 'published', slug, published_revision: r.revision + 1, last_commit: result.sha, lock_until: null }, r.revision);
    await logEvent(A, restoring ? 'publish-restore' : 'publish', id, { commit: result.sha, status: draft.status });
    return { listing: view(updated, A.env), commit: result.sha, checkPath: `/listings/${slug}/` };
  } finally {
    await releaseLock(A, id);
  }
}

async function changeStatusAndPublish(A, id) {
  const clone = A.request.clone();
  const body = await readJsonBody(clone);
  if (!['active', 'pending', 'sold'].includes(body.status)) throw new HttpError(400, 'Choose For Sale, Pending, or Sold.');
  const r = await getListing(A.db, id);
  if (r.visibility !== 'published') throw new HttpError(400, 'Publish this listing first, then you can change its status.');
  return publish(A, id, { statusOverride: body.status });
}

async function takeDown(A, id) {
  await rateLimit(A, 'publish');
  if (!A.env.GITHUB_TOKEN) throw new HttpError(503, 'Publishing is not connected yet. Please tell James.');
  const body = await readJsonBody(A.request);
  const rev = needRevision(body);
  const r = await getListing(A.db, id);
  if (r.revision !== rev) throw new HttpError(409, 'This listing was changed on another computer. Click "Reload latest" first.', { conflict: true });
  if (r.visibility !== 'published') throw new HttpError(400, 'This listing is not on the website.');
  await acquireLock(A, r);
  try {
    const gh = github(A.env);
    const addr = oneLineAddress((r.live || r.draft).address);
    const result = await gh.commit(`Take off website: ${addr}\n\nBy ${A.user.email} via the owner editor. Restorable from the editor's archive.`, async () => {
      const changes = [{ path: `content/listings/${id}.json`, content: null }];
      for (const f of await gh.listDir(`public/listings/${id}`)) changes.push({ path: f.path, content: null });
      const removed = await readRemoved(gh);
      removed.items = removed.items.filter((x) => x.slug !== r.slug);
      removed.items.push({ slug: r.slug, address: addr, removedAt: now() });
      changes.push({ path: 'content/removed.json', content: JSON.stringify(removed, null, 2) + '\n' });
      return changes;
    });
    const updated = await writeListing(A, r, { visibility: 'archived', last_commit: result.sha, lock_until: null }, r.revision);
    await logEvent(A, 'publish-takedown', id, { commit: result.sha });
    return { listing: view(updated, A.env), commit: result.sha, checkPath: `/listings/${r.slug}/` };
  } finally {
    await releaseLock(A, id);
  }
}

/** Is a published change actually live? Only says "live" after the website itself reports it. */
async function publishStatus(A, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new HttpError(400, 'Bad request.');
  const base = publicBase(A.env);
  const gh = github(A.env);
  let deployedBuild = null;
  try {
    const v = await fetch(`${base}/version.json?t=${Date.now()}`, { cf: { cacheTtl: 0 }, headers: { 'Cache-Control': 'no-cache' } });
    if (v.ok) deployedBuild = (await v.json()).build;
  } catch { /* site unreachable: treat as still publishing */ }
  if (deployedBuild === sha || (deployedBuild && await isAncestor(A, sha, deployedBuild))) return { state: 'live' };
  let wf = 'unknown';
  try { wf = await gh.workflowState(sha); } catch { /* ignore */ }
  if (wf === 'failure') return { state: 'failed' };
  return { state: 'publishing', workflow: wf };
}

async function isAncestor(A, sha, head) {
  const res = await fetch(`${A.env.GITHUB_API || 'https://api.github.com'}/repos/${A.env.GITHUB_REPO}/compare/${sha}...${head}`, {
    headers: { Authorization: `Bearer ${A.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dan-mckenna-homes-owner-editor' },
  });
  if (!res.ok) return false;
  const c = await res.json();
  return c.status === 'ahead' || c.status === 'identical';
}

async function publishRetry(A, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new HttpError(400, 'Bad request.');
  await github(A.env).rerun(sha);
  await logEvent(A, 'publish-retry', null, { sha });
  return { ok: true };
}

/* ---------- change requests ---------- */

async function createRequest(A) {
  await rateLimit(A, 'request');
  let form;
  try { form = await A.request.formData(); } catch { throw new HttpError(400, 'Your request did not arrive completely. Please check your signal and try again.'); }
  const message = String(form.get('message') || '').trim().slice(0, 4000);
  const kind = form.get('kind') === 'question' ? 'question' : 'change';
  const page = String(form.get('page') || '').slice(0, 80);
  if (message.length < 3) throw new HttpError(422, 'Please describe what you would like changed.', { fieldErrors: { message: 'Please describe what you would like changed.' } });
  const files = form.getAll('photo').filter((f) => f && typeof f !== 'string').slice(0, 3);
  const photos = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!bytes.length) continue;
    const v = validateVariant('large', bytes);
    if (v.error) throw new HttpError(422, v.error, { fieldErrors: { photo: v.error } });
    photos.push(v.bytes);
  }
  const id = randomId('req-', 8);
  await A.db.prepare('INSERT INTO requests (id, created_at, created_by, kind, page, message, photos) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, now(), A.user.email, kind, page, message, photos.length).run();
  for (let i = 0; i < photos.length; i++) await A.env.PHOTOS.put(`req:${id}:${i}`, photos[i]);
  await logEvent(A, 'request-create', null, { id });
  const notified = await notifyMaintainer(A, { id, kind, page, message, photos });
  if (notified) await A.db.prepare('UPDATE requests SET notified = 1 WHERE id = ?').bind(id).run();
  const support = supportInfo(A.env);
  const first = (support.name || 'James').split(' ')[0];
  let reply;
  if (!emailConfigured(A.env)) {
    // No email set up on purpose: the request is saved where James sees it when he signs in.
    reply = `Saved. ${first} will see this in his editor. Send him a quick text so he knows to look.${support.phone ? ` (${support.phone})` : ''} Nothing on the website changes until you approve it.`;
  } else if (notified) {
    reply = `Sent. ${first} got your ${kind === 'question' ? 'question' : 'request'} by email and will reply to ${A.user.email}. Nothing on the website changes until you approve it.`;
  } else {
    reply = `Saved, but the email to ${first} did not go through. Please ${support.phone ? `call or text ${support.phone}` : `email ${support.email}`} and mention request ${id}.`;
  }
  return { id, notified, saved: true, emailConfigured: emailConfigured(A.env), message: reply };
}

async function notifyMaintainer(A, req) {
  const to = String(A.env.NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!A.env.RESEND_API_KEY || !to.length) return false;
  const lines = [
    `${req.kind === 'question' ? 'QUESTION (do not publish anything without approval)' : 'CHANGE REQUEST'} from ${A.user.email}`,
    req.page ? `Page: ${req.page}` : '',
    '', req.message, '',
    `Request id: ${req.id}`,
    `Open the editor to mark it in progress/done: ${A.url.origin}/#requests`,
  ].filter((x) => x !== null);
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${A.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: A.env.NOTIFY_FROM || 'Dan McKenna Homes editor <onboarding@resend.dev>',
        to, reply_to: A.user.email,
        subject: `[Website ${req.kind}] ${req.message.slice(0, 60)}`,
        text: lines.join('\n'),
        attachments: req.photos.map((b, i) => ({ filename: `photo-${i + 1}.jpg`, content: toB64(b) })),
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function listRequests(A) {
  const q = A.user.role === 'maintainer'
    ? A.db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 100')
    : A.db.prepare('SELECT * FROM requests WHERE created_by = ? ORDER BY created_at DESC LIMIT 100').bind(A.user.email);
  return { requests: (await q.all()).results };
}

async function updateRequest(A, id) {
  if (A.user.role !== 'maintainer') throw new HttpError(403, 'Only James can update request status.');
  const body = await readJsonBody(A.request);
  if (!['received', 'working', 'done'].includes(body.status)) throw new HttpError(400, 'Bad status.');
  const reply = String(body.reply || '').slice(0, 2000);
  const res = await A.db.prepare('UPDATE requests SET status = ?, reply = ? WHERE id = ?').bind(body.status, reply, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Request not found.');
  await logEvent(A, 'request-update', null, { id, status: body.status });
  return { ok: true };
}

async function serveRequestPhoto(A, id, n) {
  const row = await A.db.prepare('SELECT created_by FROM requests WHERE id = ?').bind(id).first();
  if (!row || (A.user.role !== 'maintainer' && row.created_by !== A.user.email)) throw new HttpError(404, 'Not found.');
  const bytes = await A.env.PHOTOS.get(`req:${id}:${Number(n) || 0}`, 'arrayBuffer');
  if (!bytes) throw new HttpError(404, 'Not found.');
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
}

export { sniffType };
