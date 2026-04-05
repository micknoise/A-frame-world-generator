#!/usr/bin/env node
/**
 * Fail if required local vendor trees are missing (offline / air-gapped use).
 * Run from repo root: node scripts/verify-offline.mjs
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AFRAME_13_CDN_PATHS } from './aframe-1.3-cdn-paths.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'glb-room/index.html',
  'glb-room/room_maru.glb',
  'glb-room/spawn-in-circle.js',
  'glb-room/random-color.js',
  'libs/aframe/aframe-v1.3.0.min.js',
  'libs/aframe-inspector/aframe-inspector.min.js',
  'libs/a-game/a-game.min.js',
  'libs/a-game/cannonWorker.min.js',
  'js/aframe-cdn-rewrite.js',
  'js/world/generator.js',
  'js/world/bsp-dungeon.js',
  'js/world/ridge-field.js',
  'js/world/combine-bsp-ridge.js',
  'js/world/grid-build.js',
  ...AFRAME_13_CDN_PATHS.map((p) => join('libs/aframe-cdn', p))
];

let bad = 0;
for (const rel of required) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    console.error('missing:', rel);
    bad++;
  }
}
if (bad) {
  console.error(
    `\n${bad} path(s) missing. Restore from git or, if you are refreshing vendors, run: node scripts/vendor-libs.mjs`
  );
  process.exit(1);
}
console.log('offline vendor check: ok (' + required.length + ' paths)');
