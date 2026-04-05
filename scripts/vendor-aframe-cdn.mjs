#!/usr/bin/env node
/**
 * @deprecated Use `node scripts/vendor-libs.mjs` (A-Frame 1.3 + a-game complete mirror).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const r = spawnSync(process.execPath, [join(root, 'scripts', 'vendor-libs.mjs')], {
  stdio: 'inherit'
});
process.exit(r.status ?? 1);
