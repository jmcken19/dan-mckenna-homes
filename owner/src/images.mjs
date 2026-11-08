// Server-side checks for uploaded photos. The browser already resizes photos and
// re-draws them on a canvas (which drops camera metadata and applies rotation), but
// the server never trusts that: it checks the real file bytes, rejects anything that
// isn't a JPEG, and strips every metadata segment (EXIF/GPS, XMP, comments) again.

export const MAX_BYTES = { large: 4 * 1024 * 1024, small: 1.5 * 1024 * 1024, original: 24 * 1024 * 1024 };
export const MAX_EDGE = { large: 2400, small: 1200 };

export function sniffType(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'avif') return 'image/avif';
  }
  return null;
}

function ascii(b, s, e) { return String.fromCharCode(...b.subarray(s, e)); }

/**
 * Parse a baseline/progressive JPEG, drop APPn (except JFIF APP0) and COM segments.
 * Returns { bytes, width, height } or throws Error with a plain message.
 */
export function cleanJpeg(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (sniffType(b) !== 'image/jpeg') throw new Error('not-jpeg');
  const parts = [b.subarray(0, 2)];
  let i = 2, width = 0, height = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('corrupt');
    let marker = b[i + 1];
    while (marker === 0xff) { i++; marker = b[i + 1]; }
    if (marker === 0xd9) { parts.push(b.subarray(i, i + 2)); i += 2; break; }
    if (marker >= 0xd0 && marker <= 0xd7) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) throw new Error('corrupt');
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error('corrupt');
    const seg = b.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isJfif = marker === 0xe0 && ascii(b, i + 4, i + 9) === 'JFIF\0';
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = (b[i + 5] << 8) | b[i + 6];
      width = (b[i + 7] << 8) | b[i + 8];
    }
    if (marker === 0xda) {
      // Start of scan: copy the rest of the file verbatim (entropy-coded data + EOI).
      parts.push(b.subarray(i));
      i = b.length;
      break;
    }
    if (!(isApp && !isJfif) && marker !== 0xfe) parts.push(seg);
    i += 2 + len;
  }
  if (!width || !height) throw new Error('corrupt');
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, width, height };
}

/** True if a JPEG still contains an EXIF/XMP block (used by tests and the final check). */
export function hasMetadata(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda) return false;
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) return true;
    i += 2 + len;
  }
  return false;
}

export function validateVariant(kind, bytes) {
  if (!bytes || !bytes.length) return { error: 'The photo was empty. Please choose it again.' };
  if (bytes.length > MAX_BYTES[kind]) return { error: 'That photo is too large to upload. Please try again; if it keeps happening, send it to James with "Request a website change".' };
  if (sniffType(bytes) !== 'image/jpeg') return { error: 'That file is not a photo we can use. Please choose a JPG or iPhone photo.' };
  let cleaned;
  try { cleaned = cleanJpeg(bytes); } catch { return { error: 'That photo looks damaged. Please choose it again.' }; }
  if (Math.max(cleaned.width, cleaned.height) > MAX_EDGE[kind]) return { error: 'That photo is larger than expected. Please refresh the page and try again.' };
  if (Math.min(cleaned.width, cleaned.height) < 200) return { error: 'That photo is very small. Please use a bigger photo.' };
  return cleaned;
}

export function validateOriginal(bytes) {
  if (!bytes || !bytes.length) return { error: 'empty' };
  if (bytes.length > MAX_BYTES.original) return { error: 'too-large' };
  const type = sniffType(bytes);
  if (!type) return { error: 'type' };
  return { type };
}
