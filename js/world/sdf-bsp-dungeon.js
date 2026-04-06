/**
 * sdf-bsp-dungeon.js — BSP tile grid → smooth solid (smin union of wall columns +
 * ground/ceiling half-spaces) → marching cubes mesh → value-noise displacement
 * and luminance vertex colours: in luminance mode, triplanar blend of the same raw fBm samples
 * used for displacement (like noise-dungeon merged quads’ dispValues / noise-capsule shadeNoise).
 *
 * Does not modify noise-dungeon.js or the world-noise-dungeon example.
 *
 * PUBLIC API
 * ----------
 *   SdfBspDungeon.build(rootEl, tiles, options) → { spawnWorld }
 *   SdfBspDungeon.createWallTexSamplersFromImages(HTMLImageElement[]) → fn(u,v) luminance 0..1
 *
 * Optional (defaults match original flat ceiling + greyscale vertex tint):
 *   ceilingMode: 'flat' | 'dome' — dome raises the ceiling heightfield.
 *   options.regions — BSP room rects { x, y, width, height } in tile space; when dome mode
 *   and regions.length > 0, each room gets its own Gaussian arch (max over rooms); corridors
 *   pick up the blend where arches overlap. Without regions, one map-wide dome is used.
 *   ceilingRoomSpread — scales each room’s Gaussian width (default ~1.36, >1 reaches into corridors).
 *   ceilingDomeAmplitude, ceilingDomeFalloff, ceilingDetailAmplitude, ceilingDetailScale
 *   ceilingDomeScope: 'rooms' | 'map' — force map-wide dome even if regions exist (optional).
 *   floorDisplacement / wallDisplacement / ceilingDisplacement — like noise-dungeon.js (defaults 0.12 /
 *   0.35 / 0.25). If only surfaceDisplacement is set, scales those three from the old single 0.09 ref.
 *   Mesh displacement uses the same 2D fBm planes and seed offsets (0, 100, 200/300, 400/500) as
 *   buildDisplacedQuad, blended by squared SDF gradient (triplanar weights), not a single normal push.
 *
 *   albedoMode: 'luminance' | 'white' | 'cobble' — cobble = large-patch vertex tones (grey stone).
 *   luminanceDarkBase (0–1) + luminanceMaxBoost (e.g. 0.2) — in luminance mode, vertex grey is
 *   base * (1 + boost * n) with n from triplanar value noise in [0,1], so highlights are at most
 *   ~20% brighter than base when boost = 0.2. Optional luminanceHighFreqMix (0–1) blends extra
 *   high-frequency fBm into n for finer wall grain (displacement unchanged).
 *   wallTexSamplers — array of luminance samplers from SdfBspDungeon.createWallTexSamplersFromImages(imgs);
 *   optional wallTexWorldScale (meters per UV repeat, default ~5.5),
 *   wallTexMulMin / wallTexMulMax (default ~0.28 / 1) — after base*(1+maxBoost*nNoise), multiply albedo by
 *   lerp(mulMin, mulMax, photo luminance) so strata read on screen (value-noise still capped by maxBoost only).
 *   wallTexBlend (0–1, default 1) — strength of that multiply; wallTexChunkPeriod — chunk cross-fade (default 12).
 *   grainStyle: 'default' | 'neutral' | 'cobble' — cobble = low-frequency masonry grain on the map.
 *   grainNeutral: true — shorthand for grainStyle 'neutral' if grainStyle omitted.
 *   materialColor, materialRoughness, materialMetalness — PBR tweaks.
 *
 * Ceiling heightfield uses Math.min (hard cap) so a domed ceiling is not flattened by smin
 * against wall-column tops at y = wallHeight.
 *
 * Depends on window.MC_EDGE_TABLE and window.MC_TRI_TABLE (mc-tables.js).
 */
(function () {
  'use strict';

  function smin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  function sdBox(px, py, pz, cx, cy, cz, hx, hy, hz) {
    var qx = Math.abs(px - cx) - hx;
    var qy = Math.abs(py - cy) - hy;
    var qz = Math.abs(pz - cz) - hz;
    var qxm = Math.max(qx, 0);
    var qym = Math.max(qy, 0);
    var qzm = Math.max(qz, 0);
    return Math.sqrt(qxm * qxm + qym * qym + qzm * qzm) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  }

  // ── Value noise (same pattern as noise-dungeon / noise-terrain) ─────────────

  function ValueNoise(seed) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    var rng = seededRng(seed);
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

  function seededRng(seed) {
    var s = seed | 0;
    return function () {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  ValueNoise.prototype.noise2D = function (x, y) {
    var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = fade(xf), v = fade(yf);
    var aa = this.perm[this.perm[xi] + yi];
    var ab = this.perm[this.perm[xi] + yi + 1];
    var ba = this.perm[this.perm[xi + 1] + yi];
    var bb = this.perm[this.perm[xi + 1] + yi + 1];
    return lerp(
      lerp(this.values[aa], this.values[ba], u),
      lerp(this.values[ab], this.values[bb], u),
      v
    );
  };

  ValueNoise.prototype.fbm = function (x, y, octaves, lacunarity, gain) {
    lacunarity = lacunarity || 2.0;
    gain = gain || 0.5;
    var sum = 0, amp = 1, freq = 1, maxAmp = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  };

  function generateGrainTexture(seed, size, grainStyle) {
    size = size || 256;
    var style = grainStyle || 'default';
    var grainNoise = new ValueNoise(seed ^ 0xBEEF);
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(size, size);
    var data = imgData.data;
    var py, px, u, v, g0, g1, g2, mix, grey, off;
    for (py = 0; py < size; py++) {
      for (px = 0; px < size; px++) {
        u = px / size;
        v = py / size;
        if (style === 'cobble') {
          /* Large mortar joints + medium stone breakup (world UVs are ~0.5–2 units; keep tex low-freq). */
          g0 = grainNoise.fbm(u * 2.2 + 0.35, v * 2.2 + 0.08, 4);
          g1 = grainNoise.fbm(u * 7.5 + 1.9, v * 7.5 + 1.2, 3);
          g2 = grainNoise.fbm(u * 16 + 4.4, v * 16 + 0.6, 2);
          mix = g0 * 0.5 + g1 * 0.35 + g2 * 0.15;
          grey = Math.floor(55 + mix * 125);
          grey = Math.max(42, Math.min(205, grey));
        } else if (style === 'neutral') {
          g0 = grainNoise.fbm(u * 24, v * 24, 3);
          grey = Math.floor(248 + g0 * 7);
          grey = Math.max(245, Math.min(255, grey));
        } else {
          g0 = grainNoise.fbm(u * 24, v * 24, 3);
          grey = Math.floor(200 + g0 * 55);
          grey = Math.max(180, Math.min(255, grey));
        }
        off = (py * size + px) * 4;
        data[off] = grey; data[off + 1] = grey; data[off + 2] = grey; data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ── Wall list + SDF closure ─────────────────────────────────────────────────

  /** One Gaussian vault per BSP room; spread widens the bump into adjacent corridors. */
  function buildRoomCeilingArches(regions, CS, domeAmp, spread, fallMult) {
    var arches = [];
    if (!regions || !regions.length || !(domeAmp > 0)) return arches;
    spread = spread != null ? spread : 1.36;
    fallMult = fallMult != null ? fallMult : 1;
    var i, reg, cx, cz, sx, sz;
    for (i = 0; i < regions.length; i++) {
      reg = regions[i];
      cx = (reg.x + reg.width * 0.5) * CS;
      cz = (reg.y + reg.height * 0.5) * CS;
      sx = Math.max(reg.width * CS * 0.5 * spread, CS * 1.15);
      sz = Math.max(reg.height * CS * 0.5 * spread, CS * 1.15);
      arches.push({ cx: cx, cz: cz, sx: sx, sz: sz, amp: domeAmp, fall: fallMult });
    }
    return arches;
  }

  function buildWallColumns(tiles, W, H, CS, WH) {
    var list = [];
    var ty, tx, cx, cz;
    for (ty = 0; ty < H; ty++) {
      for (tx = 0; tx < W; tx++) {
        if (tiles[ty][tx] !== 'wall') continue;
        cx = (tx + 0.5) * CS;
        cz = (ty + 0.5) * CS;
        list.push({ cx: cx, cy: WH * 0.5, cz: cz, hx: CS * 0.5, hy: WH * 0.5, hz: CS * 0.5 });
      }
    }
    return list;
  }

  function makeSolidSdf(walls, WH, kWall, kCap, ceilingCfg) {
    ceilingCfg = ceilingCfg || { mode: 'flat' };
    var mode = ceilingCfg.mode || 'flat';
    var worldCX = ceilingCfg.worldCX;
    var worldCZ = ceilingCfg.worldCZ;
    var invRx = ceilingCfg.invRx;
    var invRz = ceilingCfg.invRz;
    var domeAmp = ceilingCfg.domeAmp != null ? ceilingCfg.domeAmp : 0;
    var domeFall = ceilingCfg.domeFall != null ? ceilingCfg.domeFall : 1.25;
    var roomArches = ceilingCfg.roomArches;
    var ceilNoise = ceilingCfg.ceilNoise;
    var ceilDetAmp = ceilingCfg.ceilDetAmp != null ? ceilingCfg.ceilDetAmp : 0;
    var ceilDetScale = ceilingCfg.ceilDetScale != null ? ceilingCfg.ceilDetScale : 0.1;

    function ceilingY(px, pz) {
      var y = WH;
      var lift = 0;
      if (mode === 'dome') {
        if (roomArches && roomArches.length) {
          var ri, a, dx, dz, q, g, h;
          for (ri = 0; ri < roomArches.length; ri++) {
            a = roomArches[ri];
            dx = px - a.cx;
            dz = pz - a.cz;
            q = (dx * dx) / (a.sx * a.sx) + (dz * dz) / (a.sz * a.sz);
            g = Math.exp(-q * a.fall);
            h = a.amp * g;
            if (h > lift) lift = h;
          }
        } else {
          var nx = (px - worldCX) * invRx;
          var nz = (pz - worldCZ) * invRz;
          var r2 = nx * nx + nz * nz;
          lift = domeAmp * Math.exp(-r2 * domeFall);
        }
      }
      y += lift;
      if (ceilNoise && ceilDetAmp > 0) {
        y += (ceilNoise.fbm(px * ceilDetScale, pz * ceilDetScale, 3) - 0.5) * 2 * ceilDetAmp;
      }
      return y;
    }

    return function sdf(px, py, pz) {
      var d = 1e9;
      var i, w;
      for (i = 0; i < walls.length; i++) {
        w = walls[i];
        d = smin(
          d,
          sdBox(px, py, pz, w.cx, w.cy, w.cz, w.hx, w.hy, w.hz),
          kWall
        );
      }
      d = smin(d, py, kCap);
      var cy = mode === 'flat' ? WH : ceilingY(px, pz);
      /* Hard ceiling cut: smin with wall tops pins the iso-surface near y = WH and hides domes. */
      d = Math.min(d, cy - py);
      return d;
    };
  }

  function sdfGradient(sdf, px, py, pz, e) {
    var dx = sdf(px + e, py, pz) - sdf(px - e, py, pz);
    var dy = sdf(px, py + e, pz) - sdf(px, py - e, pz);
    var dz = sdf(px, py, pz + e) - sdf(px, py, pz - e);
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  // ── Marching cubes (Paul Bourke / MC tables on window) ─────────────────────

  var CORNER_OFF = [
    [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]
  ];

  var EDGE_PAIRS = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  function interpPos(iso, ax, ay, az, av, bx, by, bz, bv) {
    if (Math.abs(av - bv) < 1e-12) return { x: ax, y: ay, z: az };
    var t = (iso - av) / (bv - av);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      z: az + (bz - az) * t
    };
  }

  function marchField(field, nx, ny, nz, ox, oy, oz, step, iso) {
    var ET = window.MC_EDGE_TABLE;
    var TT = window.MC_TRI_TABLE;
    if (!ET || !TT) {
      throw new Error('sdf-bsp-dungeon: load js/world/mc-tables.js before sdf-bsp-dungeon.js');
    }

    var positions = [];
    var ix, iy, iz, c, bits, cubeIndex, edges, e, t, triTable;
    var vals = [];
    var vertList = new Array(12);

    function valAt(ci, cj, ck) {
      return field[ci + nx * (cj + ny * ck)];
    }

    for (iz = 0; iz < nz - 1; iz++) {
      for (iy = 0; iy < ny - 1; iy++) {
        for (ix = 0; ix < nx - 1; ix++) {
          bits = 0;
          for (c = 0; c < 8; c++) {
            vals[c] = valAt(ix + CORNER_OFF[c][0], iy + CORNER_OFF[c][1], iz + CORNER_OFF[c][2]);
            if (vals[c] < iso) bits |= 1 << c;
          }
          cubeIndex = bits;
          if (cubeIndex === 0 || cubeIndex === 255) continue;

          edges = ET[cubeIndex];
          if (edges === 0) continue;

          for (e = 0; e < 12; e++) vertList[e] = null;

          for (e = 0; e < 12; e++) {
            if ((edges & (1 << e)) === 0) continue;
            var p = EDGE_PAIRS[e];
            var a = p[0], b = p[1];
            var ax = ox + (ix + CORNER_OFF[a][0]) * step;
            var ay = oy + (iy + CORNER_OFF[a][1]) * step;
            var az = oz + (iz + CORNER_OFF[a][2]) * step;
            var bx = ox + (ix + CORNER_OFF[b][0]) * step;
            var by = oy + (iy + CORNER_OFF[b][1]) * step;
            var bz = oz + (iz + CORNER_OFF[b][2]) * step;
            vertList[e] = interpPos(iso, ax, ay, az, vals[a], bx, by, bz, vals[b]);
          }

          triTable = TT[cubeIndex];
          for (t = 0; t < 16 && triTable[t] >= 0; t += 3) {
            for (var i = 0; i < 3; i++) {
              var vi = triTable[t + i];
              var vp = vertList[vi];
              positions.push(vp.x, vp.y, vp.z);
            }
          }
        }
      }
    }

    return positions;
  }

  /**
   * Same sampling pattern as noise-dungeon.js buildDisplacedQuad: floor/ceiling in XZ,
   * ±X walls use (py,pz) with offsets 400/500, ±Z walls use (px,py) with 200/300.
   * Weights tx,ty,tz are squared normal components (triplanar), so walls/floor read distinct fBm.
   */
  function axisNoiseDisplacement(noise, px, py, pz, gx, gy, gz, nScale, nOct, floorAmp, wallAmp, ceilAmp) {
    var tx = gx * gx;
    var ty = gy * gy;
    var tz = gz * gz;
    var sum = tx + ty + tz;
    if (sum < 1e-14) {
      tx = ty = tz = 1 / 3;
    } else {
      tx /= sum;
      ty /= sum;
      tz /= sum;
    }
    var nf = noise.fbm(px * nScale + 0, pz * nScale + 0, nOct);
    var nc = noise.fbm(px * nScale + 100, pz * nScale + 100, nOct);
    var hFloor = (nf - 0.5) * 2 * floorAmp;
    var hCeil = (nc - 0.5) * 2 * ceilAmp;
    var offX = gx >= 0 ? 400 : 500;
    var nWallX = noise.fbm(py * nScale + offX, pz * nScale + offX * 1.3, nOct);
    var hWallX = (nWallX - 0.5) * 2 * wallAmp;
    var offZ = gz >= 0 ? 200 : 300;
    var nWallZ = noise.fbm(px * nScale + offZ, py * nScale + offZ * 1.3, nOct);
    var hWallZ = (nWallZ - 0.5) * 2 * wallAmp;
    var dy = 0;
    if (gy > 0) dy += ty * hFloor;
    if (gy < 0) dy -= ty * hCeil;
    var dx = tx * hWallX * (Math.abs(gx) < 1e-7 ? 0 : gx >= 0 ? 1 : -1);
    var dz = tz * hWallZ * (Math.abs(gz) < 1e-7 ? 0 : gz >= 0 ? 1 : -1);
    /* Same triplanar luminance as noise-capsule / noise-dungeon-style axis blend of displacement fBms. */
    var shadeNoise = ty * (gy > 0 ? nf : nc) + tx * nWallX + tz * nWallZ;
    shadeNoise /= Math.max(1e-6, ty + tx + tz);
    return { dx: dx, dy: dy, dz: dz, lumBlend: shadeNoise };
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  function fract01(x) {
    x = x - Math.floor(x);
    if (x < 0) x += 1;
    return x;
  }

  /** Downscale wide photos for faster CPU sampling; bilinear luminance in repeating UV. */
  function createBilinearLuminanceSampler(image) {
    var canvas = document.createElement('canvas');
    var ow = image.naturalWidth || image.width;
    var oh = image.naturalHeight || image.height;
    var maxDim = 480;
    var w = ow;
    var h = oh;
    if (ow < 1 || oh < 1) {
      return function () {
        return 0.5;
      };
    }
    if (w > maxDim || h > maxDim) {
      var sc = maxDim / Math.max(w, h);
      w = Math.max(1, Math.round(w * sc));
      h = Math.max(1, Math.round(h * sc));
    }
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    var data;
    try {
      ctx.drawImage(image, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('sdf-bsp-dungeon: wall texture canvas taint/read failed (CORS or file URL?)', e);
      }
      return function () {
        return 0.5;
      };
    }
    var iw = w;
    var ih = h;
    function L(ix, iy) {
      ix = ((ix % iw) + iw) % iw;
      iy = ((iy % ih) + ih) % ih;
      var o = (iy * iw + ix) * 4;
      return (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    }
    return function sampleLum(u, v) {
      u = fract01(u);
      v = fract01(v);
      var fu = u * iw - 0.5;
      var fv = (1 - v) * ih - 0.5;
      var x0 = Math.floor(fu);
      var y0 = Math.floor(fv);
      var tx = fu - x0;
      var ty = fv - y0;
      var l00 = L(x0, y0);
      var l10 = L(x0 + 1, y0);
      var l01 = L(x0, y0 + 1);
      var l11 = L(x0 + 1, y0 + 1);
      var l0 = l00 * (1 - tx) + l10 * tx;
      var l1 = l01 * (1 - tx) + l11 * tx;
      return l0 * (1 - ty) + l1 * ty;
    };
  }

  function triplanarTexLum(px, py, pz, nx, ny, nz, texWorldScale, sampler) {
    var inv = 1 / texWorldScale;
    var ax = Math.abs(nx);
    var ay = Math.abs(ny);
    var az = Math.abs(nz);
    var sw = ax + ay + az;
    if (sw < 1e-10) sw = 1;
    var wx = ax / sw;
    var wy = ay / sw;
    var wz = az / sw;
    var a = sampler(py * inv, pz * inv);
    var b = sampler(px * inv, pz * inv);
    var c = sampler(px * inv, py * inv);
    return a * wx + b * wy + c * wz;
  }

  function cellHash01(px, py, pz, period) {
    var cx = Math.floor(px / period);
    var cy = Math.floor(py / period);
    var cz = Math.floor(pz / period);
    var t = Math.sin(cx * 12.9898 + cy * 78.233 + cz * 43.758) * 43758.5453;
    return fract01(t);
  }

  /** Cross-fade between consecutive textures by world chunk so repeats are less obvious. */
  function triplanarFourTexMix(px, py, pz, nx, ny, nz, texWorldScale, samplers, chunkPeriod) {
    var nT = samplers.length;
    if (nT === 0) return 0.5;
    if (nT === 1) return triplanarTexLum(px, py, pz, nx, ny, nz, texWorldScale, samplers[0]);
    var h = cellHash01(px, py, pz, chunkPeriod) * nT;
    var i0 = Math.floor(h) % nT;
    if (i0 < 0) i0 += nT;
    var i1 = (i0 + 1) % nT;
    var f = h - Math.floor(h);
    var v0 = triplanarTexLum(px, py, pz, nx, ny, nz, texWorldScale, samplers[i0]);
    var v1 = triplanarTexLum(px, py, pz, nx, ny, nz, texWorldScale, samplers[i1]);
    return v0 * (1 - f) + v1 * f;
  }

  function createWallTexSamplersFromImages(images) {
    var out = [];
    if (!images) return out;
    for (var ii = 0; ii < images.length; ii++) {
      var im = images[ii];
      if (im && (im.naturalWidth || im.width)) out.push(createBilinearLuminanceSampler(im));
    }
    return out;
  }

  function buildGeometryFromSoup(positions, sdf, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp, uvScale, THREE, albedoMode, cobbleDispMul, lumDark) {
    var triCount = positions.length / 9;
    var vertCount = triCount * 3;
    var pos = new Float32Array(vertCount * 3);
    var colors = new Float32Array(vertCount * 3);
    var normals = new Float32Array(vertCount * 3);
    var uvs = new Float32Array(vertCount * 2);
    var eps = 0.06;
    var ti, vi, vidx, i, base, px, py, pz, g0, gN, lum, nxv, nyv, nzv, anx, any, anz;
    var ad, cMul, wx, wy, wz, ln, tL, tw, n, nNoise, hfMix, hf, texMul, tMin, tMax;

    for (ti = 0; ti < triCount; ti++) {
      base = ti * 9;
      for (vi = 0; vi < 3; vi++) {
        vidx = ti * 3 + vi;
        px = positions[base + vi * 3];
        py = positions[base + vi * 3 + 1];
        pz = positions[base + vi * 3 + 2];

        g0 = sdfGradient(sdf, px, py, pz, eps);
        ad = axisNoiseDisplacement(noise, px, py, pz, g0.x, g0.y, g0.z, nScale, nOct, floorAmp, wallAmp, ceilAmp);
        cMul = albedoMode === 'cobble' ? (cobbleDispMul != null ? cobbleDispMul : 1.06) : 1;
        px += ad.dx * cMul;
        py += ad.dy * cMul;
        pz += ad.dz * cMul;

        pos[vidx * 3] = px;
        pos[vidx * 3 + 1] = py;
        pos[vidx * 3 + 2] = pz;

        gN = sdfGradient(sdf, px, py, pz, eps);

        if (albedoMode === 'white') {
          colors[vidx * 3] = 1;
          colors[vidx * 3 + 1] = 1;
          colors[vidx * 3 + 2] = 1;
        } else if (albedoMode === 'cobble') {
          /* Large stone patches (low f) + grout lines (mid) — sample after displacement. */
          var cLo = noise.fbm(px * nScale * 0.16 + 2.2, pz * nScale * 0.16 + 5.1, 5);
          var cMd = noise.fbm(px * nScale * 0.48 + 19, pz * nScale * 0.48 + 8.7, 4);
          var cHi = noise.fbm(px * nScale * 0.95 + 7, py * nScale * 0.85 + 14, nOct);
          var stone = cLo * 0.48 + cMd * 0.38 + cHi * 0.14;
          lum = 0.3 + stone * 0.52;
          if (lum < 0.28) lum = 0.28;
          if (lum > 0.88) lum = 0.88;
          colors[vidx * 3] = lum;
          colors[vidx * 3 + 1] = lum;
          colors[vidx * 3 + 2] = lum;
        } else if (lumDark && lumDark.base != null && lumDark.maxBoost != null) {
          /* Value-noise luminance: at most maxBoost (e.g. 20%) above base — never mix photo into this term. */
          nNoise = ad.lumBlend;
          hfMix = lumDark.highFreqMix != null ? lumDark.highFreqMix : 0;
          if (hfMix > 0) {
            hf = noise.fbm(px * nScale * 2.85 + 11.3, py * nScale * 2.85 + 47.1, nOct);
            nNoise = nNoise * (1 - hfMix) + hf * hfMix;
          }
          nNoise = clamp01(nNoise);
          lum = lumDark.base * (1 + lumDark.maxBoost * nNoise);
          /* Photo strata: separate multiply so ~0.06 * (1.2) * (0.3…1) is visible, not ~0.06…0.07 only. */
          if (lumDark.wallTexSamplers && lumDark.wallTexSamplers.length) {
            wx = gN.x;
            wy = gN.y;
            wz = gN.z;
            ln = Math.sqrt(wx * wx + wy * wy + wz * wz);
            if (ln > 1e-10) {
              wx /= ln;
              wy /= ln;
              wz /= ln;
            }
            tL = triplanarFourTexMix(
              px,
              py,
              pz,
              wx,
              wy,
              wz,
              lumDark.wallTexWorldScale,
              lumDark.wallTexSamplers,
              lumDark.wallTexChunkPeriod
            );
            tMin = lumDark.wallTexMulMin != null ? lumDark.wallTexMulMin : 0.28;
            tMax = lumDark.wallTexMulMax != null ? lumDark.wallTexMulMax : 1;
            texMul = tMin + (tMax - tMin) * tL;
            tw = lumDark.wallTexBlend != null ? lumDark.wallTexBlend : 1;
            lum *= 1 + tw * (texMul - 1);
          }
          colors[vidx * 3] = lum;
          colors[vidx * 3 + 1] = lum;
          colors[vidx * 3 + 2] = lum;
        } else {
          lum = ad.lumBlend;
          colors[vidx * 3] = lum;
          colors[vidx * 3 + 1] = lum;
          colors[vidx * 3 + 2] = lum;
        }

        normals[vidx * 3] = gN.x;
        normals[vidx * 3 + 1] = gN.y;
        normals[vidx * 3 + 2] = gN.z;
      }
    }

    for (ti = 0; ti < triCount; ti++) {
      for (vi = 0; vi < 3; vi++) {
        vidx = ti * 3 + vi;
        nxv = normals[vidx * 3];
        nyv = normals[vidx * 3 + 1];
        nzv = normals[vidx * 3 + 2];
        anx = Math.abs(nxv);
        any = Math.abs(nyv);
        anz = Math.abs(nzv);
        px = pos[vidx * 3];
        py = pos[vidx * 3 + 1];
        pz = pos[vidx * 3 + 2];
        var invUV = 1.0 / uvScale;
        if (any >= anx && any >= anz) {
          uvs[vidx * 2] = px * invUV;
          uvs[vidx * 2 + 1] = pz * invUV;
        } else if (anx >= anz) {
          uvs[vidx * 2] = pz * invUV;
          uvs[vidx * 2 + 1] = py * invUV;
        } else {
          uvs[vidx * 2] = px * invUV;
          uvs[vidx * 2 + 1] = py * invUV;
        }
      }
    }

    var indices = new Uint32Array(vertCount);
    for (i = 0; i < vertCount; i++) indices[i] = i;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  function feetSpawnY(sdf, px, pz, yMax) {
    var y = 0.08;
    var step = 0.04;
    while (y < yMax) {
      if (sdf(px, y, pz) > 0) return y + 0.35;
      y += step;
    }
    return 1.2;
  }

  function build(rootEl, tiles, options) {
    var THREE = AFRAME.THREE;
    options = options || {};

    var seed = options.seed != null ? options.seed : 42;
    var CS = options.cellSize != null ? options.cellSize : 3;
    var WH = options.wallHeight != null ? options.wallHeight : 3.5;
    var kWall = options.smoothUnion != null ? options.smoothUnion : CS * 0.42;
    var kCap = options.smoothCap != null ? options.smoothCap : CS * 0.22;
    var nScale = options.noiseScale != null ? options.noiseScale : 0.38;
    var nOct = options.octaves != null ? options.octaves : 4;
    var uvScale = options.uvScale != null ? options.uvScale : 2;
    var surfDisp = options.surfaceDisplacement;
    var floorAmp = options.floorDisplacement;
    var wallAmp = options.wallDisplacement;
    var ceilAmp = options.ceilingDisplacement;
    if (floorAmp == null && wallAmp == null && ceilAmp == null && surfDisp == null) {
      floorAmp = 0.12;
      wallAmp = 0.35;
      ceilAmp = 0.25;
    } else if (surfDisp != null && floorAmp == null && wallAmp == null && ceilAmp == null) {
      floorAmp = surfDisp * (0.12 / 0.09);
      wallAmp = surfDisp * (0.35 / 0.09);
      ceilAmp = surfDisp * (0.25 / 0.09);
    } else {
      if (floorAmp == null) floorAmp = 0.12;
      if (wallAmp == null) wallAmp = 0.35;
      if (ceilAmp == null) ceilAmp = 0.25;
    }
    var ceilingMode = options.ceilingMode != null ? options.ceilingMode : 'flat';
    var domeAmp = options.ceilingDomeAmplitude != null ? options.ceilingDomeAmplitude : 0;
    var domeFall = options.ceilingDomeFalloff != null ? options.ceilingDomeFalloff : 1.25;
    var ceilDetAmp = options.ceilingDetailAmplitude != null ? options.ceilingDetailAmplitude : 0;
    var ceilDetScale = options.ceilingDetailScale != null ? options.ceilingDetailScale : 0.1;
    var regions = options.regions;
    var domeScope = options.ceilingDomeScope;
    if (domeScope == null) {
      domeScope = regions && regions.length ? 'rooms' : 'map';
    }
    var roomSpread = options.ceilingRoomSpread != null ? options.ceilingRoomSpread : 1.36;
    var albedoMode = options.albedoMode != null ? options.albedoMode : 'luminance';
    var grainStyleOpt = options.grainStyle;
    if (!grainStyleOpt && options.grainNeutral) grainStyleOpt = 'neutral';
    var grainStyle = grainStyleOpt || 'default';
    var matColorOpt = options.materialColor;
    var matRough = options.materialRoughness != null ? options.materialRoughness : 0.88;
    var matMetal = options.materialMetalness != null ? options.materialMetalness : 0.03;
    var cobbleDispMul = options.cobbleDisplacementMul != null ? options.cobbleDisplacementMul : 1;
    var lumDark = null;
    if (
      options.luminanceDarkBase != null &&
      options.luminanceMaxBoost != null &&
      albedoMode === 'luminance'
    ) {
      lumDark = {
        base: options.luminanceDarkBase,
        maxBoost: options.luminanceMaxBoost,
        highFreqMix: options.luminanceHighFreqMix,
        wallTexSamplers: options.wallTexSamplers && options.wallTexSamplers.length ? options.wallTexSamplers : null,
        wallTexWorldScale: options.wallTexWorldScale != null ? options.wallTexWorldScale : 5.5,
        wallTexMulMin: options.wallTexMulMin,
        wallTexMulMax: options.wallTexMulMax,
        wallTexBlend: options.wallTexBlend != null ? options.wallTexBlend : 1,
        wallTexChunkPeriod: options.wallTexChunkPeriod != null ? options.wallTexChunkPeriod : 12
      };
    }

    var H = tiles.length;
    var W = tiles[0].length;

    var worldW = W * CS;
    var worldD = H * CS;
    var ceilNoisePre = new ValueNoise((seed ^ 0xCAFE) >>> 0);
    var roomArches =
      ceilingMode === 'dome' && domeScope === 'rooms'
        ? buildRoomCeilingArches(regions, CS, domeAmp, roomSpread, domeFall)
        : [];
    var ceilingCfg = {
      mode: ceilingMode,
      worldCX: worldW * 0.5,
      worldCZ: worldD * 0.5,
      invRx: 1 / Math.max(worldW * (ceilingMode === 'dome' && !roomArches.length ? 0.38 : 0.45), 0.001),
      invRz: 1 / Math.max(worldD * (ceilingMode === 'dome' && !roomArches.length ? 0.38 : 0.45), 0.001),
      domeAmp: domeAmp,
      domeFall: domeFall,
      roomArches: roomArches,
      ceilNoise: ceilDetAmp > 0 ? ceilNoisePre : null,
      ceilDetAmp: ceilDetAmp,
      ceilDetScale: ceilDetScale
    };

    var walls = buildWallColumns(tiles, W, H, CS, WH);
    var sdf = makeSolidSdf(walls, WH, kWall, kCap, ceilingCfg);

    var pad = Math.max(kWall * 2.5, CS * 0.75);
    var minX = -pad;
    var maxX = worldW + pad;
    var minY = -pad * 0.5;
    var ceilExtra = ceilingMode === 'dome' ? domeAmp + ceilDetAmp + pad * 0.35 : 0;
    var maxY = WH + pad * 0.5 + ceilExtra;
    var minZ = -pad;
    var maxZ = worldD + pad;

    var maxSpan = Math.max(maxX - minX, maxZ - minZ, maxY - minY);
    var voxelStep = options.voxelStep != null ? options.voxelStep : Math.max(0.48, Math.min(0.72, maxSpan / 96));
    var maxAxisLimit = options.maxAxisSamples != null ? options.maxAxisSamples : 128;
    var spanH = Math.max(maxX - minX, maxZ - minZ);
    var nxTry = Math.ceil((maxX - minX) / voxelStep) + 1;
    var nzTry = Math.ceil((maxZ - minZ) / voxelStep) + 1;
    if (Math.max(nxTry, nzTry) > maxAxisLimit) {
      voxelStep = spanH / (maxAxisLimit - 1);
    }

    var nx = Math.max(3, Math.ceil((maxX - minX) / voxelStep) + 1);
    var ny = Math.max(3, Math.ceil((maxY - minY) / voxelStep) + 1);
    var nz = Math.max(3, Math.ceil((maxZ - minZ) / voxelStep) + 1);

    var field = new Float32Array(nx * ny * nz);
    var ix, iy, iz, idx, wx, wy, wz;
    idx = 0;
    for (iz = 0; iz < nz; iz++) {
      for (iy = 0; iy < ny; iy++) {
        for (ix = 0; ix < nx; ix++) {
          wx = minX + ix * voxelStep;
          wy = minY + iy * voxelStep;
          wz = minZ + iz * voxelStep;
          field[idx++] = sdf(wx, wy, wz);
        }
      }
    }

    var soup = marchField(field, nx, ny, nz, minX, minY, minZ, voxelStep, 0);
    var noise = new ValueNoise(seed);

    var geo;
    if (soup.length < 9) {
      geo = new THREE.BoxGeometry(CS * 2, 0.2, CS * 2);
    } else {
      geo = buildGeometryFromSoup(soup, sdf, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp, uvScale, THREE, albedoMode, cobbleDispMul, lumDark);
    }

    var matOpts = {
      vertexColors: true,
      flatShading: false,
      roughness: matRough,
      metalness: matMetal,
      side: THREE.FrontSide
    };
    if (grainStyle !== 'none') {
      var grainCanvas = generateGrainTexture(seed, 256, grainStyle);
      var grainTex = new THREE.CanvasTexture(grainCanvas);
      grainTex.wrapS = THREE.RepeatWrapping;
      grainTex.wrapT = THREE.RepeatWrapping;
      grainTex.magFilter = THREE.LinearFilter;
      grainTex.minFilter = THREE.LinearMipmapLinearFilter;
      grainTex.anisotropy = 4;
      grainTex.needsUpdate = true;
      matOpts.map = grainTex;
    }
    if (matColorOpt != null) {
      matOpts.color = matColorOpt instanceof THREE.Color ? matColorOpt : new THREE.Color(matColorOpt);
    }
    var mat = new THREE.MeshStandardMaterial(matOpts);

    var mesh = new THREE.Mesh(geo, mat);

    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', mesh);

    var spawnTile = null;
    var sy, sx;
    for (sy = 0; sy < H && !spawnTile; sy++) {
      for (sx = 0; sx < W && !spawnTile; sx++) {
        if (tiles[sy][sx] === 'floor') spawnTile = { x: sx, y: sy };
      }
    }
    spawnTile = spawnTile || { x: 1, y: 1 };
    var spx = (spawnTile.x + 0.5) * CS;
    var spz = (spawnTile.y + 0.5) * CS;
    var spawnYMax = WH + domeAmp + ceilDetAmp + 2;
    var spy = feetSpawnY(sdf, spx, spz, spawnYMax);

    var startMarker = document.createElement('a-box');
    startMarker.setAttribute('start', '');
    startMarker.setAttribute('position', spx + ' ' + (spy - 0.2) + ' ' + spz);
    startMarker.setAttribute('width', '0.02');
    startMarker.setAttribute('height', '0.02');
    startMarker.setAttribute('depth', '0.02');
    startMarker.setAttribute('visible', 'false');
    rootEl.appendChild(startMarker);

    return { spawnWorld: { x: spx, y: spy, z: spz } };
  }

  window.SdfBspDungeon = { build: build, createWallTexSamplersFromImages: createWallTexSamplersFromImages };
}());
