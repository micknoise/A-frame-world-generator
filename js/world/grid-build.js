/**
 * @fileoverview Raster tile map → A-Frame DOM for a-game locomotion / physics.
 *
 * Tier A visual: noise-based displacement-luminance texturing.
 * The same noise field drives both the displacement map and the greyscale albedo,
 * so lighter = more displaced, darker = less displaced. A subtle grain overlay
 * adds fine surface detail. All surfaces share the same monochrome look.
 */
(function () {
  'use strict';

  function findFirstFloorTile(tiles) {
    for (var y = 0; y < tiles.length; y++) {
      for (var x = 0; x < tiles[y].length; x++) {
        if (tiles[y][x] === 'floor') return { x: x, y: y };
      }
    }
    return { x: 0, y: 0 };
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomHexColor(rng) {
    var n = (rng() * 0xffffff) >>> 0;
    return '#' + n.toString(16).padStart(6, '0');
  }

  // ── Value noise (same as noise-dungeon.js) ──────────────────────────────────

  function ValueNoise(seed) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    var rng = _seededRng(seed);
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

  function _seededRng(seed) {
    var s = seed | 0;
    return function () {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function _lerp(a, b, t) { return a + (b - a) * t; }

  ValueNoise.prototype.noise2D = function (x, y) {
    var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x), yf = y - Math.floor(y);
    var u = _fade(xf), v = _fade(yf);
    var aa = this.perm[this.perm[xi] + yi];
    var ab = this.perm[this.perm[xi] + yi + 1];
    var ba = this.perm[this.perm[xi + 1] + yi];
    var bb = this.perm[this.perm[xi + 1] + yi + 1];
    return _lerp(_lerp(this.values[aa], this.values[ba], u),
                 _lerp(this.values[ab], this.values[bb], u), v);
  };

  ValueNoise.prototype.fbm = function (x, y, octaves, lacunarity, gain) {
    lacunarity = lacunarity || 2.0; gain = gain || 0.5;
    var sum = 0, amp = 1, freq = 1, maxAmp = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      maxAmp += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / maxAmp;
  };

  // ── Noise-based albedo texture ──────────────────────────────────────────────

  /**
   * Generate a tileable greyscale texture where brightness = noise value.
   * This is the SAME noise field shape used for displacement, so the texture
   * follows the geometry contour.
   */
  function makeNoiseAlbedoTexture(THREE, outSize, seed) {
    var noise = new ValueNoise((seed + 1) ^ 0x85a308d3);
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = outSize;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(outSize, outSize);
    var data = imgData.data;

    for (var py = 0; py < outSize; py++) {
      for (var px = 0; px < outSize; px++) {
        var u = px / outSize;
        var v = py / outSize;
        // Sample noise at same scale as displacement (nScale ≈ 0.4, mapped through UVs)
        var noiseVal = noise.fbm(u * 6, v * 6, 4);
        // Map to greyscale: 0 → dark, 1 → bright
        var grey = Math.floor(30 + noiseVal * 200);
        grey = Math.max(20, Math.min(240, grey));

        var off = (py * outSize + px) * 4;
        data[off] = grey; data[off+1] = grey; data[off+2] = grey; data[off+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Subtle random grain overlay — mostly white with slight darkening.
   */
  function makeGrainTexture(THREE, outSize, seed) {
    var noise = new ValueNoise(seed ^ 0xBEEF);
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = outSize;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(outSize, outSize);
    var data = imgData.data;

    for (var py = 0; py < outSize; py++) {
      for (var px = 0; px < outSize; px++) {
        var u = px / outSize;
        var v = py / outSize;
        var grain = noise.fbm(u * 24, v * 24, 3);
        var grey = Math.floor(200 + grain * 55);
        grey = Math.max(180, Math.min(255, grey));
        var off = (py * outSize + px) * 4;
        data[off] = grey; data[off+1] = grey; data[off+2] = grey; data[off+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  // ── Displacement texture (greyscale, matches albedo noise) ──────────────────

  function makeNoiseDisplacementTexture(THREE, outSize, seed) {
    var noise = new ValueNoise((seed + 1) ^ 0x85a308d3);  // same seed as albedo
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = outSize;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(outSize, outSize);
    var data = imgData.data;

    for (var py = 0; py < outSize; py++) {
      for (var px = 0; px < outSize; px++) {
        var u = px / outSize;
        var v = py / outSize;
        var noiseVal = noise.fbm(u * 6, v * 6, 4);
        var grey = Math.floor(noiseVal * 255);
        grey = Math.max(0, Math.min(255, grey));
        var off = (py * outSize + px) * 4;
        data[off] = grey; data[off+1] = grey; data[off+2] = grey; data[off+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  /** Resolve mesh for material swap. */
  function getEntityMesh(el) {
    var direct = el.getObject3D('mesh');
    if (direct && direct.isMesh) return direct;
    var found = null;
    if (el.object3D) {
      el.object3D.traverse(function (obj) {
        if (found) return;
        if (obj.isMesh) found = obj;
      });
    }
    return found;
  }

  /**
   * World-space triplanar UVs so the noise texture follows geometry contour.
   */
  function ensureTriplanarUvs(mesh, THREE, tileMeters) {
    var geom = mesh.geometry;
    if (!geom || !geom.attributes || !geom.attributes.uv) return;
    if (!geom.attributes.position || !geom.attributes.normal) return;
    if (geom.userData && geom.userData.wgTriplanarUv) return;

    mesh.updateMatrixWorld(true);
    var clone = geom.clone();
    mesh.geometry = clone;

    var pos = clone.attributes.position;
    var norm = clone.attributes.normal;
    var uv = clone.attributes.uv;
    var invT = 1 / Math.max(0.04, tileMeters);
    var wp = new THREE.Vector3();
    var wn = new THREE.Vector3();
    var vc = pos.count;

    for (var i = 0; i < vc; i++) {
      wp.set(pos.array[i*3], pos.array[i*3+1], pos.array[i*3+2]).applyMatrix4(mesh.matrixWorld);
      wn.set(norm.array[i*3], norm.array[i*3+1], norm.array[i*3+2]).transformDirection(mesh.matrixWorld);
      var ax = Math.abs(wn.x), ay = Math.abs(wn.y), az = Math.abs(wn.z);
      if (ay >= ax && ay >= az) {
        uv.array[i*2] = wp.x * invT; uv.array[i*2+1] = wp.z * invT;
      } else if (ax >= az) {
        uv.array[i*2] = wp.z * invT; uv.array[i*2+1] = wp.y * invT;
      } else {
        uv.array[i*2] = wp.x * invT; uv.array[i*2+1] = wp.y * invT;
      }
    }
    uv.needsUpdate = true;
    clone.userData.wgTriplanarUv = 1;
  }

  /** A-Frame box geometry: higher segment count for displacement. */
  function applyTierABoxGeometry(el, width, height, depth, kind, cellSize) {
    var sw, sh, sd;
    if (kind === 'floor' || kind === 'ceiling') {
      sw = Math.max(6, Math.min(20, Math.round(width / Math.max(cellSize * 0.26, 0.05))));
      sd = Math.max(10, Math.min(20, 16));
      sh = 1;
    } else {
      sw = Math.max(6, Math.min(20, Math.round(width / Math.max(cellSize * 0.26, 0.05))));
      sh = Math.max(10, Math.min(20, Math.round(height / 0.2)));
      sd = Math.max(8, Math.min(20, 14));
    }
    el.setAttribute('geometry', {
      primitive: 'box', width: width, height: height, depth: depth,
      segmentsWidth: sw, segmentsHeight: sh, segmentsDepth: sd
    });
  }

  /**
   * Tier A material application: noise-based displacement-luminance.
   * All surfaces get the same monochrome noise texture where brightness tracks
   * displacement. Subtle grain overlay for fine detail.
   */
  function scheduleTierAMaterials(rootEl, matOpts) {
    matOpts = matOpts || {};
    if (!window.AFRAME || !AFRAME.THREE) return;
    var THREE = AFRAME.THREE;
    var seed = matOpts.seed != null ? matOpts.seed >>> 0 : 1;
    var useDisp = matOpts.displacement !== false;
    var scW = matOpts.displacementScaleWall != null ? matOpts.displacementScaleWall : 0.22;
    var cellSize = matOpts.cellSize != null ? matOpts.cellSize : 1;
    var textureTileMeters = matOpts.textureTileMeters != null
      ? matOpts.textureTileMeters : Math.max(2, cellSize * 2);

    var texBundle = null;
    function ensureTextures() {
      if (texBundle) return texBundle;
      var albedo = makeNoiseAlbedoTexture(THREE, 256, seed);
      var grain = makeGrainTexture(THREE, 256, seed);
      var disp = makeNoiseDisplacementTexture(THREE, 256, seed);
      texBundle = { albedo: albedo, grain: grain, disp: disp };
      return texBundle;
    }

    function disposeMaterial(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (var i = 0; i < mat.length; i++) if (mat[i] && mat[i].dispose) mat[i].dispose();
      } else if (mat.dispose) mat.dispose();
    }

    function applyMaterials() {
      var nodes = rootEl.querySelectorAll('[data-wg-surf]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var kind = el.getAttribute('data-wg-surf');
        var mesh = getEntityMesh(el);
        if (!mesh) continue;
        if (mesh.material && mesh.material.userData && mesh.material.userData.wgTierA) continue;

        el.removeAttribute('material');
        el.removeAttribute('color');

        var b = ensureTextures();
        ensureTriplanarUvs(mesh, THREE, textureTileMeters);

        disposeMaterial(mesh.material);

        var matParams = {
          map: b.albedo,
          roughness: 0.9,
          metalness: 0.02,
          color: 0xffffff
        };

        // Displacement on walls (not floor/ceiling/trim — floor must stay flat for physics)
        if (useDisp && kind === 'wall') {
          matParams.displacementMap = b.disp;
          matParams.displacementScale = scW;
          matParams.displacementBias = -scW * 0.5;
        }

        var mat = new THREE.MeshStandardMaterial(matParams);
        mat.userData.wgTierA = 1;
        mesh.material = mat;
        el.setAttribute('data-wg-tier-a-mat', '1');
      }
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        applyMaterials();
        setTimeout(applyMaterials, 120);
        setTimeout(applyMaterials, 400);
      });
    });
  }

  function appendSpawnPhysicsToys(rootEl, worldX, worldZ) {
    var platform = document.createElement('a-box');
    platform.setAttribute('position', worldX + ' 0.25 ' + (worldZ - 2));
    platform.setAttribute('color', '#9b5de5');
    platform.setAttribute('width', '1.4');
    platform.setAttribute('height', '0.5');
    platform.setAttribute('depth', '1.4');
    platform.setAttribute('body', 'type: static; mass: 5');
    rootEl.appendChild(platform);

    var topY = 0.25 + 0.25 + 0.11;
    var toys = [{ dx: -0.4, dz: 0 }, { dx: 0, dz: 0 }, { dx: 0.4, dz: 0 }];
    var colors = ['#e63946', '#2a9d8f', '#f4a261'];
    for (var i = 0; i < toys.length; i++) {
      var t = toys[i];
      var el = document.createElement('a-box');
      el.setAttribute('position', worldX + t.dx + ' ' + topY + ' ' + (worldZ - 2 + t.dz));
      el.setAttribute('color', colors[i]);
      el.setAttribute('width', '0.22');
      el.setAttribute('height', '0.22');
      el.setAttribute('depth', '0.22');
      el.setAttribute('body', 'type: dynamic; mass: 0.35');
      el.setAttribute('grabbable', 'physics: true; kinematicGrab: true');
      rootEl.appendChild(el);
    }
  }

  function appendGoalMarker(rootEl, gt, cellSize, floorThickness) {
    var gx = (gt.x + 0.5) * cellSize;
    var gz = (gt.y + 0.5) * cellSize;
    var pillarH = Math.min(0.95, cellSize * 0.9);
    var baseY = floorThickness + pillarH / 2;
    var goal = document.createElement('a-box');
    goal.setAttribute('data-wg-goal', '');
    goal.setAttribute('position', gx + ' ' + baseY + ' ' + gz);
    goal.setAttribute('width', (cellSize * 0.38).toFixed(3));
    goal.setAttribute('height', pillarH.toFixed(3));
    goal.setAttribute('depth', (cellSize * 0.38).toFixed(3));
    goal.setAttribute(
      'material',
      'color: #ffb24a; emissive: #cc6600; emissiveIntensity: 0.5; roughness: 0.4; metalness: 0.2'
    );
    rootEl.appendChild(goal);
  }

  function appendTrims(rootEl, tiles, W, H, cellSize, trimH, trimD, tierA) {
    var y, x;
    for (y = 0; y < H; y++) {
      x = 0;
      while (x < W) {
        var northWall = y === 0 || tiles[y - 1][x] === 'wall';
        if (tiles[y][x] !== 'floor' || !northWall) { x++; continue; }
        var x0 = x;
        while (x < W && tiles[y][x] === 'floor' && (y === 0 || tiles[y - 1][x] === 'wall')) x++;
        var run = x - x0, widthW = run * cellSize;
        var cx = x0 * cellSize + widthW / 2, cz = y * cellSize + trimD / 2;
        var tr = document.createElement('a-box');
        tr.setAttribute('width', String(widthW)); tr.setAttribute('height', String(trimH)); tr.setAttribute('depth', String(trimD));
        tr.setAttribute('position', cx + ' ' + trimH / 2 + ' ' + cz);
        if (tierA) tr.setAttribute('data-wg-surf', 'trim'); else tr.setAttribute('color', '#4a5560');
        tr.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(tr);
      }
    }
    for (y = 0; y < H; y++) {
      x = 0;
      while (x < W) {
        var southWall = y === H - 1 || tiles[y + 1][x] === 'wall';
        if (tiles[y][x] !== 'floor' || !southWall) { x++; continue; }
        var x0s = x;
        while (x < W && tiles[y][x] === 'floor' && (y === H - 1 || tiles[y + 1][x] === 'wall')) x++;
        var runs = x - x0s, wW = runs * cellSize;
        var cxs = x0s * cellSize + wW / 2, czs = (y + 1) * cellSize - trimD / 2;
        var trs = document.createElement('a-box');
        trs.setAttribute('width', String(wW)); trs.setAttribute('height', String(trimH)); trs.setAttribute('depth', String(trimD));
        trs.setAttribute('position', cxs + ' ' + trimH / 2 + ' ' + czs);
        if (tierA) trs.setAttribute('data-wg-surf', 'trim'); else trs.setAttribute('color', '#4a5560');
        trs.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(trs);
      }
    }
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        var eastWall = x === W - 1 || tiles[y][x + 1] === 'wall';
        if (tiles[y][x] !== 'floor' || !eastWall) { y++; continue; }
        var y0e = y;
        while (y < H && tiles[y][x] === 'floor' && (x === W - 1 || tiles[y][x + 1] === 'wall')) y++;
        var runH = (y - y0e) * cellSize;
        var cxe = (x + 1) * cellSize - trimD / 2, cze = y0e * cellSize + runH / 2;
        var tre = document.createElement('a-box');
        tre.setAttribute('width', String(trimD)); tre.setAttribute('height', String(trimH)); tre.setAttribute('depth', String(runH));
        tre.setAttribute('position', cxe + ' ' + trimH / 2 + ' ' + cze);
        if (tierA) tre.setAttribute('data-wg-surf', 'trim'); else tre.setAttribute('color', '#4a5560');
        tre.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(tre);
      }
    }
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        var westWall = x === 0 || tiles[y][x - 1] === 'wall';
        if (tiles[y][x] !== 'floor' || !westWall) { y++; continue; }
        var y0w = y;
        while (y < H && tiles[y][x] === 'floor' && (x === 0 || tiles[y][x - 1] === 'wall')) y++;
        var runHw = (y - y0w) * cellSize;
        var cxw = x * cellSize + trimD / 2, czw = y0w * cellSize + runHw / 2;
        var trw = document.createElement('a-box');
        trw.setAttribute('width', String(trimD)); trw.setAttribute('height', String(trimH)); trw.setAttribute('depth', String(runHw));
        trw.setAttribute('position', cxw + ' ' + trimH / 2 + ' ' + czw);
        if (tierA) trw.setAttribute('data-wg-surf', 'trim'); else trw.setAttribute('color', '#4a5560');
        trw.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(trw);
      }
    }
  }

  function buildAgameTileWorld(rootEl, tiles, options) {
    options = options || {};
    var cellSize = options.cellSize != null ? options.cellSize : 1;
    var wallHeight = options.wallHeight != null ? options.wallHeight : 3;
    var floorThickness = options.floorThickness != null ? options.floorThickness : 0.25;
    var ceilingThickness = options.ceilingThickness != null ? options.ceilingThickness : 0.12;
    var trimH = options.trimHeight != null ? options.trimHeight : 0.14;
    var trimD = options.trimDepth != null ? options.trimDepth : 0.07;
    var seed = options.seed != null ? options.seed >>> 0 : 1;
    var includeToys = options.includeToys !== false;
    var crateCount = options.crateCount != null ? options.crateCount : 10;
    var visualDetail = options.visualDetail != null ? options.visualDetail : 'tierA';
    var tierA = visualDetail === 'tierA';

    var H = tiles.length;
    var W = tiles[0].length;
    var mt = options.markerTile || findFirstFloorTile(tiles);
    if (tiles[mt.y][mt.x] !== 'floor') mt = findFirstFloorTile(tiles);

    var spawnWorld = { x: (mt.x + 0.5) * cellSize, y: 0, z: (mt.y + 0.5) * cellSize };

    var start = document.createElement('a-box');
    start.setAttribute('start', '');
    start.setAttribute('position', spawnWorld.x + ' 0.01 ' + spawnWorld.z);
    start.setAttribute('width', '0.02'); start.setAttribute('height', '0.02'); start.setAttribute('depth', '0.02');
    start.setAttribute('visible', 'false');
    rootEl.appendChild(start);

    var floorY = -floorThickness / 2;
    var ceilY = wallHeight - ceilingThickness / 2;

    for (var y = 0; y < H; y++) {
      var x = 0;
      while (x < W) {
        if (tiles[y][x] !== 'floor') { x++; continue; }
        var x0 = x;
        while (x < W && tiles[y][x] === 'floor') x++;
        var run = x - x0, widthW = run * cellSize;
        var cx = x0 * cellSize + widthW / 2, cz = y * cellSize + cellSize / 2;
        var fb = document.createElement('a-box');
        fb.setAttribute('floor', '');
        if (tierA) {
          fb.setAttribute('data-wg-surf', 'floor');
          fb.setAttribute('width', String(widthW)); fb.setAttribute('height', String(floorThickness)); fb.setAttribute('depth', String(cellSize));
        } else {
          fb.setAttribute('color', '#5c6b5c');
          fb.setAttribute('width', String(widthW)); fb.setAttribute('height', String(floorThickness)); fb.setAttribute('depth', String(cellSize));
        }
        fb.setAttribute('position', cx + ' ' + floorY + ' ' + cz);
        fb.setAttribute('shadow', 'receive: true');
        rootEl.appendChild(fb);

        if (tierA) {
          var cb = document.createElement('a-box');
          cb.setAttribute('data-wg-surf', 'ceiling');
          cb.setAttribute('width', String(widthW)); cb.setAttribute('height', String(ceilingThickness)); cb.setAttribute('depth', String(cellSize));
          cb.setAttribute('position', cx + ' ' + ceilY + ' ' + cz);
          cb.setAttribute('shadow', 'cast: true; receive: false');
          rootEl.appendChild(cb);
        }
      }
    }

    for (var wy = 0; wy < H; wy++) {
      var wx = 0;
      while (wx < W) {
        if (tiles[wy][wx] !== 'wall') { wx++; continue; }
        var wx0 = wx;
        while (wx < W && tiles[wy][wx] === 'wall') wx++;
        var wrun = wx - wx0, wWidth = wrun * cellSize;
        var wcx = wx0 * cellSize + wWidth / 2, wcz = wy * cellSize + cellSize / 2;
        var wb = document.createElement('a-box');
        wb.setAttribute('wall', '');
        if (tierA) {
          wb.setAttribute('data-wg-surf', 'wall');
          applyTierABoxGeometry(wb, wWidth, wallHeight, cellSize, 'wall', cellSize);
        } else {
          wb.setAttribute('color', '#3d4a4f');
          wb.setAttribute('width', String(wWidth)); wb.setAttribute('height', String(wallHeight)); wb.setAttribute('depth', String(cellSize));
        }
        wb.setAttribute('position', wcx + ' ' + wallHeight / 2 + ' ' + wcz);
        wb.setAttribute('shadow', 'cast: true; receive: true');
        rootEl.appendChild(wb);
      }
    }

    if (tierA) appendTrims(rootEl, tiles, W, H, cellSize, trimH, trimD, tierA);

    var outGoal = null;
    if (options.goalTile) {
      var g = options.goalTile;
      if (g.y >= 0 && g.y < H && g.x >= 0 && g.x < W && tiles[g.y][g.x] === 'floor') {
        appendGoalMarker(rootEl, g, cellSize, floorThickness);
        outGoal = { x: g.x, y: g.y };
      }
    }

    if (includeToys) appendSpawnPhysicsToys(rootEl, spawnWorld.x, spawnWorld.z);

    var rng = mulberry32(seed);
    var margin = 2;
    for (var c = 0; c < crateCount; c++) {
      var tx = Math.floor(rng() * W);
      var ty = Math.floor(rng() * H);
      if (tiles[ty][tx] !== 'floor') continue;
      if (Math.abs(tx - mt.x) < margin && Math.abs(ty - mt.y) < margin) continue;
      if (outGoal && Math.abs(tx - outGoal.x) < margin && Math.abs(ty - outGoal.y) < margin) continue;
      var wxp = (tx + 0.5) * cellSize, wzp = (ty + 0.5) * cellSize;
      var crate = document.createElement('a-box');
      var s = 0.22 + rng() * 0.18;
      crate.setAttribute('body', 'type: dynamic; mass: 0.85');
      crate.setAttribute('grabbable', 'physics: true; kinematicGrab: true');
      crate.setAttribute('color', randomHexColor(rng));
      crate.setAttribute('width', String(s)); crate.setAttribute('height', String(s)); crate.setAttribute('depth', String(s));
      var floorTop = floorThickness;
      var drop = rng() < 0.4 ? 1 + rng() * 2 : 0;
      crate.setAttribute('position', wxp + ' ' + (floorTop + s / 2 + drop).toFixed(2) + ' ' + wzp);
      crate.setAttribute('rotation', '0 ' + Math.floor(rng() * 4) * 90 + ' 0');
      rootEl.appendChild(crate);
    }

    if (tierA) {
      scheduleTierAMaterials(rootEl, {
        seed: seed,
        cellSize: cellSize,
        textureTileMeters: options.textureTileMeters,
        displacement: options.displacement !== false,
        displacementScaleWall: options.displacementScaleWall
      });
    }

    var result = { spawnWorld: spawnWorld, gridW: W, gridH: H, markerTile: mt };
    if (outGoal) result.goalTile = outGoal;
    return result;
  }

  window.buildAgameTileWorld = buildAgameTileWorld;
})();
