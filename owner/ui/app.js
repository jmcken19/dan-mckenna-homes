// Dan McKenna Homes – website editor (runs on Dan's phone).
// Plain JavaScript, no build step. All saving happens on the server, which checks
// sign-in on every request; this file only shows screens and sends what Dan typed.
'use strict';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let me = null;
let unsavedGuard = null; // function returning true when there is unsaved typing
// Browser storage keys (a client repo may give them its own prefix).
const KEYS = { page: 'dmh-editor-page', device: 'dmh-editor-device', pub: 'dmh-publishing' };

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

// Short messages. On the edit-on-the-page screen they appear in the Publish bar (#flash), never over the page.
function toast(msg, ms = 6000) {
  clearTimeout(toast.t);
  const flash = document.getElementById('flash');
  const el = flash || toastEl;
  if (flash) toastEl.hidden = true;
  el.textContent = msg; el.hidden = false;
  toast.t = setTimeout(() => { el.hidden = true; el.textContent = ''; }, ms);
}
toast.clear = () => { clearTimeout(toast.t); toastEl.hidden = true; const f = document.getElementById('flash'); if (f) { f.hidden = true; f.textContent = ''; } };

// Saves that are still on their way (uploads, settings, reviews). Publish and Undo all wait for them.
const busy = { n: 0, subs: new Set() };
const busyChanged = () => busy.subs.forEach((f) => f());
async function busyWhile(fn) {
  busy.n++; busyChanged();
  try { return await fn(); } finally { busy.n--; busyChanged(); }
}

class ApiError extends Error { constructor(status, data) { super(data?.error || 'Something went wrong.'); this.status = status; this.data = data || {}; } }

// { free: true } = don't count this call as "a save in flight" (Publish / Undo all count themselves).
async function api(method, path, body, { idem = null, free = false } = {}) {
  if (method === 'GET' || free) return apiCall(method, path, body, idem);
  return busyWhile(() => apiCall(method, path, body, idem));
}

async function apiCall(method, path, body, idem) {
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
    throw new ApiError(401, { error: 'You were signed out. Click "Sign in again" — your typing stays on this page.', signIn: true });
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

/** One short help contact for tight spaces: "Name, 555-0100" (or the email when there is no phone). */
function supportShort() {
  const s = me?.support || {};
  const how = s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '';
  return `${esc(s.name || 'James')}${how ? ', ' + how : ''}`;
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

/** Short numbered directions shown at the top of each screen. */
function how(steps) {
  return `<div class="how"><p class="how__title">How this works</p><ol>${steps.map((x) => `<li>${x}</li>`).join('')}</ol></div>`;
}

function setScreen(html) {
  app.innerHTML = html;
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/** Photo thumbnails show the chosen "focus". Set through the style object: the editor's CSP blocks style="…". */
function applyFocus(root) {
  root.querySelectorAll('img[data-pos]').forEach((img) => { img.style.objectPosition = img.dataset.pos; });
}

// Escape closes the side panel – but never while a confirm box is open (Escape closes that box first).
let escHandler = null;
function onEscape(e) {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]') || !escHandler) return;
  // Claim the key: otherwise the browser's own Escape handling would at once close the "Leave without saving?" box we open.
  e.preventDefault();
  const h = escHandler; setTimeout(() => h(e), 0);
}
document.addEventListener('keydown', onEscape);

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


/* ---------------- publishing status (shared) ---------------- */

// Shows how a publish is going in `box` until the website reports the change. One watcher per box: starting a
// new one (a second Publish) takes over the box and the old one stops. compact = one line (the Publish bar).
function watchPublish(box, job, { compact = false, onState = null } = {}) {
  if (!box) return;
  if (!job?.commit) { toast('Nothing to publish.'); return; }
  box.dataset.commit = job.commit;
  const mine = () => box.isConnected && box.dataset.commit === job.commit;
  const paint = (state) => {
    if (!mine()) return;
    box.dataset.state = state;
    if (state === 'live') {
      box.innerHTML = compact
        ? `<p class="publine publine--ok" role="status">✓ Done – <a href="${esc(job.url)}" target="_blank" rel="noopener">view your website</a> <button type="button" class="publine__x" data-dismiss aria-label="Close this message">×</button></p>`
        : `<div class="publish-panel note--ok"><h2>✓ Done – ${esc(job.verb)}</h2><p>The website now shows your change.</p><p><a class="btn btn--primary" href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.linkLabel || (job.takedown ? 'Check the old web address' : 'View updated listing'))}</a></p><button type="button" class="btn btn--small" data-dismiss>Close</button></div>`;
      if (store.get(KEYS.pub)?.commit === job.commit) store.del(KEYS.pub);
    } else if (state === 'failed' || state === 'timeout') {
      const why = state === 'timeout' ? 'It is taking much longer than usual.' : 'The website update ran into a problem.';
      box.innerHTML = compact
        ? `<p class="publine publine--bad" role="alert">Publishing didn't finish. Your changes are saved. <button type="button" class="btn btn--small" data-retry>Try again</button></p>`
        : `<div class="publish-panel note--bad" role="alert"><h2>Publishing didn't finish</h2><p>Your changes are saved — nothing was lost. ${why}</p><p><button type="button" class="btn btn--primary" data-retry>Try again</button></p><p class="hint">If it fails again, contact ${supportLine()}.</p></div>`;
      if (compact) box.querySelector('.publine').title = `${why} If it fails again, contact ${me?.support?.name || 'your website helper'}.`;
    } else {
      box.innerHTML = compact
        ? '<p class="publine" role="status" title="Your website updates in 1–3 minutes. You can keep working meanwhile."><span class="spinner" aria-hidden="true"></span> Publishing… about 2 minutes</p>'
        : '<div class="publish-panel" role="status"><h2><span class="spinner" aria-hidden="true"></span> Your changes are being published</h2><p>This usually takes 1–3 minutes. You can leave this page — it will still finish. We\'ll show a link here once the website has updated.</p></div>';
    }
    box.querySelector('[data-dismiss]')?.addEventListener('click', () => { box.innerHTML = ''; delete box.dataset.commit; delete box.dataset.state; onState?.(null); });
    box.querySelector('[data-retry]')?.addEventListener('click', async () => {
      try { await api('POST', `/publish-retry/${job.commit}`, undefined, { free: true }); job.at = Date.now(); store.set(KEYS.pub, job); paint('publishing'); poll(); } catch (err) { if (mine()) box.innerHTML = errorNote(err); }
    });
    onState?.(state);
  };
  const poll = async () => {
    if (!mine() || box.dataset.state !== 'publishing') return;
    if (Date.now() - job.at > 12 * 60 * 1000) return paint('timeout');
    try {
      const s = await api('GET', `/publish-status/${job.commit}`);
      if (s.state === 'live' || s.state === 'failed') return paint(s.state);
    } catch { /* keep waiting */ }
    setTimeout(poll, 6000);
  };
  paint('publishing'); poll();
}

/* ---------------- drag to reorder (finger or mouse) ---------------- */
// Drag an item by its handle. Works with touch (pointer events), keeps working while the
// page scrolls, and the handle also responds to arrow keys. onDone(newOrderIds) is called
// once when the item is dropped somewhere new.
function makeSortable(list, onDone) {
  if (!list) return;
  const items = () => [...list.children].filter((li) => li.dataset.id);
  list.querySelectorAll('[data-handle]').forEach((handle) => {
    const li = handle.closest('li');
    let startOrder = null, scrollTimer = null, lastX = 0, lastY = 0;
    const check = () => {
      const target = items().find((x) => { if (x === li) return false; const r = x.getBoundingClientRect(); return lastY >= r.top && lastY <= r.bottom; });
      if (!target) return;
      const r = target.getBoundingClientRect();
      const after = lastY > r.top + r.height / 2;
      if ((after ? target.nextElementSibling : target) === li) return;
      list.insertBefore(li, after ? target.nextSibling : target);
      if (navigator.vibrate) navigator.vibrate(8);
    };
    const autoscroll = () => {
      const edge = 100, speed = 12;
      if (lastY < edge) { window.scrollBy(0, -speed); check(); }
      else if (lastY > window.innerHeight - edge) { window.scrollBy(0, speed); check(); }
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      startOrder = items().map((x) => x.dataset.id).join();
      li.classList.add('is-dragging');
      list.classList.add('is-sorting');
      lastX = e.clientX; lastY = e.clientY;
      scrollTimer = setInterval(autoscroll, 16);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!startOrder) return;
      lastX = e.clientX; lastY = e.clientY;
      check();
    });
    const finish = () => {
      if (!startOrder) return;
      clearInterval(scrollTimer);
      li.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      const order = items().map((x) => x.dataset.id);
      const changed = order.join() !== startOrder;
      startOrder = null;
      if (changed) onDone(order);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const order = items().map((x) => x.dataset.id);
      const i = order.indexOf(li.dataset.id); const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      onDone(order);
    });
  });
}

/* Drop photo files onto the upload box (computers). Tapping it still opens the photo picker. */
function makeDropZone(zone, onFiles) {
  if (!zone) return;
  const on = (e) => { e.preventDefault(); zone.classList.add('is-over'); };
  const off = () => zone.classList.remove('is-over');
  zone.addEventListener('dragenter', on);
  zone.addEventListener('dragover', on);
  zone.addEventListener('dragleave', off);
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); off();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (files.length) onFiles(files); else toast('Only photos can be added here.');
  });
}

function dropZoneHtml(id, label, sub) {
  return `<label class="dropzone" for="${id}"><span class="dropzone__big">${esc(label)}</span><span class="dropzone__sub">${esc(sub)}</span><input id="${id}" type="file" accept="image/*,.heic,.heif" multiple></label>`;
}

function handleHtml(n) {
  return `<button type="button" class="drag-handle" data-handle aria-label="Drag to move photo ${n}. Or use the up and down arrow keys."><span aria-hidden="true">⠿</span><span class="drag-handle__text">Drag</span></button>`;
}

/* ---------------- router ---------------- */

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (unsavedGuard && unsavedGuard()) { e.preventDefault(); e.returnValue = ''; } });

// Laptop only: phones see a friendly note instead of the editor (the server refuses phones too).
function isPhoneDevice() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return true;
  return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

function laptopOnlyScreen() {
  setScreen(`<h1>Please use your laptop</h1>
  <div class="note"><p>The website editor is set up for your <strong>laptop</strong>. Open the <strong>Website Editor</strong> bookmark on your laptop to change your website's photos and reviews, or to send James a change request.</p></div>
  <p class="hint">Took photos on your phone? Send them to your laptop first (for example by email or Google Photos), then add them in the editor.</p>`);
}

async function route() {
  if (isPhoneDevice()) return laptopOnlyScreen();
  if (unsavedGuard && unsavedGuard() && !(await confirmBox({ title: 'Leave without saving?', body: 'You have typing that is not saved yet.', yes: 'Leave anyway', no: 'Stay here', danger: true }))) {
    history.replaceState(null, '', route.last || '#/');
    return;
  }
  unsavedGuard = null; escHandler = null; busy.subs.clear(); toast.clear();
  route.last = location.hash;
  document.body.classList.remove('is-visual');
  const h = location.hash.replace(/^#\/?/, '');
  try {
    if (!me) {
      try { me = await api('GET', '/me'); } catch (e) { if (e.data?.laptopOnly) return laptopOnlyScreen(); throw e; }
      document.getElementById('who').textContent = `Signed in as ${me.email}`;
    }
    if (h === '') return await visualScreen();
    if (h === 'list') return startScreen();
    // Listings editing is switched off: Dan doesn't add listings himself.
    // To bring it back, restore these routes and the start-screen box.
    // if (h === 'listings') return listingsScreen();
    // if (h === 'new') return editScreen(null);
    // if (h.startsWith('listing/')) return editScreen(h.split('/')[1]);
    if (h === 'homepage') return homepageScreen();
    if (h === 'reviews') return reviewsScreen();
    if (h === 'reviews/new') return reviewEditScreen(null);
    if (h.startsWith('reviews/edit/')) return reviewEditScreen(decodeURIComponent(h.slice('reviews/edit/'.length)));
    if (h === 'request' || h === 'requests') return requestScreen();
    return startScreen();
  } catch (err) {
    setScreen(`<h1>Website Editor</h1>${errorNote(err)}<p class="hint">If this keeps happening, contact ${supportLine()}.</p>`);
  }
}


/* ---------------- edit on the page (the main editor screen) ---------------- */
// Shows the owner's real page (a private draft preview) with a ✎ button on everything they can change.
// Which buttons appear is decided by the page itself: every editable part carries data-edit="<kind>"
// (src/lib/editables.mjs). KIND_TOOLS says what each kind opens. Unknown kinds are simply skipped.
//
// Everything the owner changes is saved on the server as a private draft in a "draft source". The Publish
// bar publishes, undoes and reloads every source; panels report each saved change with
// ctx.update(sourceId, newState). A new kind adds its source here and its panel to KIND_TOOLS (docs/EDITOR.md).
// A source's server routes follow one contract: GET <api> → { revision, hasUnpublishedChanges, … },
// POST <api>/publish { baseRevision } → { [result]: newState, commit }, POST <api>/discard { baseRevision } → newState.
const DRAFT_SOURCES = [
  { id: 'homepage', what: 'photos', api: '/homepage', result: 'homepage', enabled: () => true },
  { id: 'reviews', what: 'reviews', api: '/reviews', result: 'reviews', enabled: () => me.features?.reviews !== false },
];

function draftSource(def) {
  return {
    load: () => api('GET', def.api),
    publish: async (st) => { const r = await api('POST', `${def.api}/publish`, { baseRevision: st.revision }, { idem: uuid(), free: true }); return { state: r[def.result], commit: r.commit }; },
    discard: (st) => api('POST', `${def.api}/discard`, { baseRevision: st.revision }, { free: true }),
    ...def,
  };
}

// place: 'bar' = a full-width button above the part (for big areas like a reviews section),
// 'bottom' = bottom-right corner of the part (cards, so the title and date stay readable).
const KIND_TOOLS = {
  slideshow: { title: 'Slideshow photos', button: '✎ Change slideshow', open: (body, ctx) => homepageScreen(body, { embedded: true, H: ctx.get('homepage'), onChange: (st) => ctx.update('homepage', st) }) },
  photo: { title: (key) => spotInfo()[key]?.label || 'Photo', button: '✎ Change photo', open: (body, ctx) => spotPanel(body, ctx) },
  reviews: { title: 'Reviews', button: '✎ Change reviews', barButton: '✎ Change reviews – add, change or remove', place: 'bar', open: (body, ctx) => reviewsPanel(body, ctx, null) },
  review: { title: 'Change this review', button: '✎ Change review', place: 'bottom', open: (body, ctx) => reviewsPanel(body, ctx, ctx.key) },
};

// Reviews in the side panel: the list (slug = null) or one review's form; "← All reviews" goes back to the list.
function reviewsPanel(body, ctx, slug) {
  const opts = () => ({ embedded: true, R: ctx.get('reviews'), onChange: (st) => ctx.update('reviews', st) });
  const showList = () => { if (!body.isConnected) return; ctx.setTitle('Reviews'); reviewsScreen(body, { ...opts(), edit: showForm }); };
  const showForm = (s) => { if (!body.isConnected) return; ctx.setTitle(s ? 'Change this review' : 'Add a review'); reviewEditScreen(s, body, { ...opts(), back: showList }); };
  if (slug) showForm(slug); else showList();
}

const PEN_CSS = `
[data-edit]{cursor:pointer;outline:4px solid transparent;outline-offset:3px;transition:outline-color .15s}
[data-edit=slideshow],[data-edit=reviews]{outline-offset:-4px}
[data-edit].jte-hover,[data-edit].jte-on{outline-color:#111}
.jte-pen{position:absolute;z-index:60;display:inline-flex;align-items:center;gap:.4rem;min-height:50px;margin:0;padding:.5rem 1.05rem;border:3px solid #fff;border-radius:999px;background:#111;color:#fff;font:700 18px/1.1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;text-transform:none;white-space:nowrap;box-shadow:0 0 0 2px #111,0 4px 14px rgba(0,0,0,.4);cursor:pointer}
.jte-pen:hover{background:#3a3a3a}
.jte-pen:focus-visible{outline:4px solid #ffbf47;outline-offset:3px}
.jte-pen--round{width:52px;height:52px;min-height:0;padding:0;justify-content:center;font-size:24px}
.jte-pen--bar{position:relative;z-index:auto;display:flex;width:max-content;max-width:100%;margin:0 0 14px auto}
.jte-roomy{padding-bottom:76px!important}
.preview-bar{display:none!important}`;

async function visualScreen() {
  document.body.classList.add('is-visual');
  setScreen('<p class="loading">Loading your website…</p>');
  const sources = DRAFT_SOURCES.filter((s) => s.enabled()).map(draftSource);
  const S = {}; // the newest state of every draft source, by id
  await Promise.all(sources.map(async (s) => { S[s.id] = await s.load(); }));
  const isDirty = (s) => !!S[s.id]?.hasUnpublishedChanges;
  const dirty = () => sources.some(isDirty);
  const pages = me.pages?.length ? me.pages : [{ path: '/', title: 'Home' }];
  let path = pages.some((p) => p.path === store.get(KEYS.page)) ? store.get(KEYS.page) : '/';
  let device = store.get(KEYS.device) === 'phone' ? 'phone' : 'laptop';
  let open = null; // { kind, key, label, host } – the panel that is open
  let publishing = false;
  const nothingAtAll = !Object.keys(spotInfo()).length && me.features?.slideshow === false && me.features?.reviews === false;

  app.innerHTML = `
  <div class="vis">
    <div class="vis__top">
      <div class="vis__pages" id="vpages" role="group" aria-labelledby="pages-label">
        <label class="vis__label" id="pages-label" for="pagesel">Page:</label>
        <span class="vis__pagebtns">${pages.map((p) => `<button type="button" class="seg" data-page="${esc(p.path)}" title="${esc(p.title)}">${esc(p.title)}</button>`).join('')}</span>
        <select class="vis__select" id="pagesel">${pages.map((p) => `<option value="${esc(p.path)}">${esc(p.title)}</option>`).join('')}</select>
      </div>
      <p class="vis__help">Click a <strong>✎ Change</strong> button, then <strong>Publish</strong>.</p>
      <p class="vis__more"><a href="#/list">List view</a> · <a href="#/request">Request a change${me.role === 'maintainer' && me.openRequests ? ` (${me.openRequests} waiting)` : ''}</a> · Help: ${supportShort()}</p>
    </div>
    <div id="vmsg" class="vis__msg"></div>
    <div class="vis__body" id="vbody">
      <div class="vis__stage" id="stage">
        <iframe id="frame" title="Your website, with your unpublished changes"></iframe>
        <div class="vis__over" id="over" hidden></div>
      </div>
      <aside class="drawer" id="drawer" hidden role="region" aria-labelledby="drawer-title">
        <div class="drawer__head"><h2 id="drawer-title" tabindex="-1"></h2><button type="button" class="btn btn--small btn--dark" data-close>Done</button></div>
        <div class="drawer__body" id="drawer-body"></div>
      </aside>
    </div>
    <div class="vis__bar">
      <div class="vis__device" role="group" aria-label="See it on">
        <span class="vis__label">See it on:</span>
        <button type="button" class="seg" data-device="laptop">Computer</button>
        <button type="button" class="seg" data-device="phone">Phone</button>
      </div>
      <div class="vis__status">
        <p class="actions__state" id="state"></p>
        <p class="flash" id="flash" hidden></p>
        <div id="vpub" class="vis__pub" aria-live="polite"></div>
      </div>
      <div class="vis__btns">
        <button type="button" class="btn" data-undo-all>Undo all changes</button>
        <button type="button" class="btn btn--primary btn--publish" data-publish>Publish</button>
      </div>
    </div>
  </div>`;

  const vis = app.querySelector('.vis');
  const alive = () => vis.isConnected;
  const $ = (sel) => vis.querySelector(sel);
  const frame = $('#frame'), stage = $('#stage'), vbody = $('#vbody'), over = $('#over');
  const drawer = $('#drawer'), dBody = $('#drawer-body'), dTitle = $('#drawer-title');
  const msg = $('#vmsg'), pubBox = $('#vpub'), pickerEl = $('#vpages'), pagesel = $('#pagesel');
  const publishBtn = $('[data-publish]'), undoBtn = $('[data-undo-all]');
  let keepScroll = 0, lastScroll = 0;
  let pens = new Map(); // "kind|key" → the ✎ button in the page

  const paintBar = () => {
    if (!alive()) return;
    const d = dirty(), working = busy.n > 0, pubShown = !!pubBox.dataset.state; // the publish line says it all
    $('#state').textContent = working ? 'Saving your change…' : publishing ? 'Publishing…' : d ? 'You have changes that are not on the website yet' : pubShown ? '' : 'The website is up to date';
    publishBtn.disabled = !d || working || publishing;
    undoBtn.hidden = !d;
    undoBtn.disabled = working || publishing;
    vis.querySelectorAll('[data-page]').forEach((b) => { const on = b.dataset.page === path; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    pagesel.value = path;
    vis.querySelectorAll('[data-device]').forEach((b) => { const on = b.dataset.device === device; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    stage.classList.toggle('vis__stage--phone', device === 'phone');
    fit();
  };
  busy.subs.add(paintBar);

  // The page picker is a row of buttons when they fit, otherwise one big drop-down list.
  const fitPicker = () => {
    if (!alive()) return;
    pickerEl.classList.remove('is-select');
    const row = pickerEl.querySelector('.vis__pagebtns');
    if (pages.length > 6 || row.scrollWidth > row.clientWidth + 1) pickerEl.classList.add('is-select');
  };
  // While the panel is open the website keeps its full computer width and is shown smaller (never its tablet layout).
  function fit() {
    if (!alive()) return;
    const st = frame.style;
    if (device === 'phone' || !open) { st.width = ''; st.height = ''; st.transform = ''; return; }
    const full = vbody.clientWidth - (stage.offsetWidth - stage.clientWidth);
    const scale = Math.min(1, stage.clientWidth / full);
    st.width = `${full}px`; st.height = `${stage.clientHeight / scale}px`; st.transform = scale < 1 ? `scale(${scale})` : '';
  }
  const ro = new ResizeObserver(() => { fit(); fitPicker(); });
  ro.observe(vbody); ro.observe(stage);

  const previewUrl = () => `/api/homepage/preview?edit=1&path=${encodeURIComponent(path)}&r=${sources.map((s) => S[s.id]?.revision || 0).join('.')}&t=${Date.now()}`;
  const load = (keep = false) => { keepScroll = keep ? lastScroll : 0; over.hidden = true; frame.classList.remove('is-broken'); frame.src = previewUrl(); };

  // A panel saved something: newer state replaces older (a late answer from a slow upload never wins over a newer one).
  const update = (id, st) => {
    if (!alive() || !st) return;
    if (S[id] && Number(st.revision) < Number(S[id].revision)) return;
    S[id] = st; paintBar(); load(true);
  };
  const setTitle = (t) => { dTitle.textContent = t; };
  const toolTitle = (tool, key, label) => (typeof tool.title === 'function' ? tool.title(key) : (tool.title || label));

  async function openTool(kind, key, label) {
    const tool = KIND_TOOLS[kind];
    if (!tool || !alive()) return;
    if (tool.go) { location.hash = tool.go; return; }
    if (open && open.kind === kind && open.key === key) { dTitle.focus({ preventScroll: true }); return; }
    if (!(await closeTool({ refocus: false }))) return;
    const host = document.createElement('div'); // a fresh container: a late answer for an old panel can't land here
    dBody.replaceChildren(host);
    open = { kind, key, label, host };
    setTitle(toolTitle(tool, key, label));
    drawer.hidden = false; vbody.classList.add('has-drawer');
    fit(); markOpen();
    dTitle.focus({ preventScroll: true });
    const ctx = {
      kind, key, label, alive: () => host.isConnected, setTitle: (t) => { if (host.isConnected) setTitle(t); },
      get: (id) => S[id], update,
      // older names, kept for panels written before draft sources existed
      get H() { return S.homepage; }, onChange: (st) => update('homepage', st), getR: () => S.reviews, onReviews: (st) => update('reviews', st),
    };
    try { await tool.open(host, ctx); } catch (err) { if (host.isConnected) host.innerHTML = errorNote(err); }
  }

  // Closes the panel. Asks first when there is unsaved typing; returns false if the owner wants to keep typing.
  async function closeTool({ ask = true, refocus = true } = {}) {
    if (!open) return true;
    if (ask && unsavedGuard?.() && !(await confirmBox({ title: 'Leave without saving?', body: 'You have typing that is not saved yet. It will be lost.', yes: 'Leave without saving', no: 'Keep typing', danger: true }))) return false;
    unsavedGuard = null;
    const was = open; open = null;
    if (!alive()) return true;
    drawer.hidden = true; dBody.replaceChildren(); vbody.classList.remove('has-drawer');
    fit(); markOpen();
    if (refocus) { const pen = pens.get(`${was.kind}|${was.key || ''}`); if (pen?.isConnected) pen.focus({ preventScroll: true }); else frame.focus(); }
    return true;
  }
  function markOpen() {
    const doc = frame.contentDocument; if (!doc) return;
    doc.querySelectorAll('[data-edit]').forEach((el) => el.classList.toggle('jte-on', !!open && el.dataset.edit === open.kind && (el.dataset.editKey || '') === (open.key || '')));
  }
  escHandler = () => { if (open) closeTool(); };

  async function goPage(p) {
    if (p === path && !open) return;
    if (!(await closeTool({ refocus: false }))) { paintBar(); return; }
    path = p; store.set(KEYS.page, path); toast.clear(); msg.innerHTML = '';
    lastScroll = 0; paintBar(); load();
  }

  // The innermost editable thing the editor knows (a review inside a reviews section, not an unknown kind).
  const editableAt = (t) => { let el = t.closest('[data-edit]'); while (el && !KIND_TOOLS[el.dataset.edit]) el = el.parentElement?.closest('[data-edit]'); return el; };

  // Which page of the site a link points to ("/about/"), or null if it leaves the site. Handles a site under a
  // sub-path (GitHub Pages testing link), relative links ("../contact/") and root links written without it ("/team/").
  function sitePathOf(raw) {
    const siteBase = new URL((me.site.url || location.origin) + '/');
    let u;
    try { u = new URL(raw, new URL(path.replace(/^\//, ''), siteBase)); } catch { return null; }
    if (u.origin !== siteBase.origin) return null;
    let p = u.pathname;
    if (siteBase.pathname !== '/' && p.startsWith(siteBase.pathname)) p = '/' + p.slice(siteBase.pathname.length);
    return p;
  }

  function addPen(doc, el, tool) {
    const kind = el.dataset.edit, key = el.dataset.editKey || '', label = el.dataset.editLabel || '';
    const pen = doc.createElement('button');
    pen.type = 'button'; pen.className = 'jte-pen';
    const words = tool.button.replace(/^✎\s*/, '');
    pen.setAttribute('aria-label', label ? `${words}: ${label}` : words);
    pen.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openTool(kind, key, label); });
    pens.set(`${kind}|${key}`, pen);
    if (tool.place === 'bar') {
      pen.classList.add('jte-pen--bar'); pen.textContent = tool.barButton || tool.button;
      const into = el.querySelector(':scope > .wrap, :scope > .container') || el;
      into.insertBefore(pen, into.firstChild);
      return;
    }
    const host = el.tagName === 'IMG' ? el.parentElement : el;
    const win = doc.defaultView;
    if (win.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (tool.place === 'bottom') host.classList.add('jte-roomy');
    host.appendChild(pen);
    const place = () => {
      const s = pen.style; s.top = s.left = s.right = s.bottom = s.transform = '';
      const w = el.offsetWidth, h = el.offsetHeight;
      const ox = el === host ? 0 : el.offsetLeft, oy = el === host ? 0 : el.offsetTop;
      const round = w < 200 || h < 120; // small things (a logo, a thumbnail) get a round ✎ just outside their corner
      pen.classList.toggle('jte-pen--round', round);
      pen.textContent = round ? '✎' : tool.button;
      if (round) { s.left = `${ox + w - 30}px`; s.top = `${oy - 20}px`; return; }
      if (tool.place === 'bottom') { s.right = '12px'; s.bottom = '12px'; return; }
      if (el.tagName === 'IMG' && w < 320) { s.left = `${ox + w / 2}px`; s.top = `${oy + h - pen.offsetHeight - 12}px`; s.transform = 'translateX(-50%)'; return; } // keeps a face visible
      if (el === host) { s.top = '14px'; s.right = '14px'; return; }
      s.top = `${oy + 12}px`; s.left = `${Math.max(8, ox + w - pen.offsetWidth - 12)}px`;
    };
    place();
    el.addEventListener('load', place);
    win.addEventListener('resize', place);
    if (win.ResizeObserver) new win.ResizeObserver(place).observe(el);
  }

  // Put a ✎ button on every editable thing in the page, and keep clicks inside the editor.
  frame.addEventListener('load', () => {
    if (!alive() || !frame.getAttribute('src')) return;
    let doc = null;
    try { doc = frame.contentDocument; } catch { /* another site's page */ }
    if (doc && doc.location.href === 'about:blank') return;
    if (!doc || !doc.querySelector('meta[name="editor-preview"]')) return previewFailed();
    const st = doc.createElement('style'); st.textContent = PEN_CSS; doc.head.appendChild(st);
    // Sticky and fixed bars (a site header) stay above the ✎ buttons of the page under them.
    for (const x of doc.body.querySelectorAll('*')) {
      const cs = doc.defaultView.getComputedStyle(x);
      if ((cs.position === 'sticky' || cs.position === 'fixed') && !(parseInt(cs.zIndex, 10) >= 70)) x.style.zIndex = '70';
    }
    pens = new Map();
    doc.querySelectorAll('[data-edit]').forEach((el) => { const tool = KIND_TOOLS[el.dataset.edit]; if (tool) addPen(doc, el, tool); });
    doc.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('.jte-pen') || t.closest('[data-hide-preview]')) return;
      const a = t.closest('a[href]');
      const ctl = t.closest('button, [role=button], input, select, textarea, label, summary');
      if (ctl && !(a && a.contains(ctl))) return; // the page's own buttons (pause, carousel arrows…) work normally
      const ed = editableAt(t);
      if (ed) { e.preventDefault(); openTool(ed.dataset.edit, ed.dataset.editKey || '', ed.dataset.editLabel || ''); return; }
      if (!a) return;
      const raw = a.getAttribute('href') || '';
      if (raw.startsWith('#')) { if (raw === '#') e.preventDefault(); return; } // "#faq" scrolls inside the page
      e.preventDefault();
      const to = sitePathOf(raw);
      const pg = to && pages.find((p) => p.path === to || p.path === to + '/');
      if (pg) goPage(pg.path);
      else toast('Links are paused while you edit. Use "Page" at the top to switch pages.');
    }, true);
    // Outline only the innermost editable thing under the mouse (a review, not the whole reviews page).
    let hov = null;
    doc.addEventListener('mouseover', (e) => {
      const t = editableAt(e.target);
      if (t === hov) return;
      hov?.classList.remove('jte-hover'); hov = t; hov?.classList.add('jte-hover');
    });
    doc.addEventListener('submit', (e) => { e.preventDefault(); toast('Forms are switched off while you edit.'); }, true);
    doc.addEventListener('keydown', onEscape);
    doc.defaultView.addEventListener('scroll', () => { lastScroll = doc.defaultView.scrollY; }, { passive: true });
    if (keepScroll) doc.defaultView.scrollTo(0, keepScroll);
    lastScroll = keepScroll;
    if (!pens.size) {
      over.hidden = false; over.className = 'vis__over vis__over--hint';
      over.innerHTML = nothingAtAll
        ? `<p>Nothing on your website is set up for you to change yourself yet. Contact ${supportLine()}.</p>`
        : '<p>Nothing to change on this page – try another page.</p>';
    }
    markOpen();
  });

  // The page could not be shown (signed out, server error, no internet): say so instead of a broken frame.
  async function previewFailed() {
    let why = 'error';
    try {
      const r = await fetch(frame.src, { credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
      if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) why = 'signin';
    } catch { why = navigator.onLine === false ? 'offline' : 'error'; }
    if (!alive()) return;
    frame.classList.add('is-broken');
    over.hidden = false; over.className = 'vis__over vis__over--bad';
    over.innerHTML = {
      signin: '<h2>You were signed out</h2><p>For your safety the editor signs you out after a while. Nothing was lost. Click <strong>Sign in again</strong>, sign in, then come back here and click <strong>Try again</strong>.</p><p><a class="btn btn--primary" href="/" target="_blank" rel="noopener">Sign in again</a> <button type="button" class="btn" data-retry-page>Try again</button></p>',
      offline: '<h2>No internet connection</h2><p>Your page can\'t be shown right now. Nothing was lost. Try again when you\'re back online.</p><p><button type="button" class="btn btn--primary" data-retry-page>Try again</button></p>',
      error: `<h2>Your page couldn't be shown</h2><p>Your changes are safe. Please try again in a minute.</p><p><button type="button" class="btn btn--primary" data-retry-page>Try again</button></p><p class="hint">If this keeps happening, contact ${supportLine()}.</p>`,
    }[why];
    over.setAttribute('role', 'alert');
  }

  const showError = (html) => { if (!alive()) return; msg.innerHTML = html; msg.scrollIntoView({ block: 'nearest' }); };

  // "Reload latest" anywhere (bar or panel): fetch every source again, redraw the page, reopen the panel.
  async function reloadLatest() {
    const reopen = open && { ...open };
    if (!(await closeTool({ refocus: false }))) return;
    try { await Promise.all(sources.map(async (s) => { S[s.id] = await s.load(); })); } catch (err) { return showError(errorNote(err)); }
    if (!alive()) return;
    msg.innerHTML = ''; toast.clear(); paintBar(); load();
    if (reopen) openTool(reopen.kind, reopen.key, reopen.label);
  }

  const startWatch = (commit) => {
    if (!commit) return;
    const job = { id: 'site', commit, url: me.site.url + '/', verb: 'your changes are on the website', linkLabel: 'View your website', at: Date.now() };
    store.set(KEYS.pub, job);
    watchPublish(pubBox, job, { compact: true, onState: paintBar });
  };
  const words = (list) => list.map((s) => s.what).join(' and ');
  const Words = (list) => { const w = words(list); return w.charAt(0).toUpperCase() + w.slice(1); };

  async function publishAll() {
    if (busy.n || publishing) return;
    if (unsavedGuard?.()) {
      showError('<div class="note note--warn" role="alert"><p>Please save or cancel the review you are typing first. Then click <strong>Publish</strong>.</p></div>');
      dTitle.focus({ preventScroll: true });
      return;
    }
    const todo = sources.filter(isDirty);
    if (!todo.length) return;
    if (!(await confirmBox({ title: 'Put your changes on the website?', body: `This publishes your ${esc(words(todo))} changes. Everyone visiting your website sees them in a few minutes.`, yes: 'Yes, publish' }))) return;
    publishing = true; msg.innerHTML = ''; paintBar();
    const done = [], failed = [];
    // Each source is published on its own: one going wrong never hides that another one went live.
    for (const s of todo) {
      try { const r = await s.publish(S[s.id]); if (r.state) S[s.id] = r.state; done.push(s); startWatch(r.commit); } catch (err) { failed.push({ s, err }); }
    }
    publishing = false;
    if (!alive()) return;
    if (done.length) await closeTool({ ask: false, refocus: false });
    paintBar();
    if (failed.length) {
      const err = failed[0].err;
      const extra = `${err.data?.signIn ? ' <a class="btn btn--small" href="/" target="_blank" rel="noopener">Sign in again</a>' : ''}${err.data?.conflict ? ' <button type="button" class="btn btn--small" data-reload>Reload latest</button>' : ''}`;
      showError(`<div class="note note--bad" role="alert">${done.length ? `<p>✓ ${esc(Words(done))}: being published now.</p>` : ''}<p>${esc(Words(failed.map((x) => x.s)))}: saved, but <strong>not published yet</strong>. ${esc(err.message)}</p><p><button type="button" class="btn btn--small btn--primary" data-retry-publish>Try again</button>${extra}</p></div>`);
    }
  }

  async function undoAll() {
    if (busy.n || publishing) return;
    if (!(await closeTool({ refocus: false }))) return;
    const todo = sources.filter(isDirty);
    if (!todo.length) return;
    if (!(await confirmBox({ title: 'Undo all your unpublished changes?', body: `Your changes to ${esc(words(todo))} go back to exactly what is on the website now.`, yes: 'Undo all changes', danger: true }))) return;
    publishing = true; msg.innerHTML = ''; paintBar();
    const done = [], failed = [];
    for (const s of todo) { try { S[s.id] = await s.discard(S[s.id]); done.push(s); } catch (err) { failed.push({ s, err }); } }
    publishing = false;
    if (!alive()) return;
    paintBar(); load();
    if (failed.length) {
      const err = failed[0].err;
      showError(`<div class="note note--bad" role="alert">${done.length ? `<p>✓ ${esc(Words(done))}: back to what is on the website.</p>` : ''}<p>${esc(Words(failed.map((x) => x.s)))}: could not be undone. ${esc(err.message)}</p>${err.data?.conflict ? '<p><button type="button" class="btn btn--small" data-reload>Reload latest</button></p>' : ''}</div>`);
    } else toast('Back to what is on the website now.');
  }

  vis.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => goPage(b.dataset.page)));
  pagesel.addEventListener('change', () => goPage(pagesel.value));
  vis.querySelectorAll('[data-device]').forEach((b) => b.addEventListener('click', () => { device = b.dataset.device; store.set(KEYS.device, device); paintBar(); }));
  drawer.querySelector('[data-close]').addEventListener('click', () => closeTool());
  publishBtn.addEventListener('click', publishAll);
  undoBtn.addEventListener('click', undoAll);
  // One listener for the buttons inside messages – in the bar, the page area and every panel.
  vis.addEventListener('click', (e) => {
    if (e.target.closest('[data-reload]')) { e.preventDefault(); e.stopPropagation(); reloadLatest(); }
    else if (e.target.closest('[data-retry-publish]')) { msg.innerHTML = ''; publishAll(); }
    else if (e.target.closest('[data-retry-page]')) load(true);
  });

  paintBar(); fitPicker(); load();
  const job = store.get(KEYS.pub);
  if (job?.commit && (job.id === 'site' || job.id === 'homepage' || job.id === 'reviews')) watchPublish(pubBox, job, { compact: true, onState: paintBar });
}

/* One photo spot, in the side panel: see it, replace it (click or drop), undo. */
function spotPanel(root, ctx) {
  const k = ctx.key; const info = spotInfo()[k] || {};
  const H = () => ctx.get('homepage');
  const changed = () => JSON.stringify(H().draft.photos[k]) !== JSON.stringify(H().live.photos[k]);
  const say = (html) => { if (root.isConnected) root.querySelector('#pmsg').innerHTML = html; };
  function render(msg = '') {
    if (!root.isConnected) return;
    root.innerHTML = `
      <p><label class="btn btn--primary btn--block file-btn">Replace photo<input type="file" accept="image/*,.heic,.heif" id="pfile" aria-label="Replace photo: ${esc(info.label || k)}"></label></p>
      <div id="pmsg" aria-live="polite">${msg}</div>
      <p class="hint">Or drag a photo from a folder onto the photo below. It shows on your page right away.</p>
      <div class="panel-photo" id="pp"><img src="/api/homepage/spot/${esc(k)}/img?r=${H().revision}" alt="The photo now"></div>
      ${changed() ? '<p><button type="button" class="btn btn--block" data-undo>Undo – go back to the photo on the website</button></p>' : ''}
      ${info.where ? `<p class="hint">Shows on: ${esc(info.where)}</p>` : ''}
      ${info.tip ? `<p class="hint">${esc(info.tip)}</p>` : ''}`;
    root.querySelector('#pfile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) replace(f); });
    makeDropZone(root.querySelector('#pp'), (files) => replace(files[0]));
    root.querySelector('[data-undo]')?.addEventListener('click', async () => {
      try { const st = await api('POST', `/homepage/spot/${k}/undo`, { baseRevision: H().revision }); ctx.update('homepage', st); render(); toast('Back to the photo that is on the website now.'); }
      catch (err) { say(errorNote(err)); }
    });
  }
  // The whole upload counts as "saving", so Publish waits for it.
  const replace = (file) => busyWhile(async () => {
    try {
      say('<p class="hint"><span class="spinner" aria-hidden="true"></span> Preparing your photo…</p>');
      const p = await prepareHero(file, info.min);
      say('<p class="hint"><span class="spinner" aria-hidden="true"></span> Uploading…</p>');
      const fd = new FormData();
      for (const w of [2000, 1400, 800]) fd.append(`w${w}`, p[w].blob, `w${w}.jpg`);
      if (file.size <= 24 * 1024 * 1024) fd.append('original', file, 'original');
      fd.append('baseRevision', String(H().revision));
      ctx.update('homepage', await api('POST', `/homepage/spot/${k}`, fd, { idem: uuid() }));
      if (root.isConnected) render('<div class="note note--ok"><p>✓ New photo is on your page. Click <strong>Publish</strong> when you\'re happy.</p></div>');
      else toast(`✓ Your new photo (${info.label || 'photo'}) is on your page.`);
    } catch (err) {
      // Someone else changed the photos: show the newest version, so the next try works.
      if (err.status === 409) { try { ctx.update('homepage', await api('GET', '/homepage')); render(); } catch { /* ignore */ } }
      if (root.isConnected) say(errorNote(err)); else toast(`Your photo (${info.label || 'photo'}) was not saved: ${err.message}`, 10000);
    }
  });
  render();
}

/* ---------------- start (list view) ---------------- */

const spotInfo = () => SPOT_INFO;
const SPOT_INFO = {
  headshot: { label: 'Your photo', where: 'About us page and Contact page', tip: 'A portrait photo (taller than wide) of you looks best.', min: 500, page: 'headshot' },
  construction: { label: 'New Construction page photo', where: 'New Construction page', tip: 'A wide (landscape) photo looks best.', min: 800, page: 'construction' },
  luxury: { label: 'Luxury home photo', where: 'Luxury Home Marketing page', tip: 'A wide (landscape) photo of a beautiful home looks best.', min: 1200, page: 'luxury' },
};

async function startScreen() {
  setScreen('<p class="loading">Loading your website photos…</p>');
  let H = await api('GET', '/homepage');
  let banner = '';
  const changed = (k) => JSON.stringify(H.draft.photos[k]) !== JSON.stringify(H.live.photos[k]);
  const slidesChanged = () => JSON.stringify({ ...H.draft, photos: 0 }) !== JSON.stringify({ ...H.live, photos: 0 });

  function render() {
    const d = H.draft;
    const first = d.slides[0];
    app.innerHTML = `
    <p><a class="back" href="#/">← Back to editing on the page</a></p>
    <h1>Your website (list view)</h1>
    <h2 class="section-h">Photos</h2>
    ${how(['Find the photo you want to change below.', 'Click <strong>Replace photo</strong> and pick a new one — or drag a photo from a folder onto it.', 'Click <strong>Preview</strong> to see how the page will look.', 'When you like it, click the <strong>Publish</strong> button at the bottom of the screen.'])}
    <div id="msg">${banner}</div>
    <div id="pub"></div>

    <ul class="spots">
      <li class="spot${slidesChanged() ? ' spot--changed' : ''}">
        <a class="spot__img" href="#/homepage"><img src="/api/homepage/photo/${esc(first.id)}?w=800" alt="" data-pos="${esc(first.focus)}"></a>
        <div class="spot__body">
          <h2>Homepage slideshow</h2>
          <p class="spot__where">The big photos at the top of your homepage · ${d.autoplay === false ? 'One still photo' : `Slideshow of ${d.slides.length} photo${d.slides.length === 1 ? '' : 's'}`}</p>
          ${slidesChanged() ? '<p class="chip chip--draft">Changed – not published yet</p>' : ''}
          <p><a class="btn btn--primary" href="#/homepage">Change slideshow photos</a></p>
          <p class="hint">Choose slideshow or one still photo, add or remove photos, change the order and speed.</p>
        </div>
      </li>
      ${Object.entries(SPOT_INFO).map(([k, info]) => `
      <li class="spot${changed(k) ? ' spot--changed' : ''}" data-spot="${k}">
        <div class="spot__img spot__img--${k}"><img src="/api/homepage/spot/${k}/img?r=${H.revision}" alt=""></div>
        <div class="spot__body">
          <h2>${esc(info.label)}</h2>
          <p class="spot__where">Shows on: ${esc(info.where)}</p>
          ${changed(k) ? '<p class="chip chip--draft">Changed – not published yet</p>' : ''}
          <p class="spot__btns">
            <label class="btn btn--primary file-btn">Replace photo<input type="file" accept="image/*,.heic,.heif" data-spot-file="${k}" aria-label="Replace ${esc(info.label)}"></label>
            <a class="btn" href="/api/homepage/preview?page=${info.page}" target="_blank" rel="noopener">Preview</a>
            ${changed(k) ? `<button type="button" class="btn btn--small" data-spot-undo="${k}">Undo</button>` : ''}
          </p>
          <p class="hint">${esc(info.tip)} You can also drag a photo onto this box.</p>
          <p class="spot__status" aria-live="polite"></p>
        </div>
      </li>`).join('')}
    </ul>

    <h2 class="section-h">Client reviews</h2>
    <ul class="spots"><li class="spot spot--reviews">
      <div class="spot__body">
        <h2>Client reviews</h2>
        <p class="spot__where">The reviews that slide across your homepage and fill the Testimonials page.</p>
        <p><a class="btn btn--primary" href="#/reviews">Add, edit or remove reviews</a></p>
      </div>
    </li></ul>

    <p class="hint">See your website: <a href="${esc(me.site.url)}/" target="_blank" rel="noopener">${esc(me.site.url.replace(/^https?:\/\//, ''))}</a></p>
    <p class="hint">Need something else changed on the website? Contact ${supportLine()}, or <a href="#/request">request a change</a>.</p>

    <div class="actions"><p class="actions__state">${H.hasUnpublishedChanges ? 'You have photo changes that are not on the website yet' : 'The website is up to date'}</p><div class="actions__in actions__in--1">
      <button type="button" class="btn btn--primary btn--publish" data-publish ${H.hasUnpublishedChanges ? '' : 'disabled'}>Publish</button>
    </div></div>`;
    applyFocus(app);
    bind();
    const job = store.get(KEYS.pub);
    if (job?.id === 'homepage' || job?.id === 'site') watchPublish(document.getElementById('pub'), job);
  }

  const showError = (err) => { const m = document.getElementById('msg'); m.innerHTML = errorNote(err); m.scrollIntoView({ block: 'nearest' }); };

  async function replaceSpot(k, file) {
    const li = app.querySelector(`[data-spot="${k}"]`);
    const status = li.querySelector('.spot__status');
    try {
      status.textContent = 'Preparing your photo…';
      const p = await prepareHero(file, SPOT_INFO[k].min);
      status.textContent = 'Uploading…';
      const fd = new FormData();
      for (const w of [2000, 1400, 800]) fd.append(`w${w}`, p[w].blob, `w${w}.jpg`);
      if (file.size <= 24 * 1024 * 1024) fd.append('original', file, 'original');
      fd.append('baseRevision', String(H.revision));
      H = await api('POST', `/homepage/spot/${k}`, fd, { idem: uuid() });
      banner = `<div class="note note--ok"><p>✓ New photo added to <strong>${esc(SPOT_INFO[k].label)}</strong>. Click <strong>Preview</strong> to see it, then <strong>Publish</strong> at the bottom.</p></div>`;
      render();
    } catch (err) {
      if (err.status === 409) { try { H = await api('GET', '/homepage'); } catch { /* ignore */ } }
      status.innerHTML = `<strong>That photo was not added:</strong> ${esc(err.message)}`;
    }
  }

  function bind() {
    app.querySelectorAll('[data-spot-file]').forEach((inp) => inp.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) replaceSpot(inp.dataset.spotFile, f); }));
    app.querySelectorAll('[data-spot]').forEach((li) => makeDropZone(li, (files) => replaceSpot(li.dataset.spot, files[0])));
    app.querySelectorAll('[data-spot-undo]').forEach((b) => b.addEventListener('click', async () => {
      try { H = await api('POST', `/homepage/spot/${b.dataset.spotUndo}/undo`, { baseRevision: H.revision }); banner = ''; render(); toast('Back to the photo that is on the website now.'); } catch (err) { showError(err); }
    }));
    document.getElementById('msg').addEventListener('click', async (e) => { if (e.target.matches('[data-reload]')) { try { H = await api('GET', '/homepage'); banner = ''; render(); } catch (err) { showError(err); } } });
    app.querySelector('[data-publish]').addEventListener('click', async () => {
      const list = [slidesChanged() ? 'the homepage slideshow' : null, ...Object.keys(SPOT_INFO).filter(changed).map((k) => SPOT_INFO[k].label.toLowerCase())].filter(Boolean);
      if (!(await confirmBox({ title: 'Put your new photos on the website?', body: `This updates: ${esc(list.join(', '))}.`, yes: 'Yes, publish' }))) return;
      app.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        const r = await api('POST', '/homepage/publish', { baseRevision: H.revision }, { idem: uuid(), free: true });
        H = r.homepage;
        store.set(KEYS.pub, { id: 'homepage', commit: r.commit, url: me.site.url + '/', verb: 'your photos are on the website', linkLabel: 'View your website', at: Date.now() });
        banner = ''; render();
      } catch (err) { render(); showError(err); }
    });
  }
  render();
}

/* ---------------- listings list ---------------- */

async function listingsScreen() {
  setScreen('<a class="back" href="#/">← Back</a><h1>Manage listings</h1><p class="loading">Loading your listings…</p>');
  const data = await api('GET', '/listings');
  const items = data.listings;
  const draw = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((l) => { const t = `${l.address.street} ${l.address.city} ${l.address.zip}`.toLowerCase(); return words.every((w) => t.includes(w)); });
    document.getElementById('results').innerHTML = shown.length ? shown.map(card).join('') : `<li class="hint">${items.length ? 'No home matches that address.' : 'No listings yet. Click "Add a new home" to start.'}</li>`;
  };
  setScreen(`<a class="back" href="#/">← Back</a>
  <h1>Manage listings</h1>
  ${how(['To <strong>add a home</strong>, click the red <strong>+ Add a new home</strong> button.', 'To <strong>change a home</strong> (price, photos, Sold…), click it in the list below.', 'Can\'t find it? Type part of the street address in the search box.'])}
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
      ? '<div class="note note--warn"><p>This is the newest version, with your unsaved typing put back in the boxes. Check the boxes, then click <strong>Save draft</strong>. Photos below are the newest ones.</p></div>'
      : '<div class="note note--warn"><p>We brought back typing you had not saved last time. Click <strong>Save draft</strong> to keep it.</p></div>';
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
    ${how(!L || vis === 'draft'
      ? ['Fill in the boxes (only the address and status are required).', 'Add photos in step 4. The first photo is the cover.', 'Click <strong>Save draft</strong> at the bottom to keep your work. Nobody else can see it yet.', 'Click <strong>Preview</strong> to see it like a buyer, then <strong>Publish</strong> to put it on your website.']
      : vis === 'archived'
      ? ['This home is not on your website right now.', 'To show it again, scroll down and click <strong>Put back on website</strong>.']
      : ['Change anything below – price, photos, description.', 'Click <strong>Publish changes</strong> at the bottom. Buyers see nothing new until you do.', 'To mark it <strong>Pending</strong> or <strong>Sold</strong>, scroll down to "Change status on the website".'])}
    <div id="msg">${banner}</div>
    ${pending && L && pending.id === L.id ? '<div id="pub"></div>' : '<div id="pub"></div>'}
    <form id="lform" novalidate>
      <h2>1. Address</h2>
      ${input('street', 'Street address', values.street, { ph: '123 Main Street', auto: 'address-line1', err: E.street })}
      ${input('city', 'City', values.city, { ph: 'Waxhaw', auto: 'address-level2', err: E.city })}
      <div class="row">
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
    ${photos.length > 1 ? '<p class="hint">To change the order, drag a photo by its <strong>⠿ Drag</strong> handle.</p>' : ''}
    <ul class="photos photos--rows" id="lphotos">${photos.map((p, i) => `<li class="photo${i === 0 ? ' photo--cover' : ''}" data-id="${esc(p.id)}">
        <img src="/api/photo/${esc(L.id)}/${esc(p.id)}/small" alt="Photo ${i + 1}" loading="lazy">
        <div class="photo__bar">
          ${photos.length > 1 ? handleHtml(i + 1) : ''}
          <span class="photo__label">${i === 0 ? '<span class="cover">★ Cover photo</span>' : `Photo ${i + 1}`}</span>
          ${i > 0 ? `<button type="button" class="btn btn--small" data-cover="${p.id}">Make cover</button>` : ''}
          ${i > 0 ? `<button type="button" class="btn btn--small" data-move="${p.id}" data-dir="-1" aria-label="Move photo ${i + 1} earlier">↑ Earlier</button>` : ''}
          ${i < photos.length - 1 ? `<button type="button" class="btn btn--small" data-move="${p.id}" data-dir="1" aria-label="Move photo ${i + 1} later">↓ Later</button>` : ''}
          <span class="btn btn--small file-btn">Replace<input type="file" accept="image/*,.heic,.heif" data-replace="${p.id}" aria-label="Replace photo ${i + 1}"></span>
          <button type="button" class="btn btn--small btn--danger" data-remove="${p.id}" aria-label="Remove photo ${i + 1}">Remove</button>
        </div></li>`).join('')}</ul>
    ${dropZoneHtml('addphotos', '+ Add photos', 'Click to choose photos — or drag them here from a folder')}
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
    if (L && store.get('dmh-publishing')?.id === L.id) watchPublish(document.getElementById('pub'), store.get('dmh-publishing'));
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
      banner = quiet ? '' : '<div class="note note--ok"><p>Saved as a draft. Buyers will not see changes until you click <strong>Publish</strong>.</p></div>';
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
    banner = failed ? `<div class="note note--warn"><p>${files.length - failed} of ${files.length} photos added. The others are listed below with what to do.</p></div>` : `<div class="note note--ok"><p>${files.length === 1 ? 'Photo added' : files.length + ' photos added'} to the draft. Click <strong>Publish</strong> when you're ready for buyers to see them.</p></div>`;
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
    makeDropZone(document.getElementById('addphotos').closest('.dropzone'), (files) => uploadFiles(files));
    makeSortable(document.getElementById('lphotos'), (order) => arrange(order));
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


/* ---------------- homepage photos ---------------- */

const SPEEDS = [{ label: 'Slow', sub: 'about 10 seconds each', v: 10 }, { label: 'Normal', sub: 'about 7 seconds each', v: 7 }, { label: 'Fast', sub: 'about 4 seconds each', v: 4 }];
const FOCUS = [{ label: 'Top', v: '50% 15%' }, { label: 'Middle', v: '50% 50%' }, { label: 'Bottom', v: '50% 85%' }];
const nearestFocus = (f) => { const y = Number(String(f || '').split(' ')[1]?.replace('%', '')) || 50; return FOCUS.reduce((a, b) => (Math.abs(parseInt(b.v.split(' ')[1], 10) - y) < Math.abs(parseInt(a.v.split(' ')[1], 10) - y) ? b : a)).v; };
const nearestSpeed = (n) => SPEEDS.reduce((a, b) => (Math.abs(b.v - n) < Math.abs(a.v - n) ? b : a)).v;

async function prepareHero(file, minEdge = 1200) {
  if (file.size > 40 * 1024 * 1024) throw new Error('This photo is over 40 MB. Please pick a smaller one.');
  let bmp;
  try { bmp = await decode(file); } catch {
    throw new Error(looksHeic(file) ? 'This iPhone photo (HEIC) could not be opened on this device. On your iPhone: Settings → Camera → Formats → "Most Compatible", or text the photo to James.' : 'This file could not be opened as a photo. Please choose a JPG or iPhone photo.');
  }
  if (Math.max(bmp.width, bmp.height) < minEdge) throw new Error('This photo is too small — it would look blurry on the website. Please use a larger photo.');
  const out = { tall: bmp.height > bmp.width };
  for (const w of [2000, 1400, 800]) out[w] = await drawTo(bmp, w, w === 800 ? 0.8 : 0.82);
  bmp.close?.();
  return out;
}

// Slideshow controls. Used full-screen (#/homepage) and inside the side panel of the on-page editor
// (embedded: no Back link, no Preview/Publish bar, no own Undo – "Undo all changes" covers it;
// onChange(H) runs after every saved change).
async function homepageScreen(root = app, opts = {}) {
  const embedded = !!opts.embedded;
  if (embedded) root.innerHTML = '<p class="loading">Loading your photos…</p>'; else setScreen('<p class="loading">Loading your homepage photos…</p>');
  let H = opts.H || await api('GET', '/homepage');
  let lastRev = H.revision;
  const SAVED = embedded ? 'Saved – your page shows it now. Click Publish when you\'re happy.' : null;
  let banner = '';
  const gone = () => embedded && !root.isConnected; // the panel was closed (or another one opened)

  function render() {
    if (gone()) return;
    const d = H.draft;
    const speed = nearestSpeed(d.seconds);
    const choice = `<section class="choice-box">
    <h2>Slideshow or one still photo?</h2>
    <fieldset><legend class="sr">Should the photos change by themselves?</legend><div class="radios">
      <label class="radio"><input type="radio" name="autoplay" value="on" ${d.autoplay !== false ? 'checked' : ''}> <span><strong>Slideshow</strong> (recommended)<br><span class="hint">Your photos take turns, one after another</span></span></label>
      <label class="radio"><input type="radio" name="autoplay" value="off" ${d.autoplay === false ? 'checked' : ''}> <span><strong>One still photo</strong><br><span class="hint">Only Photo 1 shows — it never changes</span></span></label>
    </div></fieldset>
    </section>`;
    const photos = `<h2>Your photos</h2>
    ${d.slides.length > 1 ? '<p class="hint">To change the order, drag a photo by its <strong>⠿ Drag</strong> handle.</p>' : ''}
    <ul class="photos photos--rows" id="hphotos">${d.slides.map((sl, i) => `<li class="photo${i === 0 ? ' photo--cover' : ''}" data-id="${esc(sl.id)}">
      <div class="photo__img"><img src="/api/homepage/photo/${esc(sl.id)}?w=800" alt="Homepage photo ${i + 1}" loading="lazy" data-pos="${esc(sl.focus)}"></div>
      <div class="photo__bar">
        ${d.slides.length > 1 ? handleHtml(i + 1) : ''}
        <span class="photo__label">${i === 0 ? '<span class="cover">★ Photo 1 – shows first</span>' : `Photo ${i + 1}`}</span>
      </div>
      <div class="photo__focus" role="group" aria-label="Which part of photo ${i + 1} matters most">
        <span class="photo__focus-label">Which part matters most? (kept in view on phones)</span>
        ${FOCUS.map((f) => `<button type="button" class="seg${nearestFocus(sl.focus) === f.v ? ' is-on' : ''}" data-focus="${esc(sl.id)}" data-v="${f.v}" aria-pressed="${nearestFocus(sl.focus) === f.v}">${f.label}</button>`).join('')}
      </div>
      <div class="photo__bar">
        ${i > 0 ? `<button type="button" class="btn btn--small" data-first="${esc(sl.id)}">Show first</button>` : ''}
        <span class="btn btn--small file-btn">Replace photo<input type="file" accept="image/*,.heic,.heif" data-replace="${esc(sl.id)}" aria-label="Replace photo ${i + 1}"></span>
        ${d.slides.length > 1 ? `<button type="button" class="btn btn--small btn--danger" data-remove="${esc(sl.id)}" aria-label="Remove photo ${i + 1}">Remove</button>` : ''}
      </div></li>`).join('')}</ul>
    ${dropZoneHtml('addhero', '+ Add photos', 'Click to choose photos — or drag them here from a folder')}
    <ul class="upload-list" id="uploads" aria-live="polite"></ul>
    <p class="hint">Wide (landscape) photos look best. Tall photos get trimmed at the top and bottom.</p>`;
    const settings = `<div ${d.autoplay === false ? 'hidden' : ''}>
    <h2>Slideshow speed</h2>
    <fieldset><legend class="sr">How fast should the photos change?</legend><div class="radios">
      ${SPEEDS.map((sp) => `<label class="radio"><input type="radio" name="speed" value="${sp.v}" ${speed === sp.v ? 'checked' : ''}> <span><strong>${sp.label}</strong>${sp.v === 7 ? ' (recommended)' : ''}<br><span class="hint">${sp.sub}</span></span></label>`).join('')}
    </div></fieldset>

    <h2>How the photos change</h2>
    <fieldset><legend class="sr">How should one photo change to the next?</legend><div class="radios">
      <label class="radio"><input type="radio" name="fade" value="off" ${d.fade ? '' : 'checked'}> <span><strong>Slide</strong> (recommended)<br><span class="hint">The next photo slides in from the side</span></span></label>
      <label class="radio"><input type="radio" name="fade" value="on" ${d.fade ? 'checked' : ''}> <span><strong>Fade</strong><br><span class="hint">Each photo slowly fades into the next</span></span></label>
    </div></fieldset>
    ${d.slides.length < 2 ? '<p class="hint">Add a second photo to see the slideshow move.</p>' : ''}
    </div>`;
    root.innerHTML = `
    ${embedded ? '' : '<a class="back" href="#/list">← Back to all photos</a>\n    <h1>Homepage slideshow</h1>'}
    ${embedded ? '' : how(['First choose <strong>Slideshow</strong> or <strong>One still photo</strong> in the box below.', 'Add photos with the <strong>+ Add photos</strong> box. <strong>Photo 1 shows first.</strong> Change the order by dragging <strong>⠿ Drag</strong>, or click <strong>Show first</strong>.', 'Click <strong>Preview</strong> to look, then <strong>Publish</strong> to put it on your website.'])}
    <div id="msg">${banner}</div>
    ${embedded ? '' : '<div id="pub"></div>'}
    ${embedded ? `${photos}${choice}${settings}` : `${choice}${photos}${settings}
    ${H.hasUnpublishedChanges ? '<p class="spaced"><button type="button" class="btn btn--small" data-discard>Undo my unpublished changes</button></p>' : ''}
    <div class="actions"><p class="actions__state">${H.hasUnpublishedChanges ? 'You have changes that are not on the website yet' : 'The website is up to date'}</p><div class="actions__in actions__in--2">
      <a class="btn" href="/api/homepage/preview" target="_blank" rel="noopener">Preview</a>
      <button type="button" class="btn btn--primary" data-publish ${H.hasUnpublishedChanges ? '' : 'disabled'}>Publish</button>
    </div></div>`}`;
    applyFocus(root);
    bind();
    if (embedded && H.revision !== lastRev) { lastRev = H.revision; opts.onChange?.(H); }
    const job = store.get(KEYS.pub);
    if (!embedded && (job?.id === 'homepage' || job?.id === 'site')) watchPublish(root.querySelector('#pub'), job);
  }

  const showError = (err) => { if (gone()) return; const m = root.querySelector('#msg'); m.innerHTML = errorNote(err); m.scrollIntoView({ block: 'nearest' }); };
  const ok = (msg) => { banner = msg ? `<div class="note note--ok"><p>${msg}</p></div>` : ''; render(); };

  async function save(method, path, body) {
    try { H = await api(method, path, { ...body, baseRevision: H.revision }); return true; } catch (err) {
      // Someone else changed the slideshow: show their version (the choices snap back to what is saved) and say why.
      toast.clear(); banner = '';
      if (err.status === 409) { try { H = await api('GET', '/homepage'); } catch { /* ignore */ } }
      render(); showError(err);
      return false;
    }
  }
  const order = () => H.draft.slides.map((x) => x.id);
  const arrange = async (ord, focus) => { if (await save('PUT', '/homepage/photos', { order: ord, focus })) { ok(''); toast(SAVED || 'Saved. Click Publish when you\'re ready.'); } };

  // The whole upload (preparing + sending) counts as "saving", so Publish waits for it.
  const upload = (files, replaceId = null) => busyWhile(async () => {
    if (!files.length || gone()) return;
    const list = root.querySelector('#uploads');
    list.innerHTML = '';
    const rows = files.map((f, i) => { const li = document.createElement('li'); li.textContent = `Photo ${i + 1} of ${files.length}: waiting…`; list.appendChild(li); return li; });
    let failed = 0, tall = 0;
    for (let i = 0; i < files.length; i++) {
      const li = rows[i];
      try {
        li.textContent = `Photo ${i + 1} of ${files.length}: preparing…`;
        const p = await prepareHero(files[i]);
        if (p.tall) tall++;
        li.textContent = `Photo ${i + 1} of ${files.length}: uploading…`;
        const fd = new FormData();
        for (const w of [2000, 1400, 800]) fd.append(`w${w}`, p[w].blob, `w${w}.jpg`);
        if (files[i].size <= 24 * 1024 * 1024) fd.append('original', files[i], 'original');
        fd.append('baseRevision', String(H.revision));
        H = await api('POST', replaceId ? `/homepage/photos/${replaceId}/replace` : '/homepage/photos', fd, { idem: uuid() });
        if (embedded) { lastRev = H.revision; opts.onChange?.(H); } // the page shows it even if the panel was closed meanwhile
        li.textContent = `Photo ${i + 1} of ${files.length}: ✓ added`;
      } catch (err) {
        failed++;
        li.innerHTML = `<strong>Photo ${i + 1} (${esc(files[i].name || 'photo')}) was not added:</strong> ${esc(err.message)}`;
        if (err.status === 409) { try { H = await api('GET', '/homepage'); if (embedded) { lastRev = H.revision; opts.onChange?.(H); } } catch { /* ignore */ } }
      }
    }
    const added = files.length - failed;
    if (gone()) { toast(failed ? `${added} of ${files.length} slideshow photos were added. Open the slideshow to see what went wrong.` : `✓ ${added === 1 ? 'Photo' : added + ' photos'} added to the slideshow.`, 8000); return; }
    const summary = list.innerHTML;
    banner = failed
      ? `<div class="note note--warn"><p>${added} of ${files.length} photos added. The others are listed below with what to do.</p></div>`
      : `<div class="note note--ok"><p>${added === 1 ? 'Photo added' : added + ' photos added'} ${replaceId ? '' : 'to the end of the slideshow'}. ${embedded ? 'It shows on your page now. ' : ''}Drag to change the order, then click <strong>Publish</strong>.${tall ? ' Tip: tall photos get trimmed – use "Which part matters most?" to choose what shows.' : ''}</p></div>`;
    render();
    if (failed) root.querySelector('#uploads').innerHTML = summary;
    else if (!replaceId && added) {
      const li = root.querySelector('#hphotos > li:last-child');
      li?.classList.add('is-new'); li?.scrollIntoView({ block: 'nearest' });
    }
  });

  function bind() {
    root.querySelector('#addhero').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; upload(f); });
    makeDropZone(root.querySelector('#addhero').closest('.dropzone'), (f) => upload(f));
    makeSortable(root.querySelector('#hphotos'), (ord) => arrange(ord));
    root.querySelectorAll('[data-replace]').forEach((inp) => inp.addEventListener('change', (e) => { const f = [...e.target.files].slice(0, 1); e.target.value = ''; upload(f, inp.dataset.replace); }));
    root.querySelectorAll('[data-first]').forEach((b) => b.addEventListener('click', () => arrange([b.dataset.first, ...order().filter((x) => x !== b.dataset.first)])));
    root.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => arrange(order(), { [b.dataset.focus]: b.dataset.v })));
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Remove this photo from the slideshow?', body: 'Visitors keep seeing it until you publish. You can undo before publishing.', yes: 'Remove photo', danger: true }))) return;
      if (await save('DELETE', `/homepage/photos/${b.dataset.remove}?baseRevision=${H.revision}`)) { ok(''); toast(SAVED || 'Photo removed. Click Publish when you\'re ready.'); }
    }));
    root.querySelectorAll('input[name=speed], input[name=fade], input[name=autoplay]').forEach((r) => r.addEventListener('change', async () => {
      const seconds = Number(root.querySelector('input[name=speed]:checked').value);
      const fade = root.querySelector('input[name=fade]:checked').value === 'on';
      const autoplay = root.querySelector('input[name=autoplay]:checked').value === 'on';
      if (await save('PUT', '/homepage/settings', { seconds, fade, autoplay })) { ok(''); toast(SAVED || 'Saved. Click Preview to watch it, or Publish to put it live.'); }
    }));
    if (embedded) return; // the on-page editor handles "Reload latest", Undo all and Publish itself
    root.querySelector('[data-discard]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Undo unpublished changes?', body: 'The slideshow and the other website photos go back to exactly what is on the website now.', yes: 'Undo changes', danger: true }))) return;
      if (await save('POST', '/homepage/discard', {})) ok('Changes undone.');
    });
    root.querySelector('#msg').addEventListener('click', async (e) => { if (e.target.matches('[data-reload]')) { try { H = await api('GET', '/homepage'); ok(''); } catch (err) { showError(err); } } });
    root.querySelector('[data-publish]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Put these photos on your homepage?', body: H.draft.autoplay === false ? `One still photo (Photo 1).` : `${H.draft.slides.length} photo${H.draft.slides.length === 1 ? '' : 's'}, slideshow, ${SPEEDS.find((x) => x.v === nearestSpeed(H.draft.seconds)).label.toLowerCase()} speed, ${H.draft.fade ? 'fading' : 'sliding'} between photos.`, yes: 'Yes, publish' }))) return;
      root.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        const r = await api('POST', '/homepage/publish', { baseRevision: H.revision }, { idem: uuid(), free: true });
        H = r.homepage;
        store.set(KEYS.pub, { id: 'homepage', commit: r.commit, url: me.site.url + '/', verb: 'your homepage is updated', linkLabel: 'View your homepage', at: Date.now() });
        banner = ''; render();
      } catch (err) { render(); showError(err); }
    });
  }
  render();
}

/* ---------------- client reviews ---------------- */

const ROLES = ['', 'Buyer', 'Seller', 'Buyer and seller'];
const fmtDay = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch { return d; } };

function reviewsPublishBar(R) {
  return `<div class="actions"><p class="actions__state">${R.hasUnpublishedChanges ? 'You have review changes that are not on the website yet' : 'The website is up to date'}</p><div class="actions__in actions__in--2">
      <a class="btn" href="/api/reviews/preview" target="_blank" rel="noopener">Preview</a>
      <button type="button" class="btn btn--primary" data-publish ${R.hasUnpublishedChanges ? '' : 'disabled'}>Publish</button>
    </div></div>`;
}

async function bindReviewsPublish(getR, setR, rerender, showError) {
  app.querySelector('[data-publish]')?.addEventListener('click', async () => {
    const R = getR();
    if (!(await confirmBox({ title: 'Put your review changes on the website?', body: `Your website will show ${R.draft.items.length} review${R.draft.items.length === 1 ? '' : 's'}.`, yes: 'Yes, publish' }))) return;
    app.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try {
      const r = await api('POST', '/reviews/publish', { baseRevision: R.revision }, { idem: uuid(), free: true });
      setR(r.reviews);
      store.set(KEYS.pub, { id: 'reviews', commit: r.commit, url: me.site.url + (r.checkPath || '/testimonials/'), verb: 'your reviews are on the website', linkLabel: 'View your reviews', at: Date.now() });
      rerender();
    } catch (err) { rerender(); showError(err); }
  });
}

// Reviews list. Full screen (#/reviews) or inside the on-page editor's side panel (embedded: Change/Add open
// the form in the same panel through opts.edit(slug); opts.onChange(R) after every saved change).
async function reviewsScreen(root = app, opts = {}) {
  const embedded = !!opts.embedded;
  if (embedded) root.innerHTML = '<p class="loading">Loading your reviews…</p>'; else setScreen('<p class="loading">Loading your reviews…</p>');
  let R = opts.R || await api('GET', '/reviews');
  const changed = (x) => { R = x; if (embedded) opts.onChange?.(R); };
  const gone = () => embedded && !root.isConnected;
  let banner = '';
  const liveBySlug = () => new Map(R.live.items.map((x) => [x.slug, JSON.stringify(x)]));

  function render() {
    if (gone()) return;
    const live = liveBySlug();
    const shown = R.draft.items.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const removedCount = R.live.items.filter((x) => !R.draft.items.some((d) => d.slug === x.slug)).length;
    root.innerHTML = `
    ${embedded ? '' : '<a class="back" href="#/">← Back</a>\n    <h1>Client reviews</h1>'}
    ${embedded ? '<p class="hint">Click <strong>Change</strong> to fix a review, or add a new one. Changes show on your page right away.</p>' : how(['To add a review, click <strong>+ Add a review</strong> and paste it in.', 'To fix one, click <strong>Change</strong> next to it. To take one off, click <strong>Remove</strong>.', 'Click <strong>Preview</strong> to look, then <strong>Publish</strong> at the bottom.'])}
    <div id="msg">${banner}</div>
    ${embedded ? '' : '<div id="pub"></div>'}
    <p><a class="btn btn--primary${embedded ? ' btn--block' : ''}" href="#/reviews/new" data-add>+ Add a review</a></p>
    ${removedCount ? `<p class="chip chip--draft">${removedCount} review${removedCount === 1 ? '' : 's'} removed – not published yet</p>` : ''}
    <ul class="reviews">${shown.map((t) => {
      const state = !live.has(t.slug) ? 'New – not published yet' : live.get(t.slug) !== JSON.stringify(t) ? 'Changed – not published yet' : '';
      return `<li class="review${state ? ' review--changed' : ''}">
        <div class="review__head"><strong class="review__title">${esc(t.title)}</strong><span class="review__meta">${t.client ? esc(t.client) + ' · ' : ''}${t.role ? esc(t.role) + ' · ' : ''}${esc(fmtDay(t.date))}</span></div>
        ${state ? `<p class="chip chip--draft">${state}</p>` : ''}
        <p class="review__text">${esc((t.text || []).join(' ').slice(0, 220))}${(t.text || []).join(' ').length > 220 ? '…' : ''}</p>
        <p class="review__btns"><a class="btn btn--small" href="#/reviews/edit/${encodeURIComponent(t.slug)}" data-edit-review="${esc(t.slug)}">Change</a><button type="button" class="btn btn--small btn--danger" data-remove="${esc(t.slug)}">Remove</button></p>
      </li>`;
    }).join('')}</ul>
    ${R.hasUnpublishedChanges && !embedded ? '<p><button type="button" class="btn btn--small" data-discard>Undo my unpublished changes</button></p>' : ''}
    ${embedded ? '' : reviewsPublishBar(R)}`;
    bind();
    const job = store.get(KEYS.pub);
    if (!embedded && (job?.id === 'reviews' || job?.id === 'site')) watchPublish(root.querySelector('#pub'), job);
  }
  const showError = (err) => { if (gone()) return; const m = root.querySelector('#msg'); m.innerHTML = errorNote(err); m.scrollIntoView({ block: 'nearest' }); };
  function bind() {
    if (embedded) {
      root.querySelector('[data-add]').addEventListener('click', (e) => { e.preventDefault(); opts.edit(null); });
      root.querySelectorAll('[data-edit-review]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); opts.edit(a.dataset.editReview); }));
    }
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const t = R.draft.items.find((x) => x.slug === b.dataset.remove);
      if (!(await confirmBox({ title: 'Remove this review?', body: `"${esc(t?.title || '')}" comes off the website when you publish. You can undo before publishing.`, yes: 'Remove review', danger: true }))) return;
      try { changed(await api('DELETE', `/reviews/item/${encodeURIComponent(b.dataset.remove)}?baseRevision=${R.revision}`)); banner = ''; render(); toast(embedded ? 'Review removed from your page. Click Publish when you\'re happy.' : 'Review removed. Click Publish when you\'re ready.'); } catch (err) { showError(err); }
    }));
    if (embedded) return; // the on-page editor handles "Reload latest", Undo all and Publish itself
    root.querySelector('[data-discard]')?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Undo unpublished changes?', body: 'The reviews go back to exactly what is on the website now.', yes: 'Undo changes', danger: true }))) return;
      try { changed(await api('POST', '/reviews/discard', { baseRevision: R.revision })); banner = '<div class="note note--ok"><p>Changes undone.</p></div>'; render(); } catch (err) { showError(err); }
    });
    root.querySelector('#msg').addEventListener('click', async (e) => { if (e.target.matches('[data-reload]')) { try { changed(await api('GET', '/reviews')); banner = ''; render(); } catch (err) { showError(err); } } });
    bindReviewsPublish(() => R, (x) => { R = x; }, () => { banner = ''; render(); }, showError);
  }
  render();
}

// One review's form. Full screen, or in the on-page editor's side panel (embedded: opts.back() returns to the
// list, opts.onChange(R) after saving).
async function reviewEditScreen(slug, root = app, opts = {}) {
  const embedded = !!opts.embedded;
  if (embedded) root.innerHTML = '<p class="loading">Loading…</p>'; else setScreen('<p class="loading">Loading…</p>');
  let R = opts.R || await api('GET', '/reviews');
  const t = slug ? R.draft.items.find((x) => x.slug === slug) : null;
  if (slug && !t) { const m = '<div class="note note--bad"><p>That review is no longer there.</p></div>'; if (embedded) root.innerHTML = m; else setScreen('<a class="back" href="#/reviews">← Back to reviews</a>' + m); return; }
  const today = new Date().toISOString().slice(0, 10);
  const v = { title: t?.title || '', client: t?.client || '', role: t?.role || '', date: t?.date || today, text: (t?.text || []).join('\n\n') };
  let dirty = false;
  unsavedGuard = () => dirty && root.isConnected;
  root.innerHTML = `
    ${embedded ? '<p><a class="back" href="#" data-back>← All reviews</a></p>' : `<a class="back" href="#/reviews">← Back to reviews</a>
    <h1>${t ? 'Change review' : 'Add a review'}</h1>`}
    ${embedded ? '' : how([t ? 'Change what you need below.' : 'Fill in the boxes below. Only the review, a short title and the date are needed.', 'Click <strong>Save</strong>. Then click <strong>Publish</strong> on the reviews page to put it on your website.'])}
    <div id="msg"></div>
    <form id="rform" class="rform" novalidate>
      <div class="field"><label for="r-text">The review</label><textarea id="r-text" rows="9" maxlength="6000">${esc(v.text)}</textarea><p class="hint">Paste the client's words. Leave an empty line between paragraphs.</p></div>
      <div class="field"><label for="r-title">Short title</label><input id="r-title" maxlength="120" value="${esc(v.title)}" placeholder="For example: Made selling easy"><p class="hint">Shown in bold above the review.</p></div>
      <div class="field"><label for="r-client">Client's name <span class="opt">(optional)</span></label><input id="r-client" maxlength="80" value="${esc(v.client)}" placeholder="For example: Sarah M."><p class="hint">Only include a name if the client is OK with it.</p></div>
      <div class="field"><label for="r-role">Buyer or seller? <span class="opt">(optional)</span></label><select id="r-role">${ROLES.map((r) => `<option value="${esc(r)}"${r === v.role ? ' selected' : ''}>${r || '— Don\'t show —'}</option>`).join('')}</select></div>
      <div class="field"><label for="r-date">Date of the review</label><input id="r-date" type="date" max="${today}" value="${esc(v.date)}"></div>
      <p class="rform__btns"><button type="submit" class="btn btn--primary">${embedded ? 'Save – show it on my page' : 'Save'}</button> <a class="btn" href="#/reviews" data-cancel>Cancel</a></p>
    </form>`;
  root.querySelectorAll('#rform input, #rform textarea, #rform select').forEach((el) => el.addEventListener('input', () => { dirty = true; }));
  const leave = async () => { if (dirty && !(await confirmBox({ title: 'Leave without saving?', body: 'Your typing in this review will be lost.', yes: 'Leave without saving', no: 'Keep typing', danger: true }))) return; dirty = false; unsavedGuard = null; opts.back(); };
  if (embedded) {
    root.querySelector('[data-back]').addEventListener('click', (e) => { e.preventDefault(); leave(); });
    root.querySelector('[data-cancel]').addEventListener('click', (e) => { e.preventDefault(); leave(); });
    root.querySelector('#r-text').focus({ preventScroll: true });
  }
  const say = (html) => { if (!root.isConnected) return; const m = root.querySelector('#msg'); m.innerHTML = html; m.scrollIntoView({ block: 'nearest' }); };
  root.querySelector('#rform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = { text: root.querySelector('#r-text').value, title: root.querySelector('#r-title').value, client: root.querySelector('#r-client').value, role: root.querySelector('#r-role').value, date: root.querySelector('#r-date').value };
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      R = t ? await api('PUT', `/reviews/item/${encodeURIComponent(t.slug)}`, { fields, baseRevision: R.revision }) : await api('POST', '/reviews', { fields, baseRevision: R.revision });
      dirty = false; unsavedGuard = null;
      if (embedded) { opts.onChange?.(R); opts.back(); toast('Saved – your page shows it now. Click Publish when you\'re happy.'); return; }
      location.hash = '#/reviews';
      setTimeout(() => toast('Saved. Click Publish at the bottom when you\'re ready.'), 300);
    } catch (err) {
      btn.disabled = false; btn.textContent = embedded ? 'Save – show it on my page' : 'Save';
      if (err.status !== 409) return say(errorNote(err));
      // Someone else saved reviews meanwhile. Never overwrite their words silently: show what changed, keep the typing.
      let fresh = null;
      try { fresh = await api('GET', '/reviews'); } catch { return say(errorNote(err)); }
      R = fresh; if (embedded) opts.onChange?.(R);
      const theirs = t ? R.draft.items.find((x) => x.slug === t.slug) : null;
      if (t && !theirs) return say('<div class="note note--bad" role="alert"><p>This review was removed on another computer, so your changes can\'t be saved to it. Click <strong>Cancel</strong>, or copy your text and add it as a new review.</p></div>');
      if (t && JSON.stringify(theirs) !== JSON.stringify(t)) {
        return say(`<div class="note note--warn" role="alert"><p>This review was just changed on another computer. Their version:</p><blockquote class="review__text">${esc(theirs.title)} – ${esc((theirs.text || []).join(' ').slice(0, 300))}</blockquote><p>Your typing is still in the boxes. Click <strong>Save</strong> to replace their version with yours, or <strong>Cancel</strong> to keep theirs.</p></div>`);
      }
      say('<div class="note note--warn" role="alert"><p>Other reviews were just changed on another computer. Your typing is still here – click <strong>Save</strong> again.</p></div>');
    }
  });
}

/* ---------------- change requests ---------------- */

async function requestScreen() {
  const data = await api('GET', '/requests');
  const maint = me.role === 'maintainer';
  const kindLabel = { change: 'Change', question: 'Question' };
  const statusLabel = { received: 'Received – James has it', working: 'James is working on it', done: 'Done' };
  setScreen(`<a class="back" href="#/">← Back</a>
  <h1>Request a website change</h1>
  ${how(['Type what you want changed, in your own words. Example: <em>"On the About page, replace my headshot with this one."</em>', 'Attach a photo if it helps (optional).', 'Click <strong>Send to James</strong>. Then send James a quick text so he knows.'])}
  <div id="rmsg"></div>
  <form id="rform" novalidate>
    <fieldset><legend>Is this a change or a question?</legend><div class="radios">
      <label class="radio"><input type="radio" name="kind" value="change" checked> Please make this change</label>
      <label class="radio"><input type="radio" name="kind" value="question"> Just a question – show me first, don't change anything yet</label>
    </div></fieldset>
    <div class="field"><label for="r-page">Which page? <span class="opt">(optional)</span></label>
      <select id="r-page" name="page"><option value="">Not sure / whole website</option>${['Home', 'About us', 'New Construction', 'Luxury Home Marketing', 'Testimonials', 'Contact'].map((p) => `<option>${p}</option>`).join('')}</select></div>
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
      <div><span class="chip ${r.status === 'done' ? 'chip--live' : 'chip--draft'}">${esc(statusLabel[r.status])}</span> ${r.notified || !me.emailNotifications ? '' : '<span class="chip chip--sold">Email to James failed</span>'}</div>
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
      const good = r.notified || !r.emailConfigured;
      msg.innerHTML = `<div class="note ${good ? 'note--ok' : 'note--warn'}" role="status"><p>${esc(r.message)}</p></div>`;
      if (good) { form.reset(); setTimeout(() => requestScreen().then(() => { document.getElementById('rmsg').innerHTML = `<div class="note note--ok"><p>${esc(r.message)}</p></div>`; }), 50); }
    } catch (err) {
      msg.innerHTML = errorNote(err) + `<p class="hint">Your message is still in the box. If sending keeps failing, contact ${supportLine()}.</p>`;
    } finally { btn.disabled = false; btn.textContent = 'Send to James'; }
  });
  app.querySelectorAll('[data-req]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('PUT', `/requests/${s.dataset.req}`, { status: s.value }); toast('Request status updated.'); } catch (err) { toast(err.message, 6000); }
  }));
}

route();
