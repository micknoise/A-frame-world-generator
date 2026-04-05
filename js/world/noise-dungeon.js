/**
 * noise-dungeon.js — BSP dungeon with noise-displaced mesh surfaces
 * and a procedural greyscale stone texture that follows the surface contour.
 *
 * The stone texture is generated from the same noise field used for displacement,
 * sampled at higher frequency. UVs are triplanar-projected from world-space vertex
 * positions so the texture wraps seamlessly across floors, walls, and ceilings
 * without UV seams.
 *
 * PUBLIC API
 * ----------
 *   NoiseDungeon.build(rootEl, tiles, options) → { spawnWorld }
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

  // ── Procedural stone texture ────────────────────────────────────────────────

  /**
   * Generate a tileable greyscale stone texture on a canvas.
   * Uses the same noise algorithm at high frequency for fine-grain detail,
   * with a coarse layer for broader lumps. Result is black-to-white stone grain.
   */
  function generateStoneTexture(seed, size) {
    size = size || 512;
    var texNoise = new ValueNoise(seed ^ 0xA5A5A5);  // different seed from displacement
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(size, size);
    var data = imgData.data;

    for (var py = 0; py < size; py++) {
      for (var px = 0; px < size; px++) {
        var u = px / size;
        var v = py / size;

        // Coarse lumps — low frequency, high weight
        var coarse = texNoise.fbm(u * 4, v * 4, 3);
        // Medium grain
        var medium = texNoise.fbm(u * 12 + 50, v * 12 + 50, 4);
        // Fine grain — high frequency, low weight
        var fine = texNoise.fbm(u * 32 + 100, v * 32 + 100, 3);

        // Combine: coarse sets the broad shape, fine adds surface detail
        var val = coarse * 0.5 + medium * 0.3 + fine * 0.2;

        // Contrast stretch to use more of the 0-1 range
        val = Math.max(0, Math.min(1, (val - 0.25) * 2.0));

        // Map to greyscale range — not pure black/white, more like dark-grey to light-grey
        var grey = Math.floor(40 + val * 180);  // range 40-220

        var off = (py * size + px) * 4;
        data[off]     = grey;
        data[off + 1] = grey;
        data[off + 2] = grey;
        data[off + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ── Displaced quad builder ──────────────────────────────────────────────────

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

        var n1 = px * nScale + seedOffset;
        var n2 = pz * nScale + seedOffset;
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
   * Merge quads → BufferGeometry with smooth normals, vertex colour, AND UVs.
   * UVs are triplanar from world-space vertex positions:
   *   - Use vertex normal to decide which projection plane
   *   - Horizontal faces (|ny| dominant): UV = (x, z)
   *   - X-facing walls (|nx| dominant): UV = (z, y)
   *   - Z-facing walls (|nz| dominant): UV = (x, y)
   * uvScale controls how many world units per texture repeat.
   */
  function mergeQuadsToGeometry(quads, color, uvScale, THREE) {
    var totalVerts = 0, totalIdx = 0;
    for (var q = 0; q < quads.length; q++) {
      totalVerts += quads[q].vertCount;
      totalIdx += quads[q].indices.length;
    }

    var positions = new Float32Array(totalVerts * 3);
    var colors = new Float32Array(totalVerts * 3);
    var normals = new Float32Array(totalVerts * 3);
    var uvs = new Float32Array(totalVerts * 2);
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

    // Compute smooth vertex normals
    var i, i0, i1, i2;
    for (i = 0; i < indices.length; i += 3) {
      i0 = indices[i]; i1 = indices[i + 1]; i2 = indices[i + 2];
      var ax = positions[i1*3]-positions[i0*3], ay = positions[i1*3+1]-positions[i0*3+1], az = positions[i1*3+2]-positions[i0*3+2];
      var bx = positions[i2*3]-positions[i0*3], by = positions[i2*3+1]-positions[i0*3+1], bz = positions[i2*3+2]-positions[i0*3+2];
      var nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
      normals[i0*3]+=nx; normals[i0*3+1]+=ny; normals[i0*3+2]+=nz;
      normals[i1*3]+=nx; normals[i1*3+1]+=ny; normals[i1*3+2]+=nz;
      normals[i2*3]+=nx; normals[i2*3+1]+=ny; normals[i2*3+2]+=nz;
    }
    for (var nv = 0; nv < totalVerts; nv++) {
      var ox = normals[nv*3], oy = normals[nv*3+1], oz = normals[nv*3+2];
      var len = Math.sqrt(ox*ox + oy*oy + oz*oz) || 1;
      normals[nv*3] = ox/len; normals[nv*3+1] = oy/len; normals[nv*3+2] = oz/len;
    }

    // Triplanar UVs from final displaced world-space positions + computed normals
    var invUV = 1.0 / uvScale;
    for (var vi = 0; vi < totalVerts; vi++) {
      var px = positions[vi*3], py = positions[vi*3+1], pz = positions[vi*3+2];
      var anx = Math.abs(normals[vi*3]), any = Math.abs(normals[vi*3+1]), anz = Math.abs(normals[vi*3+2]);
      var u, v;
      if (any >= anx && any >= anz) {
        // Horizontal face (floor / ceiling) → project onto XZ
        u = px * invUV;
        v = pz * invUV;
      } else if (anx >= anz) {
        // X-facing wall → project onto ZY
        u = pz * invUV;
        v = py * invUV;
      } else {
        // Z-facing wall → project onto XY
        u = px * invUV;
        v = py * invUV;
      }
      uvs[vi * 2]     = u;
      uvs[vi * 2 + 1] = v;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  // ── Main build ──────────────────────────────────────────────────────────────

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
    var texSize  = options.textureSize != null ? options.textureSize : 512;
    var uvScale  = options.uvScale != null ? options.uvScale : 3;  // world units per texture repeat

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

        floorQuads.push(buildDisplacedQuad(
          [{x:wx,y:0,z:wz},{x:wx+CS,y:0,z:wz},{x:wx+CS,y:0,z:wz+CS},{x:wx,y:0,z:wz+CS}],
          subd, subd, 'y', 1, floorAmp, noise, nScale, nOct, 0));

        ceilingQuads.push(buildDisplacedQuad(
          [{x:wx,y:WH,z:wz+CS},{x:wx+CS,y:WH,z:wz+CS},{x:wx+CS,y:WH,z:wz},{x:wx,y:WH,z:wz}],
          subd, subd, 'y', -1, ceilAmp, noise, nScale, nOct, 100));

        if (ty === 0 || tiles[ty-1][tx] === 'wall')
          wallQuads.push(buildDisplacedQuad(
            [{x:wx+CS,y:0,z:wz},{x:wx,y:0,z:wz},{x:wx,y:WH,z:wz},{x:wx+CS,y:WH,z:wz}],
            subd, subd, 'z', 1, wallAmp, noise, nScale, nOct, 200));
        if (ty === H-1 || tiles[ty+1][tx] === 'wall')
          wallQuads.push(buildDisplacedQuad(
            [{x:wx,y:0,z:wz+CS},{x:wx+CS,y:0,z:wz+CS},{x:wx+CS,y:WH,z:wz+CS},{x:wx,y:WH,z:wz+CS}],
            subd, subd, 'z', -1, wallAmp, noise, nScale, nOct, 300));
        if (tx === 0 || tiles[ty][tx-1] === 'wall')
          wallQuads.push(buildDisplacedQuad(
            [{x:wx,y:0,z:wz},{x:wx,y:0,z:wz+CS},{x:wx,y:WH,z:wz+CS},{x:wx,y:WH,z:wz}],
            subd, subd, 'x', 1, wallAmp, noise, nScale, nOct, 400));
        if (tx === W-1 || tiles[ty][tx+1] === 'wall')
          wallQuads.push(buildDisplacedQuad(
            [{x:wx+CS,y:0,z:wz+CS},{x:wx+CS,y:0,z:wz},{x:wx+CS,y:WH,z:wz},{x:wx+CS,y:WH,z:wz+CS}],
            subd, subd, 'x', -1, wallAmp, noise, nScale, nOct, 500));
      }
    }

    // Merge with triplanar UVs
    var floorColor   = [0.45, 0.50, 0.40];
    var ceilingColor = [0.38, 0.40, 0.46];
    var wallColor    = [0.46, 0.44, 0.42];

    var floorGeo   = mergeQuadsToGeometry(floorQuads, floorColor, uvScale, THREE);
    var ceilingGeo = mergeQuadsToGeometry(ceilingQuads, ceilingColor, uvScale, THREE);
    var wallGeo    = mergeQuadsToGeometry(wallQuads, wallColor, uvScale, THREE);

    // Generate stone texture (shared across all surfaces)
    var stoneCanvas = generateStoneTexture(seed, texSize);
    var stoneTex = new THREE.CanvasTexture(stoneCanvas);
    stoneTex.wrapS = THREE.RepeatWrapping;
    stoneTex.wrapT = THREE.RepeatWrapping;
    stoneTex.magFilter = THREE.LinearFilter;
    stoneTex.minFilter = THREE.LinearMipmapLinearFilter;
    stoneTex.anisotropy = 4;
    stoneTex.needsUpdate = true;

    // Materials — vertexColors tint the greyscale map texture
    var floorMat = new THREE.MeshStandardMaterial({
      map: stoneTex, vertexColors: true, roughness: 0.92, metalness: 0.02,
      flatShading: false, side: THREE.FrontSide
    });
    var ceilingMat = new THREE.MeshStandardMaterial({
      map: stoneTex, vertexColors: true, roughness: 0.88, metalness: 0.02,
      flatShading: false, side: THREE.FrontSide
    });
    var wallMat = new THREE.MeshStandardMaterial({
      map: stoneTex, vertexColors: true, roughness: 0.85, metalness: 0.04,
      flatShading: false, side: THREE.DoubleSide
    });

    var floorMesh   = new THREE.Mesh(floorGeo, floorMat);
    var ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
    var wallMesh    = new THREE.Mesh(wallGeo, wallMat);

    // Floor under <a-entity floor=""> for a-game locomotion
    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', floorMesh);

    // Ceiling + walls: visual only
    rootEl.object3D.add(ceilingMesh);
    rootEl.object3D.add(wallMesh);

    // Spawn
    var spawnTile = null;
    for (var sy = 0; sy < H && !spawnTile; sy++) {
      for (var sx = 0; sx < W && !spawnTile; sx++) {
        if (tiles[sy][sx] === 'floor') spawnTile = { x: sx, y: sy };
      }
    }
    spawnTile = spawnTile || { x: 1, y: 1 };

    var spawnWorld = {
      x: (spawnTile.x + 0.5) * CS,
      y: 0,
      z: (spawnTile.y + 0.5) * CS
    };

    var startMarker = document.createElement('a-box');
    startMarker.setAttribute('start', '');
    startMarker.setAttribute('position', spawnWorld.x + ' 0.01 ' + spawnWorld.z);
    startMarker.setAttribute('width', '0.02');
    startMarker.setAttribute('height', '0.02');
    startMarker.setAttribute('depth', '0.02');
    startMarker.setAttribute('visible', 'false');
    rootEl.appendChild(startMarker);

    return { spawnWorld: spawnWorld };
  }

  window.NoiseDungeon = { build: build };
}());
