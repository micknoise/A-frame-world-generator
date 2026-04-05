/**
 * noise-terrain.js — Smooth procedural terrain mesh via layered value noise.
 *
 * The mesh is vertically shifted so that the chosen spawn point sits at Y ≈ 0,
 * matching a-game's expectation that floors are near the scene origin.
 * Ocean plane is shifted by the same amount.
 *
 * Public API:
 *   NoiseTerrain.generate(params) → data object
 *   NoiseTerrain.build(rootEl, params) → data object
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
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  var LAND_BANDS = [
    [0.00, [0.878, 0.788, 0.498]], [0.05, [0.878, 0.788, 0.498]],
    [0.10, [0.322, 0.745, 0.353]], [0.30, [0.322, 0.745, 0.353]],
    [0.35, [0.176, 0.541, 0.243]], [0.50, [0.176, 0.541, 0.243]],
    [0.55, [0.420, 0.357, 0.271]], [0.70, [0.420, 0.357, 0.271]],
    [0.75, [0.541, 0.541, 0.541]], [0.88, [0.541, 0.541, 0.541]],
    [0.92, [0.941, 0.941, 0.941]], [1.00, [0.941, 0.941, 0.941]]
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

  // ── Generate ────────────────────────────────────────────────────────────────

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

    // 1. Heightmap pass — values in [0, 1]
    var heightmap = new Float32Array(res * res);
    var ix, iy;
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

    // 2. Find spawn point BEFORE building vertices (need its height to shift mesh)
    var bestSpawn = null;
    var bestHeight = -Infinity;
    var searchR = Math.floor(res * 0.15);
    var midIx = Math.floor(res / 2);
    var midIy = Math.floor(res / 2);

    for (iy = midIy - searchR; iy <= midIy + searchR; iy++) {
      for (ix = midIx - searchR; ix <= midIx + searchR; ix++) {
        if (ix < 0 || ix >= res || iy < 0 || iy >= res) continue;
        var hVal = heightmap[iy * res + ix];
        var landFrac = wl < 1 ? (hVal - wl) / (1 - wl) : 0;
        if (hVal > wl && landFrac >= 0.05 && landFrac <= 0.35) {
          if (hVal > bestHeight) {
            bestHeight = hVal;
            bestSpawn = { ix: ix, iy: iy };
          }
        }
      }
    }
    if (!bestSpawn) {
      for (iy = midIy - searchR; iy <= midIy + searchR; iy++) {
        for (ix = midIx - searchR; ix <= midIx + searchR; ix++) {
          if (ix < 0 || ix >= res || iy < 0 || iy >= res) continue;
          var hVal2 = heightmap[iy * res + ix];
          if (hVal2 > wl && hVal2 > bestHeight) {
            bestHeight = hVal2;
            bestSpawn = { ix: ix, iy: iy };
          }
        }
      }
    }
    if (!bestSpawn) {
      bestSpawn = { ix: midIx, iy: midIy };
      bestHeight = heightmap[midIy * res + midIx];
    }

    // The Y offset: shift the entire mesh down so the spawn surface is at Y=0.
    // This way the player spawns at Y=0, feet on the ground, matching a-game's
    // convention where floors are near Y=0.
    var yOffset = bestHeight * heightScale;

    // 3. Vertex buffers — apply yOffset so spawn surface ≈ Y=0
    var vertCount = res * res;
    var positions = new Float32Array(vertCount * 3);
    var colors    = new Float32Array(vertCount * 3);
    var normals   = new Float32Array(vertCount * 3);
    var idx;

    for (iy = 0; iy < res; iy++) {
      for (ix = 0; ix < res; ix++) {
        idx = iy * res + ix;
        var hv = heightmap[idx];
        positions[idx * 3]     = ix * step - half;
        positions[idx * 3 + 1] = hv * heightScale - yOffset;  // spawn surface → Y=0
        positions[idx * 3 + 2] = iy * step - half;
        var col = terrainColor(hv, wl);
        colors[idx * 3]     = col[0];
        colors[idx * 3 + 1] = col[1];
        colors[idx * 3 + 2] = col[2];
      }
    }

    // 4. Index buffer
    var cellCount = (res - 1) * (res - 1);
    var indices = new Uint32Array(cellCount * 6);
    var ti = 0;
    for (iy = 0; iy < res - 1; iy++) {
      for (ix = 0; ix < res - 1; ix++) {
        var a = iy * res + ix, b = a + 1, c = a + res, d = c + 1;
        indices[ti++] = a; indices[ti++] = c; indices[ti++] = b;
        indices[ti++] = b; indices[ti++] = c; indices[ti++] = d;
      }
    }

    // 5. Smooth vertex normals
    var i, i0, i1, i2;
    for (i = 0; i < indices.length; i += 3) {
      i0 = indices[i]; i1 = indices[i + 1]; i2 = indices[i + 2];
      var ax = positions[i1*3]-positions[i0*3], ay = positions[i1*3+1]-positions[i0*3+1], az = positions[i1*3+2]-positions[i0*3+2];
      var bx = positions[i2*3]-positions[i0*3], by = positions[i2*3+1]-positions[i0*3+1], bz = positions[i2*3+2]-positions[i0*3+2];
      var nnx = ay*bz - az*by, nny = az*bx - ax*bz, nnz = ax*by - ay*bx;
      normals[i0*3]+=nnx; normals[i0*3+1]+=nny; normals[i0*3+2]+=nnz;
      normals[i1*3]+=nnx; normals[i1*3+1]+=nny; normals[i1*3+2]+=nnz;
      normals[i2*3]+=nnx; normals[i2*3+1]+=nny; normals[i2*3+2]+=nnz;
    }
    for (i = 0; i < vertCount; i++) {
      var ox = normals[i*3], oy = normals[i*3+1], oz = normals[i*3+2];
      var len = Math.sqrt(ox*ox + oy*oy + oz*oz) || 1;
      normals[i*3] = ox/len; normals[i*3+1] = oy/len; normals[i*3+2] = oz/len;
    }

    var wlY = wl * heightScale - yOffset;  // ocean also shifted

    return {
      positions: positions,
      colors: colors,
      normals: normals,
      indices: indices,
      res: res,
      worldScale: worldScale,
      heightScale: heightScale,
      waterLevelY: wlY,
      spawnWorld: {
        x: bestSpawn.ix * step - half,
        y: 0,   // spawn surface IS Y=0 now
        z: bestSpawn.iy * step - half
      }
    };
  }

  // ── Build into A-Frame ──────────────────────────────────────────────────────

  function build(rootEl, params) {
    var THREE = AFRAME.THREE;
    var data = generate(params);

    // Clean up previous
    rootEl.object3D.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        if (obj.material.dispose) obj.material.dispose();
      }
    });
    while (rootEl.lastChild) rootEl.removeChild(rootEl.lastChild);
    while (rootEl.object3D.children.length) rootEl.object3D.remove(rootEl.object3D.children[0]);

    // Terrain mesh under <a-entity floor="">
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));

    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0.05,
      flatShading: false, side: THREE.FrontSide
    });

    var terrainMesh = new THREE.Mesh(geo, mat);
    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', terrainMesh);

    // Ocean plane
    var oceanSize = data.worldScale * 1.2;
    var oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, 1, 1);
    oceanGeo.rotateX(-Math.PI / 2);
    var oceanMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.1, 0.4, 0.7),
      roughness: 0.3, metalness: 0.1,
      transparent: true, opacity: 0.8, side: THREE.DoubleSide
    });
    var oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.position.y = data.waterLevelY + 0.03;
    rootEl.object3D.add(oceanMesh);

    return data;
  }

  window.NoiseTerrain = { generate: generate, build: build };
}());
