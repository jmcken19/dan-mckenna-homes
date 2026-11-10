// Runs the real owner editor Worker in Miniflare (Cloudflare's local runtime) with:
//  - a real RSA-signed Cloudflare Access token check (we act as the Access issuer),
//  - an in-memory fake of the GitHub API (or the real API when GITHUB_MODE=real),
//  - a fake public site whose /version.json follows the fake repo's head commit,
//  - a fake email service that records messages.
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createSign, createHash, randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEAM = 'dmh-test.cloudflareaccess.com';
export const AUD = 'test-aud-123';
export const OWNER = 'dan@example.com';
export const MAINT = 'james@example.com';
export const SITE = 'https://site.example.test';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64u = (b) => Buffer.from(b).toString('base64url');
export function accessToken(email, { aud = AUD, exp = Math.floor(Date.now() / 1000) + 3600, key = privateKey, kid = 'k1' } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ email, aud: [aud], exp, iat: Math.floor(Date.now() / 1000), iss: `https://${TEAM}` }));
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key);
  return `${h}.${p}.${b64u(s)}`;
}
export const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

/* ---------------- fake GitHub ---------------- */
export class FakeGitHub {
  constructor() {
    this.blobs = new Map(); this.trees = new Map(); this.commits = new Map();
    this.files = new Map(); // path -> blob sha (current head)
    this.runs = new Map(); // commit sha -> conclusion
    this.failNextRun = false; this.raceOnce = false;
    const init = this.commitTree(new Map(), null, 'init');
    this.head = init;
  }
  sha(x) { return createHash('sha1').update(x).digest('hex'); }
  putBlob(bytes) { const s = this.sha(Buffer.concat([Buffer.from('blob'), bytes, randomBytes(0)])); this.blobs.set(s, bytes); return s; }
  commitTree(files, parent, message) {
    const treeSha = this.sha(JSON.stringify([...files.entries()].sort()));
    this.trees.set(treeSha, new Map(files));
    const c = this.sha(treeSha + (parent || '') + message + Math.random());
    this.commits.set(c, { tree: treeSha, parent, message });
    return c;
  }
  seed(path, content) {
    const files = new Map(this.trees.get(this.commits.get(this.head).tree));
    files.set(path, this.putBlob(Buffer.from(content)));
    this.head = this.commitTree(files, this.head, 'seed ' + path);
  }
  headFiles() { return this.trees.get(this.commits.get(this.head).tree); }
  read(path) { const s = this.headFiles().get(path); return s ? this.blobs.get(s) : null; }
  async handle(req) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const body = req.method === 'GET' ? null : await req.json().catch(() => null);
    const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (!/^Bearer .+/.test(req.headers.get('authorization') || '')) return j({ message: 'auth' }, 401);
    let m;
    if ((m = p.match(/^\/contents\/(.+)$/))) {
      const path = decodeURI(m[1]); const files = this.headFiles();
      if (files.has(path)) return j({ sha: files.get(path), content: this.blobs.get(files.get(path)).toString('base64'), type: 'file', path, name: path.split('/').pop() });
      const kids = [...files.keys()].filter((f) => f.startsWith(path + '/') && !f.slice(path.length + 1).includes('/'));
      return kids.length ? j(kids.map((f) => ({ path: f, name: f.split('/').pop(), type: 'file', sha: files.get(f) }))) : j({ message: 'Not Found' }, 404);
    }
    if (p === '/git/ref/heads/main') return j({ object: { sha: this.head } });
    if ((m = p.match(/^\/git\/commits\/(\w+)$/)) && req.method === 'GET') return j({ sha: m[1], tree: { sha: this.commits.get(m[1]).tree } });
    if (p === '/git/blobs') return j({ sha: this.putBlob(Buffer.from(body.content, 'base64')) }, 201);
    if (p === '/git/trees') {
      const files = new Map(this.trees.get(body.base_tree));
      for (const e of body.tree) { if (e.sha === null) files.delete(e.path); else files.set(e.path, e.sha); }
      const treeSha = this.sha(JSON.stringify([...files.entries()].sort()));
      this.trees.set(treeSha, files);
      return j({ sha: treeSha }, 201);
    }
    if (p === '/git/commits') { const c = this.sha(body.tree + body.parents[0] + body.message + Math.random()); this.commits.set(c, { tree: body.tree, parent: body.parents[0], message: body.message }); return j({ sha: c }, 201); }
    if (p === '/git/refs/heads/main' && req.method === 'PATCH') {
      if (this.raceOnce) { this.raceOnce = false; this.seed('README-race.md', 'someone else pushed'); }
      const c = this.commits.get(body.sha);
      if (c.parent !== this.head) return j({ message: 'Update is not a fast forward' }, 422);
      const prevTree = this.headFiles();
      this.head = body.sha;
      this.runs.set(body.sha, this.failNextRun ? 'failure' : 'success'); this.failNextRun = false;
      if (this.onCommit) await this.onCommit(body.sha, prevTree, this.headFiles(), c.message);
      return j({ object: { sha: body.sha } });
    }
    if (p === '/actions/runs') {
      const sha = url.searchParams.get('head_sha');
      return j({ workflow_runs: this.runs.has(sha) ? [{ id: 1, status: 'completed', conclusion: this.runs.get(sha) }] : [] });
    }
    if (p.match(/^\/actions\/runs\/\d+\/rerun-failed-jobs$/)) { for (const k of this.runs.keys()) this.runs.set(k, 'success'); return j({}, 201); }
    if ((m = p.match(/^\/compare\/(\w+)\.\.\.(\w+)$/))) {
      let c = m[2]; while (c) { if (c === m[1]) return j({ status: m[1] === m[2] ? 'identical' : 'ahead' }); c = this.commits.get(c)?.parent; }
      return j({ status: 'diverged' });
    }
    return j({ message: 'unhandled ' + p }, 500);
  }
}

async function bundle() {
  const r = await build({ entryPoints: [join(root, 'owner/src/index.mjs')], bundle: true, format: 'esm', write: false, platform: 'neutral', loader: { '.json': 'json' } });
  return r.outputFiles[0].text;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.txt': 'text/plain' };

export async function startEditor({ resend = true, port, mirror = null, siteUrl = SITE, persist = null } = {}) {
  const gh = new FakeGitHub();
  if (mirror) await mirror.attach(gh);
  const emails = [];
  const site = { deployed: null, deployDelayCalls: 1, calls: 0, deploy: true };
  const script = await bundle();
  const ui = join(root, 'owner/ui');
  const mf = new Miniflare({
    ...(port ? { port, host: '127.0.0.1' } : {}),
    modules: true, script, compatibilityDate: '2026-07-01',
    d1Databases: ['DB'], kvNamespaces: ['PHOTOS'],
    ...(persist ? { d1Persist: persist + '/d1', kvPersist: persist + '/kv' } : {}),
    bindings: {
      GITHUB_REPO: 'test/dmh', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'fake-token',
      PUBLIC_SITE_URL: siteUrl, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
      OWNER_EMAILS: OWNER, MAINTAINER_EMAILS: MAINT, NOTIFY_TO: MAINT,
      SUPPORT_NAME: 'James', SUPPORT_EMAIL: MAINT, SUPPORT_PHONE: '555-0100',
      ...(resend ? { RESEND_API_KEY: 're_test' } : {}),
    },
    serviceBindings: {
      ASSETS: async (req) => {
        let path = new URL(req.url).pathname; if (path === '/') path = '/index.html';
        try { const body = await readFile(join(ui, path.replace(/\.\.+/g, ''))); return new Response(body, { headers: { 'content-type': MIME[extname(path)] || 'application/octet-stream' } }); } catch { return new Response('not found', { status: 404 }); }
      },
    },
    outboundService: async (req) => {
      const u = new URL(req.url);
      if (u.host === TEAM && u.pathname === '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
      if (mirror && u.host === 'api.github.com' && u.pathname.endsWith('/actions/runs')) return mirror.runs(u.searchParams.get('head_sha'));
      if (mirror && u.host === 'api.github.com' && u.pathname.includes('/compare/')) return mirror.compare(u.pathname);
      if (mirror && req.url.startsWith(siteUrl) && u.pathname.endsWith('/version.json')) return mirror.version();
      if (u.host === 'api.github.com') return gh.handle(req);
      if (u.origin === new URL(siteUrl).origin && u.pathname === '/version.json') {
        // The fake site "deploys" the head commit after a couple of status checks, unless the run failed.
        site.calls++;
        if (site.deploy && gh.runs.get(gh.head) === 'success' && site.calls % (site.deployDelayCalls + 1) === 0) site.deployed = gh.head;
        return site.deployed ? Response.json({ build: site.deployed }) : new Response('nope', { status: 404 });
      }
      if (u.host === 'api.resend.com') { const b = await req.json(); emails.push(b); return Response.json({ id: 'em_' + emails.length }); }
      return new Response('blocked in test: ' + req.url, { status: 599 });
    },
  });
  const migDir = join(root, 'owner/migrations');
  const migration = (await Promise.all((await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort().map((f) => readFile(join(migDir, f), 'utf8')))).join(';\n');
  const db = await mf.getD1Database('DB');
  if (!persist || !existsSync(persist + '/.migrated')) for (const stmt of migration.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  if (persist) { mkdirSync(persist, { recursive: true }); writeFileSync(persist + '/.migrated', '1'); }
  if (!mirror) {
    gh.seed('content/removed.json', await readFile(join(root, 'content/removed.json'), 'utf8'));
    gh.seed('content/testimonials.json', await readFile(join(root, 'content/testimonials.json'), 'utf8'));
    const site = JSON.parse(await readFile(join(root, 'content/site.json'), 'utf8'));
    site.heroSlides = [{ id: 's-hero1', src: '/assets/img/hero-1', alt: 'Backyard patio', focus: '50% 70%' }];
    site.heroSlideSeconds = 7; site.heroFade = false; site.heroAutoplay = true;
    gh.seed('content/site.json', JSON.stringify(site, null, 2));
    for (const w of [800, 1400, 2000]) gh.seed(`public/assets/img/hero-1-${w}.jpg`, await readFile(join(root, `public/assets/img/hero-1-${w}.jpg`)));
    for (const f of ['dan-mckenna-headshot.jpg', 'construction.jpg', '2515-forest-lawn-dr-800.jpg', '2515-forest-lawn-dr-1400.jpg']) gh.seed(`public/assets/img/${f}`, await readFile(join(root, `public/assets/img/${f}`)));
  }
  const url = port ? `http://127.0.0.1:${port}` : 'http://editor.test';
  const call = async (method, path, { as = OWNER, body, form, idem, headers = {}, token } = {}) => {
    const h = { 'X-DMH-Editor': '1', ...headers };
    if (as) h['Cf-Access-Jwt-Assertion'] = token || accessToken(as);
    if (idem !== false && method !== 'GET') h['Idempotency-Key'] = idem || 'k' + randomBytes(8).toString('hex');
    let payload;
    if (form) { const r = new Response(form); h['Content-Type'] = r.headers.get('content-type'); payload = Buffer.from(await r.arrayBuffer()); } else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await mf.dispatchFetch(url + path, { method, headers: h, body: payload });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return { mf, gh, emails, site, call, url, close: () => mf.dispose() };
}

/** Make a real JPEG with EXIF + GPS, using sharp. */
export async function testJpeg({ width = 1600, height = 1200, color = '#7a9', gps = true, label = '' } = {}) {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="${Math.round(height / 6)}" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  let img = sharp(Buffer.from(svg)).jpeg({ quality: 80 });
  if (gps) img = img.withExifMerge({ IFD0: { Make: 'TestPhone', Model: 'GPS-Test' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 2/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '80/1 45/1 0/1' } });
  return img.toBuffer();
}

export async function listFixtures() { return readdir(join(root, 'tests')); }


/* ---------------- real-repo mirror ----------------
 * Each commit the editor makes (through the emulated GitHub API) is replayed into a real
 * clone with git and pushed, so the real GitHub Actions build + Pages deploy run. Publish
 * status is then answered from the real Actions/Deployments APIs (read-only, allowed). */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
export function realMirror(dir, { repo = 'jmcken19/dan-mckenna-homes', branch = 'main' } = {}) {
  const map = new Map(); // fake sha -> real sha
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const { ProxyAgent, fetch: ufetch } = awaitUndici();
  const agent = new ProxyAgent(process.env.HTTPS_PROXY);
  const gapi = (p) => ufetch(`https://api.github.com/repos/${repo}${p}`, { dispatcher: agent, headers: { 'User-Agent': 'dmh-test', Accept: 'application/vnd.github+json' } }).then((r) => r.json());
  let gh;
  return {
    map,
    async attach(fake) {
      gh = fake;
      git('pull', '-q', '--rebase', 'origin', branch);
      const walk = (rel) => { const abs = join(dir, rel); if (!existsSync(abs)) return []; return readdirSync(abs).flatMap((n) => { const r = rel + '/' + n; return statSync(join(dir, r)).isDirectory() ? walk(r) : [r]; }); };
      for (const f of ['content/removed.json', 'content/site.json', 'content/testimonials.json', ...walk('content/listings'), ...walk('public/listings'), ...walk('public/assets/img/hero'), 'public/assets/img/hero-1-800.jpg', 'public/assets/img/hero-1-1400.jpg', 'public/assets/img/hero-1-2000.jpg', 'public/assets/img/dan-mckenna-headshot.jpg', 'public/assets/img/construction.jpg', 'public/assets/img/2515-forest-lawn-dr-800.jpg', 'public/assets/img/2515-forest-lawn-dr-1400.jpg']) gh.seed(f, readFileSync(join(dir, f)));
      fake.onCommit = async (sha, before, after, message) => {
        for (const [path, blob] of after) if (before.get(path) !== blob) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), gh.blobs.get(blob)); }
        for (const path of before.keys()) if (!after.has(path) && !path.startsWith('README-race')) rmSync(join(dir, path), { force: true });
        git('add', '-A', '--', ...['content', 'public/listings', 'public/assets/img'].filter((d) => existsSync(join(dir, d)) || git('ls-files', d)));
        execFileSync('git', ['-C', dir, '-c', 'user.name=James McKenna', '-c', 'user.email=jmck2134@gmail.com', 'commit', '-q', '-m', message + '\n\n[acceptance test via owner editor]\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01V7nEdbx1J3PYduWzdcbP3f']);
        git('push', '-q', 'origin', branch);
        map.set(sha, git('rev-parse', 'HEAD'));
      };
    },
    async runs(fakeSha) {
      const real = map.get(fakeSha);
      if (!real) return Response.json({ workflow_runs: [] });
      const d = await gapi(`/actions/runs?head_sha=${real}&per_page=5`);
      return Response.json({ workflow_runs: (d.workflow_runs || []).map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion })) });
    },
    async version() {
      const deps = await gapi('/deployments?environment=github-pages&per_page=5');
      for (const dpl of deps) {
        const st = await gapi(`/deployments/${dpl.id}/statuses?per_page=1`);
        if (st[0]?.state === 'success') {
          const fake = [...map.entries()].find(([, r]) => r === dpl.sha)?.[0];
          return Response.json({ build: fake || dpl.sha });
        }
      }
      return new Response('none', { status: 404 });
    },
    async compare(path) {
      const [a, b] = path.split('/compare/')[1].split('...');
      const ra = map.get(a), rb = map.get(b);
      if (!ra || !rb) return Response.json({ status: 'diverged' });
      const d = await gapi(`/compare/${ra}...${rb}`);
      return Response.json({ status: d.status });
    },
  };
}
import { createRequire } from 'node:module';
function awaitUndici() { return createRequire(import.meta.url)('undici'); }

/** Dan's setup, in the same shape as client-site-template's clientSetup(), for the shared browser tests. */
export async function clientSetup() {
  const { PHOTO_SPOTS } = await import('../src/lib/photos.mjs');
  const { readFile: rf } = await import('node:fs/promises');
  const here = dirname(fileURLToPath(import.meta.url));
  const site = JSON.parse(await rf(join(here, '../content/site.json'), 'utf8'));
  const reviews = JSON.parse(await rf(join(here, '../content/testimonials.json'), 'utf8')).items || [];
  return {
    config: { photoSpots: PHOTO_SPOTS, features: { slideshow: true, reviews: true } },
    site: { ...site, heroSlides: [{ id: 's-hero1', src: '/assets/img/hero-1' }] }, // the harness seeds one slide
    reviews, slideshow: true, reviewsOn: true, reviewsPath: '/testimonials/', reviewsFile: 'content/testimonials.json', spots: Object.keys(PHOTO_SPOTS),
  };
}
