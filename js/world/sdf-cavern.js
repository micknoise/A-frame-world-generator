/**
 * sdf-cavern.js — Procedural cavern from sphere + tube meshes with domain warp.
 *
 * BSP rooms → deformed spheres, corridors → deformed tubes.
 * All vertices are warped with low-frequency noise for organic shapes.
 * Meshes are merged into a single watertight BufferGeometry.
 * Normals face inward so the player sees the cave interior.
 *
 * No marching cubes, no lookup tables — just standard THREE.js geometry.
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

  // ── Geometry builders ───────────────────────────────────────────────────────

  /**
   * Create a UV sphere (positions + indices) centred at (cx,cy,cz)
   * with radii (rx,ry,rz). Normals face INWARD.
   */
  function createEllipsoidGeometry(cx, cy, cz, rx, ry, rz, segW, segH) {
    var positions = [];
    var indices = [];
    var vertCount = (segW + 1) * (segH + 1);

    for (var iy = 0; iy <= segH; iy++) {
      var v = iy / segH;
      var phi = v * Math.PI; // 0 to PI
      for (var ix = 0; ix <= segW; ix++) {
        var u = ix / segW;
        var theta = u * 2 * Math.PI; // 0 to 2PI
        var sinPhi = Math.sin(phi);
        var cosPhi = Math.cos(phi);
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);

        positions.push(
          cx + rx * sinPhi * cosTheta,
          cy + ry * cosPhi,
          cz + rz * sinPhi * sinTheta
        );
      }
    }

    for (iy = 0; iy < segH; iy++) {
      for (ix = 0; ix < segW; ix++) {
        var a = iy * (segW + 1) + ix;
        var b = a + 1;
        var c = a + (segW + 1);
        var d = c + 1;
        // Reversed winding → normals face inward
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    return { positions: new Float32Array(positions), indices: indices, vertCount: vertCount };
  }

  /**
   * Create a tube (cylinder without caps) along an L-shaped path from A to B.
   * The L goes: A → corner (bx, midY, az) → B.
   * Two tube segments, each a cylinder. Normals face inward.
   */
  function createTubeSegment(ax, ay, az, bx, by, bz, radius, segAround, segAlong) {
    var positions = [];
    var indices = [];
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return { positions: new Float32Array(0), indices: [], vertCount: 0 };

    // Build a local coordinate frame along the tube axis
    var axisX = dx / len, axisY = dy / len, axisZ = dz / len;
    // Find a perpendicular vector
    var upX = 0, upY = 1, upZ = 0;
    if (Math.abs(axisY) > 0.9) { upX = 1; upY = 0; upZ = 0; }
    // Cross product: right = axis × up
    var rightX = axisY * upZ - axisZ * upY;
    var rightY = axisZ * upX - axisX * upZ;
    var rightZ = axisX * upY - axisY * upX;
    var rLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
    rightX /= rLen; rightY /= rLen; rightZ /= rLen;
    // Recompute up = right × axis
    upX = rightY * axisZ - rightZ * axisY;
    upY = rightZ * axisX - rightX * axisZ;
    upZ = rightX * axisY - rightY * axisX;

    for (var ia = 0; ia <= segAlong; ia++) {
      var t = ia / segAlong;
      var px = ax + dx * t;
      var py = ay + dy * t;
      var pz = az + dz * t;
      for (var ic = 0; ic <= segAround; ic++) {
        var angle = (ic / segAround) * 2 * Math.PI;
        var cosA = Math.cos(angle), sinA = Math.sin(angle);
        positions.push(
          px + radius * (cosA * rightX + sinA * upX),
          py + radius * (cosA * rightY + sinA * upY),
          pz + radius * (cosA * rightZ + sinA * upZ)
        );
      }
    }

    var vertsPerRing = segAround + 1;
    for (ia = 0; ia < segAlong; ia++) {
      for (ic = 0; ic < segAround; ic++) {
        var a = ia * vertsPerRing + ic;
        var b = a + 1;
        var c = a + vertsPerRing;
        var d = c + 1;
        // Reversed winding → normals face inward
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    return {
      positions: new Float32Array(positions),
      indices: indices,
      vertCount: (segAlong + 1) * vertsPerRing
    };
  }

  /**
   * Merge multiple geometry chunks into one, apply domain warp to all positions,
   * compute smooth normals, vertex colour (noise luminance), and triplanar UVs.
   */
  function mergeAndWarp(chunks, noise, warpScale, warpAmp, THREE) {
    // Count totals
    var totalVerts = 0, totalIdx = 0;
    for (var ci = 0; ci < chunks.length; ci++) {
      totalVerts += chunks[ci].vertCount;
      totalIdx += chunks[ci].indices.length;
    }

    var positions = new Float32Array(totalVerts * 3);
    var indices = new Uint32Array(totalIdx);
    var vOff = 0, iOff = 0, vBase = 0;

    for (ci = 0; ci < chunks.length; ci++) {
      var ch = chunks[ci];
      if (ch.vertCount === 0) continue;
      positions.set(ch.positions, vOff * 3);
      for (var ii = 0; ii < ch.indices.length; ii++) {
        indices[iOff + ii] = ch.indices[ii] + vBase;
      }
      vBase += ch.vertCount;
      vOff += ch.vertCount;
      iOff += ch.indices.length;
    }

    // Domain warp all vertex positions
    for (var vi = 0; vi < totalVerts; vi++) {
      var px = positions[vi * 3], py = positions[vi * 3 + 1], pz = positions[vi * 3 + 2];
      var wx = (noise.fbm3D(px * warpScale, py * warpScale, pz * warpScale, 3) - 0.5) * 2 * warpAmp;
      var wy = (noise.fbm3D(px * warpScale + 50, py * warpScale + 50, pz * warpScale + 50, 3) - 0.5) * 2 * warpAmp * 0.3;
      var wz = (noise.fbm3D(px * warpScale + 100, py * warpScale + 100, pz * warpScale + 100, 3) - 0.5) * 2 * warpAmp;
      positions[vi * 3] += wx;
      positions[vi * 3 + 1] += wy;
      positions[vi * 3 + 2] += wz;
    }

    // Smooth normals
    var normals = new Float32Array(totalVerts * 3);
    for (var i = 0; i < indices.length; i += 3) {
      var i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
      var ax = positions[i1*3]-positions[i0*3], ay = positions[i1*3+1]-positions[i0*3+1], az = positions[i1*3+2]-positions[i0*3+2];
      var bx = positions[i2*3]-positions[i0*3], by = positions[i2*3+1]-positions[i0*3+1], bz = positions[i2*3+2]-positions[i0*3+2];
      var nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx;
      normals[i0*3]+=nx; normals[i0*3+1]+=ny; normals[i0*3+2]+=nz;
      normals[i1*3]+=nx; normals[i1*3+1]+=ny; normals[i1*3+2]+=nz;
      normals[i2*3]+=nx; normals[i2*3+1]+=ny; normals[i2*3+2]+=nz;
    }
    for (vi = 0; vi < totalVerts; vi++) {
      var ox = normals[vi*3], oy = normals[vi*3+1], oz = normals[vi*3+2];
      var len = Math.sqrt(ox*ox+oy*oy+oz*oz) || 1;
      normals[vi*3]=ox/len; normals[vi*3+1]=oy/len; normals[vi*3+2]=oz/len;
    }

    // Vertex colour = noise luminance; triplanar UVs
    var colors = new Float32Array(totalVerts * 3);
    var uvs = new Float32Array(totalVerts * 2);
    var invUV = 0.5;
    for (vi = 0; vi < totalVerts; vi++) {
      var vpx = positions[vi*3], vpy = positions[vi*3+1], vpz = positions[vi*3+2];
      var detail = noise.fbm3D(vpx * 0.8, vpy * 0.8, vpz * 0.8, 3);
      var lum = Math.max(0.1, Math.min(0.9, detail));
      colors[vi*3] = lum; colors[vi*3+1] = lum; colors[vi*3+2] = lum;

      var anx = Math.abs(normals[vi*3]), any = Math.abs(normals[vi*3+1]), anz = Math.abs(normals[vi*3+2]);
      if (any >= anx && any >= anz) { uvs[vi*2] = vpx*invUV; uvs[vi*2+1] = vpz*invUV; }
      else if (anx >= anz) { uvs[vi*2] = vpz*invUV; uvs[vi*2+1] = vpy*invUV; }
      else { uvs[vi*2] = vpx*invUV; uvs[vi*2+1] = vpy*invUV; }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  // ── Grain texture ───────────────────────────────────────────────────────────

  function generateGrainTexture(seed, size) {
    var gn = new ValueNoise(seed ^ 0xBEEF);
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var id = ctx.createImageData(size, size);
    var d = id.data;
    for (var py = 0; py < size; py++) {
      for (var px = 0; px < size; px++) {
        var g = gn.fbm3D(px / size * 24, py / size * 24, 0.5, 3);
        var grey = Math.floor(200 + g * 55);
        grey = Math.max(180, Math.min(255, grey));
        var off = (py * size + px) * 4;
        d[off] = grey; d[off+1] = grey; d[off+2] = grey; d[off+3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
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
    var corrRadius = options.corridorRadius != null ? options.corridorRadius : 1.8;
    var sphereSegs = options.sphereSegments != null ? options.sphereSegments : 16;
    var tubeSegs   = options.tubeSegments != null ? options.tubeSegments : 8;

    var regions = bsp.regions;
    var nodes = bsp.nodes;
    var W = bsp.width;
    var H = bsp.height;
    var noise = new ValueNoise(seed);

    var chunks = [];

    // Rooms → ellipsoid meshes
    var ellipsoids = [];
    for (var ri = 0; ri < regions.length; ri++) {
      var r = regions[ri];
      var cx = (r.x + r.width / 2) * CS;
      var cy = WH / 2;
      var cz = (r.y + r.height / 2) * CS;
      var rx = (r.width / 2) * CS * 0.85;
      var ry = WH / 2 * 0.9;
      var rz = (r.height / 2) * CS * 0.85;
      ellipsoids.push({ cx: cx, cy: cy, cz: cz, rx: rx, ry: ry, rz: rz });
      chunks.push(createEllipsoidGeometry(cx, cy, cz, rx, ry, rz, sphereSegs, sphereSegs));
    }

    // Corridors → L-shaped tube pairs
    var corridorPairs = extractCorridorPairs(nodes);
    var midY = WH / 2;
    for (var ci = 0; ci < corridorPairs.length; ci++) {
      var pair = corridorPairs[ci];
      var ax = pair[0].x * CS, az = pair[0].y * CS;
      var bx = pair[1].x * CS, bz = pair[1].y * CS;
      // Horizontal segment (X direction)
      chunks.push(createTubeSegment(ax, midY, az, bx, midY, az, corrRadius, tubeSegs, 6));
      // Vertical segment (Z direction)
      chunks.push(createTubeSegment(bx, midY, az, bx, midY, bz, corrRadius, tubeSegs, 6));
    }

    // Merge all chunks, apply domain warp, compute normals/colours/UVs
    var geo = mergeAndWarp(chunks, noise, warpScale, warpAmp, THREE);

    // Grain texture
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
      side: THREE.FrontSide  // normals face inward
    });

    var mesh = new THREE.Mesh(geo, mat);

    // Floor entity for a-game locomotion
    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', mesh);

    // Spawn inside first room at floor level
    var spawnRoom = ellipsoids[0] || { cx: (W/2)*CS, cy: WH/2, cz: (H/2)*CS, ry: 1.5 };
    var floorY = spawnRoom.cy - spawnRoom.ry + 0.2;
    var spawnWorld = { x: spawnRoom.cx, y: floorY, z: spawnRoom.cz };

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
