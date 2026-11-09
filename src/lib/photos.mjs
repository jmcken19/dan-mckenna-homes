// The photos Dan can change from the editor (besides the homepage slideshow).
// Each spot is stored in content/site.json under "photos". Missing → the original photo.
// Uploaded photos live in public/assets/img/hero/<id>-<800|1400|2000>.jpg (same as slideshow).

export const PHOTO_SPOTS = {
  headshot: {
    label: 'Your photo',
    where: 'About us page, Contact page, and the top of design option 2',
    page: '/about-us/',
    minEdge: 500,
    tip: 'A portrait (taller than wide) photo of you looks best.',
    newAlt: 'Dan McKenna',
    defaults: { small: '/assets/img/dan-mckenna-headshot.jpg', large: '/assets/img/dan-mckenna-headshot.jpg', alt: 'Dan McKenna' },
  },
  construction: {
    label: 'New Construction page photo',
    where: 'New Construction page',
    page: '/new-construction/',
    minEdge: 800,
    tip: 'A wide (landscape) photo looks best.',
    newAlt: 'New construction home in the Charlotte area',
    defaults: { small: '/assets/img/construction.jpg', large: '/assets/img/construction.jpg', alt: 'New home under construction with wood framing' },
  },
  luxury: {
    label: 'Luxury home photo',
    where: 'Luxury Home Marketing page, and the homepage of design option 2',
    page: '/luxury-home-marketing/',
    minEdge: 1200,
    tip: 'A wide (landscape) photo of a beautiful home looks best.',
    newAlt: 'Luxury home in the Charlotte area',
    defaults: { small: '/assets/img/2515-forest-lawn-dr-800.jpg', large: '/assets/img/2515-forest-lawn-dr-1400.jpg', alt: '2515 Forest Lawn Drive, Weddington NC' },
  },
};

const PATH_RE = /^\/assets\/img\/[a-z0-9/_.-]+\.(jpg|jpeg|png|webp)$/i;
const ID_RE = /^s-[a-z0-9]{3,32}$/;

/** The photo to show in a spot: { id?, small, large, alt }. */
export function sitePhoto(site, key) {
  const d = PHOTO_SPOTS[key].defaults;
  const p = site?.photos?.[key];
  return p && p.small && p.large ? { ...d, ...p } : { ...d };
}

export function validatePhotos(site) {
  const problems = [];
  const photos = site?.photos;
  if (photos == null) return problems;
  if (typeof photos !== 'object' || Array.isArray(photos)) return ['"photos" must be an object'];
  for (const [k, p] of Object.entries(photos)) {
    if (!PHOTO_SPOTS[k]) { problems.push(`photos.${k}: unknown photo spot`); continue; }
    if (!p || typeof p !== 'object') { problems.push(`photos.${k}: must be an object`); continue; }
    for (const f of ['small', 'large']) if (!PATH_RE.test(String(p[f] || ''))) problems.push(`photos.${k}.${f}: must be a path under /assets/img/`);
    if (p.id != null && !ID_RE.test(p.id)) problems.push(`photos.${k}.id: invalid`);
    if (p.alt != null && (typeof p.alt !== 'string' || p.alt.length > 200)) problems.push(`photos.${k}.alt: must be text up to 200 characters`);
  }
  return problems;
}
