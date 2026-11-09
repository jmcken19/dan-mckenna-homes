import sharp from 'sharp';
import { startEditor, realMirror, testJpeg } from './harness.mjs';
const phase = process.argv[2];
const mirror = realMirror('/home/claude/mirror');
const E = await startEditor({ mirror, siteUrl: 'https://jmcken19.github.io/dan-mckenna-homes' });
const wait = async (sha) => { for (let i = 0; i < 40; i++) { const s = (await E.call('GET', `/api/publish-status/${sha}`)).data.state; if (s !== 'publishing') return s; await new Promise((r) => setTimeout(r, 6000)); } return 'timeout'; };
let H = (await E.call('GET', '/api/homepage')).data;
if (phase === 'test') {
  for (const c of ['#2a6', '#a62']) {
    const base = await testJpeg({ width: 3000, height: 2000, color: c, label: 'TEST SLIDE', gps: true });
    const fd = new FormData();
    for (const w of [2000, 1400, 800]) fd.append(`w${w}`, new Blob([await sharp(base).resize(w).jpeg({ quality: 80 }).toBuffer()]), 'x.jpg');
    fd.append('baseRevision', String(H.revision));
    H = (await E.call('POST', '/api/homepage/photos', { form: fd })).data;
  }
  H = (await E.call('PUT', '/api/homepage/settings', { body: { seconds: 4, fade: true, baseRevision: H.revision } })).data;
} else {
  // restore: only the original photo, Normal speed, fade off
  const keep = H.draft.slides.find((s) => s.id === 's-hero1');
  H = (await E.call('PUT', '/api/homepage/photos', { body: { order: [keep.id, ...H.draft.slides.filter((s) => s.id !== keep.id).map((s) => s.id)], baseRevision: H.revision } })).data;
  for (const s of H.draft.slides.slice(1)) H = (await E.call('DELETE', `/api/homepage/photos/${s.id}?baseRevision=${H.revision}`)).data;
  H = (await E.call('PUT', '/api/homepage/settings', { body: { seconds: 7, fade: false, baseRevision: H.revision } })).data;
}
const p = await E.call('POST', '/api/homepage/publish', { body: { baseRevision: H.revision } });
console.log(phase, 'publish', p.status, p.data.commit?.slice(0, 7), 'slides', H.draft.slides.length);
console.log('state:', await wait(p.data.commit));
await E.close();
