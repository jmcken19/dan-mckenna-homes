import { escapeHtml as e } from '../lib/listing.mjs';

export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/about-us/', label: 'About us' },
  { href: '/new-construction/', label: 'New Construction' },
  { href: '/luxury-home-marketing/', label: 'Luxury Home Marketing' },
  { href: '/testimonials/', label: 'Testimonials' },
  { href: '/contact/', label: 'Contact' },
];

const ICON = {
  phone: '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
  mail: '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
};

export function layout(ctx, { path, title, description, body, bodyClass = '', ogImage, noSidebar = true }) {
  const { site, url, preview } = ctx;
  const fullTitle = path === '/' ? `Charlotte Area Homes for Sale | ${site.name}` : `${title} | ${site.name}`;
  const canonical = ctx.siteUrl ? ctx.siteUrl.replace(/\/$/, '') + path : '';
  const navItems = NAV.map((n) => {
    const current = n.href === '/' ? path === '/' : path.startsWith(n.href);
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
${preview ? '<script>try{if(localStorage.getItem("dmhHidePreview")==="1")document.documentElement.classList.add("preview-hidden")}catch(e){}</script>' : ''}
${canonical && !preview ? `<link rel="canonical" href="${e(canonical)}">` : ''}
<meta property="og:title" content="${e(fullTitle)}">
<meta property="og:description" content="${e(description || site.metaDescription)}">
${ogImage ? `<meta property="og:image" content="${e(ogImage)}">` : ''}
<meta name="theme-color" content="#c41e1d">
<link rel="icon" href="${url('/favicon.ico')}" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${url('/assets/img/favicon-32.png')}">
<link rel="apple-touch-icon" href="${url('/assets/img/apple-touch-icon.png')}">
<link rel="manifest" href="${url('/site.webmanifest')}">
<link rel="preload" href="${url('/assets/fonts/montserrat-latin-600-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('/assets/css/site.css')}?v=${ctx.buildId}">
<script src="${url('/assets/js/site.js')}?v=${ctx.buildId}" defer></script>
</head>
<body class="${e(bodyClass)}">
<a class="skip" href="#main">Skip to main content</a>
${preview ? `<div class="preview-bar" role="note">Testing preview – not the live website. <a href="${e(site.liveUrl || 'https://www.danmckennahomes.com/')}">Go to the live site</a>${ctx.altUrl ? ` · <a href="${e(ctx.altUrl)}">See design option 2</a>` : ''}<button type="button" class="preview-bar__hide" data-hide-preview aria-label="Hide this testing banner">Hide ×</button></div>` : ''}
<div class="topbar">
  <div class="wrap topbar__in">
    <a href="${e(site.phoneHref)}">${ICON.phone}<span>${e(site.phone)}</span></a>
    <span class="topbar__dot" aria-hidden="true">·</span>
    <a href="mailto:${e(site.email)}">${ICON.mail}<span>${e(site.email)}</span></a>
  </div>
</div>
<header class="site-header">
  <div class="wrap site-header__in">
    <a class="brand" href="${url('/')}">
      <img src="${url('/assets/img/logo-kw-charlotte-ballantyne.png')}" width="188" height="58" alt="Keller Williams Charlotte Ballantyne Area – Dan McKenna Homes">
      <span class="brand__tag">${e(site.tagline)}</span>
    </a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">
      <span class="menu-btn__bars" aria-hidden="true"></span><span class="menu-btn__label">Menu</span>
    </button>
    <nav id="site-nav" class="site-nav" aria-label="Main">
      <ul>${navItems}</ul>
    </nav>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <img class="site-footer__logo" src="${url('/assets/img/logo-kw-white.png')}" width="214" height="66" alt="Keller Williams Charlotte Ballantyne Area" loading="lazy">
    <div class="site-footer__cols">
      <section>
        <h2>About</h2>
        <ul>${NAV.map((n) => `<li><a href="${url(n.href)}">${e(n.label)}</a></li>`).join('')}</ul>
      </section>
      <section>
        <h2>Contact Dan</h2>
        <ul>
          <li><a href="${e(site.phoneHref)}">${e(site.phone)}</a></li>
          <li><a href="mailto:${e(site.email)}">${e(site.email)}</a></li>
          <li>${e(site.agent)}, ${e(site.agentTitle)}</li>
          <li>${e(site.brokerage)}</li>
        </ul>
      </section>
      <section>
        <h2>Consumer Protection &amp; Privacy</h2>
        <ul>
          <li><a href="${url('/accessibility-2/')}">Accessibility</a></li>
          <li><a href="${url('/dmca-compliance-2/')}">Copyright (DMCA)</a></li>
        </ul>
      </section>
    </div>
    <p class="site-footer__legal">© ${new Date().getFullYear()} ${e(site.name)}. All rights reserved.</p>
  </div>
</footer>
</body>
</html>
`;
}

/** The "Have a question?" box that sits beside inner pages, same place as the old form. */
export function askBox(ctx, { heading = 'Have a question?', about = '' } = {}) {
  const { site } = ctx;
  const subject = about ? `?subject=${encodeURIComponent('Question about ' + about)}` : '';
  return `<aside class="ask" aria-labelledby="ask-h">
  <h2 id="ask-h">${e(heading)}</h2>
  <p>${about ? `Ask Dan about <strong>${e(about)}</strong>.` : 'Dan answers his own phone. Call, text, or email any time.'}</p>
  <a class="btn btn--accent" href="${e(site.phoneHref)}">Call ${e(site.phone)}</a>
  <a class="btn" href="${e(site.smsHref)}">Text Dan</a>
  <a class="btn" href="mailto:${e(site.email)}${subject}">Email Dan</a>
</aside>`;
}

export function pageWithSidebar(ctx, { heading, intro = '', content, about }) {
  return `<div class="wrap page">
  <div class="page__main">
    ${heading ? `<h1 class="page__title">${heading}</h1>` : ''}
    ${intro}
    <div class="prose">${content}</div>
  </div>
  ${askBox(ctx, { about })}
</div>`;
}
