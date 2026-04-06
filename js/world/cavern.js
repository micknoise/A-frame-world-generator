/**
 * cavern.js — BSP cavern mesh
 *
 * Pipeline:
 *   1. Wall tiles → sdBox columns
 *   2. Per-room Gaussian arch lifts the ceiling
 *   3. smin unions all columns into one smooth solid
 *   4. Marching cubes extracts the surface
 *   5. fbm displaces vertices along the surface normal (rocky texture)
 *   6. Triplanar fbm sets vertex colour (dark rock with strata variation)
 *
 * Depends on: mc-tables.js (window.MC_EDGE_TABLE, window.MC_TRI_TABLE), AFRAME
 *
 * API:
 *   buildCavern(rootEl, tiles, rooms, opts) → { spawnWorld: {x,y,z} }
 *   opts: { seed, cellSize, wallHeight, smoothK, voxelStep, domeAmp, domeFall }
 */
(function () {
  'use strict';

  // ── Seeded value noise ────────────────────────────────────────────────────

  function ValueNoise(seed) {
    var s = (seed | 0) || 1;
    function rng() { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }
    var p = new Uint8Array(256), i, j, t;
    this.v = new Float32Array(256);
    for (i = 0; i < 256; i++) { p[i] = i; this.v[i] = rng(); }
    for (i = 255; i > 0; i--) { j = (rng() * (i + 1)) | 0; t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = new Uint8Array(512);
    for (i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }

  ValueNoise.prototype.at = function (x, y) {
    var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var aa = this.p[this.p[xi] + yi],     ba = this.p[this.p[xi + 1] + yi];
    var ab = this.p[this.p[xi] + yi + 1], bb = this.p[this.p[xi + 1] + yi + 1];
    return (this.v[aa] * (1 - u) + this.v[ba] * u) * (1 - v)
         + (this.v[ab] * (1 - u) + this.v[bb] * u) * v;
  };

  ValueNoise.prototype.fbm = function (x, y, oct) {
    var sum = 0, amp = 1, freq = 1, max = 0;
    for (var i = 0; i < oct; i++) { sum += this.at(x * freq, y * freq) * amp; max += amp; amp *= 0.5; freq *= 2; }
    return sum / max;
  };

  // ── SDF primitives ────────────────────────────────────────────────────────

  function smin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  function sdBox(px, py, pz, cx, cy, cz, hx, hy, hz) {
    var qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy, qz = Math.abs(pz - cz) - hz;
    var mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  }

  // ── Build SDF ─────────────────────────────────────────────────────────────
  // Sign convention: negative = solid rock, positive = air.
  // Walls + ground below y=0 are solid; arches lift the ceiling above wallHeight.

  function makeSdf(walls, arches, WH, k, maxX, maxZ) {
    var kf = k * 0.28; // tighter blend at floor/wall junction
    return function sdf(px, py, pz) {
      var d = 1e9, i, a, dx, dz;
      for (i = 0; i < walls.length; i++) {
        var w = walls[i];
        d = smin(d, sdBox(px, py, pz, w.cx, w.cy, w.cz, w.hx, w.hy, w.hz), k);
      }
      d = smin(d, py, kf); // ground plane (solid below y = 0)

      // Outer boundary: explicit half-planes so the dungeon is fully enclosed.
      // SDF for "solid to the left of x=0" is just px (negative when px < 0).
      d = Math.min(d, px);          // solid where x < 0
      d = Math.min(d, maxX - px);   // solid where x > maxX
      d = Math.min(d, pz);          // solid where z < 0
      d = Math.min(d, maxZ - pz);   // solid where z > maxZ

      // Ceiling: per-room Gaussian arches, take highest point, then hard cap
      var cy = WH;
      for (i = 0; i < arches.length; i++) {
        a = arches[i];
        dx = (px - a.cx) / a.rx;
        dz = (pz - a.cz) / a.rz;
        var lift = a.amp * Math.exp(-(dx * dx + dz * dz) * a.fall);
        if (WH + lift > cy) cy = WH + lift;
      }
      return Math.min(d, cy - py); // solid above ceiling
    };
  }

  // ── Marching cubes ────────────────────────────────────────────────────────

  // Cube corner offsets and edge pairs (Paul Bourke / standard MC layout)
  var CORNERS = [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];
  var EDGES   = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

  function march(sdf, x0, y0, z0, x1, y1, z1, step) {
    var ET = window.MC_EDGE_TABLE, TT = window.MC_TRI_TABLE;
    var nx = Math.ceil((x1 - x0) / step) + 1;
    var ny = Math.ceil((y1 - y0) / step) + 1;
    var nz = Math.ceil((z1 - z0) / step) + 1;

    // Sample SDF into a flat array (x innermost)
    var field = new Float32Array(nx * ny * nz);
    var idx = 0;
    for (var iz = 0; iz < nz; iz++)
      for (var iy = 0; iy < ny; iy++)
        for (var ix = 0; ix < nx; ix++)
          field[idx++] = sdf(x0 + ix * step, y0 + iy * step, z0 + iz * step);

    function V(i, j, k) { return field[i + nx * (j + ny * k)]; }

    var out = [];
    for (var iz2 = 0; iz2 < nz - 1; iz2++) {
      for (var iy2 = 0; iy2 < ny - 1; iy2++) {
        for (var ix2 = 0; ix2 < nx - 1; ix2++) {
          var bits = 0, vals = [];
          for (var c = 0; c < 8; c++) {
            vals[c] = V(ix2 + CORNERS[c][0], iy2 + CORNERS[c][1], iz2 + CORNERS[c][2]);
            if (vals[c] < 0) bits |= 1 << c;
          }
          if (!bits || bits === 255) continue;
          var edges = ET[bits];
          if (!edges) continue;

          var verts = new Array(12);
          for (var e = 0; e < 12; e++) {
            if (!(edges & (1 << e))) continue;
            var ep = EDGES[e], ai = ep[0], bi = ep[1];
            var av = vals[ai], bv = vals[bi];
            var t = Math.abs(av - bv) < 1e-12 ? 0.5 : av / (av - bv);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            verts[e] = [
              x0 + (ix2 + CORNERS[ai][0] + t * (CORNERS[bi][0] - CORNERS[ai][0])) * step,
              y0 + (iy2 + CORNERS[ai][1] + t * (CORNERS[bi][1] - CORNERS[ai][1])) * step,
              z0 + (iz2 + CORNERS[ai][2] + t * (CORNERS[bi][2] - CORNERS[ai][2])) * step
            ];
          }

          var tt = TT[bits];
          for (var ti = 0; ti < 16 && tt[ti] >= 0; ti += 3)
            for (var vi = 0; vi < 3; vi++) { var vp = verts[tt[ti + vi]]; out.push(vp[0], vp[1], vp[2]); }
        }
      }
    }
    return out;
  }

  // ── Cellular (Voronoi) noise for cracked stone blocks ────────────────────

  function hash2D(ix, iy, w) {
    var h = (Math.imul(ix, 1619) + Math.imul(iy, 31337) + Math.imul(w, 6947)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Returns F1/F2 distances and the seed point of the nearest cell.
  function cellNoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var F1sq = 1e9, F2sq = 1e9, sx = 0, sy = 0;
    for (var jy = -1; jy <= 1; jy++) {
      for (var jx = -1; jx <= 1; jx++) {
        var cx = ix + jx + hash2D(ix + jx, iy + jy, 0);
        var cy = iy + jy + hash2D(ix + jx, iy + jy, 1);
        var dx = x - cx, dy = y - cy, dsq = dx * dx + dy * dy;
        if (dsq < F1sq) { F2sq = F1sq; F1sq = dsq; sx = cx; sy = cy; }
        else if (dsq < F2sq) { F2sq = dsq; }
      }
    }
    return { F1: Math.sqrt(F1sq), F2: Math.sqrt(F2sq), sx: sx, sy: sy };
  }

  function smoothstep(x, lo, hi) {
    var t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  }

  // ── Geometry: displace + colour ───────────────────────────────────────────

  function gradient(sdf, px, py, pz) {
    var e = 0.05;
    var dx = sdf(px + e, py, pz) - sdf(px - e, py, pz);
    var dy = sdf(px, py + e, pz) - sdf(px, py - e, pz);
    var dz = sdf(px, py, pz + e) - sdf(px, py, pz - e);
    var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return [dx / l, dy / l, dz / l];
  }

  function buildGeo(soup, sdf, noise, THREE) {
    var n   = soup.length / 3;
    var pos = new Float32Array(n * 3);
    var col = new Float32Array(n * 3);
    var nor = new Float32Array(n * 3);
    var sc  = 0.55, oct = 5;

    for (var i = 0; i < n; i++) {
      var px = soup[i * 3], py = soup[i * 3 + 1], pz = soup[i * 3 + 2];
      var g  = gradient(sdf, px, py, pz);

      // Triplanar blend weights (squared normal components, normalised)
      var wx = g[0] * g[0], wy = g[1] * g[1], wz = g[2] * g[2];
      var ws = wx + wy + wz || 1;
      wx /= ws; wy /= ws; wz /= ws;

      // Three fbm samples — one per axis-pair, with distinct offsets so they look different
      var ny_ = noise.fbm(px * sc,       pz * sc,       oct); // Y-faces (floor/ceiling)
      var nx_ = noise.fbm(py * sc + 40,  pz * sc + 40,  oct); // X-faces (walls)
      var nz_ = noise.fbm(px * sc + 80,  py * sc + 80,  oct); // Z-faces (walls)
      var n01 = wy * ny_ + wx * nx_ + wz * nz_;               // triplanar blend in [0,1]

      // Displace along surface normal — walls get more than floor/ceiling
      var wallness = 1 - wy; // 0 on horizontal faces, 1 on vertical
      var disp = (n01 - 0.5) * 2 * (0.15 + wallness * 0.55);
      px += g[0] * disp;
      py += g[1] * disp;
      pz += g[2] * disp;

      // Recompute normal at displaced position
      var gn = gradient(sdf, px, py, pz);

      // Rock strata: large-scale horizontal bands (geological layers)
      var strataWarp = noise.fbm(px * 0.06, pz * 0.06, 2) * 3.5;
      var strata = 0.5 + 0.5 * Math.sin((py * 1.1 + strataWarp) * Math.PI);

      // Cracked stone blocks via domain-warped Voronoi, triplanar projected.
      // Domain warp breaks up grid regularity so blocks don't tile.
      var st = 0.85; // ~1.2 world units per stone block
      var wu = (noise.fbm(px * 0.28 + 3.1, pz * 0.28 + 7.4, 3) - 0.5) * 1.5;
      var wv = (noise.fbm(px * 0.28 + 11.3, pz * 0.28 + 2.8, 3) - 0.5) * 1.5;

      var cY = cellNoise((px + wu) * st, (pz + wv) * st);
      var cX = cellNoise((py + wu) * st, (pz + wv) * st);
      var cZ = cellNoise((px + wu) * st, (py + wv) * st);

      // F2 − F1 is smallest at cell boundaries (the crack seam); smooth to 0 there
      var crack = wy * smoothstep(cY.F2 - cY.F1, 0, 0.22)
                + wx * smoothstep(cX.F2 - cX.F1, 0, 0.22)
                + wz * smoothstep(cZ.F2 - cZ.F1, 0, 0.22);

      // Per-stone tone: fbm sampled at each cell's seed point so every block is unique
      var tone = wy * noise.fbm(cY.sx * 0.15, cY.sy * 0.15, 2)
               + wx * noise.fbm(cX.sx * 0.15, cX.sy * 0.15, 2)
               + wz * noise.fbm(cZ.sx * 0.15, cZ.sy * 0.15, 2);

      // Stone surface brightness = strata + per-block tone + fine noise grain
      var surface = strata * 0.35 + tone * 0.40 + n01 * 0.25;

      // Seams are near-black; stone faces range from dark to pale
      var c = crack * (0.06 + surface * 0.30) + (1.0 - crack) * 0.025;

      pos[i * 3]     = px;    pos[i * 3 + 1]  = py;    pos[i * 3 + 2]  = pz;
      col[i * 3]     = c;     col[i * 3 + 1]  = c;     col[i * 3 + 2]  = c;
      nor[i * 3]     = gn[0]; nor[i * 3 + 1]  = gn[1]; nor[i * 3 + 2]  = gn[2];
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
    return geo;
  }

  // ── Public build function ─────────────────────────────────────────────────

  function build(rootEl, tiles, rooms, opts) {
    var THREE = AFRAME.THREE;
    opts = opts || {};
    var CS       = opts.cellSize   != null ? opts.cellSize   : 3;
    var WH       = opts.wallHeight != null ? opts.wallHeight : 3.5;
    var k        = opts.smoothK    != null ? opts.smoothK    : CS * 0.85;
    var step     = opts.voxelStep  != null ? opts.voxelStep  : 0.84;
    var domeAmp  = opts.domeAmp    != null ? opts.domeAmp    : 6;
    var domeFall = opts.domeFall   != null ? opts.domeFall   : 2.2;
    var seed     = opts.seed       != null ? opts.seed       : 1;

    var H = tiles.length, W = tiles[0].length;

    // Wall tile → sdBox column
    var walls = [];
    for (var ty = 0; ty < H; ty++)
      for (var tx = 0; tx < W; tx++)
        if (tiles[ty][tx] === 'wall')
          walls.push({ cx: (tx + 0.5) * CS, cy: WH / 2, cz: (ty + 0.5) * CS, hx: CS / 2, hy: WH / 2, hz: CS / 2 });

    // Room → Gaussian ceiling arch (spread 1.4× room half-size reaches into corridors)
    var arches = rooms.map(function (r) {
      return {
        cx:   (r.x + r.width  * 0.5) * CS,
        cz:   (r.y + r.height * 0.5) * CS,
        rx:   r.width  * CS * 0.5 * 1.4,
        rz:   r.height * CS * 0.5 * 1.4,
        amp:  domeAmp,
        fall: domeFall
      };
    });

    var sdf = makeSdf(walls, arches, WH, k, W * CS, H * CS);

    var pad  = k * 2.5;
    var soup = march(sdf, -pad, -pad * 0.5, -pad, W * CS + pad, WH + domeAmp + pad, H * CS + pad, step);

    var geo = soup.length >= 9
      ? buildGeo(soup, sdf, new ValueNoise(seed), THREE)
      : new THREE.BoxGeometry(1, 0.1, 1);

    var mat  = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    var mesh = new THREE.Mesh(geo, mat);
    var el   = document.createElement('a-entity');
    el.setAttribute('floor', '');
    rootEl.appendChild(el);
    el.setObject3D('mesh', mesh);

    // Spawn at the centre of the first BSP room — always a valid floor area
    var r0   = rooms[0];
    var spx  = (r0.x + r0.width  * 0.5) * CS;
    var spz  = (r0.y + r0.height * 0.5) * CS;

    // Scan upward from below the floor to find the first air position
    var spy = -0.3;
    while (spy < WH && sdf(spx, spy, spz) <= 0) spy += 0.04;
    if (spy >= WH) spy = 1.5; // fallback if scan fails
    spy += 0.7; // generous clearance above surface

    return { spawnWorld: { x: spx, y: spy, z: spz } };
  }

  window.buildCavern = build;
}());
