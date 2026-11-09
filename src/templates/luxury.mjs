// "Design option 2" – a quieter, luxury-brokerage layout (inspired by the structure of
// high-end brokerage sites: full-screen photography, serif display type, minimal cards).
// Same content and pages as the classic design; only the frame and homepage differ.
import { escapeHtml as e, formatPrice, factsList, STATUS_LABEL } from '../lib/listing.mjs';
import { NAV } from './layout.mjs';
import { heroSeconds } from './pages.mjs';

export function luxLayout(ctx, { path, title, description, body, bodyClass = '', ogImage }) {
  const { site, url, preview } = ctx;
  const fullTitle = path === '/' ? `Charlotte Area Homes for Sale | ${site.name}` : `${title} | ${site.name}`;
  const isHome = path === '/';
  const navItems = NAV.filter((n) => n.href !== '/').map((n) => {
    const current = path.startsWith(n.href);
    return `<li><a href="${url(n.href)}"${current ? ' aria-current="page"' : ''}>${e(n.label)}</a></li>`;
  }).join('');
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(fullTitle)}</title>
<meta name="description" content="${e(description || site.metaDescription)}">
${preview ? '<meta name="robots" content="noindex, nofollow, noarchive">' : ''}
<meta property="og:title" content="${e(fullTitle)}">
${ogImage ? `<meta property="og:image" content="${e(ogImage)}">` : ''}
<meta name="theme-color" content="#1d1d1f">
<link rel="icon" href="${url('/assets/img/favicon.png')}">
<link rel="preload" href="${url('/assets/fonts/cormorant-garamond-latin-500-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('/assets/css/luxury.css')}?v=${ctx.buildId}">
<script src="${url('/assets/js/site.js')}?v=${ctx.buildId}" defer></script>
</head>
<body class="lux ${isHome ? 'lux--home' : ''} ${e(bodyClass)}">
<a class="skip" href="#main">Skip to main content</a>
${preview ? `<div class="preview-bar" role="note">Design option 2 – testing preview. <a href="${e(ctx.altUrl || '#')}">See the classic design</a></div>` : ''}
<header class="lx-header${isHome ? ' lx-header--over' : ''}">
  <div class="lx-header__in">
    <a class="lx-brand" href="${url('/')}">
      <span class="lx-brand__name">Dan McKenna</span>
      <span class="lx-brand__sub">Keller Williams Ballantyne Area, Charlotte, NC</span>
    </a>
    <a class="lx-header__phone" href="${e(site.phoneHref)}">${e(site.phone)}</a>
    <button class="menu-btn lx-menu-btn" type="button" aria-expanded="false" aria-controls="site-nav"><span class="menu-btn__bars" aria-hidden="true"></span><span class="menu-btn__label">Menu</span></button>
    <nav id="site-nav" class="site-nav lx-nav" aria-label="Main"><ul>${navItems}</ul></nav>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="lx-footer">
  <div class="lx-wrap">
    <p class="lx-footer__statement">Experience Counts.</p>
    <div class="lx-footer__cols">
      <section>
        <h2>Dan McKenna</h2>
        <p>${e(site.agentTitle)}<br>${e(site.brokerage)}</p>
        <p><a href="${e(site.phoneHref)}">${e(site.phone)}</a><br><a href="mailto:${e(site.email)}">${e(site.email)}</a></p>
      </section>
      <section>
        <h2>Explore</h2>
        <ul>${NAV.map((n) => `<li><a href="${url(n.href)}">${e(n.label)}</a></li>`).join('')}</ul>
      </section>
      <section>
        <h2>Serving</h2>
        <p>${e(site.serviceAreaSentence.replace(/^Serving /, ''))}</p>
        <img class="lx-footer__logo" src="${url('/assets/img/logo-kw-white.png')}" width="214" height="66" alt="Keller Williams Charlotte Ballantyne Area" loading="lazy">
      </section>
    </div>
    <p class="lx-footer__legal">© ${new Date().getFullYear()} ${e(site.name)} · <a href="${url('/accessibility-2/')}">Accessibility</a> · <a href="${url('/dmca-compliance-2/')}">Copyright</a></p>
  </div>
</footer>
</body>
</html>
`;
}

function luxCard(ctx, l) {
  const cover = l.photos[0];
  const facts = [['beds', 'Beds'], ['baths', 'Baths'], ['sqft', 'Sq Ft']].filter(([k]) => typeof l[k] === 'number');
  return `<li class="lx-card">
  <a href="${ctx.url(`/listings/${l.slug}/`)}">
    <div class="lx-card__img"><img src="${ctx.url(cover.small)}" width="${cover.width}" height="${cover.height}" alt="${e(cover.alt || l.address.street)}" loading="lazy" decoding="async">${l.status !== 'active' ? `<span class="lx-tag">${e(STATUS_LABEL[l.status])}</span>` : ''}</div>
    <p class="lx-card__city">${e(l.address.city)}, ${e(l.address.state)}</p>
    <h3 class="lx-card__addr">${e(l.address.street)}</h3>
    ${l.price ? `<p class="lx-card__price">${e(formatPrice(l.price))}</p>` : ''}
    ${facts.length ? `<dl class="lx-card__facts">${facts.map(([k, lab]) => `<div><dt>${lab}</dt><dd>${e(Number(l[k]).toLocaleString('en-US'))}</dd></div>`).join('')}</dl>` : ''}
  </a>
</li>`;
}

export function luxHome(ctx) {
  const { site, url, listings, testimonials } = ctx;
  const current = listings.filter((l) => l.status !== 'sold');
  // The slideshow shows exactly the photos Dan chose in the editor's "Homepage photos" screen.
  const slides = site.heroSlides.map((s) => ({ hero: s }));
  const slideHtml = slides.map((s, i) => {
    const img = s.hero
      ? `<img src="${url(s.hero.src)}-1400.jpg" srcset="${url(s.hero.src)}-800.jpg 800w, ${url(s.hero.src)}-1400.jpg 1400w, ${url(s.hero.src)}-2000.jpg 2000w" sizes="100vw" alt="${e(s.hero.alt)}" style="object-position:${e(s.hero.focus || '50% 50%')}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">`
      : `<img src="${url(s.img.large)}" srcset="${url(s.img.small)} 900w, ${url(s.img.large)} 1800w" sizes="100vw" alt="${e(s.img.alt || s.caption)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">`;
    return `<div class="hero__slide${i === 0 ? ' is-active' : ''}"${i ? ' aria-hidden="true"' : ''}>${img}${s.caption ? `<a class="lx-hero__caption" href="${s.href}">${e(s.caption)} <span aria-hidden="true">→</span></a>` : ''}</div>`;
  }).join('');
  const multi = slides.length > 1;

  const quotes = testimonials.filter((t) => !t.excerptOnly && t.text[0].length < 420).slice(0, 5);

  return `<section class="hero lx-hero${site.heroFade ? ' hero--fade' : ''}" aria-label="Welcome"${multi ? ` data-interval="${heroSeconds(site)}"` : ''}>
  <div class="hero__slides">${slideHtml}</div>
  <div class="lx-hero__text">
    <p class="lx-eyebrow">Charlotte · Waxhaw · Weddington · Marvin</p>
    <h1>Experience Counts.</h1>
    <p class="lx-hero__sub">Buy. Sell. Build. Relocate.</p>
    <p class="lx-actions"><a class="lx-btn lx-btn--light" href="${url('/listings/')}">View Listings</a><a class="lx-btn lx-btn--ghost" href="${url('/contact/')}">Contact Dan</a></p>
  </div>
  ${multi ? '<button class="hero__pause" type="button" aria-pressed="false"><span class="sr">Pause slideshow</span><span aria-hidden="true" class="hero__pause-icon"></span></button>' : ''}
</section>

<section class="lx-intro" aria-labelledby="intro-h">
  <div class="lx-wrap lx-intro__grid">
    <img class="lx-intro__photo" src="${url('/assets/img/dan-mckenna-headshot.jpg')}" width="360" height="402" alt="Dan McKenna" loading="lazy">
    <div>
      <p class="lx-eyebrow lx-eyebrow--dark">${e(site.agentTitle)}</p>
      <h2 id="intro-h" class="lx-display">Dan McKenna</h2>
      <p class="lx-lede">Over 15 years ago, we relocated our family from New York to the Charlotte area, drawn by everything this wonderful region has to offer. Today, we're proud to help others discover the communities and lifestyle that make the Charlotte area so special.</p>
      <p>Full-time REALTOR® licensed in North Carolina and South Carolina · Certified Luxury Home Marketing Specialist (CLHMS) · GUILD member · Keller Williams Top Producer annually since 2015.</p>
      <p class="lx-contact-line"><a href="${e(site.phoneHref)}">${e(site.phone)}</a><span aria-hidden="true">|</span><a href="mailto:${e(site.email)}">${e(site.email)}</a></p>
      <p><a class="lx-link" href="${url('/about-us/')}">Meet Dan</a></p>
    </div>
  </div>
</section>

<section class="lx-listings" aria-labelledby="fl-h">
  <div class="lx-wrap">
    <div class="lx-section-head"><h2 id="fl-h" class="lx-display">Featured Listings</h2>${current.length ? `<a class="lx-link" href="${url('/listings/')}">View all</a>` : ''}</div>
    ${current.length
      ? `<ul class="lx-cards">${current.slice(0, 6).map((l) => luxCard(ctx, l)).join('')}</ul>`
      : `<div class="lx-empty"><p class="lx-lede">New listings are added here as soon as they come to market.</p><p>Looking for something specific? Call or text Dan and tell him what you're looking for.</p><p><a class="lx-btn" href="${e(site.phoneHref)}">Call ${e(site.phone)}</a></p></div>`}
  </div>
</section>

<section class="lx-services" aria-labelledby="sv-h">
  <div class="lx-wrap">
    <h2 id="sv-h" class="sr">How Dan can help</h2>
    <ol class="lx-services__list">
      <li><span class="lx-services__word">Buy</span><p>Whether you're purchasing your first home, moving into a larger home, or downsizing, I take the time to understand your needs, lifestyle, and priorities.</p><a class="lx-link" href="${url('/about-us/')}">Representing buyers</a></li>
      <li><span class="lx-services__word">Sell</span><p>Selling a home requires more than placing a sign in the yard. I also offer a complimentary market analysis and an opportunity to discuss a marketing plan tailored to your home.</p><a class="lx-link" href="${url('/luxury-home-marketing/')}">Marketing your home</a></li>
      <li><span class="lx-services__word">Build</span><p>The on-site sales representative works for the builder. Having your own representation helps ensure your interests remain a priority.</p><a class="lx-link" href="${url('/new-construction/')}">New construction</a></li>
      <li><span class="lx-services__word">Relocate</span><p>Having personally experienced a relocation to Charlotte, I understand the importance of finding not just the right home, but the right community.</p><a class="lx-link" href="${url('/about-us/')}">Moving to Charlotte</a></li>
    </ol>
  </div>
</section>

<section class="lx-feature" aria-labelledby="lux-h">
  <img src="${url('/assets/img/2515-forest-lawn-dr-1400.jpg')}" srcset="${url('/assets/img/2515-forest-lawn-dr-800.jpg')} 800w, ${url('/assets/img/2515-forest-lawn-dr-1400.jpg')} 1400w" sizes="100vw" alt="2515 Forest Lawn Drive, Weddington NC" loading="lazy">
  <div class="lx-feature__text">
    <p class="lx-eyebrow">Keller Williams Luxury · CLHMS · GUILD™</p>
    <h2 id="lux-h" class="lx-display">Exceptional homes deserve exceptional representation.</h2>
    <a class="lx-btn lx-btn--light" href="${url('/luxury-home-marketing/')}">Luxury Home Marketing</a>
  </div>
</section>

<section class="lx-quotes" aria-labelledby="q-h">
  <div class="lx-wrap">
    <h2 id="q-h" class="lx-eyebrow lx-eyebrow--dark">What clients say</h2>
    <div class="carousel" data-carousel>
      <div class="carousel__track lx-quotes__track">${quotes.map((t) => `<figure class="lx-quote"><blockquote><p>${e(t.text[0])}</p></blockquote><figcaption>${t.client ? e(t.client) + ' · ' : ''}${e(t.title)}</figcaption></figure>`).join('')}</div>
      <div class="carousel__dots" role="group" aria-label="Choose testimonial"></div>
    </div>
    <p class="center"><a class="lx-link" href="${url('/testimonials/')}">Read all testimonials</a></p>
  </div>
</section>`;
}
