# Maintainer guide (James)

Technical setup, deployment and recovery. Dan's guide is `OWNER-GUIDE.md`; AI/maintenance rules are in `../AGENTS.md`.

## Status (Nov 8, 2026)

| Part | State |
|---|---|
| Public site, testing preview | **Live** on GitHub Pages: https://jmcken19.github.io/dan-mckenna-homes/ (noindex, banner, no lead form) |
| Owner editor code | Done; 12 automated tests + phone-size end-to-end run against the real repo/Pages (see "Verification") |
| Owner editor hosting | **Not yet deployed** – needs a Cloudflare account (steps below, ~20 min, free) |
| Change-request email | **Off by choice** – requests are saved in the editor; James sees a "waiting" count when he signs in and Dan texts him. Add `RESEND_API_KEY` + `NOTIFY_TO` secrets to turn emails on |
| Production hosting / domain | **Owner decision** – plan below; current site and DNS untouched |

## Accounts, ownership, cost

| Service | Used for | Plan / cost | Owner | Recovery |
|---|---|---|---|---|
| GitHub `jmcken19/dan-mckenna-homes` | code + published content, preview hosting | Free | James | Repo is the source of truth; everything public is in git history |
| Cloudflare (Workers, D1, KV, Access, Pages) | editor, sign-in, private drafts/photos, production hosting | Free plan (Workers 100k req/day, D1 5 GB, KV 1 GB, Access ≤50 users). No card needed; over-limit requests fail rather than bill | Project shared with James's personal email (James runs setup). Write down who owns the account and how Dan gets in if James is unavailable | Account recovery via owner email + 2FA backup codes (store in Dan's password manager / printed) |
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

**4. (Optional) Resend key** – only if you want requests emailed. Skipped for now: Dan texts James.

**5. Private settings** (each command asks you to paste the value)
```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put OWNER_EMAILS        # danmckenna@kw.com  (add Wendy with a comma if wanted)
npx wrangler secret put MAINTAINER_EMAILS   # your email
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
* **Request a website change** → "test" → page says **Saved… send him a quick text**; sign in as yourself → start screen shows **1 waiting**.
* **Homepage photos** → shows the current photo → Preview opens.
* (Listings UI is switched off for Dan – see AGENTS.md. If re-enabled:) Add a listing with **TEST** in the street, 1 photo → Publish → **✓ Done** → link opens. Then
  **Take off website**, and delete its line from `content/removed.json` on GitHub.

**9. Hand over** – put the editor address + your phone/email into `OWNER-GUIDE.md`, export to PDF, and set up
Dan's laptop with him: open https://dmh-owner.danmckenna.workers.dev, sign in once, Ctrl + D → bookmarks bar, name it "Website Editor". Nothing gets downloaded or installed.

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

### Reviews order (added Nov 10)
* Reviews show everywhere (Testimonials page, homepage row in both designs) in the order of
  `content/testimonials.json → items` – first item shows first; nothing sorts by date any more. Dan arranges it in the
  reviews panel (and on `#/reviews`): **⠿ Drag** (mouse/finger, scrolls the panel), **Move up / Move down**, or arrow
  keys on the handle. Each move saves at once: `POST /api/reviews/order { slugs: [every slug, first shown first],
  baseRevision }` → the reviews state; not exactly the draft's reviews → 400, stale revision → 409 ("Reload latest").
  New reviews go to the top; editing keeps the place; removing keeps the others' order. Publish writes the order
  (one commit to `content/testimonials.json`); Undo all puts the published order back; an order-only change counts as
  unpublished. Same code as client-site-template (`docs/EDITOR.md` there).
* Switch-over: the file kept its order (it already matched the Testimonials page and the old site). Before, the homepage
  row was sorted newest first, so on the homepage the 2017 review "Sold a single family home in Waxhaw" moved from last
  to 4th (the row starts at a random review and loops). Dan can move it with the new buttons.

### Every word editable (added Nov 10)
* **All visible wording goes through `t()`** (`src/lib/text.mjs`, same code as client-site-template – its `docs/EDITOR.md`
  → "Words" has the details). Words live in `content/text.json` (119 keys, migrated word for word from the templates)
  and the `site.json` fields in its `siteFields` (name, agent, agentTitle, tagline, phone, email, brokerage,
  serviceAreaSentence). Before/after builds of all 23 pages (classic live + testing, option 2 testing + live) read
  identically (`node tests/text-diff.mjs <before> <after>`).
* Editor: Dan clicks any words on the page and types in place (toolbar **Save – show it on my page / Cancel**; Enter saves
  a line, starts a new paragraph in paragraphs). Small ✎ only on hover/keyboard focus. Menu/button words keep their link
  (**Open “page”** in the toolbar). Phone/email are checked; changing the phone updates `phoneHref`/`smsHref`.
  `mustStay`: Dan's name, NC/SC Broker/REALTOR®, Realtor NC/SC and the brokerage line can't be emptied.
  The page list has **More pages…** (Accessibility, Copyright, one review, Page not found).
* Server: `owner/src/text.mjs` – settings row `text`; `GET /api/text`, `POST /api/text/item`, `/discard`, `/publish`
  (one commit to `content/text.json` and/or `content/site.json`, only the changed words). Previews merge the draft.
* Guarantee: `tests/text-coverage.test.mjs` renders every page (classic) in edit mode and fails on any visible word that
  isn't editable; option 2 (luxury) uses the same keys where the wording is the same (it isn't the editor's design).
  Not converted: the listing templates (`listing.mjs`, the listings index/removed-listing pages and the homepage listings
  section) – switched off, not rendered; the coverage test will name every word if listings come back.
* Tests: `tests/text.test.mjs` (API), `tests/ui-text.mjs` (browser, part of `npm run test:visual`).

### Sign-in as set up (Nov 8)
Access app "Dan McKenna Homes – Website Editor" (id dfd09d8c…, attached to the `dmh-owner` worker via
`destinations: worker`), team `gentle-rice-8ea1.cloudflareaccess.com`, policy "Dan and James only"
(danmckenna@kw.com, jmck2134@gmail.com), session 30 days, login = Cloudflare account, auto-redirect straight
to the Cloudflare login. To switch to 6-digit email codes later: Zero Trust → Settings → Authentication →
Login methods → add **One-time PIN**, then allow it on the app.

### Laptop only (owner decision, Nov 8)
The editor refuses phone browsers (friendly "Please use your laptop" screen + server returns 403 `laptopOnly`).
It's a house rule, not a security boundary (a browser can pretend to be a laptop) – sign-in is the security.
To allow phones again: `npx wrangler secret put ALLOW_PHONES` → `true`.

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

## Live website (Cloudflare) – set up Nov 8, 2026
* **www.danmckennahomes.com** is the `dmh-site` Cloudflare Worker (`site/`), serving the classic design built
  into `dist-prod/`. `danmckennahomes.com` forwards to www (in `site/worker.mjs`).
* Every push to `main` runs **Publish live website (Cloudflare)** (`.github/workflows/live.yml`): test → build →
  `wrangler deploy`. It needs the repo secret `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template,
  Dan's account, zone danmckennahomes.com). Without the secret the deploy step is skipped, not failed.
* The GitHub Pages copy stays as the **testing** link (noindex, banner, both designs).
* DNS lives in Cloudflare (nameservers darwin/frida.ns.cloudflare.com, set at GoDaddy, where the domain is still
  registered). Google Workspace mail records (5 MX, SPF + `dc-aa8e722993._spfm` helper, 2 site-verification TXT)
  were copied from GoDaddy – **never delete them**.
* Placester: cancelled Nov 8, 2026.

## Contact form
"Or send Dan a message" (name, email, phone optional, message) sits under the Call/Text/Email buttons and on the
Contact page. Off on the testing link (no lead collection there). If sending fails, visitors are told to call or text.

**Two ways it can work – the website picks by `content/site.json → turnstileSiteKey`:**

| | Old way (key empty – **today**) | New way (key set) |
|---|---|---|
| Where the browser sends it | FormSubmit (formsubmit.co) | this site's own `POST /api/contact` (`site/contact.mjs`, in the `dmh-site` Worker) |
| Dan's address in the page code | **yes** (`contactFormTo`) – bots read it and post straight to FormSubmit | **no** – it is the Worker secret `CONTACT_TO` |
| Spam checks | hidden trap field, in the browser only | on the server: own-site only (Origin), Cloudflare Turnstile, trap field, sent under 3 s, more than 2 links, length limits, rate limit per IP |
| Email sent by | FormSubmit | Cloudflare Email Routing (`send_email` binding) from `form@danmckennahomes.com`, Reply-To = the visitor, subject "New message from danmckennahomes.com", with the page they were on |
| Without JavaScript | normal form post | the "please call or text" line (the form needs JavaScript for Turnstile) |

Spam that is dropped quietly gets a normal "sent" reply, so bots learn nothing. Nothing is stored: a message is
checked, emailed, and gone. `GET https://www.danmckennahomes.com/api/contact` answers `{"ready":true}` only when the
Worker has both secrets, the email binding and a rate limiter.

**Rate limit – which one is used.** The Workers Rate Limiting binding (`CONTACT_RATE` in `site/wrangler.toml`) is on:
5 posts a minute per IP. That binding only allows 10- or 60-second windows, so it cannot do "5 an hour"; the hourly
limit (5 messages an hour per IP) is a small KV counter that switches on when the `CONTACT_KV` binding is added
(optional – commented in `site/wrangler.toml`).

### Switching the new form on (in this order – the live form never breaks)
**Ask James before step 2: it changes DNS/email for the domain.**
1. Cloudflare dashboard (Dan's account) → **Turnstile** → **Add widget**: name "Dan McKenna Homes contact form",
   hostnames `danmckennahomes.com` and `www.danmckennahomes.com`, mode **Managed**. Copy the **site key** and the
   **secret key**.
2. **Email Routing – read this first.** `danmckennahomes.com` has Google Workspace mail records (5 MX + SPF, see "Live
   website" above). Switching Email Routing on for the domain itself wants to **replace those MX records, which stops
   Google mail for every @danmckennahomes.com address**. Before touching it, confirm whether anyone still receives mail
   there (Google Admin → Users; or `dig MX danmckennahomes.com`).
   * Nobody does (mail is all @kw.com): Email Routing can be switched on for the domain (zone → Email → Email
     Routing → Get started; let it add its MX/SPF records and remove the Google ones).
   * Somebody does: **do not** switch it on for the domain. Use a subdomain instead (Email Routing → Settings →
     Subdomains → add e.g. `mail.danmckennahomes.com`) and set `CONTACT_FROM = "form@mail.danmckennahomes.com"` in
     `site/wrangler.toml`. The Google records on the main domain stay untouched.
3. Email Routing → **Destination addresses** → add `danmckenna@kw.com` → Dan clicks the link in the email from
   Cloudflare ("Verify email address"). It must show **Verified**.
4. Secrets, from `site/` (they are typed into the terminal, never into a file):
   `npx wrangler secret put TURNSTILE_SECRET` (the secret key from step 1) and
   `npx wrangler secret put CONTACT_TO` (`danmckenna@kw.com`).
5. In `site/wrangler.toml` remove the `#` from the two `[[send_email]]` lines (and, for the hourly limit, create the
   KV namespace and un-comment `CONTACT_KV`). Commit, push to `main`, wait for **Publish live website** ✓.
6. Open `https://www.danmckennahomes.com/api/contact` → must say `{"ready":true}`. The website still shows the old form.
7. Put the **site key** from step 1 in `content/site.json → "turnstileSiteKey"`. Commit, push. The deploy first checks
   step 6 again and stops (nothing deployed) if the Worker is not ready. After it, the new form is live and
   `contactFormTo` is no longer written into any page (delete that line from `site.json` once the test below passes).
8. **Test:** on the live Contact page send one message as a visitor would (wait a few seconds before Send). You see
   "Thank you! Your message was sent…"; Dan's inbox gets "New message from danmckennahomes.com" from
   `form@danmckennahomes.com` (check spam the first time); **Reply** goes to the address typed in the form. Also send
   one from the "Have a question?" box on another page and check the "Page:" line. If it says "Sorry…": Cloudflare →
   Workers → dmh-site → Logs shows why (`contact: …`).

**Back to the old form at any time:** set `turnstileSiteKey` to `""` and push.

**If Dan's email address changes:** the website's address is `content/site.json → email` (he can change it in the
editor); where form messages go is the `CONTACT_TO` secret – verify the new address as a destination (step 3), then
`npx wrangler secret put CONTACT_TO`.

### Email links
Dan's address is not written in the page code any more (spam harvesters collect `mailto:` links and anything shaped
like an address). `src/lib/mail.mjs` writes it scrambled; `public/assets/js/site.js` puts the real `mailto:` link and
the readable address back when the page loads. Without JavaScript the address still reads normally (the "@" comes
from the stylesheet) and the Email buttons go to the Contact page. Use `mailAttrs(ctx)` / `mailText(ctx)` for any new
email link – `npm test` fails if a page contains `mailto:` or the address.

## Editor updates
* `.github/workflows/editor.yml` deploys `owner/` (dmh-owner) when `owner/` or `src/` changes, using the same
  `CLOUDFLARE_API_TOKEN` secret. Dan's content publishes don't trigger it.
