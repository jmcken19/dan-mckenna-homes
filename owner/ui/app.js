// Dan McKenna Homes – website editor (runs on Dan's phone).
// Plain JavaScript, no build step. All saving happens on the server, which checks
// sign-in on every request; this file only shows screens and sends what Dan typed.
'use strict';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let me = null;
let unsavedGuard = null; // function returning true when there is unsaved typing

/* ---------------- small helpers ---------------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('en-US'));
const STATUS = { active: 'For Sale', pending: 'Pending', sold: 'Sold' };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function toast(msg, ms = 4000) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

class ApiError extends Error { constructor(status, data) { super(data?.error || 'Something went wrong.'); this.status = status; this.data = data || {}; } }

async function api(method, path, body, { idem = null } = {}) {
  const headers = { 'X-DMH-Editor': '1' };
  if (idem) headers['Idempotency-Key'] = idem;
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, { error: 'No internet connection right now. Nothing was lost — try again when you have signal.' });
  }
  if (res.redirected || (res.headers.get('content-type') || '').includes('text/html')) {
    throw new ApiError(401, { error: 'You were signed out. Tap "Sign in again" — your typing stays on this page.', signIn: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function errorNote(err) {
  const signIn = err.data?.signIn ? ' <a class="btn btn--small" href="/" target="_blank" rel="noopener">Sign in again</a>' : '';
  const reload = err.data?.conflict ? ' <button type="button" class="btn btn--small" data-reload>Reload latest</button>' : '';
  return `<div class="note note--bad" role="alert"><p>${esc(err.message)}</p>${signIn || reload ? `<p>${signIn}${reload}</p>` : ''}</div>`;
}

function supportLine() {
  const s = me?.support || {};
  const bits = [];
  if (s.phone) bits.push(`call or text <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>`);
  if (s.email) bits.push(`email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`);
  return bits.length ? `${esc(s.name || 'James')}: ${bits.join(' or ')}` : 'James';
}

function confirmBox({ title, body, yes, no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>${esc(title)}</h2><p>${body}</p><div class="dialog__btns"><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" value="yes">${esc(yes)}</button><button class="btn" value="no">${esc(no)}</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { const v = e.target.closest('button')?.value; if (v) { d.close(); resolve(v === 'yes'); d.remove(); } });
    d.addEventListener('cancel', () => { resolve(false); d.remove(); });
    d.showModal();
  });
}

function setScreen(html) {
  app.innerHTML = html;
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------------- photo processing (in the browser) ---------------- */

let heicLib = null;
function loadHeic() {
  if (heicLib) return heicLib;
  heicLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/heic2any.min.js';
    s.onload = () => (window.heic2any ? resolve(window.heic2any) : reject(new Error('heic')));
    s.onerror = () => reject(new Error('heic'));
    document.head.appendChild(s);
  });
  return heicLib;
}

function looksHeic(file) { return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || ''); }

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (first) {
    if (!looksHeic(file)) throw first;
    const heic2any = await loadHeic();
    const jpg = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return createImageBitmap(Array.isArray(jpg) ? jpg[0] : jpg, { imageOrientation: 'from-image' });
  }
}

function drawTo(bitmap, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bitmap, 0, 0, w, h);
  // Re-drawing on a canvas produces a brand-new JPEG with no camera data (no GPS location).
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve({ blob: b, width: w, height: h }) : reject(new Error('encode'))), 'image/jpeg', quality));
}

async function preparePhoto(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error('This photo is over 40 MB. Please pick a smaller one.');
  let bmp;
  try { bmp = await decode(file); } catch {
    throw new Error(looksHeic(file)
      ? 'This iPhone photo (HEIC) could not be opened on this device. Fix: on your iPhone go to Settings → Camera → Formats → "Most Compatible", or send the photo to James with "Request a website change".'
      : 'This file could not be opened as a photo. Please choose a JPG or iPhone photo.');
  }
  if (Math.min(bmp.width, bmp.height) < 300) throw new Error('This photo is too small to look good on the website.');
  const large = await drawTo(bmp, 1800, 0.82);
  const small = await drawTo(bmp, 900, 0.8);
  bmp.close?.();
  return { large, small };
}

/* ---------------- router ---------------- */

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (unsavedGuard && unsavedGuard()) { e.preventDefault(); e.returnValue = ''; } });

async function route() {
  if (unsavedGuard && unsavedGuard() && !(await confirmBox({ title: 'Leave without saving?', body: 'You have typing that is not saved yet.', yes: 'Leave anyway', no: 'Stay here', danger: true }))) {
    history.replaceState(null, '', route.last || '#/');
    return;
  }
  unsavedGuard = null;
  route.last = location.hash;
  const h = location.hash.replace(/^#\/?/, '');
  try {
    if (!me) {
      me = await api('GET', '/me');
      document.getElementById('who').textContent = `Signed in as ${me.email}`;
    }
    if (h === '' ) return startScreen();
    if (h === 'listings') return listingsScreen();
    if (h === 'new') return editScreen(null);
    if (h.startsWith('listing/')) return editScreen(h.split('/')[1]);
    if (h === 'request' || h === 'requests') return requestScreen();
    return startScreen();
  } catch (err) {
    setScreen(`<h1>Website Editor</h1>${errorNote(err)}<p class="hint">If this keeps happening, contact ${supportLine()}.</p>`);
  }
}

/* ---------------- start ---------------- */

function startScreen() {
  setScreen(`
  <h1>Hi${me.email ? '' : ''}! What would you like to do?</h1>
  <div class="note"><p><strong>Bookmark this page</strong> (or "Add to Home Screen") so you can come back to it any time.</p></div>
  <div class="big-choices">
    <a class="big-choice" href="#/listings"><strong>Manage listings</strong>Add a home, change price or photos, mark it Pending or Sold, or take it off the website.</a>
    <a class="big-choice" href="#/request"><strong>Request a website change</strong>Ask James to change anything else — text, your photo, a page — or ask a question.</a>
  </div>
  <p class="hint">See the website: <a href="${esc(me.site.url)}/" target="_blank" rel="noopener">${esc(me.site.url.replace(/^https?:\/\//, ''))}</a></p>
  <p class="hint">Need help or something isn't working? ${supportLine()}.</p>`);
}

/* ---------------- listings list ---------------- */

async function listingsScreen() {
  setScreen('<a class="back" href="#/">← Back</a><h1>Manage listings</h1><p class="loading">Loading your listings…</p>');
  const data = await api('GET', '/listings');
  const items = data.listings;
  const draw = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((l) => { const t = `${l.address.street} ${l.address.city} ${l.address.zip}`.toLowerCase(); return words.every((w) => t.includes(w)); });
    document.getElementById('results').innerHTML = shown.length ? shown.map(card).join('') : `<li class="hint">${items.length ? 'No home matches that address.' : 'No listings yet. Tap "Add a new home" to start.'}</li>`;
  };
  setScreen(`<a class="back" href="#/">← Back</a>
  <h1>Manage listings</h1>
  <a class="btn btn--primary btn--block" href="#/new">+ Add a new home</a>
  ${data.syncNote ? `<div class="note note--warn"><p>${esc(data.syncNote)}</p></div>` : ''}
  <div class="search field"><label for="q">Find a home by street address</label><input id="q" type="search" placeholder="For example: 2515 Forest Lawn" autocomplete="off"></div>
  <ul class="cards" id="results"></ul>`);
  const q = document.getElementById('q');
  q.addEventListener('input', () => draw(q.value));
  draw('');
}

function chipsFor(l) {
  const c = [];
  if (l.visibility === 'published') c.push('<span class="chip chip--live">On website</span>');
  if (l.visibility === 'draft') c.push('<span class="chip chip--draft">Draft – not on website</span>');
  if (l.visibility === 'archived') c.push('<span class="chip chip--off">Taken off website</span>');
  const st = l.status || l.draft?.status;
  if (st) c.push(`<span class="chip chip--${st === 'sold' ? 'sold' : st === 'pending' ? 'pending' : 'x'}">${STATUS[st]}</span>`);
  if (l.visibility === 'published' && l.hasUnpublishedChanges) c.push('<span class="chip chip--draft">Unpublished changes</span>');
  if (l.isTest) c.push('<span class="chip">TEST</span>');
  return c.join('');
}

function card(l) {
  const img = l.cover ? `<img src="/api/photo/${esc(l.id)}/${esc(l.cover)}/small" alt="" loading="lazy">` : '<span class="noimg">No photo yet</span>';
  return `<li><a class="card" href="#/listing/${esc(l.id)}">${img}<span><span class="card__addr">${esc(l.address.street)}</span><br><span class="card__city">${esc(l.address.city)}, ${esc(l.address.state)}${l.price ? ' · ' + money(l.price) : ''}</span><span class="chips">${chipsFor(l)}</span></span></a></li>`;
}

/* ---------------- edit / add listing ---------------- */

const FIELDS = ['street', 'city', 'state', 'zip', 'status', 'price', 'beds', 'baths', 'sqft', 'mls', 'description'];

function formValues() {
  const f = document.getElementById('lform');
  const v = (n) => f.elements[n]?.value ?? '';
  return {
    address: { street: v('street'), city: v('city'), state: v('state'), zip: v('zip') },
    status: f.querySelector('input[name=status]:checked')?.value || '',
    price: v('price'), beds: v('beds'), baths: v('baths'), sqft: v('sqft'), mls: v('mls'), description: v('description'),
  };
}

function fieldsFrom(d) {
  return { street: d.address.street, city: d.address.city, state: d.address.state, zip: d.address.zip || '', status: d.status, price: d.price ?? '', beds: d.beds ?? '', baths: d.baths ?? '', sqft: d.sqft ?? '', mls: d.mls || '', description: d.description || '' };
}

function input(name, label, val, { opt = false, mode = 'text', ph = '', auto = 'off', err } = {}) {
  return `<div class="field${err ? ' field--error' : ''}"><label for="f-${name}">${esc(label)}${opt ? ' <span class="opt">(optional)</span>' : ''}</label>
  <input id="f-${name}" name="${name}" type="text" ${mode !== 'text' ? `inputmode="${mode}"` : ''} value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="${auto}" ${err ? `aria-invalid="true" aria-describedby="e-${name}"` : ''}>
  ${err ? `<p class="err" id="e-${name}">${esc(err)}</p>` : ''}</div>`;
}

async function editScreen(id) {
  setScreen('<p class="loading">Loading…</p>');
  let L = id ? await api('GET', `/listings/${id}`) : null;
  const draftKey = `dmh-typing-${id || 'new'}`;
  let errors = {};
  let banner = '';
  let saved = L ? fieldsFrom(L.draft) : { street: '', city: '', state: 'NC', zip: '', status: 'active', price: '', beds: '', baths: '', sqft: '', mls: '', description: '' };
  let values = { ...saved };
  const backup = store.get(draftKey);
  if (backup && (backup.rev === (L?.revision || 0) || backup.rev === 'conflict') && JSON.stringify(backup.values) !== JSON.stringify(saved)) {
    values = backup.values;
    banner = backup.rev === 'conflict'
      ? '<div class="note note--warn"><p>This is the newest version, with your unsaved typing put back in the boxes. Check the boxes, then tap <strong>Save draft</strong>. Photos below are the newest ones.</p></div>'
      : '<div class="note note--warn"><p>We brought back typing you had not saved last time. Tap <strong>Save draft</strong> to keep it.</p></div>';
    if (backup.rev === 'conflict') store.set(draftKey, { rev: L?.revision || 0, values });
  }
  const pending = store.get('dmh-publishing');

  const dirty = () => document.getElementById('lform') && JSON.stringify(readForm()) !== JSON.stringify(saved);
  const readForm = () => { const f = document.getElementById('lform'); const o = {}; for (const k of FIELDS) o[k] = k === 'status' ? (f.querySelector('input[name=status]:checked')?.value || '') : (f.elements[k]?.value ?? ''); return o; };
  unsavedGuard = dirty;

  function render() {
    const d = L?.draft;
    const photos = d?.photos || [];
    const vis = L?.visibility || 'draft';
    const stateLine = !L ? 'New home – not saved yet'
      : vis === 'draft' ? 'Draft – buyers cannot see this yet'
      : vis === 'archived' ? 'Taken off the website (saved in your archive)'
      : L.hasUnpublishedChanges ? 'On the website – you have changes that are not published yet' : 'On the website – up to date';
    const E = errors;
    app.innerHTML = `
    <a class="back" href="#/listings">← All listings</a>
    <h1>${L ? esc(L.draft.address.street) : 'Add a new home'}</h1>
    <div class="chips" style="margin-bottom:1rem">${L ? chipsFor({ ...L, status: L.draft.status }) : ''}</div>
    <div id="msg">${banner}</div>
    ${pending && L && pending.id === L.id ? '<div id="pub"></div>' : '<div id="pub"></div>'}
    <form id="lform" novalidate>
      <h2>1. Address</h2>
      ${input('street', 'Street address', values.street, { ph: '123 Main Street', auto: 'address-line1', err: E.street })}
      <div class="row row--3">
        ${input('city', 'City', values.city, { ph: 'Waxhaw', auto: 'address-level2', err: E.city })}
        <div class="field${E.state ? ' field--error' : ''}"><label for="f-state">State</label><select id="f-state" name="state"><option ${values.state === 'NC' ? 'selected' : ''}>NC</option><option ${values.state === 'SC' ? 'selected' : ''}>SC</option></select>${E.state ? `<p class="err">${esc(E.state)}</p>` : ''}</div>
        ${input('zip', 'ZIP', values.zip, { opt: true, mode: 'numeric', auto: 'postal-code', err: E.zip })}
      </div>
      <h2>2. Price and status</h2>
      <fieldset class="${E.status ? 'field--error' : ''}"><legend>Status</legend><div class="radios">
        ${['active', 'pending', 'sold'].map((s) => `<label class="radio"><input type="radio" name="status" value="${s}" ${values.status === s ? 'checked' : ''}> ${STATUS[s]}</label>`).join('')}
      </div>${E.status ? `<p class="err">${esc(E.status)}</p>` : ''}</fieldset>
      ${input('price', 'Price', values.price, { opt: true, mode: 'numeric', ph: '525000', err: E.price })}
      <h2>3. Details <span class="opt">(all optional – leave blank if you don't know)</span></h2>
      <div class="row">
        ${input('beds', 'Bedrooms', values.beds, { opt: true, mode: 'numeric', err: E.beds })}
        ${input('baths', 'Bathrooms', values.baths, { opt: true, mode: 'decimal', ph: '2.5', err: E.baths })}
      </div>
      <div class="row">
        ${input('sqft', 'Square feet', values.sqft, { opt: true, mode: 'numeric', err: E.sqft })}
        ${input('mls', 'MLS number', values.mls, { opt: true, err: E.mls })}
      </div>
      <div class="field${E.description ? ' field--error' : ''}"><label for="f-description">Description <span class="opt">(optional)</span></label><textarea id="f-description" name="description" placeholder="What makes this home special?">${esc(values.description)}</textarea></div>
    </form>

    <h2>4. Photos</h2>
    ${photos.length ? '<p class="hint">The first photo is the <strong>cover photo</strong> buyers see first.</p>' : '<p class="hint">Add the cover photo first. You can choose several photos at once.</p>'}
    <ul class="photos">${photos.map((p, i) => `<li class="photo${i === 0 ? ' photo--cover' : ''}">
        <img src="/api/photo/${esc(L.id)}/${esc(p.id)}/small" alt="Photo ${i + 1}" loading="lazy">
        <div class="photo__bar">
          <span class="photo__label">${i === 0 ? '<span class="cover">★ Cover photo</span>' : `Photo ${i + 1}`}</span>
          ${i > 0 ? `<button type="button" class="btn btn--small" data-cover="${p.id}">Make cover</button>` : ''}
          ${i > 0 ? `<button type="button" class="btn btn--small" data-move="${p.id}" data-dir="-1" aria-label="Move photo ${i + 1} earlier">↑ Earlier</button>` : ''}
          ${i < photos.length - 1 ? `<button type="button" class="btn btn--small" data-move="${p.id}" data-dir="1" aria-label="Move photo ${i + 1} later">↓ Later</button>` : ''}
          <span class="btn btn--small file-btn">Replace<input type="file" accept="image/*,.heic,.heif" data-replace="${p.id}" aria-label="Replace photo ${i + 1}"></span>
          <button type="button" class="btn btn--small btn--danger" data-remove="${p.id}" aria-label="Remove photo ${i + 1}">Remove</button>
        </div></li>`).join('')}</ul>
    <span class="btn btn--dark btn--block file-btn">+ Add photos<input id="addphotos" type="file" accept="image/*,.heic,.heif" multiple aria-label="Add photos"></span>
    <ul class="upload-list" id="uploads" aria-live="polite"></ul>

    ${L && L.visibility === 'published' ? `<div class="danger-zone">
      <h2>Change status on the website</h2>
      <p class="hint">These update the website right away.</p>
      <div class="status-buttons">
        ${['active', 'pending', 'sold'].filter((s) => s !== L.live?.status).map((s) => `<button type="button" class="btn" data-status="${s}">${s === 'active' ? 'Mark For Sale' : 'Mark ' + STATUS[s]}</button>`).join('')}
      </div>
      <h2>Remove from website</h2>
      <p class="hint">Hides this home from buyers. It stays in your archive, and you can put it back any time.</p>
      <button type="button" class="btn btn--danger" data-takedown>Take off website</button>
    </div>` : ''}
    ${L && L.visibility === 'archived' ? `<div class="danger-zone"><h2>Put back on the website</h2><p class="hint">This home was taken off the website. Putting it back publishes it again exactly as shown above.</p><button type="button" class="btn btn--primary" data-restore>Put back on website</button></div>` : ''}
    ${L && L.visibility === 'published' && L.hasUnpublishedChanges ? '<p style="margin-top:1.5rem"><button type="button" class="btn btn--small" data-discard>Undo my unpublished changes</button></p>' : ''}

    <div class="actions"><p class="actions__state" id="state">${esc(stateLine)}</p><div class="actions__in">
      <button type="button" class="btn" data-save>Save draft</button>
      <button type="button" class="btn" data-preview ${photos.length ? '' : 'disabled'}>Preview</button>
      <button type="button" class="btn btn--primary" data-publish ${L && L.visibility !== 'archived' && (L.hasUnpublishedChanges || L.visibility === 'draft') ? '' : 'disabled'}>${L?.visibility === 'published' ? 'Publish changes' : 'Publish'}</button>
    </div></div>`;
    bind();
    if (store.get('dmh-publishing')?.id === L?.id) watchPublish(store.get('dmh-publishing'));
  }

  function showError(err) {
    if (err.data?.fieldErrors) { errors = err.data.fieldErrors; values = readForm(); banner = errorNote(err); render(); document.querySelector('.field--error input, .field--error select, .field--error textarea')?.focus(); return; }
    document.getElementById('msg').innerHTML = errorNote(err);
    document.getElementById('msg').scrollIntoView({ block: 'center' });
  }

  async function save({ quiet = false } = {}) {
    values = readForm();
    store.set(draftKey, { rev: L?.revision || 0, values });
    const fields = formValues();
    try {
      if (!L) {
        L = await api('POST', '/listings', { fields }, { idem: uuid() });
        store.del(draftKey);
        history.replaceState(null, '', `#/listing/${L.id}`); route.last = location.hash;
      } else {
        L = await api('PUT', `/listings/${L.id}`, { fields, baseRevision: L.revision });
        store.del(draftKey);
      }
      saved = fieldsFrom(L.draft); values = { ...saved }; errors = {};
      banner = quiet ? '' : '<div class="note note--ok"><p>Saved as a draft. Buyers will not see changes until you tap <strong>Publish</strong>.</p></div>';
      render();
      return true;
    } catch (err) { showError(err); return false; }
  }

  async function uploadFiles(files, replaceId = null) {
    if (!files.length) return;
    if (!L || dirty()) { if (!(await save({ quiet: true }))) return; }
    const list = document.getElementById('uploads');
    list.innerHTML = '';
    const rows = files.map((f, i) => { const li = document.createElement('li'); li.textContent = `Photo ${i + 1} of ${files.length}: waiting…`; list.appendChild(li); return li; });
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const li = rows[i];
      try {
        li.textContent = `Photo ${i + 1} of ${files.length}: preparing…`;
        const p = await preparePhoto(files[i]);
        li.textContent = `Photo ${i + 1} of ${files.length}: uploading…`;
        const fd = new FormData();
        fd.append('large', p.large.blob, 'large.jpg');
        fd.append('small', p.small.blob, 'small.jpg');
        if (files[i].size <= 24 * 1024 * 1024) fd.append('original', files[i], 'original');
        fd.append('baseRevision', String(L.revision));
        L = await api('POST', replaceId ? `/listings/${L.id}/photos/${replaceId}/replace` : `/listings/${L.id}/photos`, fd, { idem: uuid() });
        li.textContent = `Photo ${i + 1} of ${files.length}: ✓ added`;
      } catch (err) {
        failed++;
        li.innerHTML = `<strong>Photo ${i + 1} (${esc(files[i].name || 'photo')}) was not added:</strong> ${esc(err.message)}`;
        if (err.status === 409) { try { L = await api('GET', `/listings/${L.id}`); } catch { /* ignore */ } }
      }
    }
    const summary = list.innerHTML;
    banner = failed ? `<div class="note note--warn"><p>${files.length - failed} of ${files.length} photos added. The others are listed below with what to do.</p></div>` : `<div class="note note--ok"><p>${files.length === 1 ? 'Photo added' : files.length + ' photos added'} to the draft. Tap <strong>Publish</strong> when you're ready for buyers to see them.</p></div>`;
    values = readForm(); render();
    if (failed) document.getElementById('uploads').innerHTML = summary;
  }

  async function arrange(order) {
    try { L = await api('PUT', `/listings/${L.id}/photos`, { order, baseRevision: L.revision }); values = readForm(); banner = ''; render(); toast('Photo order saved (draft).'); }
    catch (err) { showError(err); }
  }

  async function doPublish(path, body, okVerb) {
    if (dirty()) { if (!(await save({ quiet: true }))) return; }
    const btns = app.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
    try {
      const r = await api('POST', `/listings/${L.id}/${path}`, { baseRevision: L.revision, ...body }, { idem: uuid() });
      L = r.listing; saved = fieldsFrom(L.draft); values = { ...saved }; banner = '';
      const job = { id: L.id, commit: r.commit, url: (me.site.url + r.checkPath), verb: okVerb, at: Date.now(), takedown: path === 'takedown' };
      store.set('dmh-publishing', job);
      render();
    } catch (err) { btns.forEach((b) => { b.disabled = false; }); showError(err); }
  }

  function watchPublish(job) {
    const box = document.getElementById('pub');
    if (!box) return;
    let stopped = false;
    const paint = (state) => {
      if (state === 'live') {
        box.innerHTML = `<div class="publish-panel note--ok"><h2>✓ Done – ${esc(job.verb)}</h2><p>The website now shows your change.</p><p><a class="btn btn--primary" href="${esc(job.url)}" target="_blank" rel="noopener">${job.takedown ? 'Check the old web address' : 'View updated listing'}</a></p><button type="button" class="btn btn--small" data-dismiss>OK</button></div>`;
        store.del('dmh-publishing');
      } else if (state === 'failed' || state === 'timeout') {
        box.innerHTML = `<div class="publish-panel note--bad" role="alert"><h2>Publishing didn't finish</h2><p>Your changes are saved — nothing was lost. ${state === 'timeout' ? 'It is taking much longer than usual.' : 'The website update ran into a problem.'}</p><p><button type="button" class="btn btn--primary" data-retry>Try again</button></p><p class="hint">If it fails again, contact ${supportLine()}.</p></div>`;
      } else {
        box.innerHTML = `<div class="publish-panel" role="status"><h2><span class="spinner" aria-hidden="true"></span> Your changes are being published</h2><p>This usually takes 1–3 minutes. You can leave this page — it will still finish. We'll show a link here once the website has updated.</p></div>`;
      }
      box.querySelector('[data-dismiss]')?.addEventListener('click', () => { box.innerHTML = ''; });
      box.querySelector('[data-retry]')?.addEventListener('click', async () => {
        try { await api('POST', `/publish-retry/${job.commit}`); job.at = Date.now(); store.set('dmh-publishing', job); paint('publishing'); poll(); } catch (err) { box.innerHTML = errorNote(err); }
      });
    };
    const poll = async () => {
      if (stopped || !document.body.contains(box)) return;
      if (Date.now() - job.at > 12 * 60 * 1000) return paint('timeout');
      try {
        const s = await api('GET', `/publish-status/${job.commit}`);
        if (s.state === 'live' || s.state === 'failed') return paint(s.state);
      } catch { /* keep waiting */ }
      setTimeout(poll, 6000);
    };
    paint('publishing'); poll();
    window.addEventListener('hashchange', () => { stopped = true; }, { once: true });
  }

  function bind() {
    const f = document.getElementById('lform');
    document.getElementById('msg').addEventListener('click', (e) => {
      if (e.target.matches('[data-reload]')) { store.set(draftKey, { rev: 'conflict', values: readForm() }); unsavedGuard = null; editScreen(L.id); }
    });
    f.addEventListener('input', () => store.set(draftKey, { rev: L?.revision || 0, values: readForm() }));
    f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    app.querySelector('[data-save]').addEventListener('click', () => save());
    app.querySelector('[data-preview]')?.addEventListener('click', async () => {
      if (dirty()) { if (!(await save({ quiet: true }))) return; }
      window.open(`/api/listings/${L.id}/preview`, '_blank', 'noopener');
    });
    app.querySelector('[data-publish]')?.addEventListener('click', async () => {
      const first = L?.visibility === 'draft' || !L;
      if (!(await confirmBox({ title: first ? 'Put this home on the website?' : 'Publish your changes?', body: first ? 'Buyers will be able to see this listing.' : 'Buyers will see the updated listing.', yes: 'Yes, publish' }))) return;
      doPublish('publish', {}, first ? 'the listing is on the website' : 'your changes are live');
    });
    app.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
      const s = b.dataset.status;
      const extra = L.hasUnpublishedChanges ? '<br><br>Your other unpublished changes will be published too.' : '';
      if (!(await confirmBox({ title: `Mark this home ${STATUS[s]}?`, body: `The website will show it as <strong>${STATUS[s]}</strong>.${extra}`, yes: `Yes, mark ${STATUS[s]}` }))) return;
      doPublish('status', { status: s }, `marked ${STATUS[s]}`);
    }));
    app.querySelector('[data-takedown]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Take this home off the website?', body: 'Buyers will no longer see it. Anyone with the old link sees a "no longer available" page. You can put it back later from this screen.', yes: 'Take off website', danger: true }))) return;
      doPublish('takedown', {}, 'the listing is off the website');
    });
    app.querySelector('[data-restore]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Put this home back on the website?', body: 'It will be published again as shown on this screen.', yes: 'Put it back' }))) return;
      doPublish('restore', {}, 'the listing is back on the website');
    });
    app.querySelector('[data-discard]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Undo unpublished changes?', body: 'This listing goes back to exactly what is on the website now.', yes: 'Undo changes', danger: true }))) return;
      try { L = await api('POST', `/listings/${L.id}/discard`, { baseRevision: L.revision }); saved = fieldsFrom(L.draft); values = { ...saved }; banner = '<div class="note note--ok"><p>Changes undone.</p></div>'; store.del(draftKey); render(); } catch (err) { showError(err); }
    });
    document.getElementById('addphotos').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; uploadFiles(files); });
    app.querySelectorAll('[data-replace]').forEach((inp) => inp.addEventListener('change', (e) => { const files = [...e.target.files].slice(0, 1); e.target.value = ''; uploadFiles(files, inp.dataset.replace); }));
    const ids = () => L.draft.photos.map((p) => p.id);
    app.querySelectorAll('[data-cover]').forEach((b) => b.addEventListener('click', () => { const o = ids().filter((x) => x !== b.dataset.cover); arrange([b.dataset.cover, ...o]); }));
    app.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const o = ids(); const i = o.indexOf(b.dataset.move); const j = i + Number(b.dataset.dir);
      if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; arrange(o);
    }));
    app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Remove this photo?', body: 'It is removed from the draft. Buyers keep seeing it until you publish.', yes: 'Remove photo', danger: true }))) return;
      try { L = await api('DELETE', `/listings/${L.id}/photos/${b.dataset.remove}?baseRevision=${L.revision}`); values = readForm(); banner = ''; render(); toast('Photo removed from the draft.'); } catch (err) { showError(err); }
    }));
  }

  render();
}

/* ---------------- change requests ---------------- */

async function requestScreen() {
  const data = await api('GET', '/requests');
  const maint = me.role === 'maintainer';
  const kindLabel = { change: 'Change', question: 'Question' };
  const statusLabel = { received: 'Received – James has it', working: 'James is working on it', done: 'Done' };
  setScreen(`<a class="back" href="#/">← Back</a>
  <h1>Request a website change</h1>
  <p>Tell James what you'd like in your own words. For example: <em>"On the About page, replace my headshot with this one."</em></p>
  <div id="rmsg"></div>
  <form id="rform" novalidate>
    <fieldset><legend>Is this a change or a question?</legend><div class="radios">
      <label class="radio"><input type="radio" name="kind" value="change" checked> Please make this change</label>
      <label class="radio"><input type="radio" name="kind" value="question"> Just a question – show me first, don't change anything yet</label>
    </div></fieldset>
    <div class="field"><label for="r-page">Which page? <span class="opt">(optional)</span></label>
      <select id="r-page" name="page"><option value="">Not sure / whole website</option>${['Home', 'About us', 'Listings', 'New Construction', 'Luxury Home Marketing', 'Testimonials', 'Contact'].map((p) => `<option>${p}</option>`).join('')}</select></div>
    <div class="field" id="r-message-field"><label for="r-message">What would you like?</label><textarea id="r-message" name="message" required></textarea></div>
    <div class="field" id="r-photo-field"><label for="r-photo">Attach photos <span class="opt">(optional, up to 3)</span></label><input id="r-photo" type="file" accept="image/*,.heic,.heif" multiple></div>
    <button class="btn btn--primary btn--block" type="submit">Send to James</button>
  </form>
  <p class="hint" style="margin-top:1rem">James gets this by email right away and replies to you by email. You'll also see its progress below. Nothing on the website changes until it's done.</p>
  <h2>${maint ? 'All requests' : 'Your requests'}</h2>
  <div id="rlist">${data.requests.length ? data.requests.map((r) => `<div class="req">
      <div class="req__meta">${esc(kindLabel[r.kind])} · ${new Date(r.created_at).toLocaleString()}${r.page ? ' · ' + esc(r.page) : ''}${maint ? ' · ' + esc(r.created_by) : ''}</div>
      <div class="req__msg">${esc(r.message)}</div>
      ${r.photos ? Array.from({ length: r.photos }, (_, i) => `<img src="/api/requests/${esc(r.id)}/photo/${i}" alt="Attached photo ${i + 1}">`).join('') : ''}
      <div><span class="chip ${r.status === 'done' ? 'chip--live' : 'chip--draft'}">${esc(statusLabel[r.status])}</span> ${r.notified ? '' : '<span class="chip chip--sold">Email to James failed</span>'}</div>
      ${r.reply ? `<p class="note"><strong>James:</strong> ${esc(r.reply)}</p>` : ''}
      ${maint ? `<p><select data-req="${esc(r.id)}">${Object.keys(statusLabel).map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></p>` : ''}
    </div>`).join('') : '<p class="hint">No requests yet.</p>'}</div>`);

  const form = document.getElementById('rform');
  const idem = uuid();
  unsavedGuard = () => form.elements.message.value.trim().length > 0;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const msg = document.getElementById('rmsg');
    const text = form.elements.message.value.trim();
    document.getElementById('r-message-field').classList.toggle('field--error', !text);
    if (!text) { msg.innerHTML = '<div class="note note--bad" role="alert"><p>Please describe what you would like changed.</p></div>'; form.elements.message.focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    const fd = new FormData();
    fd.append('kind', form.querySelector('input[name=kind]:checked').value);
    fd.append('page', form.elements.page.value);
    fd.append('message', text);
    try {
      for (const file of [...document.getElementById('r-photo').files].slice(0, 3)) {
        const p = await preparePhoto(file);
        fd.append('photo', p.large.blob, 'photo.jpg');
      }
      const r = await api('POST', '/requests', fd, { idem });
      unsavedGuard = null;
      msg.innerHTML = `<div class="note ${r.notified ? 'note--ok' : 'note--warn'}" role="status"><p>${esc(r.message)}</p></div>`;
      if (r.notified) { form.reset(); setTimeout(() => requestScreen().then(() => { document.getElementById('rmsg').innerHTML = `<div class="note note--ok"><p>${esc(r.message)}</p></div>`; }), 50); }
    } catch (err) {
      msg.innerHTML = errorNote(err) + `<p class="hint">Your message is still in the box. If sending keeps failing, contact ${supportLine()}.</p>`;
    } finally { btn.disabled = false; btn.textContent = 'Send to James'; }
  });
  app.querySelectorAll('[data-req]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('PUT', `/requests/${s.dataset.req}`, { status: s.value }); toast('Request status updated.'); } catch (err) { toast(err.message, 6000); }
  }));
}

route();
