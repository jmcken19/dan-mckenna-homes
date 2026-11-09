// Homepage slideshow editing: photos, order, which part stays in view, speed, fade.
// Same safety model as listings: private draft in D1/KV, revision check on every save,
// one non-forced Git commit to publish, "live" only after the website reports it.
import { github } from './github.mjs';
import { validateVariant, validateOriginal } from './images.mjs';
import { validateHomepage, HERO_SIZES, MAX_HERO_SLIDES, randomId } from '../../src/lib/listing.mjs';
import { layout } from '../../src/templates/layout.mjs';
import { homePage } from '../../src/templates/pages.mjs';
import { luxLayout, luxHome } from '../../src/templates/luxury.mjs';
import siteContent from '../../content/site.json';
import testimonialsContent from '../../content/testimonials.json';

const KEY = 'homepage';
const ID_RE = /^s-[a-z0-9]{3,32}$/;
const HERO_DIR = 'public/assets/img/hero';

export function homepageRoutes(H) {
  const { HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent, idempotent, publicBase } = H;

  const fromSite = (site) => ({
    slides: (site.heroSlides || []).map((s, i) => ({ id: s.id || `s-legacy${i + 1}`, src: s.src, alt: s.alt || '', focus: s.focus || '50% 50%' })),
    seconds: typeof site.heroSlideSeconds === 'number' ? site.heroSlideSeconds : 7,
    fade: site.heroFade === true,
    autoplay: site.heroAutoplay !== false,
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function view(row) {
    return { revision: row.revision, draft: row.draft, live: row.live, hasUnpublishedChanges: !same(row.draft, row.live), lastCommit: row.last_commit, updatedAt: row.updated_at, updatedBy: row.updated_by };
  }

  async function readRow(A) {
    const r = await A.db.prepare('SELECT * FROM settings WHERE key = ?').bind(KEY).first();
    return r ? { ...r, draft: JSON.parse(r.draft), live: r.live ? JSON.parse(r.live) : null } : null;
  }

  /** Load the slideshow, creating it from the website's current settings the first time and
   *  picking up changes made directly in the repo (e.g. by an AI assistant). */
  async function load(A) {
    let row = await readRow(A);
    let file = null;
    try { file = A.env.GITHUB_TOKEN ? await github(A.env).getFile('content/site.json') : null; } catch { /* offline: use what we have */ }
    const repoState = file ? fromSite(JSON.parse(new TextDecoder().decode(file.bytes))) : fromSite(siteContent);
    const t = now();
    if (!row) {
      await A.db.prepare('INSERT OR IGNORE INTO settings (key, revision, draft, live, repo_sha, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .bind(KEY, JSON.stringify(repoState), JSON.stringify(repoState), file?.sha || null, t, 'website').run();
      return readRow(A);
    }
    if (file && row.repo_sha !== file.sha) {
      const draftUntouched = same(row.draft, row.live);
      if (!same(row.live, repoState)) {
        await A.db.prepare('UPDATE settings SET live = ?, draft = ?, repo_sha = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE key = ?')
          .bind(JSON.stringify(repoState), JSON.stringify(draftUntouched ? repoState : row.draft), file.sha, t, 'website', KEY).run();
      } else {
        await A.db.prepare('UPDATE settings SET repo_sha = ? WHERE key = ?').bind(file.sha, KEY).run();
      }
      row = await readRow(A);
    }
    return row;
  }

  async function write(A, row, changes, expectedRevision) {
    const fields = { ...changes, updated_at: now(), updated_by: A.user.email };
    const cols = Object.keys(fields);
    const vals = cols.map((c) => ((c === 'draft' || c === 'live') && fields[c] && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]));
    const res = await A.db.prepare(`UPDATE settings SET ${cols.map((c) => `${c} = ?`).join(', ')}, revision = revision + 1 WHERE key = ? AND revision = ?`).bind(...vals, KEY, expectedRevision).run();
    if (!res.meta.changes) throw new HttpError(409, 'The homepage photos were changed on another phone or computer since you opened this page. Tap "Reload latest" to see the newest version.', { conflict: true });
    return readRow(A);
  }

  async function readForm(A) {
    const len = Number(A.request.headers.get('content-length') || 0);
    if (len > 40 * 1024 * 1024) throw new HttpError(413, 'That photo is too large to upload. Please try a different photo.');
    let form;
    try { form = await A.request.formData(); } catch { throw new HttpError(400, 'The photo did not arrive completely. Please check your signal and try again.'); }
    const get = async (n) => { const f = form.get(n); return f && typeof f !== 'string' ? new Uint8Array(await f.arrayBuffer()) : null; };
    const variants = {};
    for (const w of HERO_SIZES) {
      const v = validateVariant(w === 800 ? 'small' : 'large', await get(`w${w}`));
      if (v.error) throw new HttpError(422, v.error);
      variants[w] = v;
    }
    const original = await get('original');
    const orig = original && !validateOriginal(original).error ? original : null;
    return { variants, original: orig, baseRevision: Number(form.get('baseRevision')), alt: String(form.get('alt') || '').slice(0, 200) };
  }

  async function store(A, id, p) {
    for (const w of HERO_SIZES) await A.env.PHOTOS.put(`hero:${id}:${w}`, p.variants[w].bytes);
    if (p.original) await A.env.PHOTOS.put(`heroorig:${id}`, p.original, { metadata: { by: A.user.email, at: now() } });
  }

  const routes = {
    async get(A) { return json(view(await load(A))); },

    async settings(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const seconds = Number(body.seconds);
      if (!(seconds >= 2 && seconds <= 30)) throw new HttpError(400, 'Choose Slow, Normal, or Fast.');
      if (typeof body.fade !== 'boolean') throw new HttpError(400, 'Choose fade on or off.');
      const autoplay = typeof body.autoplay === 'boolean' ? body.autoplay : row.draft.autoplay !== false;
      const updated = await write(A, row, { draft: { ...row.draft, seconds, fade: body.fade, autoplay } }, rev);
      await logEvent(A, 'save-homepage-settings');
      return json(view(updated));
    },

    async add(A) {
      await rateLimit(A, 'upload');
      const p = await readForm(A);
      let row = await load(A);
      if (row.draft.slides.length >= MAX_HERO_SLIDES) throw new HttpError(422, `The slideshow can have up to ${MAX_HERO_SLIDES} photos. Remove one first.`);
      const id = randomId('s-', 10);
      await store(A, id, p);
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          row = await readRow(A);
          const slide = { id, src: `/assets/img/hero/${id}`, alt: p.alt || 'Homepage photo', focus: '50% 50%' };
          const updated = await write(A, row, { draft: { ...row.draft, slides: [...row.draft.slides, slide] } }, row.revision);
          await logEvent(A, 'upload-homepage', null, { id });
          return view(updated);
        } catch (e) { if (!(e instanceof HttpError && e.status === 409)) throw e; }
      }
      throw new HttpError(409, 'Too many changes at once. Please try again.');
    },

    async replace(A, id) {
      await rateLimit(A, 'upload');
      const p = await readForm(A);
      const row = await load(A);
      const i = row.draft.slides.findIndex((s) => s.id === id);
      if (i < 0) throw new HttpError(404, 'That photo is no longer in the slideshow. Please refresh.');
      const newId = randomId('s-', 10);
      await store(A, newId, p);
      const slides = row.draft.slides.slice();
      slides[i] = { id: newId, src: `/assets/img/hero/${newId}`, alt: p.alt || slides[i].alt, focus: slides[i].focus };
      const updated = await write(A, row, { draft: { ...row.draft, slides } }, p.baseRevision);
      await logEvent(A, 'upload-homepage-replace', null, { from: id, to: newId });
      return view(updated);
    },

    async arrange(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const byId = new Map(row.draft.slides.map((s) => [s.id, s]));
      const order = Array.isArray(body.order) ? body.order : [];
      if (order.length !== byId.size || !order.every((x) => byId.has(x))) throw new HttpError(409, 'The photos changed since you opened this page. Please tap "Reload latest".', { conflict: true });
      const focus = body.focus && typeof body.focus === 'object' ? body.focus : {};
      const alts = body.alts && typeof body.alts === 'object' ? body.alts : {};
      const slides = order.map((id) => {
        const s = byId.get(id);
        const f = typeof focus[id] === 'string' && /^\d{1,3}% \d{1,3}%$/.test(focus[id]) ? focus[id] : s.focus;
        const a = typeof alts[id] === 'string' ? alts[id].slice(0, 200) : s.alt;
        return { ...s, focus: f, alt: a };
      });
      const updated = await write(A, row, { draft: { ...row.draft, slides } }, rev);
      await logEvent(A, 'save-homepage-photos');
      return json(view(updated));
    },

    async remove(A, id) {
      const rev = Number(A.url.searchParams.get('baseRevision'));
      if (!Number.isInteger(rev)) throw new HttpError(400, 'Please refresh the page and try again.');
      const row = await load(A);
      const slides = row.draft.slides.filter((s) => s.id !== id);
      if (slides.length === row.draft.slides.length) throw new HttpError(404, 'That photo was already removed.');
      if (!slides.length) throw new HttpError(422, 'The slideshow needs at least one photo. Add the new photo first, then remove this one.');
      const updated = await write(A, row, { draft: { ...row.draft, slides } }, rev);
      await logEvent(A, 'save-homepage-remove', null, { id });
      return json(view(updated));
    },

    async discard(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const updated = await write(A, row, { draft: row.live }, rev);
      await logEvent(A, 'save-homepage-discard');
      return json(view(updated));
    },

    async photo(A, id) {
      if (!ID_RE.test(id || '')) throw new HttpError(404, 'Not found.');
      const w = HERO_SIZES.includes(Number(A.url.searchParams.get('w'))) ? Number(A.url.searchParams.get('w')) : 800;
      let bytes = await A.env.PHOTOS.get(`hero:${id}:${w}`, 'arrayBuffer');
      if (!bytes) {
        // Photos that were already on the website before the editor existed: copy from the repo once.
        const row = await readRow(A);
        const slide = [...(row?.draft.slides || []), ...(row?.live?.slides || [])].find((s) => s.id === id);
        if (!slide) throw new HttpError(404, 'Photo not found.');
        const f = await github(A.env).getFile(`public${slide.src}-${w}.jpg`);
        if (!f) throw new HttpError(404, 'Photo not found.');
        bytes = f.bytes;
        await A.env.PHOTOS.put(`hero:${id}:${w}`, bytes);
      }
      return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
    },

    async preview(A) {
      const row = await load(A);
      const design = A.url.searchParams.get('design') === 'option2' ? 'option2' : 'classic';
      const base = publicBase(A.env) + (design === 'option2' ? (A.env.PUBLIC_SITE_V2_PATH ?? '/v2') : '');
      const srcToId = new Map(row.draft.slides.map((s) => [s.src, s.id]));
      const site = { ...siteContent, heroSlides: row.draft.slides, heroSlideSeconds: row.draft.seconds, heroFade: row.draft.fade, heroAutoplay: row.draft.autoplay !== false };
      const ctx = {
        site, preview: true, siteUrl: '', buildId: 'preview', listings: [], removed: [], testimonials: testimonialsContent.items,
        url: (p) => {
          const m = p.match(/^(\/assets\/img\/(?:hero-\d{1,2}|hero\/s-[a-z0-9]+))-(800|1400|2000)\.jpg$/);
          if (m && srcToId.has(m[1])) return `/api/homepage/photo/${srcToId.get(m[1])}?w=${m[2]}`;
          return base + p;
        },
      };
      const html = design === 'option2'
        ? luxLayout(ctx, { path: '/', title: 'Preview', body: luxHome(ctx) })
        : layout(ctx, { path: '/', title: 'Preview', body: homePage(ctx) });
      const note = `<div style="position:fixed;left:0;right:0;bottom:0;z-index:99;background:#fff4c2;color:#3d3200;font:600 16px system-ui;padding:12px;text-align:center;border-top:1px solid #e6d27a">Preview only – visitors still see the current homepage until you publish.</div>`;
      const origin = publicBase(A.env) ? new URL(publicBase(A.env)).origin : "'self'";
      return new Response(html.replace('</body>', note + '</body>'), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
          'Content-Security-Policy': `default-src 'none'; img-src 'self' ${origin}; style-src ${origin} 'unsafe-inline'; font-src ${origin}; script-src ${origin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
        },
      });
    },

    async publish(A) {
      await rateLimit(A, 'publish');
      if (!A.env.GITHUB_TOKEN) throw new HttpError(503, 'Publishing is not connected yet. Your changes are saved. Please tell James.');
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      if (row.revision !== rev) throw new HttpError(409, 'The homepage photos were changed on another phone or computer. Tap "Reload latest" first.', { conflict: true });
      const t = Date.now();
      const lock = await A.db.prepare('UPDATE settings SET lock_until = ? WHERE key = ? AND (lock_until IS NULL OR lock_until < ?)').bind(t + 90_000, KEY, t).run();
      if (!lock.meta.changes) throw new HttpError(409, 'The homepage is already being published. Please wait a minute.');
      try {
        const d = row.draft;
        const gh = github(A.env);
        const result = await gh.commit(`Update homepage slideshow (${d.slides.length} photo${d.slides.length === 1 ? '' : 's'}, ${d.autoplay === false ? 'still' : `moving, ${d.seconds}s, fade ${d.fade ? 'on' : 'off'}`})\n\nBy ${A.user.email} via the owner editor.`, async () => {
          const site = JSON.parse(await gh.getText('content/site.json'));
          site.heroSlides = d.slides.map(({ id, src, alt, focus }) => ({ id, src, alt, focus }));
          site.heroSlideSeconds = d.seconds;
          site.heroFade = d.fade;
          site.heroAutoplay = d.autoplay !== false;
          const problems = validateHomepage(site);
          if (problems.length) throw new HttpError(422, 'Something about the slideshow is not ready: ' + problems[0]);
          const changes = [{ path: 'content/site.json', content: JSON.stringify(site, null, 2) + '\n' }];
          const existing = new Set((await gh.listDir(HERO_DIR)).map((f) => f.name));
          const wanted = new Set();
          for (const s of d.slides) {
            if (!s.src.startsWith('/assets/img/hero/')) continue; // photos that came with the original site stay where they are
            for (const w of HERO_SIZES) {
              const name = `${s.id}-${w}.jpg`;
              wanted.add(name);
              if (existing.has(name)) continue;
              const bytes = await A.env.PHOTOS.get(`hero:${s.id}:${w}`, 'arrayBuffer');
              if (!bytes) throw new HttpError(500, 'A photo is missing from storage. Please remove it and add it again.');
              changes.push({ path: `${HERO_DIR}/${name}`, content: new Uint8Array(bytes) });
            }
          }
          for (const name of existing) if (/^s-[a-z0-9]+-\d+\.jpg$/.test(name) && !wanted.has(name)) changes.push({ path: `${HERO_DIR}/${name}`, content: null });
          return changes;
        });
        const updated = await write(A, row, { live: d, last_commit: result.sha, lock_until: null }, row.revision);
        await logEvent(A, 'publish-homepage', null, { commit: result.sha });
        return { homepage: view(updated), commit: result.sha, checkPath: '/' };
      } finally {
        await A.db.prepare('UPDATE settings SET lock_until = NULL WHERE key = ?').bind(KEY).run();
      }
    },
  };

  return async function handle(A, parts, method) {
    // parts: ['homepage', ...]
    if (parts.length === 1 && method === 'GET') return routes.get(A);
    if (parts[1] === 'settings' && method === 'PUT') return routes.settings(A);
    if (parts[1] === 'photos' && parts.length === 2 && method === 'POST') return idempotent(A, () => routes.add(A));
    if (parts[1] === 'photos' && parts.length === 2 && method === 'PUT') return routes.arrange(A);
    if (parts[1] === 'photos' && parts.length === 3 && method === 'DELETE') return routes.remove(A, parts[2]);
    if (parts[1] === 'photos' && parts[3] === 'replace' && method === 'POST') return idempotent(A, () => routes.replace(A, parts[2]));
    if (parts[1] === 'photo' && method === 'GET') return routes.photo(A, parts[2]);
    if (parts[1] === 'preview' && method === 'GET') return routes.preview(A);
    if (parts[1] === 'publish' && method === 'POST') return idempotent(A, () => routes.publish(A));
    if (parts[1] === 'discard' && method === 'POST') return routes.discard(A);
    throw new HttpError(404, 'Not found.');
  };
}
