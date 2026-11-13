# Security review

Architecture: static public site (its only server code is the contact form endpoint, `site/contact.mjs`) + owner editor Worker behind Cloudflare
Access. Only the Worker can write, and only to this repo.

Legend: **Tested** = automated test or acceptance run · **Host** = provided by Cloudflare/GitHub ·
**N/A** = does not apply · **Launch** = to do before production.

| Item | How it's handled | Status |
|---|---|---|
| Secrets in code / Git history | No secrets in repo; GitHub token + Resend key are Worker secrets only. `.gitignore` covers `.dev.vars`. History checked: only placeholder strings in `wrangler.toml` | Tested (grep) |
| Environment variables | Non-secret config in `wrangler.toml [vars]`; secrets via `wrangler secret put` | Host |
| Authentication | Cloudflare Access (email one-time code) in front of the whole editor | Host (Launch: enable) |
| Server-side authorization | Every `/api/*` call verifies the Access JWT signature (RS256, JWKS), audience, issuer, expiry, then a second email allow-list (owner vs maintainer roles). Fails closed if not configured. A hidden URL is not relied on | Tested: missing, forged, expired, wrong-aud, not-listed → 401 |
| Write protection | All writes happen in the Worker; GitHub token never reaches the browser or build output. Fine-grained token limited to this one repo | Tested (401 on unauthenticated PUT/POST) |
| Signed-out access to drafts | Drafts/photos/requests only in D1/KV, served only through authenticated API; never in the public repo | Tested (401 on draft, preview, photo) |
| Input validation | Shared validator (`src/lib/listing.mjs`): lengths, NC/SC, ZIP, numbers > 0 or null, status enum, photo paths must match `/listings/<id>/…jpg`; build fails on invalid content | Tested |
| Output escaping | Every value through `escapeHtml` in templates and editor UI; descriptions rendered as text | Tested (escape test) |
| Injection (SQL) | D1 queries use bound parameters only; dynamic column names come from code, not input | Reviewed |
| Injection (path) | IDs validated by regex before use in keys/paths | Reviewed + tested |
| Database access rules | D1/KV reachable only via Worker bindings | Host |
| Rate limits | Per-user daily caps (uploads 400, requests 30, publishes 120, saves 1000) in the Worker; Access blocks everyone else | Reviewed |
| Spend controls | Cloudflare free plan: over-limit → requests fail, no billing. No paid APIs. Resend free tier | Host |
| Upload validation | Server sniffs magic bytes (JPEG only for public copies), parses JPEG structure, size caps (4 MB/1.5 MB; originals 24 MB), dimension caps; rejects fakes | Tested (script-as-JPEG, oversize) |
| Location metadata | Browser re-encodes on canvas; server strips every APP1–APP15/COM segment again; originals (with metadata) kept private | Tested (GPS JPEG → no EXIF in repo/site) |
| Untrusted uploads executing | Stored as bytes in KV; served `image/jpeg` + `nosniff`; public copies are static JPEGs | Tested/Reviewed |
| CSRF | State-changing calls need custom header `X-DMH-Editor` (forces CORS preflight, never granted) and matching `Origin`; Access cookie is SameSite | Tested (403) |
| CORS | No CORS headers sent → cross-origin reads blocked | Reviewed |
| HTTPS | workers.dev / Pages / GitHub Pages are HTTPS-only; HSTS header from Worker | Host |
| Security headers | Editor: CSP (`default-src 'self'`, no inline script), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS. Public site on GitHub Pages can't set headers (static; no forms) | Tested (editor) · **Launch:** add `public/_headers` on Cloudflare Pages |
| Cookies | Only Cloudflare Access's `CF_Authorization` (HttpOnly, Secure, SameSite) – set by host | Host |
| Debug settings | No debug mode or auth bypass exists in the code; tests sign their own tokens | Reviewed |
| Production config | `PREVIEW=1` only in the Pages workflow; production build omits it (indexable, canonical, sitemap) | Reviewed |
| Duplicate submissions | Idempotency keys on create/upload/publish/requests; buttons disabled while sending | Tested |
| Silent overwrites | Optimistic revision check on every save (409 + "Reload latest"); publish lock; non-forced Git ref update with retry | Tested |
| Visitor personal data (contact form) | Off on previews. Nothing is stored: a message is checked and emailed to the owner, then gone. **Old way** (until `turnstileSiteKey` is set): the browser posts straight to FormSubmit; the owner's address is in the page code; trap field only. **New way:** `POST /api/contact` on the site Worker – JSON only, own Origin only, Cloudflare Turnstile verified server-side, trap field / under-3-seconds / more-than-2-links / over-length dropped quietly (reply looks like "sent"), rate limit per IP (Rate Limiting binding 5/min; optional KV counter 5/hour), sent by Cloudflare Email Routing to the verified address in the `CONTACT_TO` secret. Replies only ever contain `{success}` / `{ready}` – never an address or a reason | Tested (`tests/contact.test.mjs`, `tests/site-worker.test.mjs`) · **verify delivery with a real test after switching on** (docs/MAINTAINER.md) |
| Email header injection | Visitor text never reaches a header except Reply-To, which must match a strict one-line address pattern; body is base64 | Tested |
| Address harvesting | No `mailto:` link or written-out address in the page code; `src/lib/mail.mjs` scrambles it and `site.js` restores it for people | Tested |
| Secrets (site Worker) | `TURNSTILE_SECRET`, `CONTACT_TO`: Worker secrets only (`wrangler secret put`), never in the repo. The Turnstile **site** key in `site.json` is public by design | Tested (not in `wrangler.toml`) |
| Private material in public repo | Only published listings and their stripped photos are committed | Reviewed |

Suggested `public/_headers` for Cloudflare Pages at launch:
```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'
```
