// Website wording: every visible word the owner can click and change on the page (headings, paragraphs, buttons,
// menu labels, footer lines, contact details). Words live in content/text.json → "text" and, for business facts,
// in content/site.json (the fields listed in text.json → "siteFields", keys "site.<field>"). See src/lib/text.mjs.
// Same safety model as reviews: private draft in D1 (settings row "text"), revision check on every save,
// one non-forced Git commit to publish that changes only the words that changed (all other fields are kept).
import { github } from './github.mjs';
import { cleanText, textRules, withPhoneLinks, TEXT_FILE } from '../../src/lib/text.mjs';
import siteContent from '../../content/site.json';
import textContent from '../../content/text.json';

const KEY = 'text';
const SITE_FILE = 'content/site.json';
const isWords = (v) => (typeof v === 'string' && v.trim()) || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'));

/** The editable words of the two files: { text: {key: words}, site: {field: words}, rules }. */
export function wordsFrom(textFile, site) {
  const rules = textRules(textFile);
  const s = {};
  for (const f of rules.siteFields) if (isWords(site?.[f])) s[f] = site[f];
  return { text: { ...(textFile?.text || {}) }, site: s, rules };
}

/** Page content with the owner's unpublished words (for previews): { site, text } to put on ctx. */
export function withDraftWords(site, textFile, draftJson) {
  let d = null;
  try { d = draftJson ? (typeof draftJson === 'string' ? JSON.parse(draftJson) : draftJson) : null; } catch (err) { console.error('text draft unreadable', err?.message); }
  if (!d?.text || !d?.site) return { site, text: textFile };
  return { site: withPhoneLinks({ ...site, ...d.site }, site), text: { ...textFile, text: { ...textFile.text, ...d.text } } };
}

export function textRoutes(H) {
  const { HttpError, json, now, readJsonBody, needRevision, rateLimit, logEvent } = H;
  const words = (st) => JSON.stringify({ text: st?.text, site: st?.site });
  const same = (a, b) => words(a) === words(b);
  /** The keys whose words differ between two states: ['home.title', 'site.phone', …]. */
  const changedKeys = (a, b) => [
    ...Object.keys(a.text).filter((k) => JSON.stringify(a.text[k]) !== JSON.stringify(b?.text?.[k])),
    ...Object.keys(a.site).filter((f) => JSON.stringify(a.site[f]) !== JSON.stringify(b?.site?.[f])).map((f) => `site.${f}`),
  ];

  function view(row) {
    return { revision: row.revision, draft: row.draft, live: row.live, hasUnpublishedChanges: !same(row.draft, row.live), changed: changedKeys(row.draft, row.live), lastCommit: row.last_commit, updatedAt: row.updated_at };
  }
  async function readRow(A) {
    const r = await A.db.prepare('SELECT * FROM settings WHERE key = ?').bind(KEY).first();
    return r ? { ...r, draft: JSON.parse(r.draft), live: r.live ? JSON.parse(r.live) : null } : null;
  }
  async function repoFiles(A) {
    if (!A.env.GITHUB_TOKEN) return null;
    try {
      const gh = github(A.env);
      const [t, s] = await Promise.all([gh.getFile(TEXT_FILE), gh.getFile(SITE_FILE)]);
      if (!t || !s) return null;
      const dec = (f) => JSON.parse(new TextDecoder().decode(f.bytes));
      return { state: wordsFrom(dec(t), dec(s)), sha: `${t.sha}:${s.sha}` };
    } catch { return null; } // offline: use what we have
  }
  /** Load the words, creating them from the website the first time and picking up changes made in the repo
   *  (e.g. a new page's wording added by a helper). Unpublished changes the owner made are kept on top. */
  async function load(A) {
    let row = await readRow(A);
    const repo = await repoFiles(A);
    const repoState = repo ? repo.state : wordsFrom(textContent, siteContent);
    const t = now();
    if (!row) {
      await A.db.prepare('INSERT OR IGNORE INTO settings (key, revision, draft, live, repo_sha, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .bind(KEY, JSON.stringify(repoState), JSON.stringify(repoState), repo?.sha || null, t, 'website').run();
      return readRow(A);
    }
    if (repo && row.repo_sha !== repo.sha) {
      if (!same(row.live, repoState) || JSON.stringify(row.live.rules) !== JSON.stringify(repoState.rules)) {
        // The owner's own unpublished changes go on top of the newest website words.
        const draft = { ...repoState, text: { ...repoState.text }, site: { ...repoState.site } };
        for (const k of changedKeys(row.draft, row.live)) {
          if (k.startsWith('site.')) { const f = k.slice(5); if (f in draft.site) draft.site[f] = row.draft.site[f]; } else if (k in draft.text) draft.text[k] = row.draft.text[k];
        }
        await A.db.prepare('UPDATE settings SET live = ?, draft = ?, repo_sha = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE key = ?')
          .bind(JSON.stringify(repoState), JSON.stringify(draft), repo.sha, t, 'website', KEY).run();
      } else {
        await A.db.prepare('UPDATE settings SET repo_sha = ? WHERE key = ?').bind(repo.sha, KEY).run();
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
    if (!res.meta.changes) throw new HttpError(409, 'The words on your website were changed on another computer since you opened this page. Click "Reload latest" to see the newest version, then type your change again.', { conflict: true });
    return readRow(A);
  }

  const routes = {
    async get(A) { return json(view(await load(A))); },

    // Body: { key, value, baseRevision }. value = the words (one line), or a list of paragraphs / list items.
    async item(A) {
      await rateLimit(A, 'save');
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const key = typeof body.key === 'string' ? body.key : '';
      const row = await load(A);
      const isSite = key.startsWith('site.');
      const field = isSite ? key.slice(5) : key;
      const box = isSite ? row.draft.site : row.draft.text;
      if (!key || !Object.prototype.hasOwnProperty.call(box, field)) throw new HttpError(404, 'These words can\'t be changed here any more. Please click "Reload latest".', { conflict: true });
      const rules = row.draft.rules || textRules(textContent);
      const cur = box[field];
      const meta = { multi: Array.isArray(cur) ? (body.list ? 'li' : 'p') : false, kind: rules.kinds?.[key] || '', must: (rules.mustStay || []).includes(key) };
      const r = cleanText(body.value, meta);
      if (r.error) throw new HttpError(422, r.error, { field: key });
      if (JSON.stringify(r.value) === JSON.stringify(cur)) {
        if (row.revision !== rev) throw new HttpError(409, 'The words on your website were changed on another computer. Click "Reload latest" first.', { conflict: true });
        return json(view(row)); // nothing changed
      }
      const draft = { ...row.draft, text: { ...row.draft.text }, site: { ...row.draft.site } };
      (isSite ? draft.site : draft.text)[field] = r.value;
      const updated = await write(A, { draft }, rev);
      await logEvent(A, 'save-text', null, { key, length: JSON.stringify(r.value).length });
      return json(view(updated));
    },

    async discard(A) {
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      const updated = await write(A, { draft: row.live }, rev);
      await logEvent(A, 'save-text-discard');
      return json(view(updated));
    },

    async publish(A) {
      await rateLimit(A, 'publish');
      if (!A.env.GITHUB_TOKEN) throw new HttpError(503, 'Publishing is not connected yet. Your changes are saved. Please tell James.');
      const body = await readJsonBody(A.request);
      const rev = needRevision(body);
      const row = await load(A);
      if (row.revision !== rev) throw new HttpError(409, 'The words on your website were changed on another computer. Click "Reload latest" first.', { conflict: true });
      const t = Date.now();
      const lock = await A.db.prepare('UPDATE settings SET lock_until = ? WHERE key = ? AND (lock_until IS NULL OR lock_until < ?)').bind(t + 90_000, KEY, t).run();
      if (!lock.meta.changes) throw new HttpError(409, 'Your words are already being published. Please wait a minute.');
      try {
        const d = row.draft;
        const keys = changedKeys(d, row.live);
        const gh = github(A.env);
        const result = await gh.commit(`Update website wording (${keys.length} change${keys.length === 1 ? '' : 's'})\n\nChanged: ${keys.join(', ').slice(0, 900)}\nBy ${A.user.email} via the owner editor.`, async () => {
          // Re-read both files and change only the words that changed – every other field stays as it is.
          const textFile = JSON.parse(await gh.getText(TEXT_FILE));
          const siteRaw = await gh.getText(SITE_FILE);
          const site = JSON.parse(siteRaw);
          const before = { ...site };
          let textChanged = false;
          for (const k of keys) {
            if (k.startsWith('site.')) site[k.slice(5)] = d.site[k.slice(5)];
            else { textFile.text[k] = d.text[k]; textChanged = true; }
          }
          const newSite = withPhoneLinks(site, before); // phone changed → its tel:/sms: links follow
          const out = [];
          if (textChanged) out.push({ path: TEXT_FILE, content: JSON.stringify(textFile, null, 2) + '\n' });
          if (keys.some((k) => k.startsWith('site.'))) out.push({ path: SITE_FILE, content: JSON.stringify(newSite, null, 2) + '\n' });
          return out;
        });
        const updated = await write(A, { live: d, last_commit: result.sha, lock_until: null }, row.revision);
        await logEvent(A, 'publish-text', null, { commit: result.sha, keys: keys.slice(0, 50) });
        return { text: view(updated), commit: result.sha, checkPath: '/' };
      } finally {
        await A.db.prepare('UPDATE settings SET lock_until = NULL WHERE key = ?').bind(KEY).run();
      }
    },
  };

  return async function handle(A, parts, method, idempotent) {
    if (parts.length === 1 && method === 'GET') return routes.get(A);
    if (parts[1] === 'item' && parts.length === 2 && method === 'POST') return routes.item(A);
    if (parts[1] === 'publish' && method === 'POST') return idempotent(A, () => routes.publish(A));
    if (parts[1] === 'discard' && method === 'POST') return routes.discard(A);
    throw new HttpError(404, 'Not found.');
  };
}
