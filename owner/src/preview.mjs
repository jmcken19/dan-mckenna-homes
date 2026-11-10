// Shared bits for the editor's page previews (homepage.mjs and reviews.mjs). Same file as in client-site-template.
//
// The preview is the client's real page, shown inside the editor (a frame on the editor's own address).
// Its Content-Security-Policy allows what typical small-business sites use: the site's own files,
// Google Fonts, https images (CDN logos), and YouTube / Vimeo / Google Maps embeds.
// Add a host here if a client's site needs another one (and check it in the editor's console).
export const PREVIEW_FRAME_HOSTS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.google.com', 'https://maps.google.com'];

export function previewHeaders(base) {
  const origin = base ? new URL(base).origin : "'self'";
  return {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': [
      "default-src 'none'",
      `img-src 'self' ${origin} https: data:`,
      `style-src ${origin} 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src ${origin} https://fonts.gstatic.com data:`,
      `script-src ${origin}`,
      `frame-src ${PREVIEW_FRAME_HOSTS.join(' ')}`,
      `manifest-src ${origin}`,
      "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'",
    ].join('; '),
  };
}

/** Marks a page as a real editor preview, so the editor can tell it apart from an error page or a sign-in page. */
export function markPreview(html) {
  return html.replace(/<head>/i, '<head>\n<meta name="editor-preview" content="1">');
}

/** A reviews draft that can't be read must not break every page preview: fall back to the published reviews. */
export function parseReviewsDraft(text, fallback) {
  try { return JSON.parse(text).items || fallback; } catch (err) { console.error('reviews draft unreadable', err?.message); return fallback; }
}
