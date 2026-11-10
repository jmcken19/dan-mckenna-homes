// Shared set-up for the browser tests of the "edit on the page" editor (ui-visual.mjs, ui-visual-edge.mjs):
// the local Miniflare editor + fake GitHub, Chrome at laptop size, and the public site's CSS/JS/images served
// from public/ (like site/worker.mjs, including CORS for fonts), so the page in the frame looks real.
// Same file as in client-site-template.
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEditor, accessToken, OWNER, SITE } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const LAPTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * Starts the editor and a laptop-size Chrome page signed in as the owner.
 * siteUrl: the public site's address (may have a sub-path, like a GitHub Pages testing link).
 * intercept(req, url): return true when the test answered the request itself (to fake errors or slow answers).
 */
export async function openEditor({ out, port = 0, siteUrl = SITE, width = 1366, height = 768, intercept = null } = {}) {
  mkdirSync(out, { recursive: true });
  const E = await startEditor({ port: port || 8800 + Math.floor(Math.random() * 150), siteUrl });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width, height, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, userAgent: LAPTOP_UA });
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': accessToken(OWNER) });
  await page.setRequestInterception(true);
  const site = new URL(siteUrl);
  const basePath = site.pathname.replace(/\/$/, '');
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (intercept && await intercept(req, u)) return;
    if (u.origin !== site.origin) return req.continue();
    const rel = decodeURIComponent(u.pathname).replace(/\.\.+/g, '');
    const f = join(root, 'public', basePath && rel.startsWith(basePath) ? rel.slice(basePath.length) : rel);
    if (!existsSync(f)) return req.respond({ status: 404, body: 'not found' });
    return req.respond({ status: 200, contentType: MIME[extname(f)] || 'application/octet-stream', headers: /\.woff2?$/.test(f) ? { 'Access-Control-Allow-Origin': '*' } : {}, body: readFileSync(f) });
  });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const frame = async () => { const h = await page.$('#frame'); return h.contentFrame(); };
  const waitFrame = async (pred, ...args) => {
    for (let i = 0; i < 300; i++) { try { const f = await frame(); if (f && await f.evaluate(pred, ...args)) return f; } catch { /* reloading */ } await sleep(100); }
    throw new Error('frame condition not met: ' + pred);
  };
  const close = async () => { await browser.close(); await E.close(); };
  return { E, browser, page, frame, waitFrame, shot, errors, close };
}
