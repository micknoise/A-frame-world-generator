/**
 * noise-capsule-dungeon.js — BSP dungeon with axis-aligned ellipsoid rooms (squashed spheres that
 * match each carved room box in XZ and wall height in Y) and open cylindrical tube corridors on the
 * same corridorLegs as bsp-dungeon carveCorridor (no end caps, inward normals). Same displacement
 * and materials as noise-dungeon.js (axis/triplanar fBm, grain, vertex luminance).
 *
 * PUBLIC API
 * ----------
 *   NoiseTubeDungeon.build(rootEl, bsp, options) → { spawnWorld }
 *   Options include spawnFeetOffset (feet Y above the ellipsoid inner floor; default allows displacement).
 *   NoiseCapsuleDungeon — alias of NoiseTubeDungeon (legacy name)
 */
(function () {
  'use strict';

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

  /** Identical to noise-dungeon.js generateGrainTexture */
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

  /** Same as sdf-bsp-dungeon axisNoiseDisplacement (matches noise-dungeon quad sampling). */
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
    var lumBlend =
      noise.fbm(px * nScale + 17, pz * nScale + 23, nOct) * 0.52 +
      noise.fbm(py * nScale * 1.1 + 41, px * nScale + 11, nOct) * 0.48;
    var shadeNoise = ty * (gy > 0 ? nf : nc) + tx * nWallX + tz * nWallZ;
    shadeNoise /= Math.max(1e-6, ty + tx + tz);
    return { dx: dx, dy: dy, dz: dz, lumBlend: lumBlend, shadeNoise: shadeNoise };
  }

  /** Geometric normals from base positions (before displacement), then displace. */
  function displaceWithGeometricNormals(basePos, getNormal, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp) {
    var n = basePos.length / 3;
    var out = new Float32Array(basePos.length);
    var disp = new Float32Array(n);
    var i, px, py, pz, nn, ad;
    for (i = 0; i < n; i++) {
      px = basePos[i * 3];
      py = basePos[i * 3 + 1];
      pz = basePos[i * 3 + 2];
      nn = getNormal(px, py, pz, i);
      ad = axisNoiseDisplacement(noise, px, py, pz, nn.x, nn.y, nn.z, nScale, nOct, floorAmp, wallAmp, ceilAmp);
      out[i * 3] = px + ad.dx;
      out[i * 3 + 1] = py + ad.dy;
      out[i * 3 + 2] = pz + ad.dz;
      disp[i] = ad.shadeNoise;
    }
    return { positions: out, dispValues: disp };
  }

  /**
   * Axis-aligned ellipsoid shell (UV sphere mapped), centre (cx,cy,cz), semi-axes rx, ry, rz.
   * Fits the BSP room box: half-width / half-depth from floor tile count, half-height from wall height.
   * Winding: inward-facing cavity normals for FrontSide.
   */
  function buildEllipsoidMesh(cx, cy, cz, rx, ry, rz, segH, segW) {
    var positions = [];
    var indices = [];
    var iy, ix, v, phi, u, theta, sinPhi, cosPhi, sinT, cosT, px, py, pz;
    var rx2 = rx * rx;
    var ry2 = ry * ry;
    var rz2 = rz * rz;
    for (iy = 0; iy <= segH; iy++) {
      v = iy / segH;
      phi = v * Math.PI;
      sinPhi = Math.sin(phi);
      cosPhi = Math.cos(phi);
      for (ix = 0; ix <= segW; ix++) {
        u = ix / segW;
        theta = u * Math.PI * 2;
        sinT = Math.sin(theta);
        cosT = Math.cos(theta);
        px = cx + rx * sinPhi * cosT;
        py = cy + ry * cosPhi;
        pz = cz + rz * sinPhi * sinT;
        positions.push(px, py, pz);
      }
    }
    var row = segW + 1;
    for (iy = 0; iy < segH; iy++) {
      for (ix = 0; ix < segW; ix++) {
        var a = iy * row + ix;
        var b = a + 1;
        var c = a + row;
        var d = c + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      vertCount: (segH + 1) * (segW + 1),
      normalAt: function (px, py, pz) {
        var nx = (cx - px) / rx2;
        var ny = (cy - py) / ry2;
        var nz = (cz - pz) / rz2;
        var ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        return { x: nx / ln, y: ny / ln, z: nz / ln };
      }
    };
  }

  /** Corridor pairs — same idea as sdf-cavern.js extractCorridorPairs */
  function extractCorridorPairs(nodes) {
    var pairs = [];
    if (!nodes || nodes.length < 2) return pairs;
    var c = [];
    var i;
    for (i = 0; i < nodes.length; i++) c.push({ x: nodes[i].x, y: nodes[i].y });
    for (i = 0; i + 1 < c.length; i += 2) pairs.push([c[i], c[i + 1]]);
    for (i = 0; i + 3 < c.length; i += 4) {
      pairs.push([
        { x: (c[i].x + c[i + 1].x) / 2, y: (c[i].y + c[i + 1].y) / 2 },
        { x: (c[i + 2].x + c[i + 3].x) / 2, y: (c[i + 2].y + c[i + 3].y) / 2 }
      ]);
    }
    for (i = 0; i + 7 < c.length; i += 8) {
      pairs.push([
        { x: (c[i].x + c[i + 1].x + c[i + 2].x + c[i + 3].x) / 4, y: (c[i].y + c[i + 1].y + c[i + 2].y + c[i + 3].y) / 4 },
        { x: (c[i + 4].x + c[i + 5].x + c[i + 6].x + c[i + 7].x) / 4, y: (c[i + 4].y + c[i + 5].y + c[i + 6].y + c[i + 7].y) / 4 }
      ]);
    }
    if (c.length > 1 && c.length % 2 === 1) pairs.push([c[c.length - 2], c[c.length - 1]]);
    return pairs;
  }

  /**
   * Open tube (no end caps) along segment A→B, same layout as sdf-cavern createTubeSegment.
   * Winding gives inward-facing normals; normalAt points from surface toward the tunnel axis
   * so displacement matches that convention.
   */
  function buildTubeMesh(ax, ay, az, bx, by, bz, radius, segAround, segAlong) {
    var positions = [];
    var indices = [];
    var dx = bx - ax;
    var dy = by - ay;
    var dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.02) {
      return { positions: new Float32Array(0), indices: new Uint32Array(0), vertCount: 0, normalAt: null };
    }
    var axisX = dx / len;
    var axisY = dy / len;
    var axisZ = dz / len;
    var upX = 0;
    var upY = 1;
    var upZ = 0;
    if (Math.abs(axisY) > 0.9) {
      upX = 1;
      upY = 0;
      upZ = 0;
    }
    var rightX = axisY * upZ - axisZ * upY;
    var rightY = axisZ * upX - axisX * upZ;
    var rightZ = axisX * upY - axisY * upX;
    var rLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ) || 1;
    rightX /= rLen;
    rightY /= rLen;
    rightZ /= rLen;
    upX = rightY * axisZ - rightZ * axisY;
    upY = rightZ * axisX - rightX * axisZ;
    upZ = rightX * axisY - rightY * axisX;

    var ia, ic, t, px, py, pz, angle, cosA, sinA;
    for (ia = 0; ia <= segAlong; ia++) {
      t = ia / segAlong;
      px = ax + dx * t;
      py = ay + dy * t;
      pz = az + dz * t;
      for (ic = 0; ic <= segAround; ic++) {
        angle = (ic / segAround) * 2 * Math.PI;
        cosA = Math.cos(angle);
        sinA = Math.sin(angle);
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
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    var vertCount = positions.length / 3;
    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      vertCount: vertCount,
      normalAt: function (px, py, pz) {
        var abx = bx - ax;
        var aby = by - ay;
        var abz = bz - az;
        var ab2 = abx * abx + aby * aby + abz * abz;
        var tt = ab2 < 1e-12 ? 0 : ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / ab2;
        if (tt < 0) tt = 0;
        else if (tt > 1) tt = 1;
        var cpx = ax + abx * tt;
        var cpy = ay + aby * tt;
        var cpz = az + abz * tt;
        var qx = cpx - px;
        var qy = cpy - py;
        var qz = cpz - pz;
        var ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
        return { x: qx / ql, y: qy / ql, z: qz / ql };
      }
    };
  }

  /** Identical merge path to noise-dungeon mergeQuadsToGeometry */
  function mergePartsToGeometry(parts, uvScale, THREE) {
    var totalVerts = 0;
    var totalIdx = 0;
    var q;
    for (q = 0; q < parts.length; q++) {
      totalVerts += parts[q].vertCount;
      totalIdx += parts[q].indices.length;
    }

    var positions = new Float32Array(totalVerts * 3);
    var colors = new Float32Array(totalVerts * 3);
    var normals = new Float32Array(totalVerts * 3);
    var uvs = new Float32Array(totalVerts * 2);
    var indices = new Uint32Array(totalIdx);

    var vOff = 0;
    var iOff = 0;
    var vBase = 0;
    for (q = 0; q < parts.length; q++) {
      var p = parts[q];
      positions.set(p.positions, vOff * 3);
      var dv = p.dispValues;
      for (var cv = 0; cv < p.vertCount; cv++) {
        var lum = dv[cv];
        colors[(vOff + cv) * 3] = lum;
        colors[(vOff + cv) * 3 + 1] = lum;
        colors[(vOff + cv) * 3 + 2] = lum;
      }
      for (var ii = 0; ii < p.indices.length; ii++) {
        indices[iOff + ii] = p.indices[ii] + vBase;
      }
      vBase += p.vertCount;
      vOff += p.vertCount;
      iOff += p.indices.length;
    }

    var i, i0, i1, i2;
    for (i = 0; i < indices.length; i += 3) {
      i0 = indices[i];
      i1 = indices[i + 1];
      i2 = indices[i + 2];
      var ax = positions[i1 * 3] - positions[i0 * 3];
      var ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      var az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      var bx = positions[i2 * 3] - positions[i0 * 3];
      var by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      var bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      var nx = ay * bz - az * by;
      var ny = az * bx - ax * bz;
      var nz = ax * by - ay * bx;
      normals[i0 * 3] += nx;
      normals[i0 * 3 + 1] += ny;
      normals[i0 * 3 + 2] += nz;
      normals[i1 * 3] += nx;
      normals[i1 * 3 + 1] += ny;
      normals[i1 * 3 + 2] += nz;
      normals[i2 * 3] += nx;
      normals[i2 * 3 + 1] += ny;
      normals[i2 * 3 + 2] += nz;
    }
    for (var nv = 0; nv < totalVerts; nv++) {
      var ox = normals[nv * 3];
      var oy = normals[nv * 3 + 1];
      var oz = normals[nv * 3 + 2];
      var len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      normals[nv * 3] = ox / len;
      normals[nv * 3 + 1] = oy / len;
      normals[nv * 3 + 2] = oz / len;
    }

    var invUV = 1.0 / uvScale;
    for (var vi = 0; vi < totalVerts; vi++) {
      var px = positions[vi * 3];
      var py = positions[vi * 3 + 1];
      var pz = positions[vi * 3 + 2];
      var anx = Math.abs(normals[vi * 3]);
      var any = Math.abs(normals[vi * 3 + 1]);
      var anz = Math.abs(normals[vi * 3 + 2]);
      if (any >= anx && any >= anz) {
        uvs[vi * 2] = px * invUV;
        uvs[vi * 2 + 1] = pz * invUV;
      } else if (anx >= anz) {
        uvs[vi * 2] = pz * invUV;
        uvs[vi * 2 + 1] = py * invUV;
      } else {
        uvs[vi * 2] = px * invUV;
        uvs[vi * 2 + 1] = py * invUV;
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  function processMesh(meshData, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp) {
    if (!meshData.vertCount) return null;
    var dn = displaceWithGeometricNormals(
      meshData.positions,
      meshData.normalAt,
      noise,
      nScale,
      nOct,
      floorAmp,
      wallAmp,
      ceilAmp
    );
    return {
      positions: dn.positions,
      indices: meshData.indices,
      vertCount: meshData.vertCount,
      dispValues: dn.dispValues
    };
  }

  function build(rootEl, bsp, options) {
    var THREE = AFRAME.THREE;
    options = options || {};

    var seed = options.seed != null ? options.seed : 42;
    var CS = options.cellSize != null ? options.cellSize : 4.5;
    var WH = options.wallHeight != null ? options.wallHeight : 6;
    var nScale = options.noiseScale != null ? options.noiseScale : 0.4;
    var nOct = options.octaves != null ? options.octaves : 4;
    var floorAmp = options.floorDisplacement != null ? options.floorDisplacement : 0.12;
    var wallAmp = options.wallDisplacement != null ? options.wallDisplacement : 0.35;
    var ceilAmp = options.ceilingDisplacement != null ? options.ceilingDisplacement : 0.25;
    var uvScale = options.uvScale != null ? options.uvScale : 2;
    var sphereSeg = options.sphereSegments != null ? options.sphereSegments : 32;
    var roomInset = options.roomBoxInset != null ? options.roomBoxInset : 0.985;
    var capRadius = options.corridorRadius != null ? options.corridorRadius : CS * 0.46;
    var spawnFeetOffset =
      options.spawnFeetOffset != null ? options.spawnFeetOffset : 1.15 + floorAmp + wallAmp * 0.35;
    var capAround =
      options.tubeAroundSegments != null
        ? options.tubeAroundSegments
        : options.capsuleAroundSegments != null
          ? options.capsuleAroundSegments
          : 28;
    var capAlong =
      options.tubeAlongSegments != null
        ? options.tubeAlongSegments
        : options.capsuleAlongSegments != null
          ? options.capsuleAlongSegments
          : 14;

    var noise = new ValueNoise(seed);
    var regions = bsp.regions || [];
    var nodes = bsp.nodes || [];
    var W = bsp.width;
    var H = bsp.height;

    var parts = [];
    var ri, r, cx, cy, cz, rx, ry, rz, rawRoom, rawTube, midY;
    midY = WH * 0.5;

    for (ri = 0; ri < regions.length; ri++) {
      r = regions[ri];
      cx = (r.x + r.width * 0.5) * CS;
      cy = midY;
      cz = (r.y + r.height * 0.5) * CS;
      /* Same footprint as BSP floor rect: half-extents of the room box in world units, slightly inset. */
      rx = r.width * CS * 0.5 * roomInset;
      rz = r.height * CS * 0.5 * roomInset;
      ry = WH * 0.5 * roomInset;
      if (rx < CS * 0.18) rx = CS * 0.18;
      if (rz < CS * 0.18) rz = CS * 0.18;
      if (ry < CS * 0.15) ry = CS * 0.15;
      rawRoom = buildEllipsoidMesh(cx, cy, cz, rx, ry, rz, sphereSeg, sphereSeg);
      var procS = processMesh(rawRoom, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp);
      if (procS) parts.push(procS);
    }

    var legs = bsp.corridorLegs;
    var li, ax, az, bx, bz, segAlong, lenLeg;
    if (legs && legs.length) {
      for (li = 0; li < legs.length; li++) {
        ax = legs[li].sx * CS;
        az = legs[li].sy * CS;
        bx = legs[li].ex * CS;
        bz = legs[li].ey * CS;
        lenLeg = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
        segAlong = Math.max(capAlong, Math.ceil(lenLeg / Math.max(CS * 0.35, 0.5)) * 2);
        rawTube = buildTubeMesh(ax, midY, az, bx, midY, bz, capRadius, capAround, segAlong);
        var procL = processMesh(rawTube, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp);
        if (procL) parts.push(procL);
      }
    } else {
      var pairs = extractCorridorPairs(nodes);
      var pi, segAlongH, segAlongV, lenH, lenV;
      for (pi = 0; pi < pairs.length; pi++) {
        ax = pairs[pi][0].x * CS;
        az = pairs[pi][0].y * CS;
        bx = pairs[pi][1].x * CS;
        bz = pairs[pi][1].y * CS;
        lenH = Math.abs(bx - ax);
        lenV = Math.abs(bz - az);
        segAlongH = Math.max(capAlong, Math.ceil(lenH / Math.max(CS * 0.35, 0.5)) * 2);
        segAlongV = Math.max(capAlong, Math.ceil(lenV / Math.max(CS * 0.35, 0.5)) * 2);
        rawTube = buildTubeMesh(ax, midY, az, bx, midY, az, capRadius, capAround, segAlongH);
        var procH = processMesh(rawTube, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp);
        if (procH) parts.push(procH);
        rawTube = buildTubeMesh(bx, midY, az, bx, midY, bz, capRadius, capAround, segAlongV);
        var procV = processMesh(rawTube, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp);
        if (procV) parts.push(procV);
      }
    }

    if (!parts.length) {
      rawRoom = buildEllipsoidMesh(
        (W * 0.5) * CS,
        midY,
        (H * 0.5) * CS,
        W * CS * 0.22,
        WH * 0.45,
        H * CS * 0.22,
        24,
        24
      );
      parts.push(processMesh(rawRoom, noise, nScale, nOct, floorAmp, wallAmp, ceilAmp));
    }

    var geo = mergePartsToGeometry(parts, uvScale, THREE);

    var grainCanvas = generateGrainTexture(seed, 256);
    var grainTex = new THREE.CanvasTexture(grainCanvas);
    grainTex.wrapS = THREE.RepeatWrapping;
    grainTex.wrapT = THREE.RepeatWrapping;
    grainTex.magFilter = THREE.LinearFilter;
    grainTex.minFilter = THREE.LinearMipmapLinearFilter;
    grainTex.anisotropy = 4;
    grainTex.needsUpdate = true;

    var sharedMatProps = {
      map: grainTex,
      vertexColors: true,
      flatShading: false,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.FrontSide
    };

    var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(sharedMatProps));

    var floorEl = document.createElement('a-entity');
    floorEl.setAttribute('floor', '');
    rootEl.appendChild(floorEl);
    floorEl.setObject3D('mesh', mesh);

    var rySpawn = WH * 0.5 * roomInset;
    var spawnY = midY - rySpawn + spawnFeetOffset;
    if (spawnY < 0.5) spawnY = 0.5;
    var spawnWorld;
    if (regions.length) {
      r = regions[0];
      spawnWorld = {
        x: (r.x + r.width * 0.5) * CS,
        y: spawnY,
        z: (r.y + r.height * 0.5) * CS
      };
    } else {
      spawnWorld = { x: (W * 0.5) * CS, y: spawnY, z: (H * 0.5) * CS };
    }

    var startMarker = document.createElement('a-box');
    startMarker.setAttribute('start', '');
    startMarker.setAttribute('position', spawnWorld.x + ' ' + spawnY + ' ' + spawnWorld.z);
    startMarker.setAttribute('width', '0.02');
    startMarker.setAttribute('height', '0.02');
    startMarker.setAttribute('depth', '0.02');
    startMarker.setAttribute('visible', 'false');
    rootEl.appendChild(startMarker);

    return { spawnWorld: spawnWorld };
  }

  var api = { build: build };
  window.NoiseTubeDungeon = api;
  window.NoiseCapsuleDungeon = api;
}());
