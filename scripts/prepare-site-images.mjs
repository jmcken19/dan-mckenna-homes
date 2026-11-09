#!/usr/bin/env node
// One-off: turns the original images in assets-src/ into optimized, metadata-free
// copies in public/assets/img/. Re-run after replacing a file in assets-src/.
// To add a homepage slideshow photo: put it in assets-src/hero-N.jpg, add it to the
// HERO list below, run `npm run images`, then add it to content/site.json heroSlides.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const src = 'assets-src';
const dst = 'public/assets/img';
await mkdir(dst, { recursive: true });

const HERO = ['hero-1.jpg', 'hero-2.jpg', 'hero-3.jpg', 'hero-4.jpg', 'hero-5.jpg'].filter((f) => existsSync(`${src}/${f}`));
for (const f of HERO) {
  const name = f.replace(/\.\w+$/, '');
  for (const w of [800, 1400, 2000]) {
    const img = sharp(`${src}/${f}`).rotate().resize({ width: w, withoutEnlargement: true });
    await img.jpeg({ quality: 66, mozjpeg: true, progressive: true }).toFile(`${dst}/${name}-${w}.jpg`);
  }
}
for (const w of [800, 1400]) {
  await sharp(`${src}/forest-lawn.jpg`).rotate().resize({ width: w, height: Math.round(w * 0.75), fit: 'cover' }).jpeg({ quality: 80, mozjpeg: true }).toFile(`${dst}/2515-forest-lawn-dr-${w}.jpg`);
}
await sharp(`${src}/construction.jpg`).rotate().jpeg({ quality: 82, mozjpeg: true }).toFile(`${dst}/construction.jpg`);
await sharp(`${src}/headshot.png`).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(`${dst}/dan-mckenna-headshot.jpg`);
await sharp(`${src}/logo.png`).png({ compressionLevel: 9 }).toFile(`${dst}/logo-kw-charlotte-ballantyne.png`);
await sharp(`${src}/kw-logo.png`).resize({ width: 428 }).png({ compressionLevel: 9 }).toFile(`${dst}/logo-kw-white.png`);
// Favicons (favicon.ico, favicon-32/favicon/apple-touch-icon/icon-192/icon-512.png) are made from
// assets-src/kw-mark-red.png – see docs/MAINTAINER.md. They are not regenerated here.
console.log('Images written to', dst, '(hero slides:', HERO.length + ')');
