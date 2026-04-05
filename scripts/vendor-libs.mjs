#!/usr/bin/env node
/**
 * Maintainer tool: download A-Frame 1.3 CDN assets into libs/aframe-cdn/.
 * Normal users / clones should already have these files in git — do not rely on running this.
 *
 * Microsoft GLBs: from @webxr-input-profiles/assets (see ALT_SRC).
 *
 * Run from repo root: node scripts/vendor-libs.mjs
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import { AFRAME_13_CDN_PATHS } from './aframe-1.3-cdn-paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'libs', 'aframe-cdn');
const CDN = 'https://cdn.aframe.io/';

/** cdn.aframe.io has no Microsoft meshes; use WebXR Input Profiles (MIT). */
const ALT_SRC = {
  'controllers/microsoft/left.glb':
    'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.0/dist/profiles/microsoft-mixed-reality/left.glb',
  'controllers/microsoft/right.glb':
    'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.0/dist/profiles/microsoft-mixed-reality/right.glb',
  'controllers/microsoft/universal.glb':
    'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.0/dist/profiles/microsoft-mixed-reality/left.glb'
};

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error('Redirect without location'));
        return resolve(
          fetchToFile(loc.startsWith('http') ? loc : new URL(loc, url).href, dest)
        );
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${res.statusCode} ${url}`));
      }
      mkdir(dirname(dest), { recursive: true }).then(() => {
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }, reject);
    }).on('error', reject);
  });
}

let ok = 0;
const errors = [];

for (const p of AFRAME_13_CDN_PATHS) {
  const url = ALT_SRC[p] || CDN + p;
  const dest = join(OUT, p);
  try {
    await fetchToFile(url, dest);
    ok++;
    console.log('ok', p);
  } catch (e) {
    errors.push({ p, message: e.message });
    console.error('FAIL', p, e.message);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} download(s) failed (of ${AFRAME_13_CDN_PATHS.length}).`);
  process.exit(1);
}
console.log(`\nDone: ${ok} files under libs/aframe-cdn/`);
