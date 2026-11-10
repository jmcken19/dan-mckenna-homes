// EDITABLE MARKS – the foundation of the "edit on the page" editor.
//
// Every part of a client's site that the owner may change marks itself with data-edit="<kind>"
// (only inside the editor's preview – never on the real website). The editor finds these marks in
// the page and puts the right tool on each one. So a client's editor automatically matches what is
// on THEIR site: if their site uses a slideshow and two photo spots, those three get ✎ buttons.
//
// To make something new editable (e.g. a video): add a kind below, call editMark() in the part that draws it,
// then follow "Adding a new kind" in client-site-template's docs/EDITOR.md (server route + preview merge +
// DRAFT_SOURCES + KIND_TOOLS panel in owner/ui/app.js). Ported from client-site-template.
import { escapeHtml as e } from './listing.mjs';

/** Kinds of things the owner can change. The ✎ button's words live in owner/ui/app.js → KIND_TOOLS. */
export const EDIT_KINDS = {
  slideshow: { what: 'The big photos at the top' },
  photo: { what: 'A photo' },
  reviews: { what: 'Client reviews' },
  review: { what: 'One review' },
  // Planned (not built yet): text, video, videos, hours, team …
};

/** Attributes to add to an editable element. Empty string on the real website. */
export function editMark(ctx, kind, key = '', label = '') {
  if (!ctx.editMode || !EDIT_KINDS[kind]) return '';
  return ` data-edit="${e(kind)}"${key ? ` data-edit-key="${e(key)}"` : ''}${label ? ` data-edit-label="${e(label)}"` : ''}`;
}
