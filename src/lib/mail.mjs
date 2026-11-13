// EMAIL LINKS WITHOUT THE ADDRESS IN THE PAGE CODE (same file in client-site-template).
//
// Spam harvesters read pages for "mailto:" links and anything shaped like name@example.com. So on the website the
// owner's address is never written out: the link carries it scrambled (data-mail) and public/assets/js/site.js puts
// the real mailto: link and the readable address back when the page loads. Without JavaScript the link goes to the
// Contact page and the address still reads normally (the "@" is drawn by the stylesheet – see .eml-at in the CSS).
// In the editor's edit mode (private, signed-in) the plain address is used so the owner can click and change it.
//
//   <a ${mailAttrs(ctx)}>…</a>              instead of  <a href="mailto:${site.email}">
//   <a class="btn" ${mailAttrs(ctx, { subject })}>
//   ${mailText(ctx)}                        instead of  ${t(ctx, 'site.email')}
import { escapeHtml as e } from './listing.mjs';
import { t } from './text.mjs';

/** The address, scrambled (base64 of the URL-encoded address, reversed). site.js → unscramble() is the other half. */
export const scrambleMail = (addr) => btoa(encodeURIComponent(String(addr || ''))).split('').reverse().join('');

/** The href (+ data) attributes of an email link. contactPath = where the link goes when JavaScript is off. */
export function mailAttrs(ctx, { subject = '', contactPath = '/contact/' } = {}) {
  const addr = ctx.site.email;
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  if (ctx.editMode) return `href="mailto:${e(addr)}${query}"`;
  return `href="${e(ctx.url(contactPath))}" data-mail="${e(scrambleMail(addr))}"${subject ? ` data-mail-subject="${e(subject)}"` : ''}`;
}

/** The address as visible words. */
export function mailText(ctx) {
  if (ctx.editMode) return t(ctx, 'site.email');
  const [user, ...rest] = String(ctx.site.email || '').split('@');
  return `<span class="eml" data-mail-text="${e(scrambleMail(ctx.site.email))}">${e(user)}<span class="eml-at"></span>${e(rest.join('@'))}</span>`;
}
