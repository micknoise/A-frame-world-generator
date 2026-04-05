/**
 * sdf-cavern.js — SDF-based cavern generation with marching cubes extraction.
 *
 * BSP room regions → ellipsoid SDFs, corridors → capsule SDFs.
 * Smooth-min union + domain warp → marching cubes isosurface.
 * Normals are flipped inward so the player sees the cave interior.
 *
 * PUBLIC API
 * ----------
 *   SDFCavern.build(rootEl, bsp, options) → { spawnWorld }
 */
(function () {
  'use strict';

  // ── Value noise ─────────────────────────────────────────────────────────────

  function ValueNoise(seed) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    var rng = _rng(seed);
    var i;
    for (i = 0; i < 256; i++) this.values[i] = rng();
    var p = new Uint8Array(256);
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  function _rng(seed) {
    var s = seed | 0;
    return function () { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function _lerp(a, b, t) { return a + (b - a) * t; }
  ValueNoise.prototype.noise2D = function (x, y) {
    var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = _fade(xf), v = _fade(yf);
    var aa = this.perm[this.perm[xi] + yi], ab = this.perm[this.perm[xi] + yi + 1];
    var ba = this.perm[this.perm[xi + 1] + yi], bb = this.perm[this.perm[xi + 1] + yi + 1];
    return _lerp(_lerp(this.values[aa], this.values[ba], u),
                 _lerp(this.values[ab], this.values[bb], u), v);
  };
  ValueNoise.prototype.noise3D = function (x, y, z) {
    var a = this.noise2D(x + z * 31.7, y + z * 17.3);
    var b = this.noise2D(x + (z + 1) * 31.7, y + (z + 1) * 17.3);
    return _lerp(a, b, _fade(z - Math.floor(z)));
  };
  ValueNoise.prototype.fbm3D = function (x, y, z, octaves) {
    var sum = 0, amp = 1, freq = 1, maxAmp = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.noise3D(x * freq, y * freq, z * freq) * amp;
      maxAmp += amp; amp *= 0.5; freq *= 2;
    }
    return sum / maxAmp;
  };
  ValueNoise.prototype.fbm = function (x, y, octaves) {
    var sum = 0, amp = 1, freq = 1, maxAmp = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      maxAmp += amp; amp *= 0.5; freq *= 2;
    }
    return sum / maxAmp;
  };

  // ── SDF primitives ──────────────────────────────────────────────────────────

  function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
    var dx = (px - cx) / rx, dy = (py - cy) / ry, dz = (pz - cz) / rz;
    return (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1.0) * Math.min(rx, ry, rz);
  }

  function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
    var abx = bx - ax, aby = by - ay, abz = bz - az;
    var apx = px - ax, apy = py - ay, apz = pz - az;
    var ab2 = abx * abx + aby * aby + abz * abz;
    var t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
    var cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
    return Math.sqrt(cx * cx + cy * cy + cz * cz) - r;
  }

  function smin(a, b, k) {
    var h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  }

  // ── Corridor pairs from BSP nodes ───────────────────────────────────────────

  function extractCorridorPairs(nodes) {
    var pairs = [];
    if (nodes.length < 2) return pairs;
    var c = [];
    for (var i = 0; i < nodes.length; i++) c.push({ x: nodes[i].x, y: nodes[i].y });
    for (i = 0; i + 1 < c.length; i += 2) pairs.push([c[i], c[i + 1]]);
    for (i = 0; i + 3 < c.length; i += 4) {
      pairs.push([
        { x: (c[i].x + c[i+1].x) / 2, y: (c[i].y + c[i+1].y) / 2 },
        { x: (c[i+2].x + c[i+3].x) / 2, y: (c[i+2].y + c[i+3].y) / 2 }
      ]);
    }
    for (i = 0; i + 7 < c.length; i += 8) {
      pairs.push([
        { x: (c[i].x+c[i+1].x+c[i+2].x+c[i+3].x)/4, y: (c[i].y+c[i+1].y+c[i+2].y+c[i+3].y)/4 },
        { x: (c[i+4].x+c[i+5].x+c[i+6].x+c[i+7].x)/4, y: (c[i+4].y+c[i+5].y+c[i+6].y+c[i+7].y)/4 }
      ]);
    }
    if (c.length > 1 && c.length % 2 === 1) pairs.push([c[c.length - 2], c[c.length - 1]]);
    return pairs;
  }

  // ── Marching cubes ──────────────────────────────────────────────────────────

  var MC_EDGE_TABLE, MC_TRI_TABLE;

  function initMarchingCubesTables() {
    if (MC_EDGE_TABLE) return;
    MC_EDGE_TABLE=[0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0];
    MC_TRI_TABLE=[[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[-1],[0,8,3],[0,1,9],[1,8,3,9,8,1],[3,11,2],[0,11,2,8,11,0],[1,9,0,2,3,11],[1,11,2,1,9,11,9,8,11],[3,10,1],[0,10,1,8,10,0],[3,9,0,3,10,9],[9,8,10],[4,7,8],[4,3,0,7,3,4],[0,1,9,8,4,7],[4,1,9,4,7,1,7,3,1],[1,2,10,8,4,7],[3,4,7,3,0,4,1,2,10],[9,2,10,9,0,2,8,4,7],[2,10,9,2,9,7,2,7,3,7,9,4],[8,4,7,3,11,2],[11,4,7,11,2,4,2,0,4],[9,0,1,8,4,7,2,3,11],[4,7,11,9,4,11,9,11,2,9,2,1],[3,10,1,3,11,10,7,8,4],[1,11,10,1,4,11,1,0,4,7,11,4],[4,7,8,9,0,11,9,11,10,11,0,3],[4,7,11,4,11,9,9,11,10],[9,5,4],[9,5,4,0,8,3],[0,5,4,1,5,0],[8,5,4,8,3,5,3,1,5],[1,2,10,9,5,4],[3,0,8,1,2,10,4,9,5],[5,2,10,5,4,2,4,0,2],[2,10,5,3,2,5,3,5,4,3,4,8],[9,5,4,2,3,11],[0,11,2,0,8,11,4,9,5],[0,5,4,0,1,5,2,3,11],[2,1,5,2,5,8,2,8,11,4,8,5],[10,3,11,10,1,3,9,5,4],[4,9,5,0,8,1,8,10,1,8,11,10],[5,4,0,5,0,11,5,11,10,11,0,3],[5,4,8,5,8,10,10,8,11],[9,7,8,5,7,9],[9,3,0,9,5,3,5,7,3],[0,7,8,0,1,7,1,5,7],[1,5,3,3,5,7],[9,7,8,9,5,7,10,1,2],[10,1,2,9,5,0,5,3,0,5,7,3],[8,0,2,8,2,5,8,5,7,10,5,2],[2,10,5,2,5,3,3,5,7],[7,9,5,7,8,9,3,11,2],[9,5,7,9,7,2,9,2,0,2,7,11],[2,3,11,0,1,8,1,7,8,1,5,7],[11,2,1,11,1,7,7,1,5],[9,5,8,8,5,7,10,1,3,10,3,11],[5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],[11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],[11,10,5,7,11,5],[10,6,5],[0,8,3,5,10,6],[9,0,1,5,10,6],[1,8,3,1,9,8,5,10,6],[1,6,5,2,6,1],[1,6,5,1,2,6,3,0,8],[9,6,5,9,0,6,0,2,6],[5,9,8,5,8,2,5,2,6,3,2,8],[2,3,11,10,6,5],[11,0,8,11,2,0,10,6,5],[0,1,9,2,3,11,5,10,6],[5,10,6,1,9,2,9,11,2,9,8,11],[6,3,11,6,5,3,5,1,3],[0,8,11,0,11,5,0,5,1,5,11,6],[3,11,6,0,3,6,0,6,5,0,5,9],[6,5,9,6,9,11,11,9,8],[5,10,6,4,7,8],[4,3,0,4,7,3,6,5,10],[1,9,0,5,10,6,8,4,7],[10,6,5,1,9,7,1,7,3,7,9,4],[6,1,2,6,5,1,4,7,8],[1,2,5,5,2,6,3,0,4,3,4,7],[8,4,7,9,0,5,0,6,5,0,2,6],[7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],[3,11,2,7,8,4,10,6,5],[5,10,6,4,7,2,4,2,0,2,7,11],[0,1,9,4,7,8,2,3,11,5,10,6],[9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],[8,4,7,3,11,5,3,5,1,5,11,6],[5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],[0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],[6,5,9,6,9,11,4,7,9,7,11,9],[10,4,9,6,4,10],[4,10,6,4,9,10,0,8,3],[10,0,1,10,6,0,6,4,0],[8,3,1,8,1,6,8,6,4,6,1,10],[1,4,9,1,2,4,2,6,4],[3,0,8,1,2,9,2,4,9,2,6,4],[0,2,4,4,2,6],[8,3,2,8,2,4,4,2,6],[10,4,9,10,6,4,11,2,3],[0,8,2,2,8,11,4,9,10,4,10,6],[3,11,2,0,1,6,0,6,4,6,1,10],[6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],[9,6,4,9,3,6,9,1,3,11,6,3],[8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],[3,11,6,3,6,0,0,6,4],[6,4,8,11,6,8],[7,10,6,7,8,10,8,9,10],[0,7,3,0,10,7,0,9,10,6,7,10],[10,6,7,1,10,7,1,7,8,1,8,0],[10,6,7,10,7,1,1,7,3],[1,2,6,1,6,8,1,8,9,8,6,7],[2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],[7,8,0,7,0,6,6,0,2],[7,3,2,6,7,2],[2,3,11,10,6,8,10,8,9,8,6,7],[2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],[1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],[11,2,1,11,1,7,10,6,1,6,7,1],[8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],[0,9,1,11,6,7],[7,8,0,7,0,6,3,11,0,11,6,0],[7,11,6],[7,6,11],[3,0,8,11,7,6],[0,1,9,11,7,6],[8,1,9,8,3,1,11,7,6],[10,1,2,6,11,7],[1,2,10,3,0,8,6,11,7],[2,9,0,2,10,9,6,11,7],[6,11,7,2,10,3,10,8,3,10,9,8],[7,2,3,6,2,7],[7,0,8,7,6,0,6,2,0],[2,7,6,2,3,7,0,1,9],[1,6,2,1,8,6,1,9,8,8,7,6],[10,7,6,10,1,7,1,3,7],[10,7,6,1,7,10,1,8,7,1,0,8],[0,3,7,0,7,10,0,10,9,6,10,7],[7,6,10,7,10,8,8,10,9],[6,8,4,11,8,6],[3,6,11,3,0,6,0,4,6],[8,6,11,8,4,6,9,0,1],[9,4,6,9,6,3,9,3,1,11,3,6],[6,8,4,6,11,8,2,10,1],[1,2,10,3,0,11,0,6,11,0,4,6],[4,11,8,4,6,11,0,2,9,2,10,9],[10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],[8,2,3,8,4,2,4,6,2],[0,4,2,4,6,2],[1,9,0,2,3,4,2,4,6,4,3,8],[1,9,4,1,4,2,2,4,6],[8,1,3,8,6,1,8,4,6,6,10,1],[10,1,0,10,0,6,6,0,4],[4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],[10,9,4,6,10,4],[4,9,5,7,6,11],[0,8,3,4,9,5,11,7,6],[5,0,1,5,4,0,7,6,11],[11,7,6,8,3,4,3,5,4,3,1,5],[9,5,4,10,1,2,7,6,11],[6,11,7,1,2,10,0,8,3,4,9,5],[7,6,11,5,4,10,4,2,10,4,0,2],[3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],[7,2,3,7,6,2,5,4,9],[9,5,4,0,8,6,0,6,2,6,8,7],[3,6,2,3,7,6,1,5,0,5,4,0],[6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],[9,5,4,10,1,6,1,7,6,1,3,7],[1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],[4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],[7,6,10,7,10,8,5,4,10,4,8,10],[6,9,5,6,11,9,11,8,9],[3,6,11,0,6,3,0,5,6,0,9,5],[0,11,8,0,5,11,0,1,5,5,6,11],[6,11,3,6,3,5,5,3,1],[1,2,10,9,5,11,9,11,8,11,5,6],[0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],[11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],[6,11,3,6,3,5,2,10,3,10,5,3],[5,8,9,5,2,8,5,6,2,3,8,2],[9,5,6,9,6,0,0,6,2],[1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],[1,5,6,2,1,6],[1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],[10,1,0,10,0,6,9,5,0,5,6,0],[0,3,8,5,6,10],[10,5,6],[11,5,10,7,5,11],[11,5,10,11,7,5,8,3,0],[5,11,7,5,10,11,1,9,0],[10,7,5,10,11,7,9,8,1,8,3,1],[11,1,2,11,7,1,7,5,1],[0,8,3,1,2,7,1,7,5,7,2,11],[9,7,5,9,2,7,9,0,2,2,11,7],[7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],[2,5,10,2,3,5,3,7,5],[8,2,0,8,5,2,8,7,5,10,2,5],[9,0,1,5,10,3,5,3,7,3,10,2],[9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],[1,3,5,3,7,5],[0,8,7,0,7,1,1,7,5],[9,0,3,9,3,5,5,3,7],[9,8,7,5,9,7],[5,8,4,5,10,8,10,11,8],[5,0,4,5,11,0,5,10,11,11,3,0],[0,1,9,8,4,10,8,10,11,10,4,5],[10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],[2,5,1,2,8,5,2,11,8,4,5,8],[0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],[0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],[9,4,5,2,11,3],[2,5,10,3,5,2,3,4,5,3,8,4],[5,10,2,5,2,4,4,2,0],[3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],[5,10,2,5,2,4,1,9,2,9,4,2],[8,4,5,8,5,3,3,5,1],[0,4,5,1,0,5],[8,4,5,8,5,3,9,0,5,0,3,5],[9,4,5],[4,11,7,4,9,11,9,10,11],[0,8,3,4,9,7,9,11,7,9,10,11],[1,10,11,1,11,4,1,4,0,7,4,11],[3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],[4,11,7,9,11,4,9,2,11,9,1,2],[9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],[11,7,4,11,4,2,2,4,0],[11,7,4,11,4,2,8,3,4,3,2,4],[2,9,10,2,7,9,2,3,7,7,4,9],[9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],[3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],[1,10,2,8,7,4],[4,9,1,4,1,7,7,1,3],[4,9,1,4,1,7,0,8,1,8,7,1],[4,0,3,7,4,3],[4,8,7],[9,10,8,10,11,8],[3,0,9,3,9,11,11,9,10],[0,1,10,0,10,8,8,10,11],[3,1,10,11,3,10],[1,2,11,1,11,9,9,11,8],[3,0,9,3,9,11,1,2,9,2,11,9],[0,2,11,8,0,11],[3,2,11],[2,3,8,2,8,10,10,8,9],[9,10,2,0,9,2],[2,3,8,2,8,10,0,1,8,1,10,8],[1,10,2],[1,3,8,9,1,8],[0,9,1],[0,3,8],[-1]];
  }

  function marchingCubes(field, nx, ny, nz, isoLevel, cellW, cellH, cellD, originX, originY, originZ) {
    initMarchingCubesTables();
    var positions = [], indices = [], vertMap = {}, vertCount = 0;
    function idx(ix,iy,iz){return ix+iy*nx+iz*nx*ny;}
    function val(ix,iy,iz){return field[idx(ix,iy,iz)];}
    function interp(ix1,iy1,iz1,ix2,iy2,iz2){
      var v1=val(ix1,iy1,iz1),v2=val(ix2,iy2,iz2);
      var t=(v2-v1)!==0?(isoLevel-v1)/(v2-v1):0.5;
      t=Math.max(0,Math.min(1,t));
      return[originX+(ix1+(ix2-ix1)*t)*cellW,originY+(iy1+(iy2-iy1)*t)*cellH,originZ+(iz1+(iz2-iz1)*t)*cellD];
    }
    function edgeKey(ix1,iy1,iz1,ix2,iy2,iz2){var a=idx(ix1,iy1,iz1),b=idx(ix2,iy2,iz2);return a<b?a+','+b:b+','+a;}
    function getOrCreateVertex(ix1,iy1,iz1,ix2,iy2,iz2){
      var key=edgeKey(ix1,iy1,iz1,ix2,iy2,iz2);
      if(vertMap[key]!==undefined)return vertMap[key];
      var p=interp(ix1,iy1,iz1,ix2,iy2,iz2);
      positions.push(p[0],p[1],p[2]);
      var vi=vertCount++;vertMap[key]=vi;return vi;
    }
    var edgeVerts=[[[0,0,0],[1,0,0]],[[1,0,0],[1,1,0]],[[0,1,0],[1,1,0]],[[0,0,0],[0,1,0]],[[0,0,1],[1,0,1]],[[1,0,1],[1,1,1]],[[0,1,1],[1,1,1]],[[0,0,1],[0,1,1]],[[0,0,0],[0,0,1]],[[1,0,0],[1,0,1]],[[1,1,0],[1,1,1]],[[0,1,0],[0,1,1]]];
    for(var iz=0;iz<nz-1;iz++){for(var iy=0;iy<ny-1;iy++){for(var ix=0;ix<nx-1;ix++){
      var cubeIdx=0;
      if(val(ix,iy,iz)<isoLevel)cubeIdx|=1;if(val(ix+1,iy,iz)<isoLevel)cubeIdx|=2;
      if(val(ix+1,iy+1,iz)<isoLevel)cubeIdx|=4;if(val(ix,iy+1,iz)<isoLevel)cubeIdx|=8;
      if(val(ix,iy,iz+1)<isoLevel)cubeIdx|=16;if(val(ix+1,iy,iz+1)<isoLevel)cubeIdx|=32;
      if(val(ix+1,iy+1,iz+1)<isoLevel)cubeIdx|=64;if(val(ix,iy+1,iz+1)<isoLevel)cubeIdx|=128;
      if(MC_EDGE_TABLE[cubeIdx]===0)continue;
      var triRow=MC_TRI_TABLE[cubeIdx];
      for(var t=0;t<triRow.length;t+=3){
        if(triRow[t]===-1)break;
        var tv0,tv1,tv2;
        for(var tv=0;tv<3;tv++){
          var ei=triRow[t+tv],e=edgeVerts[ei];
          var vi=getOrCreateVertex(ix+e[0][0],iy+e[0][1],iz+e[0][2],ix+e[1][0],iy+e[1][1],iz+e[1][2]);
          if(tv===0)tv0=vi;else if(tv===1)tv1=vi;else tv2=vi;
        }
        // REVERSED winding order → normals face INWARD (into the cavern)
        indices.push(tv0,tv2,tv1);
      }
    }}}
    return{positions:new Float32Array(positions),indices:new Uint32Array(indices),vertCount:vertCount,triCount:indices.length/3};
  }

  // ── Grain texture ───────────────────────────────────────────────────────────

  function generateGrainTexture(seed,size){
    var gn=new ValueNoise(seed^0xBEEF);var c=document.createElement('canvas');c.width=c.height=size;
    var ctx=c.getContext('2d');var id=ctx.createImageData(size,size);var d=id.data;
    for(var py=0;py<size;py++){for(var px=0;px<size;px++){
      var g=gn.fbm(px/size*24,py/size*24,3);var grey=Math.floor(200+g*55);
      grey=Math.max(180,Math.min(255,grey));var off=(py*size+px)*4;
      d[off]=grey;d[off+1]=grey;d[off+2]=grey;d[off+3]=255;
    }}ctx.putImageData(id,0,0);return c;
  }

  // ── Main build ──────────────────────────────────────────────────────────────

  function build(rootEl, bsp, options) {
    var THREE = AFRAME.THREE;
    options = options || {};

    var seed       = options.seed != null ? options.seed : 42;
    var CS         = options.cellSize != null ? options.cellSize : 3;
    var WH         = options.wallHeight != null ? options.wallHeight : 4;
    var warpScale  = options.warpScale != null ? options.warpScale : 0.12;
    var warpAmp    = options.warpAmp != null ? options.warpAmp : 1.5;
    var smoothK    = options.smoothK != null ? options.smoothK : 2.0;
    var corrRadius = options.corridorRadius != null ? options.corridorRadius : 1.8;
    var voxRes     = options.voxelResolution != null ? options.voxelResolution : 0.5;

    var regions = bsp.regions;
    var nodes = bsp.nodes;
    var W = bsp.width;
    var H = bsp.height;
    var noise = new ValueNoise(seed);

    var worldW = W * CS;
    var worldH = H * CS;

    // Voxel grid — pad by 2 cells each side
    var pad = voxRes * 2;
    var nx = Math.ceil((worldW + pad * 2) / voxRes);
    var ny = Math.ceil((WH + pad * 2) / voxRes);
    var nz = Math.ceil((worldH + pad * 2) / voxRes);
    var originX = -pad;
    var originY = -pad;
    var originZ = -pad;

    // Rooms → ellipsoids
    var ellipsoids = [];
    for (var ri = 0; ri < regions.length; ri++) {
      var r = regions[ri];
      ellipsoids.push({
        cx: (r.x + r.width / 2) * CS,
        cy: WH / 2,
        cz: (r.y + r.height / 2) * CS,
        rx: (r.width / 2) * CS * 0.85,
        ry: WH / 2 * 0.9,
        rz: (r.height / 2) * CS * 0.85
      });
    }

    // Corridors → L-shaped capsule pairs
    var corridorPairs = extractCorridorPairs(nodes);
    var capsules = [];
    var midY = WH / 2;
    for (var ci = 0; ci < corridorPairs.length; ci++) {
      var pair = corridorPairs[ci];
      var ax = pair[0].x * CS, az = pair[0].y * CS;
      var bx = pair[1].x * CS, bz = pair[1].y * CS;
      capsules.push({ ax: ax, ay: midY, az: az, bx: bx, by: midY, bz: az, r: corrRadius });
      capsules.push({ ax: bx, ay: midY, az: az, bx: bx, by: midY, bz: bz, r: corrRadius });
    }

    // SDF evaluation with domain warp
    var field = new Float32Array(nx * ny * nz);
    for (var iz = 0; iz < nz; iz++) {
      for (var iy = 0; iy < ny; iy++) {
        for (var ix = 0; ix < nx; ix++) {
          var px = originX + ix * voxRes;
          var py = originY + iy * voxRes;
          var pz = originZ + iz * voxRes;

          var wpx = px + (noise.fbm3D(px*warpScale, py*warpScale, pz*warpScale, 3) - 0.5) * 2 * warpAmp;
          var wpy = py + (noise.fbm3D(px*warpScale+50, py*warpScale+50, pz*warpScale+50, 3) - 0.5) * 2 * warpAmp * 0.3;
          var wpz = pz + (noise.fbm3D(px*warpScale+100, py*warpScale+100, pz*warpScale+100, 3) - 0.5) * 2 * warpAmp;

          var d = 1e10;
          for (var ei = 0; ei < ellipsoids.length; ei++) {
            var e = ellipsoids[ei];
            d = smin(d, sdEllipsoid(wpx,wpy,wpz, e.cx,e.cy,e.cz, e.rx,e.ry,e.rz), smoothK);
          }
          for (var ki = 0; ki < capsules.length; ki++) {
            var c = capsules[ki];
            d = smin(d, sdCapsule(wpx,wpy,wpz, c.ax,c.ay,c.az, c.bx,c.by,c.bz, c.r), smoothK);
          }

          field[ix + iy * nx + iz * nx * ny] = d;
        }
      }
    }

    // Marching cubes — winding reversed so normals face inward
    var mc = marchingCubes(field, nx, ny, nz, 0, voxRes, voxRes, voxRes, originX, originY, originZ);

    if (mc.vertCount === 0) {
      console.warn('SDFCavern: marching cubes produced 0 vertices');
      return { spawnWorld: { x: (W/2)*CS, y: WH/2, z: (H/2)*CS } };
    }

    // Smooth normals (already correct winding from reversed indices)
    var normals = new Float32Array(mc.vertCount * 3);
    var pos = mc.positions, ind = mc.indices;
    for (var i = 0; i < ind.length; i += 3) {
      var i0=ind[i],i1=ind[i+1],i2=ind[i+2];
      var vax=pos[i1*3]-pos[i0*3],vay=pos[i1*3+1]-pos[i0*3+1],vaz=pos[i1*3+2]-pos[i0*3+2];
      var vbx=pos[i2*3]-pos[i0*3],vby=pos[i2*3+1]-pos[i0*3+1],vbz=pos[i2*3+2]-pos[i0*3+2];
      var fnx=vay*vbz-vaz*vby,fny=vaz*vbx-vax*vbz,fnz=vax*vby-vay*vbx;
      normals[i0*3]+=fnx;normals[i0*3+1]+=fny;normals[i0*3+2]+=fnz;
      normals[i1*3]+=fnx;normals[i1*3+1]+=fny;normals[i1*3+2]+=fnz;
      normals[i2*3]+=fnx;normals[i2*3+1]+=fny;normals[i2*3+2]+=fnz;
    }
    for(var ni=0;ni<mc.vertCount;ni++){
      var ox=normals[ni*3],oy=normals[ni*3+1],oz=normals[ni*3+2];
      var len=Math.sqrt(ox*ox+oy*oy+oz*oz)||1;
      normals[ni*3]=ox/len;normals[ni*3+1]=oy/len;normals[ni*3+2]=oz/len;
    }

    // Vertex colour + UVs
    var colors = new Float32Array(mc.vertCount * 3);
    var uvs = new Float32Array(mc.vertCount * 2);
    var invUV = 0.5;
    for (var vi = 0; vi < mc.vertCount; vi++) {
      var vpx=pos[vi*3],vpy=pos[vi*3+1],vpz=pos[vi*3+2];
      var detail = noise.fbm3D(vpx*0.8, vpy*0.8, vpz*0.8, 3);
      var lum = Math.max(0.1, Math.min(0.9, detail));
      colors[vi*3]=lum; colors[vi*3+1]=lum; colors[vi*3+2]=lum;

      var anx=Math.abs(normals[vi*3]),any=Math.abs(normals[vi*3+1]),anz=Math.abs(normals[vi*3+2]);
      if(any>=anx&&any>=anz){uvs[vi*2]=vpx*invUV;uvs[vi*2+1]=vpz*invUV;}
      else if(anx>=anz){uvs[vi*2]=vpz*invUV;uvs[vi*2+1]=vpy*invUV;}
      else{uvs[vi*2]=vpx*invUV;uvs[vi*2+1]=vpy*invUV;}
    }

    // Geometry
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mc.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(mc.indices, 1));

    var grainCanvas = generateGrainTexture(seed, 256);
    var grainTex = new THREE.CanvasTexture(grainCanvas);
    grainTex.wrapS = THREE.RepeatWrapping;
    grainTex.wrapT = THREE.RepeatWrapping;
    grainTex.anisotropy = 4;
    grainTex.needsUpdate = true;

    var mat = new THREE.MeshStandardMaterial({
      map: grainTex,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false,
      side: THREE.FrontSide  // normals face inward, FrontSide shows interior
    });

    var mesh = new THREE.Mesh(geo, mat);

    // Floor entity for a-game locomotion
    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', mesh);

    // Spawn INSIDE the first room, at the floor level.
    // The ellipsoid bottom is at cy - ry. We want feet near that surface.
    var spawnRoom = ellipsoids[0] || { cx: (W/2)*CS, cy: WH/2, cz: (H/2)*CS, ry: 1.5 };
    var floorY = spawnRoom.cy - spawnRoom.ry + 0.2; // slightly above the bottom
    var spawnWorld = {
      x: spawnRoom.cx,
      y: floorY,
      z: spawnRoom.cz
    };

    var startMarker = document.createElement('a-box');
    startMarker.setAttribute('start', '');
    startMarker.setAttribute('position', spawnWorld.x + ' ' + (floorY + 0.01) + ' ' + spawnWorld.z);
    startMarker.setAttribute('width', '0.02');
    startMarker.setAttribute('height', '0.02');
    startMarker.setAttribute('depth', '0.02');
    startMarker.setAttribute('visible', 'false');
    rootEl.appendChild(startMarker);

    return { spawnWorld: spawnWorld };
  }

  window.SDFCavern = { build: build };
}());
