// Shared listing rules. Used by the static build (scripts/build.mjs),
// the owner editor service (owner/src) and the tests. Keep it dependency-free
// so it runs in Node and in Cloudflare Workers.

export const STATUSES = ['active', 'pending', 'sold'];
export const STATUS_LABEL = { active: 'For Sale', pending: 'Pending', sold: 'Sold' };
export const VISIBILITIES = ['draft', 'published', 'archived'];

export const LIMITS = {
  street: 120, city: 60, state: 2, zip: 10,
  description: 6000, alt: 200, mls: 30,
  maxPhotos: 40,
  price: 100_000_000, beds: 50, baths: 50, sqft: 100_000,
};

const ID_RE = /^lst-[a-z0-9]{6,32}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHOTO_ID_RE = /^p-[a-z0-9]{6,32}$/;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function listingSlug(address) {
  return slugify([address.street, address.city, address.state].filter(Boolean).join(' '));
}

export function oneLineAddress(address) {
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address.street, cityLine].filter(Boolean).join(', ');
}

export function formatPrice(price) {
  if (price === null || price === undefined || price === '') return '';
  return '$' + Number(price).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatNumber(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Facts line: only values that are known. Unknown is never shown as 0. */
export function factsList(l) {
  const out = [];
  if (isNum(l.beds)) out.push(`${formatNumber(l.beds)} ${l.beds === 1 ? 'bed' : 'beds'}`);
  if (isNum(l.baths)) out.push(`${formatNumber(l.baths)} ${l.baths === 1 ? 'bath' : 'baths'}`);
  if (isNum(l.sqft)) out.push(`${formatNumber(l.sqft)} sq ft`);
  return out;
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Parse a number typed by a person. Blank means "unknown" (null), never zero.
 * Returns { value } or { error }.
 */
export function parseOptionalNumber(input, { label, max, allowHalf = false, integer = false }) {
  if (input === null || input === undefined) return { value: null };
  const raw = String(input).trim().replace(/[$,\s]/g, '');
  if (raw === '') return { value: null };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: `${label}: please type a number, like ${integer ? '2400' : '2.5'}. Leave it blank if you don't know it.` };
  const n = Number(raw);
  if (integer && !Number.isInteger(n)) return { error: `${label}: please use a whole number.` };
  if (allowHalf && Math.round(n * 2) !== n * 2) return { error: `${label}: use whole or half numbers, like 2 or 2.5.` };
  if (n <= 0) return { error: `${label}: must be more than zero. Leave it blank if you don't know it.` };
  if (n > max) return { error: `${label}: that number looks too large. Please check it.` };
  return { value: n };
}

function cleanText(v, max) {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

/**
 * Validate and normalise the fields Dan types. Returns { listing, errors }.
 * `errors` is a list of plain-English messages keyed by field.
 */
export function normaliseFields(input) {
  const errors = {};
  const street = cleanText(input?.address?.street, LIMITS.street);
  const city = cleanText(input?.address?.city, LIMITS.city);
  const state = cleanText(input?.address?.state, LIMITS.state).toUpperCase();
  const zip = cleanText(input?.address?.zip, LIMITS.zip);
  if (!street) errors.street = 'Street address is required (for example: 123 Main Street).';
  if (!city) errors.city = 'City is required.';
  if (!/^(NC|SC)$/.test(state)) errors.state = 'Choose NC or SC.';
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = 'ZIP code should look like 28173. Leave it blank if you are not sure.';

  const status = STATUSES.includes(input?.status) ? input.status : null;
  if (!status) errors.status = 'Choose For Sale, Pending, or Sold.';

  const nums = {
    price: parseOptionalNumber(input?.price, { label: 'Price', max: LIMITS.price, integer: true }),
    beds: parseOptionalNumber(input?.beds, { label: 'Bedrooms', max: LIMITS.beds, integer: true }),
    baths: parseOptionalNumber(input?.baths, { label: 'Bathrooms', max: LIMITS.baths, allowHalf: true }),
    sqft: parseOptionalNumber(input?.sqft, { label: 'Square feet', max: LIMITS.sqft, integer: true }),
  };
  for (const [k, r] of Object.entries(nums)) if (r.error) errors[k] = r.error;

  const description = cleanText(input?.description, LIMITS.description);
  const mls = cleanText(input?.mls, LIMITS.mls);
  if (mls && !/^[A-Za-z0-9-]+$/.test(mls)) errors.mls = 'MLS number should only have letters and numbers.';

  const listing = {
    address: { street, city, state, zip },
    status,
    price: nums.price.value ?? null,
    beds: nums.beds.value ?? null,
    baths: nums.baths.value ?? null,
    sqft: nums.sqft.value ?? null,
    description,
    mls,
  };
  return { listing, errors };
}

/** Strict validation of a public listing file (content/listings/*.json). */
export function validatePublicListing(l) {
  const problems = [];
  if (!l || typeof l !== 'object') return ['not an object'];
  if (!ID_RE.test(l.id || '')) problems.push('id must look like lst-xxxxxx');
  if (!SLUG_RE.test(l.slug || '')) problems.push('slug must be lowercase words joined by dashes');
  if (!Number.isInteger(l.revision) || l.revision < 1) problems.push('revision must be a whole number >= 1');
  if (!STATUSES.includes(l.status)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
  const { errors } = normaliseFields(l);
  for (const [k, v] of Object.entries(errors)) problems.push(`${k}: ${v}`);
  for (const k of ['price', 'beds', 'baths', 'sqft']) {
    if (!(l[k] === null || (typeof l[k] === 'number' && l[k] > 0))) problems.push(`${k} must be a positive number or null (null = unknown)`);
  }
  if (!Array.isArray(l.photos) || l.photos.length === 0) problems.push('at least one photo is required to publish');
  else {
    if (l.photos.length > LIMITS.maxPhotos) problems.push('too many photos');
    l.photos.forEach((p, i) => {
      if (!PHOTO_ID_RE.test(p.id || '')) problems.push(`photo ${i + 1}: bad id`);
      for (const k of ['large', 'small']) {
        if (typeof p[k] !== 'string' || !p[k].startsWith(`/listings/${l.id}/`) || !/\.(jpg|webp)$/.test(p[k])) problems.push(`photo ${i + 1}: ${k} path must be /listings/${l.id}/...jpg`);
      }
      if (!(Number.isInteger(p.width) && Number.isInteger(p.height))) problems.push(`photo ${i + 1}: width/height required`);
    });
  }
  if (typeof l.updatedAt !== 'string' || Number.isNaN(Date.parse(l.updatedAt))) problems.push('updatedAt must be an ISO date');
  return problems;
}

export function randomId(prefix, bytes = 8) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => (b % 36).toString(36)).join('');
}
