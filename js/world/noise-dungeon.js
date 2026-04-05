/**
 * noise-dungeon.js — BSP dungeon with noise-displaced mesh surfaces.
 *
 * Takes a BSP tile grid (floor / wall) and builds continuous BufferGeometry
 * meshes with layered value-noise displacement applied to vertices:
 *   - Floors: gently undulating but navigable (low-amplitude noise)
 *   - Walls: bulge and recede like natural rock (high-amplitude noise)
 *   - Ceilings: sag and rise (medium-amplitude noise)
 *
 * Integration with a-game locomotion:
 *   The floor mesh is placed under an <a-entity floor=""> so a-game's locomotion
 *   raycaster targets it.  Walls + ceilings are pure THREE.Mesh children of
 *   world-root — they are visual only and do not interact with physics.
 *
 * PUBLIC API
 * ----------
 *   NoiseDungeon.build(rootEl, tiles, options)
 *     rootEl  — DOM element (e.g. #world-root) under an <a-scene>
 *     tiles   — string[][] row-major from generateBspDungeon
 *     options — { seed, cellSize, wallHeight, noiseScale, octaves,
 *                 floorDisplacement, wallDisplacement, ceilingDisplacement,
 *                 subdivisions }
 *     returns — { spawnWorld }
 */
(function () {
  'use strict';

  // ── Value noise ─────────────────────────────────────────────────────────────

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

  // ── Displaced quad builder ──────────────────────────────────────────────────

  /**
   * Build a subdivided quad between four corners, displaced by noise.
   *   corners: [v0, v1, v2, v3] — CCW winding.
   *   subdU, subdV: subdivisions per edge.
   *   displaceAxis: 'x' | 'y' | 'z'.
   *   displaceSign: +1 or -1.
   *   amplitude: max world-unit displacement.
   *   noise, nScale, nOctaves, seedOffset: noise sampling.
   */
  function buildDisplacedQuad(corners, subdU, subdV, displaceAxis, displaceSign,
                              amplitude, noise, nScale, nOctaves, seedOffset) {
    var c0 = corners[0], c1 = corners[1], c2 = corners[2], c3 = corners[3];
    var vertsU = subdU + 1;
    var vertsV = subdV + 1;
    var vertCount = vertsU * vertsV;
    var positions = new Float32Array(vertCount * 3);
    var idx = 0;

    for (var iv = 0; iv <= subdV; iv++) {
      var tv = iv / subdV;
      var e0x = c0.x + (c3.x - c0.x) * tv;
      var e0y = c0.y + (c3.y - c0.y) * tv;
      var e0z = c0.z + (c3.z - c0.z) * tv;
      var e1x = c1.x + (c2.x - c1.x) * tv;
      var e1y = c1.y + (c2.y - c1.y) * tv;
      var e1z = c1.z + (c2.z - c1.z) * tv;
      for (var iu = 0; iu <= subdU; iu++) {
        var tu = iu / subdU;
        var px = e0x + (e1x - e0x) * tu;
        var py = e0y + (e1y - e0y) * tu;
        var pz = e0z + (e1z - e0z) * tu;

        // World-space noise coords for seamless tiling across adjacent quads
        var n1 = px * nScale + seedOffset;
        var n2 = pz * nScale + seedOffset;
        // For vertical walls, mix in Y instead of Z
        if (displaceAxis === 'x' || displaceAxis === 'z') {
          n2 = py * nScale + seedOffset * 1.3;
        }
        var disp = (noise.fbm(n1, n2, nOctaves) - 0.5) * 2 * amplitude;

        if (displaceAxis === 'x') px += disp * displaceSign;
        else if (displaceAxis === 'y') py += disp * displaceSign;
        else pz += disp * displaceSign;

        positions[idx++] = px;
        positions[idx++] = py;
        positions[idx++] = pz;
      }
    }

    var triCount = subdU * subdV * 2;
    var indices = new Uint32Array(triCount * 3);
    var ti = 0;
    for (var jv = 0; jv < subdV; jv++) {
      for (var ju = 0; ju < subdU; ju++) {
        var a = jv * vertsU + ju;
        var b = a + 1;
        var c = a + vertsU;
        var d = c + 1;
        indices[ti++] = a; indices[ti++] = c; indices[ti++] = b;
        indices[ti++] = b; indices[ti++] = c; indices[ti++] = d;
      }
    }

    return { positions: positions, indices: indices, vertCount: vertCount };
  }

  /**
   * Merge quad arrays into one BufferGeometry with smooth normals + vertex colour.
   */
  function mergeQuadsToGeometry(quads, color, THREE) {
    var totalVerts = 0, totalIdx = 0;
    for (var q = 0; q < quads.length; q++) {
      totalVerts += quads[q].vertCount;
      totalIdx += quads[q].indices.length;
    }

    var positions = new Float32Array(totalVerts * 3);
    var colors = new Float32Array(totalVerts * 3);
    var normals = new Float32Array(totalVerts * 3);
    var indices = new Uint32Array(totalIdx);

    var vOff = 0, iOff = 0, vBase = 0;
    for (q = 0; q < quads.length; q++) {
      positions.set(quads[q].positions, vOff * 3);
      for (var cv = 0; cv < quads[q].vertCount; cv++) {
        colors[(vOff + cv) * 3]     = color[0];
        colors[(vOff + cv) * 3 + 1] = color[1];
        colors[(vOff + cv) * 3 + 2] = color[2];
      }
      for (var ii = 0; ii < quads[q].indices.length; ii++) {
        indices[iOff + ii] = quads[q].indices[ii] + vBase;
      }
      vBase += quads[q].vertCount;
      vOff += quads[q].vertCount;
      iOff += quads[q].indices.length;
    }

    // Smooth vertex normals
    for (var i = 0; i < indices.length; i += 3) {
      var i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
      var ax = positions[i1 * 3] - positions[i0 * 3];
      var ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      var az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      var bx = positions[i2 * 3] - positions[i0 * 3];
      var by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      var bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      var nx = ay * bz - az * by;
      var ny = az * bx - ax * bz;
      var nz = ax * by - ay * bx;
      normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
      normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
      normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
    }
    for (var nv = 0; nv < totalVerts; nv++) {
      var ox = normals[nv * 3], oy = normals[nv * 3 + 1], oz = normals[nv * 3 + 2];
      var len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      normals[nv * 3] = ox / len; normals[nv * 3 + 1] = oy / len; normals[nv * 3 + 2] = oz / len;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  // ── Main build ──────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} rootEl — DOM element under <a-scene> (e.g. #world-root)
   * @param {string[][]} tiles — row-major: tiles[y][x] ∈ 'floor' | 'wall'
   * @param {Object} [options]
   */
  function build(rootEl, tiles, options) {
    var THREE = AFRAME.THREE;
    options = options || {};

    var seed     = options.seed != null ? options.seed : 42;
    var CS       = options.cellSize != null ? options.cellSize : 3;
    var WH       = options.wallHeight != null ? options.wallHeight : 3.5;
    var nScale   = options.noiseScale != null ? options.noiseScale : 0.4;
    var nOct     = options.octaves != null ? options.octaves : 4;
    var floorAmp = options.floorDisplacement != null ? options.floorDisplacement : 0.12;
    var wallAmp  = options.wallDisplacement != null ? options.wallDisplacement : 0.35;
    var ceilAmp  = options.ceilingDisplacement != null ? options.ceilingDisplacement : 0.25;
    var subd     = options.subdivisions != null ? options.subdivisions : 6;

    var H = tiles.length;
    var W = tiles[0].length;
    var noise = new ValueNoise(seed);

    var floorQuads = [];
    var ceilingQuads = [];
    var wallQuads = [];

    for (var ty = 0; ty < H; ty++) {
      for (var tx = 0; tx < W; tx++) {
        if (tiles[ty][tx] !== 'floor') continue;

        var wx = tx * CS;
        var wz = ty * CS;

        // Floor quad — displaced upward gently
        floorQuads.push(buildDisplacedQuad(
          [
            { x: wx,      y: 0, z: wz },
            { x: wx + CS, y: 0, z: wz },
            { x: wx + CS, y: 0, z: wz + CS },
            { x: wx,      y: 0, z: wz + CS }
          ],
          subd, subd, 'y', 1,
          floorAmp, noise, nScale, nOct, 0
        ));

        // Ceiling quad — displaced downward
        ceilingQuads.push(buildDisplacedQuad(
          [
            { x: wx,      y: WH, z: wz + CS },
            { x: wx + CS, y: WH, z: wz + CS },
            { x: wx + CS, y: WH, z: wz },
            { x: wx,      y: WH, z: wz }
          ],
          subd, subd, 'y', -1,
          ceilAmp, noise, nScale, nOct, 100
        ));

        // Wall quads — only where neighbor is wall or edge
        if (ty === 0 || tiles[ty - 1][tx] === 'wall') {
          wallQuads.push(buildDisplacedQuad(
            [
              { x: wx + CS, y: 0,  z: wz },
              { x: wx,      y: 0,  z: wz },
              { x: wx,      y: WH, z: wz },
              { x: wx + CS, y: WH, z: wz }
            ],
            subd, subd, 'z', 1,
            wallAmp, noise, nScale, nOct, 200
          ));
        }
        if (ty === H - 1 || tiles[ty + 1][tx] === 'wall') {
          wallQuads.push(buildDisplacedQuad(
            [
              { x: wx,      y: 0,  z: wz + CS },
              { x: wx + CS, y: 0,  z: wz + CS },
              { x: wx + CS, y: WH, z: wz + CS },
              { x: wx,      y: WH, z: wz + CS }
            ],
            subd, subd, 'z', -1,
            wallAmp, noise, nScale, nOct, 300
          ));
        }
        if (tx === 0 || tiles[ty][tx - 1] === 'wall') {
          wallQuads.push(buildDisplacedQuad(
            [
              { x: wx, y: 0,  z: wz },
              { x: wx, y: 0,  z: wz + CS },
              { x: wx, y: WH, z: wz + CS },
              { x: wx, y: WH, z: wz }
            ],
            subd, subd, 'x', 1,
            wallAmp, noise, nScale, nOct, 400
          ));
        }
        if (tx === W - 1 || tiles[ty][tx + 1] === 'wall') {
          wallQuads.push(buildDisplacedQuad(
            [
              { x: wx + CS, y: 0,  z: wz + CS },
              { x: wx + CS, y: 0,  z: wz },
              { x: wx + CS, y: WH, z: wz },
              { x: wx + CS, y: WH, z: wz + CS }
            ],
            subd, subd, 'x', -1,
            wallAmp, noise, nScale, nOct, 500
          ));
        }
      }
    }

    // Merge into THREE geometries
    var floorColor   = [0.36, 0.42, 0.32];  // dark mossy stone
    var ceilingColor = [0.30, 0.32, 0.38];  // cool grey-blue stone
    var wallColor    = [0.38, 0.36, 0.34];  // warm grey rock

    var floorGeo   = mergeQuadsToGeometry(floorQuads, floorColor, THREE);
    var ceilingGeo = mergeQuadsToGeometry(ceilingQuads, ceilingColor, THREE);
    var wallGeo    = mergeQuadsToGeometry(wallQuads, wallColor, THREE);

    var stdMatParams = { vertexColors: true, flatShading: false };

    var floorMat = new THREE.MeshStandardMaterial(
      Object.assign({}, stdMatParams, { roughness: 0.92, metalness: 0.02, side: THREE.FrontSide }));
    var ceilingMat = new THREE.MeshStandardMaterial(
      Object.assign({}, stdMatParams, { roughness: 0.88, metalness: 0.02, side: THREE.FrontSide }));
    var wallMat = new THREE.MeshStandardMaterial(
      Object.assign({}, stdMatParams, { roughness: 0.85, metalness: 0.04, side: THREE.DoubleSide }));

    var floorMesh   = new THREE.Mesh(floorGeo, floorMat);
    var ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
    var wallMesh    = new THREE.Mesh(wallGeo, wallMat);

    // ── a-game locomotion integration ─────────────────────────────────────────
    //
    // a-game's locomotion raycasts downward against entities that have the
    // [floor] attribute. We create an <a-entity floor=""> and attach the
    // floor mesh to it so the raycast hits the actual displaced surface.
    //
    // Walls + ceiling are visual only — added as raw THREE children of rootEl.

    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', floorMesh);

    // Ceiling + walls: purely visual THREE meshes
    rootEl.object3D.add(ceilingMesh);
    rootEl.object3D.add(wallMesh);

    // ── Spawn point ───────────────────────────────────────────────────────────

    var spawnTile = null;
    for (var sy = 0; sy < H && !spawnTile; sy++) {
      for (var sx = 0; sx < W && !spawnTile; sx++) {
        if (tiles[sy][sx] === 'floor') spawnTile = { x: sx, y: sy };
      }
    }
    spawnTile = spawnTile || { x: 1, y: 1 };

    // a-game rig sits at y=0 and adds 1.6 for eye height; the floor mesh is
    // displaced slightly above y=0, so spawning at y=0 is safe.
    var spawnWorld = {
      x: (spawnTile.x + 0.5) * CS,
      y: 0,
      z: (spawnTile.y + 0.5) * CS
    };

    // Also place an invisible <a-box start> marker (some a-game helpers use it)
    var startMarker = document.createElement('a-box');
    startMarker.setAttribute('start', '');
    startMarker.setAttribute('position',
      spawnWorld.x + ' 0.01 ' + spawnWorld.z);
    startMarker.setAttribute('width', '0.02');
    startMarker.setAttribute('height', '0.02');
    startMarker.setAttribute('depth', '0.02');
    startMarker.setAttribute('visible', 'false');
    rootEl.appendChild(startMarker);

    return { spawnWorld: spawnWorld };
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  window.NoiseDungeon = { build: build };

}());
