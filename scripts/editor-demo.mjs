#!/usr/bin/env node
// Try the owner editor on your own computer – no Cloudflare, no GitHub, nothing goes live.
//   npm run editor:demo   → open http://localhost:8790 in Chrome or Edge (laptop size)
// It runs the real editor code with a pretend GitHub and a pretend sign-in. Publishing "works" but only
// inside this demo. Your changes are kept in .demo-data/ until you delete that folder.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEditor, accessToken, OWNER } from '../tests/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8790);
const PUBLIC = `http://localhost:${PORT}`;
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

const E = await startEditor({ port: PORT + 9, siteUrl: PUBLIC, persist: join(root, '.demo-data') });
const editor = `http://127.0.0.1:${PORT + 9}`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC);
  // The website's own files (styles, scripts, photos) – what the page in the editor loads.
  if (url.pathname.startsWith('/assets/')) {
    try {
      const body = await readFile(join(root, 'public', decodeURIComponent(url.pathname).replace(/\.\.+/g, '')));
      res.writeHead(200, { 'Content-Type': MIME[extname(url.pathname)] || 'application/octet-stream' }); return res.end(body);
    } catch { res.writeHead(404); return res.end('not found'); }
  }
  // Everything else goes to the editor, signed in as the owner.
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = { ...req.headers, host: new URL(editor).host, 'cf-access-jwt-assertion': accessToken(OWNER) };
  if (headers.origin) headers.origin = editor;
  const r = await fetch(editor + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual' });
  const h = Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`\n  Editor demo running. Open:  ${PUBLIC}\n  (signed in as ${OWNER}; nothing here touches a real website)\n  Stop it with Ctrl + C. Start over by deleting the .demo-data folder.\n`);
});
process.on('SIGINT', async () => { await E.close(); process.exit(0); });
