# Migration from danmckennahomes.com (Placester)

Audited Nov 8, 2026 at desktop and phone widths. Verified = page loads on the preview (HTTP 200) and content checked against the source.

| Old URL | New destination | Status |
|---|---|---|
| `/` | `/` – same hero photo (now a slideshow-capable hero), name, tagline, testimonial carousel; adds View Listings / Call Dan buttons | ✅ Verified |
| `/about-us/` | `/about-us/` – full text, headshot, recognition list, Wendy's bio | ✅ Verified |
| `/new-construction/` | `/new-construction/` – full text + construction photo | ✅ Verified |
| `/luxury-home-marketing/` | `/luxury-home-marketing/` – full text + featured 2515 Forest Lawn Dr photo | ✅ Verified |
| `/testimonials/` | `/testimonials/` – all 13 | ✅ Verified |
| `/testimonial/<slug>/` (13 pages) | same paths | ✅ Verified (3 are excerpt-only – see gaps) |
| `/contact/` | `/contact/` – phone, email, headshot, call/text/email buttons | ✅ Verified |
| `/accessibility-2/` | `/accessibility-2/` – commitment text, contact changed from Placester to Dan | ✅ Verified (wording trimmed – review) |
| `/dmca-compliance-2/` | `/dmca-compliance-2/` – short copyright-contact page | ⚠️ Placester's DMCA agent removed; needs owner/legal review |
| — (new) | `/listings/` and `/listings/<slug>/` – Dan's own listings from the editor | ✅ Verified with test listing |
| Sign In / Sign Up modals | removed (no accounts on new site) | n/a |
| Site-wide "Have a question?" form (name/email/phone/message, math captcha) | replaced by Call / Text / Email buttons in the same spot | Preview: intentionally no form |
| "Share this listing" / "Hold on! redirecting to listing data" modals | not carried over (no IDX search exists on the old site) | n/a |

Contact facts verified against source: **704-441-4556**, **danmckenna@kw.com**, brokerage **Keller Williams Ballantyne Area** (from the KW logo and page sign-offs), service areas **Charlotte, Waxhaw, Weddington, Marvin, and surrounding communities in NC and SC**. (The old homepage meta description also lists Fort Mill, Indian Land, Lake Norman, Mooresville, Huntersville, Denver, Sherrills Ford – not used because no page states them; confirm with Dan.)

## Third-party items needing permission or replacement

| Item | Source | Action |
|---|---|---|
| Hero photo (pool/fire-pit patio), construction photo, 2515 Forest Lawn photo | Uploaded to Placester by Dan; photographer unknown | **Dan to confirm** he owns/licensed them for his own site (Forest Lawn: builder Tiara Homes / listing photographer) |
| Dan's headshot (2019) | Placester upload | Dan to confirm; easy to replace via change request |
| Keller Williams Charlotte Ballantyne logos | KW brand assets | Allowed for KW agents under KW brand guidelines – Dan to confirm current logo version with his office |
| Testimonials | Dan's clients, posted on his site | Kept verbatim. Full text of the three 09/09/2025 testimonials was never published on the old site (only cut-off excerpts) – **ask Dan for the full text** |
| UserWay accessibility widget, Placester footer credit, compliance@placester.com | Placester | Removed |
| MLS / IDX property search | **Not present** on old site | None needed. If Dan wants an IDX search later, it requires a licensed IDX feed from Canopy MLS and stays separate from his own listings |
| Fonts (Montserrat, Source Sans Pro) | Google Fonts, OFL | Self-hosted with licenses in `public/assets/fonts/` |
| heic2any (editor only) | MIT (libheif LGPL) | `owner/ui/vendor/` |

## Open questions for Dan (not guessed)
1. Full text of the three 2025 testimonials; are the reviewers' names/initials OK to show?
2. Extra service areas from the old meta description – include them?
3. DMCA / accessibility page wording – OK as simplified, or keep Placester-style legal text?
4. Should the site show "Equal Housing Opportunity" / a license number in the footer? (Not on the old site; ask his broker.)
5. More homepage slideshow photos (he can send them through "Request a website change").
