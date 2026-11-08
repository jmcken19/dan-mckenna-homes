// Page bodies. Copy is Dan McKenna's own text from danmckennahomes.com (Nov 2026).
import { escapeHtml as e, STATUS_LABEL } from '../lib/listing.mjs';
import { pageWithSidebar, askBox } from './layout.mjs';
import { listingCard } from './listing.mjs';

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
}

function testimonialCard(ctx, t, { full = false } = {}) {
  const first = t.text[0];
  const short = !full && first.length > 170 ? first.slice(0, first.lastIndexOf(' ', 165)) + '…' : first;
  return `<article class="tcard">
  <p class="tcard__meta">${t.client ? `<span>${e(t.client)}</span>` : ''}<time datetime="${e(t.date)}">${fmtDate(t.date)}</time></p>
  <h3 class="tcard__title"><a href="${ctx.url(`/testimonial/${t.slug}/`)}">${e(t.title)}</a></h3>
  <blockquote><p>${e(short)}</p></blockquote>
  <a class="tcard__more" href="${ctx.url(`/testimonial/${t.slug}/`)}" aria-label="Read more: ${e(t.title)}">Read more</a>
</article>`;
}

export function homePage(ctx) {
  const { site, url, listings } = ctx;
  const slides = site.heroSlides.map((s, i) => `<div class="hero__slide${i === 0 ? ' is-active' : ''}"${i ? ' aria-hidden="true"' : ''}>
      <picture>
        <img src="${url(s.src)}-1400.jpg" srcset="${url(s.src)}-800.jpg 800w, ${url(s.src)}-1400.jpg 1400w, ${url(s.src)}-2000.jpg 2000w" sizes="100vw" alt="${e(s.alt)}" style="object-position:${e(s.focus || '50% 50%')}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      </picture>
    </div>`).join('');
  const multi = site.heroSlides.length > 1;

  const shown = listings.filter((l) => l.status !== 'sold').slice(0, 6);
  const listingsSection = shown.length ? `<section class="home-listings" aria-labelledby="hl-h">
  <div class="wrap">
    <h2 id="hl-h" class="section-title">Dan's Listings</h2>
    <ul class="lgrid">${shown.map((l) => listingCard(ctx, l)).join('')}</ul>
    <p class="center"><a class="btn btn--dark" href="${url('/listings/')}">View all listings</a></p>
  </div>
</section>` : '';

  const t = ctx.testimonials.slice(0, 6);
  return `<section class="hero" aria-label="Welcome"${multi ? ` data-interval="${Number(site.heroSlideSeconds) || 7}"` : ''}>
  <div class="hero__slides">${slides}</div>
  <div class="hero__text">
    <h1>${e(site.name)}</h1>
    <p>${e(site.tagline)}</p>
    <p class="hero__actions">
      <a class="btn btn--light" href="${url('/listings/')}">View Listings</a>
      <a class="btn btn--accent" href="${e(site.phoneHref)}">Call Dan ${e(site.phone)}</a>
    </p>
  </div>
  ${multi ? '<button class="hero__pause" type="button" aria-pressed="false"><span class="sr">Pause slideshow</span><span aria-hidden="true" class="hero__pause-icon"></span></button>' : ''}
</section>
${listingsSection}
<section class="home-testimonials" aria-labelledby="ht-h">
  <div class="wrap">
    <h2 id="ht-h" class="section-title">What Clients Say About Working With Us</h2>
    <div class="carousel" data-carousel>
      <div class="carousel__track">${t.map((x) => testimonialCard(ctx, x)).join('')}</div>
      <div class="carousel__dots" role="group" aria-label="Choose testimonial"></div>
    </div>
    <p class="center"><a class="btn btn--dark btn--wide" href="${url('/testimonials/')}">View all</a></p>
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
<p><a class="btn btn--dark" href="${ctx.url('/listings/')}">See current listings</a></p>`,
  });
}

export function aboutPage(ctx) {
  const { url } = ctx;
  return pageWithSidebar(ctx, {
    heading: '',
    intro: `<div class="about-intro">
  <img class="headshot" src="${url('/assets/img/dan-mckenna-headshot.jpg')}" width="360" height="402" alt="Dan McKenna">
  <div>
    <h1 class="page__title">Dan McKenna, NC/SC Broker/REALTOR®</h1>
    <p class="kicker">Experience Counts.</p>
  </div>
</div>`,
    content: `<p>Over 15 years ago, we relocated our family from New York to the Charlotte area, drawn by everything this wonderful region has to offer. Having made that move ourselves, we understand the excitement and challenges of finding a new place to call home. Today, we're proud to help others discover the communities and lifestyle that make the Charlotte area so special.</p>
<p>I am a full-time REALTOR® licensed in North Carolina and South Carolina, specializing in residential real estate, luxury homes, relocation, buyer and seller representation, and new construction. As a Certified Luxury Home Marketing Specialist (CLHMS) and GUILD member, I bring extensive market knowledge, strong negotiation skills, and personalized service to every transaction.</p>
<p>I am supported by my wife, Wendy, who serves as my Administrative Assistant, and Tammy, our Closing Coordinator. Together, we are committed to making every real estate experience as smooth, organized, and successful as possible.</p>
<h2>Representing Buyers</h2>
<p>Whether you're purchasing your first home, moving into a larger home, or downsizing, I take the time to understand your needs, lifestyle, and priorities. My knowledge of the Charlotte-area market helps you make informed decisions, identify the right opportunities, and negotiate with confidence.</p>
<h2>Representing Sellers</h2>
<p>Selling a home requires more than placing a sign in the yard. I develop a personalized marketing strategy designed to showcase your property's strengths, attract qualified buyers, and achieve the best possible outcome.</p>
<p>From pricing and presentation to marketing and negotiations, I provide experienced guidance throughout the selling process. I also offer a complimentary market analysis and an opportunity to discuss a marketing plan tailored to your home.</p>
<h2>New Construction Representation</h2>
<p>Buying a newly constructed home is an exciting opportunity, but having an experienced REALTOR® representing your interests is essential.</p>
<p>I have extensive experience working with national, regional, and custom home builders throughout the Charlotte area. From selecting a homesite and reviewing builder contracts to negotiating and navigating the construction process, I provide guidance every step of the way.</p>
<p>Remember, the on-site sales representative works for the builder. Having your own representation helps ensure your interests remain a priority. Buyer representation fees and terms are discussed upfront.</p>
<h2>Relocation to the Charlotte Area</h2>
<p>Having personally experienced a relocation to Charlotte, I understand the importance of finding not just the right home, but the right community.</p>
<p>I help relocating buyers explore neighborhoods, schools, amenities, and lifestyles throughout Charlotte, Waxhaw, Weddington, Marvin, and the surrounding areas. My goal is to make your transition as informed and seamless as possible.</p>
<h2>Experience &amp; Recognition</h2>
<p>My commitment to my clients and consistent real estate production have earned recognition throughout my career, including:</p>
<ul>
<li>2022 #1 Individual Real Estate Agent — Keller Williams Ballantyne office, among approximately 500 agents</li>
<li>Consistent Keller Williams Top Producer — Recognized for production annually since 2015</li>
<li>Nextdoor Neighborhood Favorite — 2017, 2018, 2019, 2023 &amp; 2024</li>
<li>Multiple recognitions from the Keller Williams Carolinas Region</li>
<li>Consistent Top Agent recognition in Union County</li>
</ul>
<h2>A Commitment Beyond the Closing</h2>
<p>Real estate is about more than buying or selling a home. It's about relationships built on trust, communication, and results.</p>
<p>My goal is simple: to provide an exceptional experience so that when your family, friends, or neighbors need real estate guidance, you'll feel confident referring them to me.</p>
<h2>Wendy McKenna, Administrative Assistant</h2>
<p>Over 15 years ago, Dan and I relocated our family from New York to the Charlotte area in search of more family time, excellent schools, milder weather, and a community that fit our lifestyle. Looking back, I can confidently say we found everything we were hoping for and more. Charlotte has become home, and we're grateful for the life we've built here.</p>
<p>As Dan's Administrative Assistant, I draw on my professional background in healthcare and education, which helped shape the attention to detail, communication skills, and commitment to helping others that I bring to my work today.</p>
<p>Working closely with Dan, I assist with property listings, marketing, client communication, scheduling, and the day-to-day operations of our business. I take pride in staying organized, anticipating needs, and making sure our clients feel informed and supported throughout the process.</p>
<p>What I enjoy most about my role is the opportunity to work with people. Whether preparing a home for the market, coordinating showings, or assisting our clients behind the scenes, my goal is to help make their real estate experience as seamless and positive as possible.</p>`,
  });
}

export function newConstructionPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: 'New Construction Home Buying',
    intro: `<p class="kicker">Building Your Dream Home? Experience Counts.</p>`,
    content: `<img class="page__img" src="${ctx.url('/assets/img/construction.jpg')}" width="640" height="427" alt="New home under construction with wood framing">
<p>The Charlotte metropolitan area continues to offer exciting opportunities for new construction, from established neighborhoods and growing communities to exceptional custom homes.</p>
<p>Building or purchasing a newly constructed home can be an exciting and rewarding experience, but the process can also be complex. Having an experienced real estate professional representing your interests can make all the difference.</p>
<h2>5 Reasons to Work with an Experienced Buyer's Agent When Purchasing New Construction</h2>
<h3>1. Representation That Puts Your Interests First</h3>
<p>The on-site sales representative works for the builder. As your buyer's agent, I represent your interests throughout the purchasing and construction process, helping you understand your options and make informed decisions. Buyer representation fees and compensation arrangements are discussed upfront.</p>
<h3>2. Builder Knowledge and Negotiation Experience</h3>
<p>With extensive experience working with national, regional, and custom home builders throughout the Charlotte area, I understand builder incentives, market conditions, comparable sales, and potential opportunities for negotiation. My goal is to help you secure the best possible value for your investment.</p>
<h3>3. Guidance Beyond the Purchase Agreement</h3>
<p>My involvement doesn't end when the contract is signed. I help you navigate important contract terms and construction milestones, coordinate with the builder, and participate in scheduled inspections and walkthroughs when permitted. When concerns arise, I advocate for your interests and work toward a satisfactory resolution.</p>
<h3>4. Assistance Throughout the Financing Process</h3>
<p>New construction financing can differ from purchasing an existing home. I help you understand available builder incentives and financing considerations while working alongside your chosen mortgage professional to keep the process moving forward.</p>
<h3>5. Support Through Closing and Beyond</h3>
<p>From your initial home search and homesite selection to the final walkthrough and closing, I remain involved every step of the way. Even after closing, I can help direct you to the appropriate builder contacts and warranty resources when questions arise.</p>
<h2>Build with Confidence</h2>
<p>Whether you're considering a move-in-ready new home, selecting a homesite in a new community, or building a fully customized residence, having an experienced REALTOR® on your side provides valuable guidance and peace of mind.</p>
<p>Let my experience work for you.</p>
<p class="signoff"><strong>Dan McKenna</strong><br>Dan McKenna Homes | Keller Williams Ballantyne Area<br>Serving Charlotte, Waxhaw, Weddington, Marvin, and surrounding communities in North Carolina and South Carolina.</p>`,
  });
}

export function luxuryPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: 'Luxury Home Marketing',
    intro: `<p class="kicker">Exceptional Properties. Experienced Representation. Personalized Service.</p>`,
    content: `<p>Luxury real estate requires more than beautiful photography and an attractive listing. It requires an understanding of the market, thoughtful pricing, strategic marketing, skilled negotiations, and an appreciation for the distinctive qualities that make each home unique.</p>
<p>At Dan McKenna Homes, I combine extensive Charlotte-area real estate experience with specialized luxury credentials and the resources of Keller Williams Luxury to provide personalized representation for buyers and sellers of exceptional properties.</p>
<h2>The Keller Williams Luxury Advantage</h2>
<p>As a Keller Williams Luxury real estate professional, I have access to an extensive network of real estate professionals, specialized marketing resources, and connections that extend beyond the Charlotte area.</p>
<p>This network complements my local market expertise, providing additional opportunities to connect exceptional properties with potential buyers locally, nationally, and internationally.</p>
<p>My clients benefit from the resources of an established luxury real estate brand while receiving the personalized attention and experienced guidance of a dedicated local agent.</p>
<h2>Certified Luxury Home Marketing Specialist™ (CLHMS)</h2>
<p>The Certified Luxury Home Marketing Specialist™ designation is awarded by The Institute for Luxury Home Marketing to real estate professionals who have completed specialized luxury real estate education and demonstrated documented sales performance in the upper-tier residential market.</p>
<p>The designation recognizes both professional knowledge and proven transaction experience, reflecting my commitment to providing knowledgeable representation for luxury buyers and sellers.</p>
<h2>GUILD™ Recognition</h2>
<p>In addition to my CLHMS designation, I have earned GUILD™ recognition from The Institute for Luxury Home Marketing.</p>
<p>GUILD recognition is awarded to qualified CLHMS professionals who have demonstrated successful sales performance in the residential market at or above $1 million.</p>
<p>This distinction recognizes proven experience representing clients in the million-dollar luxury home market.</p>
<h2>A Personalized Approach to Luxury Real Estate</h2>
<p>Every luxury property is unique and deserves an individualized marketing strategy.</p>
<p>My approach includes strategic pricing, professional photography, compelling property descriptions, thoughtful digital marketing, agent networking, and experienced negotiations.</p>
<p>Whether representing an established luxury estate or an extraordinary new construction residence, I focus on highlighting the features, craftsmanship, location, and lifestyle that distinguish each home.</p>
<figure class="feature">
  <img src="${ctx.url('/assets/img/2515-forest-lawn-dr-1400.jpg')}" srcset="${ctx.url('/assets/img/2515-forest-lawn-dr-800.jpg')} 800w, ${ctx.url('/assets/img/2515-forest-lawn-dr-1400.jpg')} 1400w" sizes="(min-width: 1000px) 700px, 100vw" width="1400" height="1050" alt="2515 Forest Lawn Drive, Weddington NC" loading="lazy">
  <figcaption><strong>Featured Dan McKenna Homes Listing</strong><br>2515 Forest Lawn Drive, Weddington NC<br>Built by Tiara Homes</figcaption>
</figure>
<h2>Luxury Homes &amp; Custom Construction</h2>
<p>The Charlotte metropolitan area offers a remarkable variety of luxury living opportunities, including established estates, distinctive neighborhoods, and custom-built residences.</p>
<p>With experience representing buyers and sellers of luxury properties and working with national, regional, and custom home builders, I understand the details involved in navigating this specialized market.</p>
<p>Whether you're considering the purchase of a luxury home, exploring a custom-building opportunity, or preparing to sell your property, I offer guidance tailored to your goals.</p>
<h2>Experience Counts</h2>
<p>Exceptional homes deserve exceptional representation.</p>
<p>My commitment is to provide knowledgeable guidance, personalized service, and a thoughtful approach to every real estate transaction.</p>
<p class="signoff"><strong>Dan McKenna</strong><br>Certified Luxury Home Marketing Specialist™ | GUILD™ Recognition<br>Dan McKenna Homes | Keller Williams Luxury<br>Keller Williams Ballantyne/Charlotte</p>`,
  });
}

export function testimonialsPage(ctx) {
  return `<div class="wrap page">
  <div class="page__main">
    <h1 class="page__title">Testimonials</h1>
    <div class="tgrid">${ctx.testimonials.map((t) => testimonialCard(ctx, t)).join('')}</div>
  </div>
  ${askBox(ctx)}
</div>`;
}

export function testimonialPage(ctx, t) {
  return pageWithSidebar(ctx, {
    heading: e(t.title),
    content: `<blockquote class="tquote">${t.text.map((p) => `<p>${e(p)}</p>`).join('')}
  <footer>${t.client ? `<strong>${e(t.client)}</strong>` : ''}${t.role ? ` <span>${e(t.role)}</span>` : ''} <time datetime="${e(t.date)}">${fmtDate(t.date)}</time></footer>
</blockquote>
<p><a href="${ctx.url('/testimonials/')}">← All testimonials</a></p>`,
  });
}

export function contactPage(ctx) {
  const { site, url } = ctx;
  return `<div class="wrap page">
  <div class="page__main">
    <h1 class="page__title">Contact</h1>
    <div class="contact-card">
      <img class="headshot headshot--sm" src="${url('/assets/img/dan-mckenna-headshot.jpg')}" width="360" height="402" alt="Dan McKenna">
      <div>
        <h2>${e(site.agent)}</h2>
        <p class="kicker">${e(site.tagline)}</p>
        <p>Realtor NC/SC<br>${e(site.brokerage)}</p>
        <dl class="contact-list">
          <div><dt>Mobile</dt><dd><a href="${e(site.phoneHref)}">${e(site.phone)}</a></dd></div>
          <div><dt>Email</dt><dd><a href="mailto:${e(site.email)}">${e(site.email)}</a></dd></div>
        </dl>
        <p class="contact-actions">
          <a class="btn btn--accent" href="${e(site.phoneHref)}">Call Dan</a>
          <a class="btn" href="${e(site.smsHref)}">Text Dan</a>
          <a class="btn" href="mailto:${e(site.email)}">Email Dan</a>
        </p>
      </div>
    </div>
    <p>${e(site.serviceAreaSentence)}</p>
  </div>
</div>`;
}

export function accessibilityPage(ctx) {
  const { site } = ctx;
  return pageWithSidebar(ctx, {
    heading: 'Accessibility',
    content: `<h2>Our Commitment</h2>
<p>We are committed to providing an accessible website. If you have difficulty accessing content, have trouble viewing a file on the site, or notice any accessibility problems, please contact us to specify the nature of the accessibility issue and the assistive technology you use. We will strive to provide the content you need in the format you require. We welcome your suggestions and comments about improving ongoing efforts to increase the accessibility of this website.</p>
<h2>For additional assistance</h2>
<p>Call <a href="${e(site.phoneHref)}">${e(site.phone)}</a> or email <a href="mailto:${e(site.email)}">${e(site.email)}</a> if you experience difficulty in accessing any part of this website, and we will work with you to provide the information you seek through an alternate communication method that is accessible for you.</p>
<p>The <a href="https://www.ssa.gov/accessibility/">US Social Security Administration</a> offers tips for adjusting your computer and browser, such as reading pages out loud, enlarging text, and changing colors.</p>`,
  });
}

export function dmcaPage(ctx) {
  const { site } = ctx;
  return pageWithSidebar(ctx, {
    heading: 'Copyright Concerns',
    content: `<p>We respect the intellectual property rights of others. If you believe material on this website infringes your copyright, please contact ${e(site.agent)} at <a href="mailto:${e(site.email)}">${e(site.email)}</a> or <a href="${e(site.phoneHref)}">${e(site.phone)}</a> with a description of the material and where it appears, and we will review it promptly.</p>`,
  });
}

export function notFoundPage(ctx) {
  return pageWithSidebar(ctx, {
    heading: 'Page not found',
    content: `<p>Sorry, we couldn't find that page. It may have moved when the website was updated.</p>
<ul><li><a href="${ctx.url('/')}">Home page</a></li><li><a href="${ctx.url('/listings/')}">Current listings</a></li><li><a href="${ctx.url('/contact/')}">Contact Dan</a></li></ul>`,
  });
}

export { STATUS_LABEL };
