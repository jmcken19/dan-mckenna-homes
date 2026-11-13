// Serves the built website. Sends danmckennahomes.com → www.danmckennahomes.com, adds safety headers,
// and keeps test addresses (workers.dev) out of Google. Also answers the contact form (POST /api/contact – see contact.mjs).
import { EmailMessage } from 'cloudflare:email';
import { CONTACT_PATH, handleContact } from './contact.mjs';

const MAIN = 'www.danmckennahomes.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'danmckennahomes.com') {
      url.hostname = MAIN; url.protocol = 'https:'; url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === CONTACT_PATH) {
      const { EMAIL, CONTACT_RATE, CONTACT_KV, TURNSTILE_SECRET, CONTACT_TO, CONTACT_FROM, CONTACT_SUBJECT } = env;
      return handleContact(request, { MAIN_HOST: MAIN, EMAIL, CONTACT_RATE, CONTACT_KV, TURNSTILE_SECRET, CONTACT_TO, CONTACT_FROM, CONTACT_SUBJECT },
        { makeEmail: (from, to, raw) => new EmailMessage(from, to, raw) });
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    const h = out.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('X-Frame-Options', 'SAMEORIGIN');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    if (url.hostname === MAIN) h.set('Strict-Transport-Security', 'max-age=31536000');
    else h.set('X-Robots-Tag', 'noindex, nofollow');
    // The editor checks this file to know when a change is live, so it must never be cached.
    if (url.pathname === '/version.json') h.set('Cache-Control', 'no-store');
    // The owner editor shows this site's pages from its own address; fonts need CORS to load there.
    if (/\.(woff2?|ttf|otf)$/i.test(url.pathname)) h.set('Access-Control-Allow-Origin', '*');
    return out;
  },
};
