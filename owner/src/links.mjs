// Start-page links (same file in client-site-template).
/**
 * The owner's other accounts, shown as links on the editor's start page (#/home): where the website is hosted, where
 * form messages go… Set in owner/wrangler.toml → MANAGE_LINKS, a JSON list of { name, url, note }. Links only – the
 * editor never signs in to these or stores a password. Anything that is not a plain https link is left out.
 */
export function manageLinks(env) {
  let list;
  try { list = JSON.parse(env.MANAGE_LINKS || '[]'); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const out = [];
  for (const l of list.slice(0, 12)) {
    const name = line(l?.name, 40), note = line(l?.note, 160);
    let url;
    try { url = new URL(line(l?.url, 300)); } catch { continue; }
    if (!name || url.protocol !== 'https:' || url.username || url.password) continue;
    out.push({ name, url: url.href, note });
  }
  return out;
}
