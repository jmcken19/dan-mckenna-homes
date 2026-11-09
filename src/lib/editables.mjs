// EDITABLE MARKS – the foundation of the "edit on the page" editor.
//
// Every part of a client's site that the owner may change marks itself with data-edit="<kind>"
// (only inside the editor's preview – never on the real website). The editor finds these marks in
// the page and puts the right tool on each one. So a client's editor automatically matches what is
// on THEIR site: if their site uses a slideshow and two photo spots, those three get ✎ buttons.
//
// To make something new editable (e.g. a video): 1) add a kind below, 2) call editMark() in the part
// that draws it, 3) add the matching panel in owner/ui/app.js (KIND_TOOLS) and its save/publish route
// in owner/src/ (homepage.mjs for photos, reviews.mjs for reviews). Ported from client-site-template.
import { escapeHtml as e } from './listing.mjs';

/** Kinds of things the owner can change. `button` is the ✎ label shown on the page. */
export const EDIT_KINDS = {
  slideshow: { button: 'Change these photos', what: 'The big photos at the top' },
  photo: { button: 'Change photo', what: 'A photo' },
  reviews: { button: 'Change reviews', what: 'Client reviews' },
  review: { button: 'Edit', what: 'One review' },
  // Planned (not built yet): text, video, videos, hours, team …
};

/** Attributes to add to an editable element. Empty string on the real website. */
export function editMark(ctx, kind, key = '', label = '') {
  if (!ctx.editMode || !EDIT_KINDS[kind]) return '';
  return ` data-edit="${e(kind)}"${key ? ` data-edit-key="${e(key)}"` : ''}${label ? ` data-edit-label="${e(label)}"` : ''}`;
}
