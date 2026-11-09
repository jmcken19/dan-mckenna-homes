// Authentication is done by Cloudflare Access (email one-time code sign-in) in front of
// this Worker. Access adds a signed JWT to every request; we verify it here on the
// server for every API call, so a request that bypasses Access (or forges a header)
// is rejected. We never trust a header without checking its signature.

let jwksCache = { at: 0, keys: null, url: '' };

// Accept the team domain with or without https:// and a trailing slash.
const teamHost = (env) => String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const dec = new TextDecoder();

async function getKeys(env) {
  const url = `https://${teamHost(env)}/cdn-cgi/access/certs`;
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error('jwks-fetch-failed');
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys, url };
  return keys;
}

export async function verifyAccessJwt(token, env) {
  if (!token || token.split('.').length !== 3) return null;
  const [h, p, s] = token.split('.');
  let header, payload;
  try { header = JSON.parse(dec.decode(b64urlToBytes(h))); payload = JSON.parse(dec.decode(b64urlToBytes(p))); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const keys = await getKeys(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null;
  if (payload.nbf && payload.nbf > now + 30) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(String(env.ACCESS_AUD).trim())) return null;
  if (payload.iss && payload.iss !== `https://${teamHost(env)}`) return null;
  if (typeof payload.email !== 'string') return null;
  return { email: payload.email.toLowerCase() };
}

function list(v) { return String(v || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean); }

/** Returns { email, role } or null. role: 'owner' (Dan/Wendy) or 'maintainer' (James). */
export async function authenticate(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null; // misconfigured: fail closed
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  let user;
  try { user = await verifyAccessJwt(token, env); } catch { return null; }
  if (!user) return null;
  // Second, independent allow-list in case the Access policy is ever loosened by mistake.
  const maint = list(env.MAINTAINER_EMAILS);
  const owners = list(env.OWNER_EMAILS);
  if (maint.includes(user.email)) return { email: user.email, role: 'maintainer' };
  if (owners.includes(user.email)) return { email: user.email, role: 'owner' };
  return null;
}
