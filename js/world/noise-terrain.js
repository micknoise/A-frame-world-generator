/**
 * noise-terrain.js — Smooth procedural terrain mesh via layered value noise.
 *
 * Generates a single high-resolution BufferGeometry with:
 *   - fBm (fractal Brownian motion) value noise heightmap
 *   - radial island falloff
 *   - smooth vertex normals (no flat shading / no blocks)
 *   - per-vertex colour from terrain-band classification with smoothstep blending
 *   - flat transparent ocean plane at configurable water level
 *
 * Public API (attached to window):
 *   NoiseTerrain.generate(params)  → { positions, colors, normals, indices, … }
 *   NoiseTerrain.build(scene, params) → builds THREE meshes into scene.object3D
 */
(function () {
  'use strict';

  // ── Value noise ────────────────────────────────────────────────────────────

  function ValueNoise(seed) {
    this.perm   = new Uint8Array(512);
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

  // Quintic smootherstep for continuous second-derivative noise
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

  // ── Terrain colour ──────────────────────────────────────────────────────────

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function lerpCol(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t];
  }

  // Band definitions: [landFraction, [r,g,b]]
  var LAND_BANDS = [
    [0.00, [0.878, 0.788, 0.498]],  // sand
    [0.05, [0.878, 0.788, 0.498]],
    [0.10, [0.322, 0.745, 0.353]],  // grass
    [0.30, [0.322, 0.745, 0.353]],
    [0.35, [0.176, 0.541, 0.243]],  // forest
    [0.50, [0.176, 0.541, 0.243]],
    [0.55, [0.420, 0.357, 0.271]],  // hills/dirt
    [0.70, [0.420, 0.357, 0.271]],
    [0.75, [0.541, 0.541, 0.541]],  // rock
    [0.88, [0.541, 0.541, 0.541]],
    [0.92, [0.941, 0.941, 0.941]],  // snow
    [1.00, [0.941, 0.941, 0.941]]
  ];

  var DEEP_WATER    = [0.102, 0.322, 0.463];
  var SHALLOW_WATER = [0.161, 0.502, 0.725];

  function terrainColor(h, wl) {
    if (h < wl * 0.6) return DEEP_WATER;
    if (h < wl) {
      var tw = (h - wl * 0.6) / (wl * 0.4);
      return lerpCol(DEEP_WATER, SHALLOW_WATER, smoothstep(tw));
    }
    var land = (h - wl) / (1 - wl);
    for (var i = 0; i < LAND_BANDS.length - 1; i++) {
      if (land >= LAND_BANDS[i][0] && land < LAND_BANDS[i + 1][0]) {
        var t = (land - LAND_BANDS[i][0]) / (LAND_BANDS[i + 1][0] - LAND_BANDS[i][0]);
        return lerpCol(LAND_BANDS[i][1], LAND_BANDS[i + 1][1], smoothstep(t));
      }
    }
    return LAND_BANDS[LAND_BANDS.length - 1][1];
  }

  // ── Generate data ───────────────────────────────────────────────────────────

  /**
   * @param {Object} params
   * @param {number} params.seed          - integer seed
   * @param {number} params.gridSize      - vertices per side (e.g. 256)
   * @param {number} params.worldScale    - world units across (e.g. 200)
   * @param {number} params.heightScale   - max elevation in world units (e.g. 35)
   * @param {number} params.noiseScale    - noise zoom (e.g. 3)
   * @param {number} params.octaves       - fBm octaves (e.g. 6)
   * @param {number} params.waterLevel    - 0-100 percentage (e.g. 30)
   * @param {number} params.falloff       - 0-100 island radial falloff (e.g. 50)
   */
  function generate(params) {
    var seed        = params.seed || 42;
    var gridSize    = params.gridSize || 256;
    var worldScale  = params.worldScale || 200;
    var heightScale = params.heightScale || 35;
    var noiseScale  = params.noiseScale || 3;
    var octaves     = params.octaves || 6;
    var wl          = (params.waterLevel != null ? params.waterLevel : 30) / 100;
    var fo          = (params.falloff != null ? params.falloff : 50) / 100;

    var noise = new ValueNoise(seed);
    var res   = gridSize;
    var half  = worldScale / 2;
    var step  = worldScale / (res - 1);

    // Heightmap pass
    var heightmap = new Float32Array(res * res);
    var ix, iy, idx;
    for (iy = 0; iy < res; iy++) {
      for (ix = 0; ix < res; ix++) {
        var nx = ix / res * noiseScale;
        var ny = iy / res * noiseScale;
        var h = noise.fbm(nx, ny, octaves);
        if (fo > 0) {
          var cx = (ix / (res - 1)) * 2 - 1;
          var cy = (iy / (res - 1)) * 2 - 1;
          var dist = Math.sqrt(cx * cx + cy * cy);
          h *= Math.max(0, 1 - dist * dist * fo * 2);
        }
        heightmap[iy * res + ix] = h;
      }
    }

    // Vertex buffers
    var vertCount = res * res;
    var positions = new Float32Array(vertCount * 3);
    var colors    = new Float32Array(vertCount * 3);
    var normals   = new Float32Array(vertCount * 3);

    for (iy = 0; iy < res; iy++) {
      for (ix = 0; ix < res; ix++) {
        idx = iy * res + ix;
        var hv = heightmap[idx];
        var worldY = hv <= wl ? wl * heightScale * 0.3 : hv * heightScale;
        positions[idx * 3]     = ix * step - half;
        positions[idx * 3 + 1] = worldY;
        positions[idx * 3 + 2] = iy * step - half;
        var col = terrainColor(hv, wl);
        colors[idx * 3]     = col[0];
        colors[idx * 3 + 1] = col[1];
        colors[idx * 3 + 2] = col[2];
      }
    }

    // Index buffer
    var cellCount = (res - 1) * (res - 1);
    var indices = new Uint32Array(cellCount * 6);
    var ti = 0;
    for (iy = 0; iy < res - 1; iy++) {
      for (ix = 0; ix < res - 1; ix++) {
        var a = iy * res + ix;
        var b = a + 1;
        var c = a + res;
        var d = c + 1;
        indices[ti++] = a; indices[ti++] = c; indices[ti++] = b;
        indices[ti++] = b; indices[ti++] = c; indices[ti++] = d;
      }
    }

    // Smooth vertex normals (accumulate face normals then normalise)
    var i, i0, i1, i2;
    for (i = 0; i < indices.length; i += 3) {
      i0 = indices[i]; i1 = indices[i + 1]; i2 = indices[i + 2];
      var ax = positions[i1 * 3] - positions[i0 * 3];
      var ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      var az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      var bx = positions[i2 * 3] - positions[i0 * 3];
      var by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      var bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      var nnx = ay * bz - az * by;
      var nny = az * bx - ax * bz;
      var nnz = ax * by - ay * bx;
      normals[i0 * 3] += nnx; normals[i0 * 3 + 1] += nny; normals[i0 * 3 + 2] += nnz;
      normals[i1 * 3] += nnx; normals[i1 * 3 + 1] += nny; normals[i1 * 3 + 2] += nnz;
      normals[i2 * 3] += nnx; normals[i2 * 3 + 1] += nny; normals[i2 * 3 + 2] += nnz;
    }
    for (i = 0; i < vertCount; i++) {
      var ox = normals[i * 3], oy = normals[i * 3 + 1], oz = normals[i * 3 + 2];
      var len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      normals[i * 3] = ox / len; normals[i * 3 + 1] = oy / len; normals[i * 3 + 2] = oz / len;
    }

    return {
      positions: positions,
      colors: colors,
      normals: normals,
      indices: indices,
      res: res,
      worldScale: worldScale,
      heightScale: heightScale,
      waterLevelY: wl * heightScale * 0.3
    };
  }

  // ── Build into an A-Frame scene ─────────────────────────────────────────────

  function build(scene, params) {
    var THREE = AFRAME.THREE;
    var data = generate(params);

    // Terrain mesh
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));

    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false,
      side: THREE.DoubleSide
    });

    var terrainMesh = new THREE.Mesh(geo, mat);
    scene.object3D.add(terrainMesh);

    // Ocean plane
    var oceanSize = data.worldScale * 1.2;
    var oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, 1, 1);
    oceanGeo.rotateX(-Math.PI / 2);
    var oceanMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.1, 0.4, 0.7),
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    var oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.position.y = data.waterLevelY + 0.05;
    scene.object3D.add(oceanMesh);

    return data;
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  window.NoiseTerrain = {
    generate: generate,
    build: build
  };

}());
