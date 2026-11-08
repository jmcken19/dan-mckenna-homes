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

## Connect the editor (one time, ~20 minutes)

You need: a Cloudflare account, Node 22, this repo cloned.

1. **Log in:** `cd owner && npx wrangler login`
2. **Create storage:**
   ```bash
   npx wrangler d1 create dmh-owner          # copy database_id into wrangler.toml
   npx wrangler kv namespace create PHOTOS   # copy id into wrangler.toml
   npx wrangler d1 migrations apply dmh-owner --remote
   ```
3. **GitHub token:** GitHub → Settings → Developer settings → Fine-grained tokens → *Generate*.
   Repository access: **only** `jmcken19/dan-mckenna-homes`. Permissions: **Contents: Read and write**,
   **Actions: Read and write** (read status + re-run failed publish), Metadata: read. Expiry: 1 year (calendar a reminder).
   `npx wrangler secret put GITHUB_TOKEN`
4. **Email:** create a Resend account (with the address that should receive requests), make an API key
   with "Sending access" only. `npx wrangler secret put RESEND_API_KEY`. Without a verified domain,
   Resend only delivers to your own account email – that's fine, that's where requests should go.
5. **Edit `wrangler.toml` vars:** `MAINTAINER_EMAILS`, `NOTIFY_TO`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`
   (these are shown to Dan as his help contact), `OWNER_EMAILS` (Dan; add Wendy if wanted).
6. **Deploy:** `npx wrangler deploy` → note the URL `https://dmh-owner.<you>.workers.dev`.
7. **Turn on sign-in (Cloudflare Access):** Dashboard → Workers & Pages → dmh-owner → Settings →
   Domains & Routes → workers.dev → **Enable Cloudflare Access**. Then Zero Trust → Access →
   Applications → the new app → Policies: *Allow* → Include → Emails: Dan's + yours. Login method:
   **One-time PIN** (email code). Copy the app's **AUD tag** and your team domain
   (`<team>.cloudflareaccess.com`) into `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`, then `npx wrangler deploy` again.
8. **Check it (must pass before giving Dan the link):**
   * Private window, editor URL → you get the Cloudflare sign-in page. Sign in with a *non-listed*
     email → refused.
   * `curl -i https://dmh-owner.<you>.workers.dev/api/listings` → **401** (`Please sign in again`).
   * Sign in as yourself → Request a website change → send "test" → the email arrives, the page says **Sent**.
   * Add a listing with street containing `TEST`, publish, see ✓ Done + link works, then take it off
     and delete the leftover entry from `content/removed.json`.
9. Put the editor URL and your phone/email into `OWNER-GUIDE.md`, export it to PDF, send it to Dan.

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
