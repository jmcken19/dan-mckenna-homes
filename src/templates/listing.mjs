import { escapeHtml as e, formatPrice, factsList, oneLineAddress, STATUS_LABEL } from '../lib/listing.mjs';
import { askBox } from './layout.mjs';

export function statusBadge(status) {
  if (status === 'active') return '';
  return `<span class="status status--${e(status)}">${e(STATUS_LABEL[status] || status)}</span>`;
}

export function listingCard(ctx, l) {
  const cover = l.photos[0];
  const facts = factsList(l);
  return `<li class="lcard">
  <a href="${ctx.url(`/listings/${l.slug}/`)}">
    <div class="lcard__img">
      <img src="${ctx.url(cover.small)}" width="${cover.width}" height="${cover.height}" alt="${e(cover.alt || 'Front of ' + l.address.street)}" loading="lazy" decoding="async">
      ${statusBadge(l.status)}
    </div>
    <div class="lcard__body">
      ${l.price ? `<p class="lcard__price">${e(formatPrice(l.price))}</p>` : ''}
      <p class="lcard__addr">${e(l.address.street)}<br><span>${e(l.address.city)}, ${e(l.address.state)}</span></p>
      ${facts.length ? `<p class="lcard__facts">${facts.map(e).join(' <span aria-hidden="true">·</span> ')}</p>` : ''}
    </div>
  </a>
</li>`;
}

export function listingDetail(ctx, l, { previewDraft = false } = {}) {
  const facts = factsList(l);
  const addr = oneLineAddress(l.address);
  const photos = l.photos.map((p, i) => `<li class="gallery__slide" id="photo-${i + 1}" aria-roledescription="slide" aria-label="Photo ${i + 1} of ${l.photos.length}">
      <img src="${ctx.url(p.large)}" srcset="${ctx.url(p.small)} 900w, ${ctx.url(p.large)} 1800w" sizes="(min-width: 1100px) 760px, 100vw" width="${p.width}" height="${p.height}" alt="${e(p.alt || `Photo ${i + 1} of ${l.address.street}`)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
    </li>`).join('');
  const thumbs = l.photos.length > 1 ? `<ol class="gallery__thumbs" aria-label="All photos">${l.photos.map((p, i) => `<li><a href="#photo-${i + 1}" data-go="${i}"><img src="${ctx.url(p.small)}" width="${p.width}" height="${p.height}" alt="" loading="lazy" decoding="async"><span class="sr">Show photo ${i + 1}</span></a></li>`).join('')}</ol>` : '';

  const description = (l.description || '').split(/\n{2,}/).map((para) => `<p>${e(para).replace(/\n/g, '<br>')}</p>`).join('');

  return `<div class="wrap listing">
  ${previewDraft ? '<p class="draft-note" role="note"><strong>Preview only.</strong> This is how the listing will look. Buyers cannot see it until you publish.</p>' : ''}
  <p class="crumbs"><a href="${ctx.url('/listings/')}">← All listings</a></p>
  <div class="listing__grid">
    <div class="listing__media">
      <section class="gallery" aria-roledescription="carousel" aria-label="Photos of ${e(l.address.street)}">
        <ol class="gallery__track">${photos}</ol>
        ${l.photos.length > 1 ? `<div class="gallery__nav">
          <button type="button" class="gallery__btn" data-dir="-1" aria-label="Previous photo">‹</button>
          <span class="gallery__count" aria-live="polite"><span data-current>1</span> / ${l.photos.length}</span>
          <button type="button" class="gallery__btn" data-dir="1" aria-label="Next photo">›</button>
        </div>` : ''}
        ${thumbs}
      </section>
    </div>
    <div class="listing__info">
      <div class="listing__head">
        ${l.status !== 'active' ? statusBadge(l.status) : ''}
        ${l.price ? `<p class="listing__price">${e(formatPrice(l.price))}${l.status === 'sold' ? ' <span class="listing__pricenote">(list price)</span>' : ''}</p>` : ''}
        <h1 class="listing__addr">${e(l.address.street)}<span>${e(l.address.city)}, ${e(l.address.state)} ${e(l.address.zip || '')}</span></h1>
        ${facts.length ? `<ul class="listing__facts">${facts.map((f) => `<li>${e(f)}</li>`).join('')}</ul>` : ''}
        ${l.mls ? `<p class="listing__mls">MLS # ${e(l.mls)}</p>` : ''}
      </div>
      ${askBox(ctx, { heading: l.status === 'sold' ? 'Thinking of buying or selling nearby?' : 'Interested in this home?', about: addr })}
    </div>
  </div>
  ${description ? `<section class="listing__desc prose"><h2>About this home</h2>${description}</section>` : ''}
  <p class="listing__broker">Listing presented by ${e(ctx.site.agent)}, ${e(ctx.site.brokerage)}.</p>
</div>`;
}
