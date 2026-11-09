// Client reviews editing: add, edit, remove. Same safety model as the homepage photos:
// private draft in D1 (settings table, key "reviews"), revision check on every save,
// one non-forced Git commit to publish, "live" only after the website reports it.
import { github } from './github.mjs';
import { slugify } from '../../src/lib/listing.mjs';
import { layout } from '../../src/templates/layout.mjs';
import { testimonialsPage } from '../../src/templates/pages.mjs';
import siteContent from '../../content/site.json';
import testimonialsContent from '../../content/testimonials.json';

const KEY = 'reviews';
const FILE = 'content/testimonials.json';
export const REVIEW_ROLES = ['', 'Buyer', 'Seller', 'Buyer and seller'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn the editor's fields into a stored review, or throw a plain message. */
export function cleanReview(fields, HttpError) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  const title = str(f.title, 120);
  const client = str(f.client, 80);
  const role = REVIEW_ROLES.includes(f.role) ? f.role : '';
  const date = str(f.date, 10);
  const body = str(f.text, 6000);
  const problems = {};
  if (!title) problems.title = 'Please add a short title, for example "Made selling easy".';
  if (!body) problems.text = 'Please paste the review.';
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) problems.date = 'Please choose the date of the review.';
  else if (Date.parse(date) > Date.now() + 86400000) problems.date = 'The date can\'t be in the future.';
  if (Object.keys(problems).length) throw new HttpError(422, Object.values(problems)[0], { fields: problems });
  const text = body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return { title, client, ...(role ? { role } : {}), date, text };
}

export function reviewsRoutes(H) {
  const { HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent, publicBase } = H;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fromFile = (data) => ({ items: (data.items || []).map((t) => ({ ...t })) });

  function view(row) {
    return { revision: row.revision, draft: row.draft, live: row.live, hasUnpublishedChanges: !same(row.draft, row.live), lastCommit: row.last_commit, updatedAt: row.updated_at };
  }
  async function readRow(A) {
    const r = await A.db.prepare('SELECT * FROM settings WHERE key = ?').bind(KEY).first();
    return r ? { ...r, draft: JSON.parse(r.draft), live: r.live ? JSON.parse(r.live) : null } : null;
  }
  /** Load the reviews, creating them from the website the first time and picking up changes made in the repo. */
  async function load(A) {
    let row = await readRow(A);
    let file = null;
    try { file = A.env.GITHUB_TOKEN ? await github(A.env).getFile(FILE) : null; } catch { /* offline: use what we have */ }
    const repoState = file ? fromFile(JSON.parse(new TextDecoder().decode(file.bytes))) : fromFile(testimonialsContent);
    const t = now();
    if (!row) {
      await A.db.prepare('INSERT OR IGNORE INTO settings (key, revision, draft, live, repo_sha, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .bind(KEY, JSON.stringify(repoState), JSON.stringify(repoState), file?.sha || null, t, 'website').run();
      return readRow(A);
    }
    if (file && row.repo_sha !== file.sha) {
      const untouched = same(row.draft, row.live);
      if (!same(row.live, repoState)) {
        await A.db.prepare('UPDATE settings SET live = ?, draft = ?, repo_sha = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE key = ?')
          .bind(JSON.stringify(repoState), JSON.stringify(untouched ? repoState : row.draft), file.sha, t, 'website', KEY).run();
      } else {
        await A.db.prepare('UPDATE settings SET repo_sha = ? WHERE key = ?').bind(file.sha, KEY).run();
      }
      row = await readRow(A);
    }
    return row;
  }
  async function write(A, changes, expectedRevision) {
    const fields = { ...changes, updated_at: now(), updated_by: A.user.email };
    const cols = Object.keys(fields);
    const vals = cols.map((c) => ((c === 'draft' || c === 'live') && fields[c] && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c]));
    const res = await A.db.prepare(`UPDATE settings SET ${cols.map((c) => `${c} = ?`).join(', ')}, revision = revision + 1 WHERE key = ? AND revision = ?`).bind(...vals, KEY, expectedRevision).run();
    if (!res.meta.changes) throw new HttpError(409, 'The reviews were changed on another computer since you opened this page. Click "Reload latest" to see the newest version.', { conflict: true });
    return readRow(A);
  }
  const uniqueSlug = (base, taken) => { let s = base || 'review'; let n = 2; while (taken.has(s)) s = `${base}-${n++}`; return s; };

  const routes = {
    async get(A) { return json(view(await load(A))); },

    async add(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const r = cleanReview(body.fields, HttpError);
      const taken = new Set([...row.draft.items, ...row.live.items].map((x) => x.slug));
      const item = { slug: uniqueSlug(slugify(r.title).slice(0, 60), taken), ...r };
      const updated = await write(A, { draft: { items: [item, ...row.draft.items] } }, rev);
      await logEvent(A, 'save-review-add', null, { slug: item.slug });
      return json(view(updated));
    },

    async edit(A, slug) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const i = row.draft.items.findIndex((x) => x.slug === slug);
      if (i < 0) throw new HttpError(404, 'That review is no longer there. Please reload the page.');
      const r = cleanReview(body.fields, HttpError);
      const old = row.draft.items[i];
      const items = row.draft.items.slice();
      // The web address (slug) never changes once a review exists. Editing the text means it is no longer a cut-off excerpt.
      items[i] = { slug: old.slug, ...r };
      const updated = await write(A, { draft: { items } }, rev);
      await logEvent(A, 'save-review-edit', null, { slug });
      return json(view(updated));
    },

    async remove(A, slug) {
      const rev = Number(A.url.searchParams.get('baseRevision'));
      if (!Number.isInteger(rev)) throw new HttpError(400, 'Please reload the page and try again.');
      const row = await load(A);
      const items = row.draft.items.filter((x) => x.slug !== slug);
      if (items.length === row.draft.items.length) throw new HttpError(404, 'That review was already removed.');
      if (!items.length) throw new HttpError(422, 'The website needs at least one review. Add a new one first, then remove this one.');
      const updated = await write(A, { draft: { items } }, rev);
      await logEvent(A, 'save-review-remove', null, { slug });
      return json(view(updated));
    },

    async discard(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const updated = await write(A, { draft: row.live }, rev);
      await logEvent(A, 'save-review-discard');
      return json(view(updated));
    },

    async preview(A) {
      const row = await load(A);
      const base = publicBase(A.env);
      const ctx = { site: siteContent, preview: true, siteUrl: '', buildId: 'preview-' + Date.now(), listings: [], removed: [], testimonials: row.draft.items, url: (p) => base + p };
      const html = layout(ctx, { path: '/testimonials/', title: 'Testimonials', body: testimonialsPage(ctx) });
      const origin = base ? new URL(base).origin : "'self'";
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
          'Content-Security-Policy': `default-src 'none'; img-src 'self' ${origin}; style-src ${origin} 'unsafe-inline'; font-src ${origin}; script-src ${origin}; manifest-src ${origin}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
        },
      });
    },

    async publish(A) {
      await rateLimit(A, 'publish');
      if (!A.env.GITHUB_TOKEN) throw new HttpError(503, 'Publishing is not connected yet. Your changes are saved. Please tell James.');
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      if (row.revision !== rev) throw new HttpError(409, 'The reviews were changed on another computer. Click "Reload latest" first.', { conflict: true });
      const t = Date.now();
      const lock = await A.db.prepare('UPDATE settings SET lock_until = ? WHERE key = ? AND (lock_until IS NULL OR lock_until < ?)').bind(t + 90_000, KEY, t).run();
      if (!lock.meta.changes) throw new HttpError(409, 'The reviews are already being published. Please wait a minute.');
      try {
        const d = row.draft;
        const gh = github(A.env);
        const liveSlugs = new Set(row.live.items.map((x) => x.slug));
        const result = await gh.commit(`Update client reviews (${d.items.length} on the website)\n\nBy ${A.user.email} via the owner editor.`, async () => {
          const file = JSON.parse((await gh.getText(FILE)) || '{"items":[]}');
          const keep = new Set(d.items.map((x) => x.slug));
          // Remember removed reviews so their old web address forwards to the reviews page.
          const removed = new Set(file.removedSlugs || []);
          for (const s of liveSlugs) if (!keep.has(s)) removed.add(s);
          for (const s of keep) removed.delete(s);
          file.items = d.items;
          if (removed.size) file.removedSlugs = [...removed]; else delete file.removedSlugs;
          return [{ path: FILE, content: JSON.stringify(file, null, 2) + '\n' }];
        });
        const updated = await write(A, { live: d, last_commit: result.sha, lock_until: null }, row.revision);
        await logEvent(A, 'publish-reviews', null, { commit: result.sha });
        return { reviews: view(updated), commit: result.sha, checkPath: '/testimonials/' };
      } finally {
        await A.db.prepare('UPDATE settings SET lock_until = NULL WHERE key = ?').bind(KEY).run();
      }
    },
  };

  return async function handle(A, parts, method, idempotent) {
    if (parts.length === 1 && method === 'GET') return routes.get(A);
    if (parts.length === 1 && method === 'POST') return routes.add(A);
    if (parts[1] === 'preview' && method === 'GET') return routes.preview(A);
    if (parts[1] === 'publish' && method === 'POST') return idempotent(A, () => routes.publish(A));
    if (parts[1] === 'discard' && method === 'POST') return routes.discard(A);
    if (parts[1] === 'item' && parts.length === 3 && method === 'PUT') return routes.edit(A, parts[2]);
    if (parts[1] === 'item' && parts.length === 3 && method === 'DELETE') return routes.remove(A, parts[2]);
    throw new HttpError(404, 'Not found.');
  };
}
