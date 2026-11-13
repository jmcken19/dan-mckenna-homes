// The live-site Worker (site/worker.mjs) running in the real Workers runtime (Miniflare, local – nothing leaves this
// computer): page requests still reach the website, and /api/contact works end to end with the real send_email and
// rate-limit bindings. Only Cloudflare's Turnstile check is mocked. The endpoint's rules are in tests/contact.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';

const HOST = 'www.danmckennahomes.com';
const APEX = 'danmckennahomes.com';
const src = (f) => ({ type: 'ESModule', path: `site/${f}`, contents: readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8') });
const verifies = [];
function worker({ ready = true } = {}) {
  return new Miniflare({
    modules: [src('worker.mjs'), src('contact.mjs')], modulesRoot: 'site', compatibilityDate: '2026-07-01',
    serviceBindings: { ASSETS: () => new Response('<h1>a page</h1>', { headers: { 'Content-Type': 'text/html' } }) },
    bindings: { MAIN_HOST: HOST, APEX_HOST: APEX, CONTACT_FROM: `form@${APEX}`, CONTACT_SUBJECT: `New message from ${APEX}`, ...(ready ? { TURNSTILE_SECRET: 'ts-secret', CONTACT_TO: 'owner-private@example.net' } : {}) },
    ratelimits: { CONTACT_RATE: { namespace_id: '1001', simple: { limit: 5, period: 60 } } },
    ...(ready ? { email: { send_email: [{ name: 'EMAIL' }] } } : {}),
    outboundService: async (req) => { verifies.push(await req.json()); return new Response(JSON.stringify({ success: true })); },
  });
}
const mf = worker(), bare = worker({ ready: false });
after(async () => { await mf.dispose(); await bare.dispose(); });
const post = (w, body, origin = `https://${HOST}`) => w.dispatchFetch(`https://${HOST}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify(body) });
const good = () => ({ name: 'Pat Visitor', email: 'pat@visitor.example', phone: '', message: 'Hello from the test.', _honey: '', _t: Date.now() - 20_000, _sent: Date.now(), token: 'tok', page: '/contact/' });

test('pages still come from the website, with the safety headers; the bare domain forwards to www', async () => {
  const page = await mf.dispatchFetch(`https://${HOST}/about-us/`);
  assert.equal(await page.text(), '<h1>a page</h1>');
  assert.equal(page.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(page.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  const fwd = await mf.dispatchFetch(`https://${APEX}/contact/`, { redirect: 'manual' });
  assert.deepEqual([fwd.status, fwd.headers.get('Location')], [301, `https://${HOST}/contact/`]);
});

test('/api/contact in the Worker: ready, refuses other sites, sends a good message, rate-limits a burst', async () => {
  assert.deepEqual(await (await mf.dispatchFetch(`https://${HOST}/api/contact`)).json(), { ready: true });
  const evil = await post(mf, good(), 'https://evil.example');
  assert.deepEqual([evil.status, await evil.json()], [403, { success: false }]);
  const ok = await post(mf, good());
  assert.deepEqual([ok.status, await ok.json()], [200, { success: true }]);
  assert.deepEqual(verifies.at(-1), { secret: 'ts-secret', response: 'tok', remoteip: '203.0.113.9' });
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await post(mf, good())).status);
  assert.ok(statuses.includes(429), `more than 5 a minute from one address is refused (${statuses})`);
  assert.equal(statuses.filter((s) => s === 200).length, 4, 'five in the minute went through, counting the first');
});

test('before the secrets and the email binding are set: ready:false and the form endpoint fails (the site keeps the old form)', async () => {
  assert.deepEqual(await (await bare.dispatchFetch(`https://${HOST}/api/contact`)).json(), { ready: false });
  const r = await post(bare, good());
  assert.deepEqual([r.status, await r.json()], [503, { success: false }]);
  assert.equal((await bare.dispatchFetch(`https://${HOST}/`)).status, 200, 'pages are not affected');
});
