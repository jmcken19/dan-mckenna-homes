# Maintainer guide (James)

Technical setup, deployment and recovery. Dan's guide is `OWNER-GUIDE.md`; AI/maintenance rules are in `../AGENTS.md`.

## Status (Nov 8, 2026)

| Part | State |
|---|---|
| Public site, testing preview | **Live** on GitHub Pages: https://jmcken19.github.io/dan-mckenna-homes/ (noindex, banner, no lead form) |
| Owner editor code | Done; 12 automated tests + phone-size end-to-end run against the real repo/Pages (see "Verification") |
| Owner editor hosting | **Not yet deployed** – needs a Cloudflare account (steps below, ~20 min, free) |
| Change-request email | Code done and tested with a stand-in; **real delivery needs a Resend API key** (free) |
| Production hosting / domain | **Owner decision** – plan below; current site and DNS untouched |

## Accounts, ownership, cost

| Service | Used for | Plan / cost | Owner | Recovery |
|---|---|---|---|---|
| GitHub `jmcken19/dan-mckenna-homes` | code + published content, preview hosting | Free | James | Repo is the source of truth; everything public is in git history |
| Cloudflare (Workers, D1, KV, Access, Pages) | editor, sign-in, private drafts/photos, production hosting | Free plan (Workers 100k req/day, D1 5 GB, KV 1 GB, Access ≤50 users). No card needed; over-limit requests fail rather than bill | Recommend Dan's business email as account owner, James as member | Account recovery via owner email + 2FA backup codes (store in Dan's password manager / printed) |
| Resend | emails change requests to James | Free (3,000/mo) | James | Re-create API key → `wrangler secret put RESEND_API_KEY` |
| Domain `danmckennahomes.com` | live site | Unknown registrar (currently pointed at Placester) | Dan | **Owner decision** before any DNS change |

## Connect the editor (one time, ~30 minutes)

Run these on your own computer (PowerShell on Windows is fine). You need Node 22+ and Git.

**0. Accounts**: Cloudflare (free; sign up with an email you'll keep, turn on 2-step verification),
Resend (free, sign up with the email that should receive Dan's requests).

**1. Get the code**
```powershell
git clone https://github.com/jmcken19/dan-mckenna-homes.git
cd dan-mckenna-homes
npm ci
cd owner
npx wrangler login            # browser opens → Allow
```

**2. Create the private storage** (each command prints an ID – paste it into `owner/wrangler.toml`)
```powershell
npx wrangler d1 create dmh-owner             # copy database_id → [[d1_databases]] database_id
npx wrangler kv namespace create PHOTOS      # copy id → [[kv_namespaces]] id
npx wrangler d1 migrations apply dmh-owner --remote   # answer "y"
```

**3. GitHub token** – github.com → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token. Name `dmh-editor`, expiration 1 year (calendar a reminder),
Repository access: *Only select repositories* → `dan-mckenna-homes`. Permissions: **Contents: Read and write**,
**Actions: Read and write**. Generate → copy.

**4. Resend key** – resend.com → API Keys → Create → permission *Sending access* → copy.

**5. Private settings** (each command asks you to paste the value)
```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put OWNER_EMAILS        # danmckenna@kw.com  (add Wendy with a comma if wanted)
npx wrangler secret put MAINTAINER_EMAILS   # your email
npx wrangler secret put NOTIFY_TO           # your email (must be your Resend sign-up email)
npx wrangler secret put SUPPORT_EMAIL       # your email
npx wrangler secret put SUPPORT_PHONE       # your cell, e.g. 704-555-1234
```
(The first `secret put` may offer to create the Worker – say yes.)

**6. First deploy** – `npx wrangler deploy` → note the address `https://dmh-owner.<your-subdomain>.workers.dev`.

**7. Turn on sign-in (Cloudflare Access)** – dashboard → **Workers & Pages** → `dmh-owner` → **Access**
(older dashboards: Settings → Domains & Routes → workers.dev → *Enable Cloudflare Access*).
Choose **All traffic**. Policy: allow these **emails**: Dan's + yours. Login method: **One-time PIN** (email code).
The dialog shows the **team domain** and **Application Audience (AUD) tag** – paste them into
`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `owner/wrangler.toml`, then `npx wrangler deploy` again.
Commit the two IDs + Access values (`git commit -am "Connect editor" && git push`) – they are not secrets.

**8. Check it (all must pass before giving Dan the link)**
* Private/incognito window → editor address → Cloudflare sign-in page appears.
* Sign in with an email that is **not** on the list → refused.
* PowerShell: `curl.exe -i https://dmh-owner.<sub>.workers.dev/api/listings` → **401** (or a redirect to sign-in).
* Sign in as yourself → start screen shows *Signed in as …* and three buttons.
* **Request a website change** → "test" → page says **Sent** and the email arrives.
* **Homepage photos** → shows the current photo → Preview opens.
* Add a listing with **TEST** in the street, 1 photo → Publish → **✓ Done** → link opens. Then
  **Take off website**, and delete its line from `content/removed.json` on GitHub.

**9. Hand over** – put the editor address + your phone/email into `OWNER-GUIDE.md`, export to PDF, and set up
Dan's phone with him (sign in once, *Add to Home Screen*).

Note: Cloudflare describes `*.workers.dev` addresses as meant for non-critical projects; it's fine for a private
editor. When the domain moves to Cloudflare, give the editor its own address (e.g. `edit.danmckennahomes.com`:
Worker → Settings → Domains & Routes → Add custom domain) and update Dan's bookmark.

## Production hosting (owner decision needed)

GitHub Pages is the **testing preview only** (GitHub's terms discourage commercial sites on Pages,
and the preview is noindex). Recommended production host: **Cloudflare Pages** (free, commercial use OK,
HTTPS, same account as the editor):
1. Pages → Create → Connect to Git → this repo. Build command `npm ci && node scripts/build.mjs`,
   output `dist`, env vars `SITE_URL=https://www.danmckennahomes.com`, `NODE_VERSION=22`.
   (No `PREVIEW`, no `BASE_PATH` → indexable, root paths, sitemap.)
2. `public/_headers` (add at launch) for security headers – see SECURITY.md.
3. Change the editor's `PUBLIC_SITE_URL` to the production URL and redeploy (so "✓ Done" checks the real site).
4. **DNS cutover** (Dan decides when): add the domain in Cloudflare Pages, update DNS at the registrar,
   then cancel Placester *after* the new site is verified. Keep Placester until then.
5. Before launch: decide on a lead form (see SECURITY.md) – the preview deliberately has none.

## Verification performed (Nov 8, 2026)

* `npm test`: 18 tests – content validation; editor auth (missing/forged/expired/wrong-audience/
  not-allow-listed tokens → 401), CSRF (403), validation, duplicate-submit, stale-edit conflict (409),
  upload validation, EXIF/GPS stripping, failed publish + retry, concurrent push, change requests incl.
  email-not-configured honesty.
* Phone-size (390×844, emulated in headless Chrome) run of the real editor UI against the **real repo
  and Pages deploys** (`tests/acceptance-ui.mjs`): add listing with 3 photos → draft (signed-out 401) →
  preview → publish (✓ Done in 45 s, page verified live in a browser) → price change, cover replaced,
  gallery reordered, Pending (index + detail agree after refresh) → Sold → taken off (old URL shows the
  "no longer available" page, photos 404) → restored → change request with photo (invalid image,
  missing message both refused) → invalid listing photo → unauthenticated write 401 → `git revert`
  of a publish (verified deployed) → all test content removed.
* **Emulated, not real:** GitHub's commit API (this build session could only `git push`, so the
  harness replayed the Worker's commits with git; the real Actions build/Pages deploy ran), Cloudflare
  Access (tokens signed by the test harness with the same verification code), Resend delivery, and
  phone photo picking on a real device (iPhone HEIC path untested on hardware). Re-check these in step 8.

### Homepage photos (added Nov 8)
* Editor screen **Homepage photos**: upload, drag to reorder (touch + mouse + arrow keys), "keep in view" focus,
  speed (default Normal 7 s), fade (default off), preview in either design, publish. Drafts are private (D1 `settings` row
  + KV); publish = one commit to `content/site.json` + `public/assets/img/hero/`. Migration `0002_settings.sql` –
  run `npx wrangler d1 migrations apply dmh-owner --remote` when connecting.
* Verified: API tests; phone-size UI run (finger drag, keyboard, drop-a-file on desktop); a real publish of a 3-photo,
  4 s, fade-on slideshow to the preview (both designs rotated on schedule), then restored to the original single photo
  through the editor (test photo files removed, status reported ✓ live).

## Recovery

* **Undo a published change:** `git log --oneline -- content public/listings` → `git revert <sha>` → push.
  (Tested.) The editor re-imports repo changes when Dan next opens it.
* **Editor storage lost (D1/KV):** published listings re-import from the repo automatically on the next
  "Manage listings" load (photos copied back from the repo). Unpublished drafts and request history would be lost.
* **GitHub token expired/revoked:** publishing shows "Publishing didn't finish… your changes are saved".
  Make a new token (step 3) → `wrangler secret put GITHUB_TOKEN`.
* **Dan locked out:** Access → app → policy: check his email; he can also use the fallback contact in his guide.
* **Roll back the editor code:** `git checkout <good-sha> -- owner && cd owner && npx wrangler deploy`.

## Local development

```bash
npm ci && npm test
npm run build:preview          # dist/ for the Pages preview
node tests/acceptance-ui.mjs   # end-to-end against the real repo – pushes commits; read the file first
```
