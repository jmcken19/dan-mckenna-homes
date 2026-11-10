// Page bodies. Copy is Dan McKenna's own text from danmckennahomes.com (Nov 2026).
// Every visible word goes through t() / tBlock() / tList() (src/lib/text.mjs): the words live in content/text.json
// (or content/site.json for contact facts), and Dan can click and change them in the editor. Never hard-code words.
import { escapeHtml as e, STATUS_LABEL } from '../lib/listing.mjs';
import { t, tBlock, tList, tText } from '../lib/text.mjs';
import { pageWithSidebar, askBox, contactForm } from './layout.mjs';
import { listingCard } from './listing.mjs';
import { sitePhoto, PHOTO_SPOTS } from '../lib/photos.mjs';
import { editMark, ownedBy } from '../lib/editables.mjs';

/** Edit mark for a photo spot (only in the editor's edit-on-the-page preview). */
const photoMark = (ctx, key) => editMark(ctx, 'photo', key, PHOTO_SPOTS[key]?.label || '');

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
}

function testimonialCard(ctx, r, { full = false, mark = false } = {}) {
  const first = r.text[0];
  const short = !full && first.length > 170 ? first.slice(0, first.lastIndexOf(' ', 165)) + '…' : first;
  const own = ownedBy(ctx, 'reviews'); // the review's own words are changed in the reviews panel
  return `<article class="tcard"${mark ? editMark(ctx, 'review', r.slug, r.title) : ''}>
  <p class="tcard__meta"${own}>${r.client ? `<span>${e(r.client)}</span>` : ''}<time datetime="${e(r.date)}">${fmtDate(r.date)}</time></p>
  <h3 class="tcard__title"${own}><a href="${ctx.url(`/testimonial/${r.slug}/`)}">${e(r.title)}</a></h3>
  <blockquote${own}><p>${e(short)}</p></blockquote>
  <a class="tcard__more" href="${ctx.url(`/testimonial/${r.slug}/`)}" aria-label="${e(tText(ctx, 'reviews.readMore'))}: ${e(r.title)}">${t(ctx, 'reviews.readMore')}</a>
</article>`;
}

/** Newest reviews first (ties keep their order). Not used for display any more: reviews show in the order of
 *  content/testimonials.json, which Dan arranges in the editor (Nov 2026). Kept for reference / one-time sorting. */
export function newestFirst(list) {
  return list.map((t, i) => [t, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || a[1] - b[1]).map(([t]) => t);
}

export function heroSeconds(site) {
  const n = Number(site.heroSlideSeconds);
  return Number.isFinite(n) && n >= 2 && n <= 30 ? n : 7;
}

export function homePage(ctx) {
  const { site, url, listings } = ctx;
  const slides = site.heroSlides.map((s, i) => `<div class="hero__slide${i === 0 ? ' is-active' : ''}"${i ? ' aria-hidden="true"' : ''}>
      <picture>
        <img src="${url(s.src)}-1400.jpg" srcset="${url(s.src)}-800.jpg 800w, ${url(s.src)}-1400.jpg 1400w, ${url(s.src)}-2000.jpg 2000w" sizes="100vw" alt="${e(s.alt)}" style="object-position:${e(s.focus || '50% 50%')}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      </picture>
    </div>`).join('');
  const multi = site.heroSlides.length > 1 && site.heroAutoplay !== false;

  const shown = listings.filter((l) => l.status !== 'sold').slice(0, 6);
  const listingsSection = shown.length ? `<section class="home-listings" aria-labelledby="hl-h">
  <div class="wrap">
    <h2 id="hl-h" class="section-title">Dan's Listings</h2>
    <ul class="lgrid">${shown.map((l) => listingCard(ctx, l)).join('')}</ul>
    <p class="center"><a class="btn btn--dark" href="${url('/listings/')}">View all listings</a></p>
  </div>
</section>` : '';

  const reviews = ctx.testimonials; // the order of content/testimonials.json (Dan arranges it in the editor)
  return `<section class="hero${site.heroFade ? ' hero--fade' : ' hero--slide'}" aria-label="Welcome"${multi ? ` data-interval="${heroSeconds(site)}"` : ''}${editMark(ctx, 'slideshow', 'hero', 'Homepage photos')}>
  <div class="hero__slides">${slides}</div>
  <div class="hero__text">
    <h1>${t(ctx, 'site.name')}</h1>
    <p>${t(ctx, 'site.tagline')}</p>
    <p class="hero__actions">
      <a class="btn btn--accent" href="${e(site.phoneHref)}">${t(ctx, 'home.call')} ${t(ctx, 'site.phone')}</a>
    </p>
  </div>
  ${multi ? `<button class="hero__pause sr-focus" type="button" aria-pressed="false">${t(ctx, 'hero.pause')}</button>` : ''}
</section>
<section class="home-testimonials" aria-labelledby="ht-h" data-reveal${editMark(ctx, 'reviews', 'row', 'Client reviews')}>
  <div class="wrap">
    <h2 id="ht-h" class="section-title">${t(ctx, 'home.reviewsTitle')}</h2>
    <div class="carousel" data-carousel data-marquee>
      <div class="carousel__track" tabindex="0" aria-label="Client reviews – drag or scroll sideways to read more">${reviews.map((x) => testimonialCard(ctx, x)).join('')}</div>
      <div class="carousel__dots" role="group" aria-label="Choose testimonial"></div>
      <button class="marquee-pause sr-focus" type="button" aria-pressed="false" hidden>${t(ctx, 'reviews.pause')}</button>
    </div>
    <p class="center"><a class="btn btn--dark btn--wide" href="${url('/testimonials/')}">${t(ctx, 'home.viewAll')}</a></p>
  </div>
</section>`;
}

export function listingsIndexPage(ctx) {
  const { listings, site } = ctx;
  const groups = ['active', 'pending', 'sold'].map((s) => ({ s, items: listings.filter((l) => l.status === s) }));
  const anyCurrent = groups[0].items.length + groups[1].items.length > 0;
  const titles = { active: 'For Sale', pending: 'Under Contract (Pending)', sold: 'Recently Sold' };
  const sections = groups.filter((g) => g.items.length).map((g) => `<section aria-labelledby="g-${g.s}">
    <h2 id="g-${g.s}" class="section-title section-title--left">${titles[g.s]}</h2>
    <ul class="lgrid">${g.items.map((l) => listingCard(ctx, l)).join('')}</ul>
  </section>`).join('');
  const empty = anyCurrent ? '' : `<div class="empty">
    <h2>No homes listed here right now</h2>
    <p>Dan's new listings appear on this page as soon as they hit the market. Looking for something specific? Call or text Dan and tell him what you're looking for.</p>
    <p><a class="btn btn--accent" href="${e(site.phoneHref)}">Call ${e(site.phone)}</a> <a class="btn" href="mailto:${e(site.email)}">Email Dan</a></p>
  </div>`;
  return `<div class="wrap page page--wide">
  <div class="page__main">
    <h1 class="page__title">Listings</h1>
    <p class="lede">Homes Dan McKenna is currently representing.</p>
    ${empty}${sections}
  </div>
</div>`;
}

export function removedListingPage(ctx, r) {
  return pageWithSidebar(ctx, {
    heading: 'This home is no longer on Dan’s website',
    content: `<p><strong>${e(r.address)}</strong> has been taken off the website. It may have sold or been withdrawn from the market.</p>
<p>Dan can tell you what happened with this home and show you similar ones nearby.</p>
<p><a class="btn btn--dark" href="${ctx.url('/contact/')}">Contact Dan</a></p>`,
  });
}

export function aboutPage(ctx) {
  const { url } = ctx;
  return pageWithSidebar(ctx, {
    heading: '',
    intro: `<div class="about-intro">
  <img class="headshot" src="${url(sitePhoto(ctx.site, 'headshot').small)}" width="360" height="402" alt="${e(sitePhoto(ctx.site, 'headshot').alt)}"${photoMark(ctx, 'headshot')}>
  <div>
    <h1 class="page__title">${t(ctx, 'about.title')}</h1>
    <p class="kicker">${t(ctx, 'about.kicker')}</p>
  </div>
</div>`,
    content: `${tBlock(ctx, 'about.intro.text')}
<h2>${t(ctx, 'about.buyers.title')}</h2>
${tBlock(ctx, 'about.buyers.text')}
<h2>${t(ctx, 'about.sellers.title')}</h2>
${tBlock(ctx, 'about.sellers.text')}
<h2>${t(ctx, 'about.newConstruction.title')}</h2>
${tBlock(ctx, 'about.newConstruction.text')}
<h2>${t(ctx, 'about.relocation.title')}</h2>
${tBlock(ctx, 'about.relocation.text')}
<h2>${t(ctx, 'about.recognition.title')}</h2>
${tBlock(ctx, 'about.recognition.text')}
${tList(ctx, 'about.recognition.list')}
<h2>${t(ctx, 'about.commitment.title')}</h2>
${tBlock(ctx, 'about.commitment.text')}
<h2>${t(ctx, 'about.wendy.title')}</h2>
${tBlock(ctx, 'about.wendy.text')}`,
  });
}

export function newConstructionPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: t(ctx, 'newConstruction.title'),
    intro: `<p class="kicker">${t(ctx, 'newConstruction.kicker')}</p>`,
    content: `<img class="page__img" src="${ctx.url(sitePhoto(ctx.site, 'construction').large)}" width="640" height="427" alt="${e(sitePhoto(ctx.site, 'construction').alt)}"${photoMark(ctx, 'construction')}>
${tBlock(ctx, 'newConstruction.intro.text')}
<h2>${t(ctx, 'newConstruction.reasons.title')}</h2>
<h3>${t(ctx, 'newConstruction.reason1.title')}</h3>
${tBlock(ctx, 'newConstruction.reason1.text')}
<h3>${t(ctx, 'newConstruction.reason2.title')}</h3>
${tBlock(ctx, 'newConstruction.reason2.text')}
<h3>${t(ctx, 'newConstruction.reason3.title')}</h3>
${tBlock(ctx, 'newConstruction.reason3.text')}
<h3>${t(ctx, 'newConstruction.reason4.title')}</h3>
${tBlock(ctx, 'newConstruction.reason4.text')}
<h3>${t(ctx, 'newConstruction.reason5.title')}</h3>
${tBlock(ctx, 'newConstruction.reason5.text')}
<h2>${t(ctx, 'newConstruction.build.title')}</h2>
${tBlock(ctx, 'newConstruction.build.text')}
<p class="signoff"><strong>${t(ctx, 'newConstruction.signoff.name')}</strong><br>${t(ctx, 'newConstruction.signoff.line1')}<br>${t(ctx, 'newConstruction.signoff.line2')}</p>`,
  });
}

export function luxuryPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: t(ctx, 'luxury.title'),
    intro: `<p class="kicker">${t(ctx, 'luxury.kicker')}</p>`,
    content: `${tBlock(ctx, 'luxury.intro.text')}
<h2>${t(ctx, 'luxury.kwLuxury.title')}</h2>
${tBlock(ctx, 'luxury.kwLuxury.text')}
<h2>${t(ctx, 'luxury.clhms.title')}</h2>
${tBlock(ctx, 'luxury.clhms.text')}
<h2>${t(ctx, 'luxury.guild.title')}</h2>
${tBlock(ctx, 'luxury.guild.text')}
<h2>${t(ctx, 'luxury.approach.title')}</h2>
${tBlock(ctx, 'luxury.approach.text')}
<figure class="feature">
  <img src="${ctx.url(sitePhoto(ctx.site, 'luxury').large)}" srcset="${ctx.url(sitePhoto(ctx.site, 'luxury').small)} 800w, ${ctx.url(sitePhoto(ctx.site, 'luxury').large)} 1400w" sizes="(min-width: 1000px) 700px, 100vw" width="1400" height="1050" alt="${e(sitePhoto(ctx.site, 'luxury').alt)}" loading="lazy"${photoMark(ctx, 'luxury')}>
  ${sitePhoto(ctx.site, 'luxury').id ? '' : `<figcaption><strong>${t(ctx, 'luxury.caption.title')}</strong><br>${t(ctx, 'luxury.caption.address')}<br>${t(ctx, 'luxury.caption.builder')}</figcaption>`}
</figure>
<h2>${t(ctx, 'luxury.homes.title')}</h2>
${tBlock(ctx, 'luxury.homes.text')}
<h2>${t(ctx, 'luxury.experience.title')}</h2>
${tBlock(ctx, 'luxury.experience.text')}
<p class="signoff"><strong>${t(ctx, 'luxury.signoff.name')}</strong><br>${t(ctx, 'luxury.signoff.line1')}<br>${t(ctx, 'luxury.signoff.line2')}<br>${t(ctx, 'luxury.signoff.line3')}</p>`,
  });
}

export function testimonialsPage(ctx) {
  return `<div class="wrap page">
  <div class="page__main"${editMark(ctx, 'reviews', 'list', 'Client reviews')}>
    <h1 class="page__title">${t(ctx, 'reviews.title')}</h1>
    <div class="tgrid">${ctx.testimonials.map((t) => testimonialCard(ctx, t, { mark: true })).join('')}</div>
  </div>
  ${askBox(ctx)}
</div>`;
}

export function testimonialPage(ctx, r) {
  return pageWithSidebar(ctx, {
    heading: e(r.title),
    headingAttrs: ownedBy(ctx, 'reviews'), // the review's own words are changed in the reviews panel
    content: `<blockquote class="tquote"${ownedBy(ctx, 'reviews')}>${r.text.map((p) => `<p>${e(p)}</p>`).join('')}
  <footer>${r.client ? `<strong>${e(r.client)}</strong>` : ''}${r.role ? ` <span>${e(r.role)}</span>` : ''} <time datetime="${e(r.date)}">${fmtDate(r.date)}</time></footer>
</blockquote>
<p><a href="${ctx.url('/testimonials/')}">${t(ctx, 'reviews.back')}</a></p>`,
  });
}

export function contactPage(ctx) {
  const { site, url } = ctx;
  return `<div class="wrap page">
  <div class="page__main">
    <h1 class="page__title">${t(ctx, 'contact.title')}</h1>
    <div class="contact-card">
      <img class="headshot headshot--sm" src="${url(sitePhoto(site, 'headshot').small)}" width="360" height="402" alt="${e(sitePhoto(site, 'headshot').alt)}"${photoMark(ctx, 'headshot')}>
      <div>
        <h2>${t(ctx, 'site.agent')}</h2>
        <p class="kicker">${t(ctx, 'site.tagline')}</p>
        <p>${t(ctx, 'contact.license')}<br>${t(ctx, 'site.brokerage')}</p>
        <dl class="contact-list">
          <div><dt>${t(ctx, 'contact.mobile')}</dt><dd><a href="${e(site.phoneHref)}">${t(ctx, 'site.phone')}</a></dd></div>
          <div><dt>${t(ctx, 'contact.email')}</dt><dd><a href="mailto:${e(site.email)}">${t(ctx, 'site.email')}</a></dd></div>
        </dl>
        <p class="contact-actions">
          <a class="btn btn--accent" href="${e(site.phoneHref)}">${t(ctx, 'contact.call')}</a>
          <a class="btn" href="${e(site.smsHref)}">${t(ctx, 'contact.text')}</a>
          <a class="btn" href="mailto:${e(site.email)}">${t(ctx, 'contact.emailButton')}</a>
        </p>
      </div>
    </div>
    <p>${t(ctx, 'site.serviceAreaSentence')}</p>
    <div class="contact-form">${contactForm(ctx, { id: 'contact' })}</div>
  </div>
</div>`;
}

export function accessibilityPage(ctx) {
  const { site } = ctx;
  return pageWithSidebar(ctx, {
    heading: t(ctx, 'accessibility.title'),
    content: `<h2>${t(ctx, 'accessibility.commitment.title')}</h2>
${tBlock(ctx, 'accessibility.commitment.text')}
<h2>${t(ctx, 'accessibility.help.title')}</h2>
<p>${t(ctx, 'accessibility.help.call')} <a href="${e(site.phoneHref)}">${t(ctx, 'site.phone')}</a> ${t(ctx, 'accessibility.help.orEmail')} <a href="mailto:${e(site.email)}">${t(ctx, 'site.email')}</a> ${t(ctx, 'accessibility.help.after')}</p>
<p>${t(ctx, 'accessibility.ssa.before')} <a href="https://www.ssa.gov/accessibility/">${t(ctx, 'accessibility.ssa.link')}</a> ${t(ctx, 'accessibility.ssa.after')}</p>`,
  });
}

export function dmcaPage(ctx) {
  const { site } = ctx;
  return pageWithSidebar(ctx, {
    heading: t(ctx, 'dmca.title'),
    content: `<p>${t(ctx, 'dmca.before')} ${t(ctx, 'site.agent')} ${t(ctx, 'dmca.at')} <a href="mailto:${e(site.email)}">${t(ctx, 'site.email')}</a> ${t(ctx, 'dmca.or')} <a href="${e(site.phoneHref)}">${t(ctx, 'site.phone')}</a> ${t(ctx, 'dmca.after')}</p>`,
  });
}

export function notFoundPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: t(ctx, 'notFound.title'),
    content: `${tBlock(ctx, 'notFound.text')}
<ul><li><a href="${ctx.url('/')}">${t(ctx, 'notFound.home')}</a></li><li><a href="${ctx.url('/contact/')}">${t(ctx, 'notFound.contact')}</a></li></ul>`,
  });
}

export { STATUS_LABEL };
