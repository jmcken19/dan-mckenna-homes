# AGENTS.md — maintaining the Dan McKenna Homes website

Canonical instructions for any AI assistant (Claude, ChatGPT/Codex, Copilot, …) or person
maintaining this repository. `CLAUDE.md` only points here.

## What this is

* **Public website** for Dan McKenna, NC/SC Broker/REALTOR® with Keller Williams Ballantyne Area.
  A plain static site: `scripts/build.mjs` turns the files in `content/` and `src/templates/`
  into HTML in `dist/`. No framework, no database.
* **Owner editor** (`owner/`): a small Cloudflare Worker that Dan uses on his phone to add
  listings and send change requests. Sign-in is Cloudflare Access (email code). It publishes by
  committing to this repo. Drafts, original photos and change requests stay in private
  Cloudflare storage (D1 + KV), never in this repo.
* **Hosting:** GitHub Pages is the *testing preview* (`.github/workflows/pages.yml`, with a
  noindex banner). Production hosting is in `docs/MAINTAINER.md`.

The owner is old-school and non-technical. Never ask Dan to use Git, GitHub, a terminal or a token.

## Ground rules

1. **Never invent facts.** No made-up property details, prices, client quotes, sales numbers,
   awards or service areas. If information is missing, ask one specific question or leave it blank.
   Unknown numbers are `null`, never `0`.
2. **Never edit a client's testimonial wording.** Testimonials are copied verbatim.
3. **Change only what was asked.** Preserve every unrelated field, file and photo.
4. **Identify a listing by its stable `id` (`lst-…`) or a confirmed full street address.**
   If two listings could match, ask which one (show street + city + status).
5. **Report exactly what changed**: file(s), field(s), old → new value, and the commit.
6. **Questions are not instructions.** "What would it look like if…?" → describe it or make a
   preview branch / screenshot; do not publish.
7. **No write access?** (e.g. a ChatGPT chat without the repo connected) Then you cannot update
   the site. Write a ready-to-send request instead, and tell the user to paste it into
   **Request a website change** in the owner editor (their bookmark). Never claim the site was updated.
8. Keep private things out of this public repo: unpublished listings, original photos,
   visitor contact details, credentials.

## Layout

```
content/site.json            contact info, tagline, homepage slideshow photos
content/testimonials.json    testimonials (verbatim)
content/listings/<id>.json   PUBLISHED listings only (one file each)
content/removed.json         listings taken off the site (old URL shows a friendly page)
public/                      copied as-is into the site
  assets/img/                site images (logo, headshot, hero slides…)
  listings/<id>/             listing photos: <photoId>-1800.jpg and <photoId>-900.jpg
src/lib/listing.mjs          listing rules + validation (shared by build, editor, tests)
src/templates/               page HTML (layout.mjs, pages.mjs, listing.mjs)
scripts/build.mjs            the build
scripts/prepare-site-images.mjs  regenerates public/assets/img from assets-src/
owner/                       the owner editor (Worker code, UI, D1 migration, wrangler.toml)
tests/                       npm test (content + editor); acceptance-ui.mjs = manual end-to-end
docs/                        OWNER-GUIDE.md, MAINTAINER.md, MIGRATION.md, SECURITY.md
```

## Listing schema (`content/listings/<id>.json`)

```jsonc
{
  "id": "lst-abc123xyz0",          // stable, never changes; file name = id + ".json"
  "slug": "123-main-street-waxhaw-nc", // web address /listings/<slug>/ – never change once published
  "revision": 4,                    // whole number; INCREMENT by 1 on every edit you make
  "status": "active",               // "active" (For Sale) | "pending" | "sold"
  "address": { "street": "123 Main Street", "city": "Waxhaw", "state": "NC", "zip": "28173" }, // zip may be ""
  "price": 525000,                  // number or null (unknown). Never 0.
  "beds": 4, "baths": 2.5, "sqft": null, // numbers or null
  "description": "Plain text. Blank line = new paragraph.",
  "mls": "4123456",                 // optional
  "photos": [                       // first photo = cover. At least one.
    { "id": "p-k3j2h1g0f9", "large": "/listings/lst-abc123xyz0/p-k3j2h1g0f9-1800.jpg",
      "small": "/listings/lst-abc123xyz0/p-k3j2h1g0f9-900.jpg", "width": 1800, "height": 1350, "alt": "" }
  ],
  "updatedAt": "2026-11-08T22:00:00.000Z"
}
```

`npm test` validates every listing file (paths, numbers, required fields, photos exist).

## Common tasks

**Find a listing:** `grep -il "main street" content/listings/*.json` → confirm the `id` and address.

**Change price / status / text:** edit that one file, bump `revision` by 1, set `updatedAt`.
The editor picks up repo edits automatically next time Dan opens it (it imports any file whose
`revision` is higher than what it last published).

**Add or replace listing photos:** prefer the owner editor (it strips GPS data, rotates and resizes).
If you must do it in the repo: JPEG only, max 1800 px (large) and 900 px (small), **remove all
EXIF/GPS metadata** (e.g. `sharp(input).rotate().resize(1800).jpeg({quality:82})` drops metadata
by default), save as `public/listings/<id>/<photoId>-1800.jpg` / `-900.jpg`, add to `photos`.

**Mark sold:** `"status": "sold"`. Sold homes stay visible under “Recently Sold”.

**Take off website:** delete `content/listings/<id>.json` and `public/listings/<id>/`, and add
`{ "slug", "address", "removedAt" }` to `content/removed.json`. **Restore:** the reverse
(git history has the files: `git checkout <commit>^ -- content/listings/<id>.json public/listings/<id>`).

**Drafts:** drafts only exist in the owner editor (private). There are no drafts in this repo —
anything in `content/listings/` is public as soon as it is pushed to `main`.

**Change page text:** `src/templates/pages.mjs`. Contact details: `content/site.json`.

**Homepage slideshow:** add the photo as `assets-src/hero-N.jpg` (N = 2…5), run
`npm run images`, then add `{ "src": "/assets/img/hero-N", "alt": "describe the photo", "focus": "50% 50%" }`
to `heroSlides` in `content/site.json`. One slide = still photo; two or more = slow slideshow with a pause button.

## Preview, test, publish

```bash
npm ci
npm test                 # must pass before pushing
npm run build:preview    # builds dist/ with the /dan-mckenna-homes base path
npx serve dist           # or any static server; open /dan-mckenna-homes/ (symlink) — or build with BASE_PATH="" to preview at /
```

Pushing to `main` publishes the testing preview through GitHub Actions in ~1 minute.
For a change that needs Dan's approval first, push a branch and send him screenshots instead.

## Undo / restore the previous version

Every change (including every editor publish) is a Git commit.
```bash
git log --oneline -- content/ public/listings/   # find the change
git revert <commit>                              # makes a new commit undoing it
git push                                         # live in ~1 minute
```
Verified in the acceptance run (see docs/MAINTAINER.md). If Dan used the editor, he can also
use **Undo my unpublished changes**, **Put back on website**, or the status buttons.

## Starter prompt (paste into Claude or ChatGPT)

> You are helping maintain Dan McKenna's real-estate website. Read `AGENTS.md` in the repository
> `jmcken19/dan-mckenna-homes` and follow it exactly. Here is what I need: **[describe the change]**.
> Identify the listing by its id or full street address, ask me one specific question only if
> something is truly missing, change nothing else, run `npm test`, and tell me exactly what you
> changed. If you cannot write to the repository, do not pretend you did — instead write the
> request as a short message I can paste into "Request a website change" in Dan's editor.
