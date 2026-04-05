/**
 * sdf-bsp-dungeon.js — BSP tile grid → smooth solid (smin union of wall columns +
 * ground/ceiling half-spaces) → marching cubes mesh → value-noise displacement
 * and luminance vertex colours (same idea as noise-dungeon / noise-terrain shading).
 *
 * Does not modify noise-dungeon.js or the world-noise-dungeon example.
 *
 * PUBLIC API
 * ----------
 *   SdfBspDungeon.build(rootEl, tiles, options) → { spawnWorld }
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

  function generateGrainTexture(seed, size) {
    size = size || 256;
    var grainNoise = new ValueNoise(seed ^ 0xBEEF);
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(size, size);
    var data = imgData.data;
    var py, px, u, v, grain, grey, off;
    for (py = 0; py < size; py++) {
      for (px = 0; px < size; px++) {
        u = px / size;
        v = py / size;
        grain = grainNoise.fbm(u * 24, v * 24, 3);
        grey = Math.floor(200 + grain * 55);
        grey = Math.max(180, Math.min(255, grey));
        off = (py * size + px) * 4;
        data[off] = grey; data[off + 1] = grey; data[off + 2] = grey; data[off + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ── Wall list + SDF closure ─────────────────────────────────────────────────

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

  function makeSolidSdf(walls, WH, kWall, kCap) {
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
      d = smin(d, WH - py, kCap);
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
            for (i = 0; i < 3; i++) {
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

  function buildGeometryFromSoup(positions, sdf, noise, nScale, nOct, dispAmp, uvScale, THREE) {
    var triCount = positions.length / 9;
    var vertCount = triCount * 3;
    var pos = new Float32Array(vertCount * 3);
    var colors = new Float32Array(vertCount * 3);
    var normals = new Float32Array(vertCount * 3);
    var uvs = new Float32Array(vertCount * 2);
    var eps = 0.06;
    var ti, vi, vidx, i, base, px, py, pz, g, lum, disp, n1, n2, nxv, nyv, nzv, anx, any, anz;

    for (ti = 0; ti < triCount; ti++) {
      base = ti * 9;
      for (vi = 0; vi < 3; vi++) {
        vidx = ti * 3 + vi;
        px = positions[base + vi * 3];
        py = positions[base + vi * 3 + 1];
        pz = positions[base + vi * 3 + 2];

        g = sdfGradient(sdf, px, py, pz, eps);
        n1 = noise.fbm(px * nScale + 17, pz * nScale + 23, nOct);
        n2 = noise.fbm(py * nScale * 1.1 + 41, px * nScale + 11, nOct);
        lum = (n1 + n2) * 0.5;
        disp = (lum - 0.5) * 2 * dispAmp;

        px += g.x * disp;
        py += g.y * disp;
        pz += g.z * disp;

        pos[vidx * 3] = px;
        pos[vidx * 3 + 1] = py;
        pos[vidx * 3 + 2] = pz;

        colors[vidx * 3] = lum;
        colors[vidx * 3 + 1] = lum;
        colors[vidx * 3 + 2] = lum;

        g = sdfGradient(sdf, px, py, pz, eps);
        normals[vidx * 3] = g.x;
        normals[vidx * 3 + 1] = g.y;
        normals[vidx * 3 + 2] = g.z;
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

  function feetSpawnY(sdf, px, pz, WH) {
    var y = 0.08;
    var step = 0.04;
    while (y < WH + 0.5) {
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
    var dispAmp = options.surfaceDisplacement != null ? options.surfaceDisplacement : 0.09;
    var uvScale = options.uvScale != null ? options.uvScale : 2;

    var H = tiles.length;
    var W = tiles[0].length;

    var walls = buildWallColumns(tiles, W, H, CS, WH);
    var sdf = makeSolidSdf(walls, WH, kWall, kCap);

    var pad = Math.max(kWall * 2.5, CS * 0.75);
    var minX = -pad;
    var maxX = W * CS + pad;
    var minY = -pad * 0.5;
    var maxY = WH + pad * 0.5;
    var minZ = -pad;
    var maxZ = H * CS + pad;

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
      geo = buildGeometryFromSoup(soup, sdf, noise, nScale, nOct, dispAmp, uvScale, THREE);
    }

    var grainCanvas = generateGrainTexture(seed, 256);
    var grainTex = new THREE.CanvasTexture(grainCanvas);
    grainTex.wrapS = THREE.RepeatWrapping;
    grainTex.wrapT = THREE.RepeatWrapping;
    grainTex.magFilter = THREE.LinearFilter;
    grainTex.minFilter = THREE.LinearMipmapLinearFilter;
    grainTex.anisotropy = 4;
    grainTex.needsUpdate = true;

    var mat = new THREE.MeshStandardMaterial({
      map: grainTex,
      vertexColors: true,
      flatShading: false,
      roughness: 0.88,
      metalness: 0.03,
      side: THREE.FrontSide
    });

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
    var spy = feetSpawnY(sdf, spx, spz, WH);

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

  window.SdfBspDungeon = { build: build };
}());
