// The contact form endpoint (site/contact.mjs → POST /api/contact), with Cloudflare's parts mocked:
// fetch (the Turnstile check), the send_email binding, the rate limiter and the KV hour counter.
// Same file in client-site-template. Nothing here sends a real email or calls Cloudflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleContact, contactReady, buildMime, LIMITS, PER_HOUR } from '../site/contact.mjs';

const HOST = 'www.example.com';
const TO = 'owner-private@example.net'; // stands in for the CONTACT_TO secret
const T0 = 1_800_000_000_000;

function setup({ turnstile = { success: true }, rateOk = true, kv = false, sendFails = false, env: extra = {} } = {}) {
  const mails = [], verifies = [], store = new Map();
  const env = {
    MAIN_HOST: HOST, CONTACT_FROM: 'form@example.com', CONTACT_SUBJECT: 'New message from example.com',
    TURNSTILE_SECRET: 'ts-secret', CONTACT_TO: TO,
    EMAIL: { send: async (m) => { if (sendFails) throw new Error('destination address not verified'); mails.push(m); } },
    CONTACT_RATE: { limit: async ({ key }) => ({ success: typeof rateOk === 'function' ? rateOk(key) : rateOk }) },
    ...(kv ? { CONTACT_KV: { get: async (k) => store.get(k) ?? null, put: async (k, v, o) => { store.set(k, v); store.ttl = o?.expirationTtl; } } } : {}),
    ...extra,
  };
  const deps = {
    now: () => T0,
    makeEmail: (from, to, raw) => ({ from, to, raw }),
    fetch: async (url, init) => { verifies.push({ url, body: JSON.parse(init.body) }); if (turnstile === 'down') throw new Error('network'); return new Response(JSON.stringify(turnstile)); },
  };
  const good = { name: 'Pat Visitor', email: 'pat@visitor.example', phone: '704-555-0100', message: 'Hello,\nI would like to talk about selling my home.', _honey: '', _t: T0 - 20_000, _sent: T0, token: 'tok-123', page: '/contact/' };
  const post = (body = good, { origin = `https://${HOST}`, type = 'application/json', method = 'POST', ip = '203.0.113.9' } = {}) =>
    handleContact(new Request(`https://${HOST}/api/contact`, {
      method, headers: { ...(origin ? { Origin: origin } : {}), ...(type ? { 'Content-Type': type } : {}), 'CF-Connecting-IP': ip },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }), env, deps);
  return { env, deps, mails, verifies, store, good, post };
}
const answer = async (res) => ({ status: res.status, body: await res.json(), text: JSON.stringify([...res.headers]) });
const bodyOf = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('a good message is emailed: from the form address to the secret address, Reply-To the visitor, subject and page included', async () => {
  const s = setup();
  const res = await s.post();
  const a = await answer(res);
  assert.deepEqual([a.status, a.body], [200, { success: true }]);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(s.mails.length, 1);
  const m = s.mails[0];
  assert.equal(m.from, 'form@example.com'); assert.equal(m.to, TO);
  assert.match(m.raw, /^From: form@example\.com\r\nTo: owner-private@example\.net\r\nReply-To: pat@visitor\.example\r\nSubject: New message from example\.com\r\n/);
  assert.match(m.raw, /\r\nMessage-ID: <[0-9a-f]{24}@example\.com>\r\n/);
  assert.match(m.raw, /\r\nContent-Type: text\/plain; charset=utf-8\r\n/);
  assert.equal(bodyOf(m.raw), 'Name: Pat Visitor\nEmail: pat@visitor.example\nPhone: 704-555-0100\nPage: https://www.example.com/contact/\n\nHello,\nI would like to talk about selling my home.\n');
  assert.deepEqual(s.verifies, [{ url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', body: { secret: 'ts-secret', response: 'tok-123', remoteip: '203.0.113.9' } }]);
});

test('the owner\'s address never appears in any reply', async () => {
  for (const o of [{}, { turnstile: { success: false } }, { sendFails: true }, { rateOk: false }]) {
    const s = setup(o);
    for (const res of [await s.post(), await s.post(s.good, { origin: 'https://evil.example' }), await s.post(undefined, { method: 'GET' })]) {
      const a = await answer(res);
      assert.doesNotMatch(JSON.stringify(a.body) + a.text, /owner-private|example\.net|ts-secret/);
      assert.deepEqual(Object.keys(a.body).filter((k) => !['success', 'ready'].includes(k)), []);
    }
  }
});

test('bad origin, wrong method, not JSON, broken JSON: refused, nothing checked or sent', async () => {
  const s = setup();
  for (const [opts, status, body] of [
    [{ origin: 'https://evil.example' }, 403], [{ origin: '' }, 403], [{ origin: `http://${HOST}` }, 403], [{ origin: 'https://example-site.workers.dev' }, 403],
    [{ type: 'application/x-www-form-urlencoded' }, 415], [{ type: '' }, 415], [{ type: 'text/plain' }, 415],
    [{}, 400, '{not json'], [{}, 400, '[1,2]'], [{}, 400, '"words"'],
  ]) {
    const a = await answer(await s.post(body ?? s.good, opts));
    assert.deepEqual([a.status, a.body], [status, { success: false }], JSON.stringify(opts) + (body || ''));
  }
  for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await handleContact(new Request(`https://${HOST}/api/contact`, { method }), s.env, s.deps)).status, 405);
  assert.equal(s.mails.length + s.verifies.length, 0);
});

test('missing or failed Turnstile token: refused, nothing sent', async () => {
  let s = setup();
  for (const token of [undefined, '', 12345, 'x'.repeat(3000)]) {
    const a = await answer(await s.post({ ...s.good, token }));
    assert.deepEqual([a.status, a.body], [400, { success: false }]);
  }
  assert.equal(s.verifies.length, 0, 'no token → Cloudflare is not even asked');
  s = setup({ turnstile: { success: false, 'error-codes': ['invalid-input-response'] } });
  assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post())), [403, { success: false }]);
  assert.equal(s.verifies.length, 1); assert.equal(s.mails.length, 0);
  s = setup({ turnstile: { success: 'true' } });
  assert.equal((await s.post()).status, 403, 'only a real true counts');
  s = setup({ turnstile: 'down' });
  assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post())), [502, { success: false }]);
  assert.equal(s.mails.length, 0);
});

test('quiet drops look like "sent" but send nothing: trap field, too fast, link spam, over-long fields', async () => {
  const s = setup();
  const long = (n) => 'x'.repeat(n);
  const cases = {
    'trap field filled': { _honey: 'http://spam.example' },
    'trap field not text': { _honey: 1 },
    'sent 1 second after the page loaded': { _t: T0 - 1000 },
    'sent 2.9 seconds after': { _t: T0 - 2900 },
    'no timestamp': { _t: undefined },
    'timestamp is words': { _t: 'soon' },
    'sent before it loaded': { _t: T0 + 60_000 },
    'no send time': { _sent: undefined },
    'three links': { message: 'see http://a.example and https://b.example and www.c.example' },
    'link in the name': { name: 'Buy now https://a.example' },
    'name too long': { name: long(LIMITS.name + 1) },
    'email too long': { email: long(LIMITS.email) + '@a.example' },
    'phone too long': { phone: long(LIMITS.phone + 1) },
    'message too long': { message: long(LIMITS.message + 1) },
  };
  for (const [what, change] of Object.entries(cases)) {
    const a = await answer(await s.post({ ...s.good, ...change }));
    assert.deepEqual([a.status, a.body], [200, { success: true }], what);
  }
  assert.deepEqual((await answer(await s.post(JSON.stringify({ ...s.good, extra: long(30000) })))).body, { success: true }, 'huge body');
  assert.equal(s.mails.length, 0); assert.equal(s.verifies.length, 0, 'dropped before the Turnstile check');
  // Right at the limits is fine: 3 seconds, two links, full-length fields.
  for (const change of [{ _t: T0 - 3000 }, { message: 'My listing: https://a.example/1 and https://b.example/2' }, { name: long(LIMITS.name), phone: long(LIMITS.phone), message: long(LIMITS.message) }, { phone: '' }]) {
    assert.deepEqual((await answer(await s.post({ ...s.good, ...change }))).body, { success: true });
  }
  assert.equal(s.mails.length, 4);
  assert.doesNotMatch(bodyOf(s.mails[3].raw), /Phone:/, 'no phone line when the visitor gave none');
});

test('missing name, message or a real email address: says it failed (a real visitor is never dropped silently)', async () => {
  const s = setup();
  for (const change of [{ name: '  ' }, { message: '' }, { email: '' }, { email: 'not-an-email' }, { email: 'a@b' }, { email: 'a b@c.example' }, { email: 'a@b.example, c@d.example' }]) {
    const a = await answer(await s.post({ ...s.good, ...change }));
    assert.deepEqual([a.status, a.body], [400, { success: false }], JSON.stringify(change));
  }
  assert.equal(s.mails.length, 0);
});

test('header injection: line breaks in name/email/phone/page can never add email headers', async () => {
  const s = setup();
  assert.equal((await s.post({ ...s.good, email: 'pat@visitor.example\r\nBcc: victim@x.example' })).status, 400);
  await s.post({ ...s.good, name: 'Pat\r\nBcc: victim@x.example', phone: '1\n2', page: '/x\r\nBcc: v@x.example' });
  const [head] = s.mails[0].raw.split('\r\n\r\n');
  assert.doesNotMatch(head, /Bcc/i);
  assert.equal(head.split('\r\n').length, 9, 'exactly the nine headers');
  assert.match(bodyOf(s.mails[0].raw), /^Name: Pat Bcc: victim@x\.example\nEmail: pat@visitor\.example\nPhone: 1 2\n\nHello/);
  // Words outside plain English survive (subject is encoded, body is UTF-8).
  const raw = buildMime({ from: 'form@example.com', to: TO, replyTo: 'a@b.example', subject: 'Nuevo mensaje – café', text: 'Señor José ✓' });
  assert.match(raw, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.equal(bodyOf(raw), 'Señor José ✓');
  assert.ok(buildMime({ from: 'f@e.example', to: TO, replyTo: 'a@b.example', subject: 's', text: 'y'.repeat(3000) }).split('\r\n').every((l) => l.length <= 78), 'no over-long lines');
});

test('rate limit: the burst limiter refuses by IP; the hour counter allows 5 messages an hour per IP', async () => {
  let s = setup({ rateOk: (ip) => ip !== '198.51.100.7' });
  assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post(s.good, { ip: '198.51.100.7' }))), [429, { success: false }]);
  assert.equal(s.verifies.length, 0);
  assert.equal((await s.post()).status, 200, 'another visitor is not affected');

  s = setup({ kv: true });
  for (let i = 0; i < PER_HOUR; i++) assert.equal((await s.post()).status, 200, `message ${i + 1}`);
  assert.equal(PER_HOUR, 5);
  assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post())), [429, { success: false }]);
  assert.equal(s.mails.length, 5); assert.equal(s.verifies.length, 5);
  assert.equal(s.store.ttl, 3600, 'the counter clears itself after the hour');
  assert.equal((await s.post(s.good, { ip: '198.51.100.8' })).status, 200, 'another visitor is not affected');
  s.deps.now = () => T0 + 3_600_001;
  assert.equal((await s.post({ ...s.good, _t: T0 + 3_500_000, _sent: T0 + 3_600_001 })).status, 200, 'allowed again after an hour');
  // Failed Turnstile checks and quiet drops don't use up a visitor's five.
  s = setup({ kv: true, turnstile: { success: false } });
  for (let i = 0; i < 8; i++) await s.post();
  assert.equal(s.store.size, 0);
});

test('email could not be sent: says it failed (the visitor is told to call or text)', async () => {
  const s = setup({ sendFails: true });
  assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post())), [502, { success: false }]);
});

test('not set up yet: GET says ready:false and POST fails, for each missing piece', async () => {
  const full = setup();
  assert.equal(contactReady(full.env), true);
  assert.deepEqual((await answer(await full.post(undefined, { method: 'GET' }))).body, { ready: true });
  for (const missing of ['TURNSTILE_SECRET', 'CONTACT_TO', 'EMAIL', 'CONTACT_FROM', 'CONTACT_RATE']) {
    const s = setup({ env: { [missing]: undefined } });
    assert.equal(contactReady(s.env), false, missing);
    assert.deepEqual((await answer(await s.post(undefined, { method: 'GET' }))).body, { ready: false }, missing);
    assert.deepEqual((({ status, body }) => [status, body])(await answer(await s.post())), [503, { success: false }], missing);
    assert.equal(s.mails.length, 0);
  }
  assert.equal(contactReady(setup({ kv: true, env: { CONTACT_RATE: undefined } }).env), true, 'the hour counter alone is enough');
});
