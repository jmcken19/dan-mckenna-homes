// The website's contact form endpoint: POST /api/contact (same file in client-site-template).
//
// A visitor's browser posts the form here; this Worker checks it and emails it to the owner. The owner's address
// is a Worker secret (CONTACT_TO) – it is never in the page code, in a reply, or in this repository.
//
// Checks, in order:
//   1. POST + JSON only, and only from the site's own address (Origin header = https://<MAIN_HOST>).
//   2. Quiet drops – the reply looks like a normal "sent", so bots learn nothing: the hidden trap field is filled,
//      the form was sent under 3 seconds after the page loaded, more than 2 links in the message, or a field is
//      longer than the form allows.
//   3. Rate limit per visitor IP: CONTACT_RATE (Workers Rate Limiting binding – short bursts) and, when the
//      CONTACT_KV binding exists, at most 5 messages an hour.
//   4. Cloudflare Turnstile token, checked with Cloudflare using TURNSTILE_SECRET.
//   5. The message is emailed through the send_email binding (EMAIL) from CONTACT_FROM to CONTACT_TO,
//      Reply-To = the visitor.
//
// Settings (site/wrangler.toml → [vars]):  MAIN_HOST, CONTACT_FROM, CONTACT_SUBJECT
// Secrets (`npx wrangler secret put …`):   TURNSTILE_SECRET, CONTACT_TO
// Bindings (site/wrangler.toml):           EMAIL (send_email), CONTACT_RATE (ratelimits), CONTACT_KV (optional)
//
// GET /api/contact answers { ready: true|false } – whether everything above is set – and nothing else.
export const CONTACT_PATH = '/api/contact';
export const LIMITS = { name: 100, email: 200, phone: 40, message: 3000 };
export const MIN_SECONDS = 3;
export const MAX_LINKS = 2;
export const PER_HOUR = 5;
const MAX_BODY = 20000;
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EMAIL_RE = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[a-z]{2,}$/i;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
});
const fail = (status) => json({ success: false }, status);
const sent = () => json({ success: true });

/** True when the Worker has everything the form needs. Until then the site keeps its old form (see docs). */
export function contactReady(env) {
  return !!(env.MAIN_HOST && env.CONTACT_FROM && env.TURNSTILE_SECRET && env.CONTACT_TO && env.EMAIL && typeof env.EMAIL.send === 'function'
    && (env.CONTACT_RATE || env.CONTACT_KV));
}

const str = (v) => (typeof v === 'string' ? v : '');
const oneLine = (v) => str(v).replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const countLinks = (s) => (s.match(/https?:\/\/|www\./gi) || []).length;

/**
 * @param request the visitor's request
 * @param env     the Worker's settings, secrets and bindings (see the top of this file)
 * @param deps    { makeEmail(from, to, raw) → the message for env.EMAIL.send, fetch, now } – tests pass their own
 */
export async function handleContact(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;

  if (request.method === 'GET' || request.method === 'HEAD') return json({ ready: contactReady(env) });
  if (request.method !== 'POST') return fail(405);
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return fail(415);
  if (!env.MAIN_HOST || request.headers.get('Origin') !== `https://${env.MAIN_HOST}`) return fail(403);
  if (!contactReady(env)) return fail(503);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return sent(); // far bigger than the form allows: quiet drop
    body = JSON.parse(raw);
  } catch { return fail(400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400);

  // Quiet drops.
  if (str(body._honey) || body._honey != null && typeof body._honey !== 'string') return sent();
  const waited = Number(body._sent) - Number(body._t); // both from the visitor's own clock
  if (!Number.isFinite(waited) || waited < MIN_SECONDS * 1000) return sent();
  const name = oneLine(body.name), email = oneLine(body.email), phone = oneLine(body.phone);
  const message = str(body.message).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (name.length > LIMITS.name || email.length > LIMITS.email || phone.length > LIMITS.phone || message.length > LIMITS.message) return sent();
  if (countLinks(message) > MAX_LINKS || countLinks(name) || countLinks(phone)) return sent();

  // A real visitor's browser never sends these (the fields are required); say it failed so nothing is lost silently.
  if (!name || !message || !EMAIL_RE.test(email)) return fail(400);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.CONTACT_RATE) {
    try { if (!(await env.CONTACT_RATE.limit({ key: ip })).success) return fail(429); } catch (err) { console.error('contact: rate limiter failed', err?.message); }
  }
  const hourKey = `contact-rate:${ip}`;
  let hour = null;
  if (env.CONTACT_KV) {
    try { hour = JSON.parse(await env.CONTACT_KV.get(hourKey) || 'null'); } catch { hour = null; }
    if (!hour || !(hour.until > now())) hour = { n: 0, until: now() + 3600_000 };
    if (hour.n >= PER_HOUR) return fail(429);
  }

  const token = str(body.token);
  if (!token || token.length > 2048) return fail(400);
  let ok = false;
  try {
    const res = await doFetch(VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip === 'unknown' ? undefined : ip }),
    });
    ok = (await res.json())?.success === true;
  } catch (err) { console.error('contact: Turnstile check failed', err?.message); return fail(502); }
  if (!ok) return fail(403);

  if (env.CONTACT_KV) {
    hour.n += 1;
    try { await env.CONTACT_KV.put(hourKey, JSON.stringify(hour), { expirationTtl: Math.max(60, Math.ceil((hour.until - now()) / 1000)) }); } catch (err) { console.error('contact: hour counter failed', err?.message); }
  }

  const page = /^\/[^\s]*$/.test(str(body.page)) ? str(body.page).slice(0, 200) : '';
  const raw = buildMime({
    from: env.CONTACT_FROM, to: env.CONTACT_TO, replyTo: email,
    subject: env.CONTACT_SUBJECT || `New message from ${env.MAIN_HOST.replace(/^www\./, '')}`,
    text: [`Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : '', page ? `Page: https://${env.MAIN_HOST}${page}` : '', '', message, ''].filter((l, i) => l || i >= 4).join('\n'),
    date: new Date(now()),
  });
  try {
    if (!deps.makeEmail) throw new Error('no makeEmail');
    await env.EMAIL.send(deps.makeEmail(env.CONTACT_FROM, env.CONTACT_TO, raw));
  } catch (err) {
    console.error('contact: email not sent', err?.message);
    return fail(502);
  }
  return sent();
}

const b64 = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** A plain-text email, built by hand (no dependencies). Every header value is one line; the body is base64. */
export function buildMime({ from, to, replyTo, subject, text, date = new Date() }) {
  const domain = from.split('@')[1];
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${header(oneLine(subject))}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text).replace(/.{76}/g, '$&\r\n'),
    '',
  ].join('\r\n');
}
