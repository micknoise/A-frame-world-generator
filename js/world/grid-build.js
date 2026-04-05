/**
 * @fileoverview Raster tile map → A-Frame DOM for a-game locomotion / physics.
 *
 * INPUT CONTRACT
 * --------------
 *   tiles: string[][] row-major, tiles[y][x] ∈ 'floor' | 'wall'
 *   Same convention as BSP output: y grows downward in grid space, mapped to +Z in world space.
 *
 * OUTPUT / TAGS
 * -------------
 * Appends to rootEl (typically #world-root under <a-scene>):
 *   - <a-box start> — invisible marker at spawn (a-game spawn / navigation helpers).
 *   - <a-box floor> — horizontal runs of adjacent floor cells merged per row → fewer entities.
 *   - <a-box wall> — horizontal runs of adjacent wall cells merged per row, full wallHeight.
 *   - Optional goal marker (visible emissive box) when goalTile is set (mazes).
 *   - visualDetail 'tierA': ceiling, trims, procedural albedo/roughness + optional mesh displacement
 *     (smoother height texture + displacementScale/displacementBias; physics remain simple boxes).
 *   - Static purple platform + three small dynamic grabbable cubes near spawn (optional).
 *   - Scattered dynamic crates on random floor cells (seeded).
 *
 * OPTIONS
 * -------
 *   visualDetail: 'basic' | 'tierA' (default 'tierA') — Tier A adds ceiling, trims, MeshStandardMaterial
 *     with repeating canvas noise (roughness/detail) after a short rAF delay once meshes exist.
 *   goalTile: { x, y } — floor tile for a visible “exit” pillar (no floor/wall tag; cosmetic).
 *   ceilingThickness, trimHeight, trimDepth — only used when visualDetail === 'tierA'.
 *   displacement — default true with tierA; set false to skip displacementMap (saves shader cost).
 *   displacementScaleFloor / displacementScaleWall / displacementScaleCeiling — world-unit amplitudes.
 *
 * PUBLIC API
 * ----------
 *   buildAgameTileWorld(rootEl, tiles, options?) — see generator.js / README.
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

  function smoothHeightGrid(seed, n) {
    var rng = mulberry32(seed >>> 0);
    var g = [];
    for (var j = 0; j < n; j++) {
      g[j] = [];
      for (var i = 0; i < n; i++) g[j][i] = rng();
    }
    var b = [];
    for (var y = 0; y < n; y++) {
      b[y] = [];
      for (var x = 0; x < n; x++) {
        var s = 0;
        var c = 0;
        for (var dj = -2; dj <= 2; dj++) {
          for (var di = -2; di <= 2; di++) {
            var yy = Math.max(0, Math.min(n - 1, y + dj));
            var xx = Math.max(0, Math.min(n - 1, x + di));
            s += g[yy][xx];
            c++;
          }
        }
        b[y][x] = s / c;
      }
    }
    return b;
  }

  function sampleHeightBilinear(b, n, fx, fy) {
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var tx = fx - x0;
    var ty = fy - y0;
    var x1 = Math.min(n - 1, x0 + 1);
    var y1 = Math.min(n - 1, y0 + 1);
    var v00 = b[y0][x0];
    var v10 = b[y0][x1];
    var v01 = b[y1][x0];
    var v11 = b[y1][x1];
    return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
  }

  /**
   * One coherent height field → RGB albedo (tinted), grey roughness, displacement, tangent normals.
   * Reads well under scene lights; normalMap gives visible relief even when displacement is subtle.
   */
  function makeTierSurfaceTextures(THREE, outSize, seed, surfaceKind) {
    var n = 42;
    var hGrid = smoothHeightGrid(seed, n);
    var tint =
      surfaceKind === 'floor'
        ? { dr: 88, dg: 108, db: 82, lr: 168, lg: 188, lb: 148 }
        : surfaceKind === 'ceiling'
          ? { dr: 118, dg: 132, db: 158, lr: 208, lg: 218, lb: 235 }
          : { dr: 138, dg: 148, db: 162, lr: 205, lg: 212, lb: 222 };

    var H = new Float32Array(outSize * outSize);
    var px;
    var py;
    for (py = 0; py < outSize; py++) {
      for (px = 0; px < outSize; px++) {
        var fx = (px / Math.max(1, outSize - 1)) * (n - 1);
        var fy = (py / Math.max(1, outSize - 1)) * (n - 1);
        var hBase = sampleHeightBilinear(hGrid, n, fx, fy);
        var fxp = (fx * 3.15) % (n - 1);
        var fyp = (fy * 3.15) % (n - 1);
        if (fxp < 0) fxp += n - 1;
        if (fyp < 0) fyp += n - 1;
        var hDet = sampleHeightBilinear(hGrid, n, fxp, fyp);
        H[py * outSize + px] = hBase * 0.7 + hDet * 0.3;
      }
    }

    var albedoData = new Uint8ClampedArray(outSize * outSize * 4);
    var roughData = new Uint8ClampedArray(outSize * outSize * 4);
    var dispData = new Uint8ClampedArray(outSize * outSize * 4);
    var normData = new Uint8ClampedArray(outSize * outSize * 4);
    var normalStrength = 22;

    for (py = 0; py < outSize; py++) {
      for (px = 0; px < outSize; px++) {
        var xm = Math.max(0, px - 1);
        var xp = Math.min(outSize - 1, px + 1);
        var ym = Math.max(0, py - 1);
        var yp = Math.min(outSize - 1, py + 1);
        var idx = py * outSize + px;
        var h0 = H[idx];
        var hl = H[py * outSize + xm];
        var hr = H[py * outSize + xp];
        var hu = H[ym * outSize + px];
        var hd = H[yp * outSize + px];
        var dx = (hr - hl) * normalStrength;
        var dy = (hd - hu) * normalStrength;
        var nx = -dx;
        var ny = -dy;
        var nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        var ar = Math.floor(tint.dr + (tint.lr - tint.dr) * h0);
        var ag = Math.floor(tint.dg + (tint.lg - tint.dg) * h0);
        var ab = Math.floor(tint.db + (tint.lb - tint.db) * h0);
        var o = idx * 4;
        albedoData[o] = ar;
        albedoData[o + 1] = ag;
        albedoData[o + 2] = ab;
        albedoData[o + 3] = 255;
        var rg = Math.floor(255 * (0.36 + 0.56 * h0));
        roughData[o] = roughData[o + 1] = roughData[o + 2] = rg;
        roughData[o + 3] = 255;
        var db = Math.floor(128 + (h0 - 0.5) * 230);
        if (db < 2) db = 2;
        if (db > 253) db = 253;
        dispData[o] = dispData[o + 1] = dispData[o + 2] = db;
        dispData[o + 3] = 255;
        normData[o] = Math.floor((nx * 0.5 + 0.5) * 255);
        normData[o + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
        normData[o + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
        normData[o + 3] = 255;
      }
    }

    function dataToTex(data, encHint) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = outSize;
      var ctx = canvas.getContext('2d');
      ctx.putImageData(new ImageData(data, outSize, outSize), 0, 0);
      var tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      if (
        THREE.SRGBColorSpace != null &&
        THREE.LinearSRGBColorSpace != null &&
        tex.colorSpace !== undefined
      ) {
        tex.colorSpace =
          encHint === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      } else if (THREE.sRGBEncoding !== undefined && tex.encoding !== undefined) {
        tex.encoding =
          encHint === 'srgb' ? THREE.sRGBEncoding : THREE.LinearEncoding;
      }
      tex.needsUpdate = true;
      return tex;
    }

    return {
      albedo: dataToTex(albedoData, 'srgb'),
      roughness: dataToTex(roughData, 'linear'),
      displacement: dataToTex(dispData, 'linear'),
      normal: dataToTex(normData, 'linear')
    };
  }

  /** Resolve mesh for Tier A material swap (some A-Frame builds nest the mesh). */
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

  /** A-Frame box geometry is capped at 20 segments per axis (see geometry box schema). */
  function applyTierABoxGeometry(el, width, height, depth, kind, cellSize) {
    var sw;
    var sh;
    var sd;
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
      primitive: 'box',
      width: width,
      height: height,
      depth: depth,
      segmentsWidth: sw,
      segmentsHeight: sh,
      segmentsDepth: sd
    });
  }

  /**
   * After A-Frame creates meshes: PBR + optional displacement (vertex shader, same UVs as map).
   * Trims (data-wg-surf="trim") skip displacement — small pieces, not worth subdividing.
   */
  function scheduleTierAMaterials(rootEl, matOpts) {
    matOpts = matOpts || {};
    if (!window.AFRAME || !AFRAME.THREE) return;
    var THREE = AFRAME.THREE;
    var seed = matOpts.seed != null ? matOpts.seed >>> 0 : 1;
    var useDisp = matOpts.displacement !== false;
    /* Stronger defaults + normalMap carry most of the readable relief. */
    var scF = matOpts.displacementScaleFloor != null ? matOpts.displacementScaleFloor : 0.3;
    var scW = matOpts.displacementScaleWall != null ? matOpts.displacementScaleWall : 0.22;
    var scC = matOpts.displacementScaleCeiling != null ? matOpts.displacementScaleCeiling : 0.26;

    /* repeat < 1 → fewer, larger tiles on each face */
    var repFloorU = 0.38;
    var repFloorV = 0.38;
    var repWallU = 0.34;
    var repWallV = 0.48;
    var repCeilU = 0.4;
    var repCeilV = 0.4;

    var textureBundle = null;
    function ensureTextureBundle() {
      if (textureBundle) return textureBundle;
      var outSize = 192;
      var floorSet = makeTierSurfaceTextures(THREE, outSize, seed ^ 0x243f6a88, 'floor');
      var wallSet = makeTierSurfaceTextures(THREE, outSize, (seed + 1) ^ 0x85a308d3, 'wall');
      var ceilSet = makeTierSurfaceTextures(THREE, outSize, (seed + 2) ^ 0x13198a2e, 'ceiling');

      function setRep(s, u, v) {
        [s.albedo, s.roughness, s.displacement, s.normal].forEach(function (t) {
          t.repeat.set(u, v);
          t.needsUpdate = true;
        });
      }
      setRep(floorSet, repFloorU, repFloorV);
      setRep(wallSet, repWallU, repWallV);
      setRep(ceilSet, repCeilU, repCeilV);

      textureBundle = { floor: floorSet, wall: wallSet, ceiling: ceilSet };
      return textureBundle;
    }

    function disposeMaterial(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (var i = 0; i < mat.length; i++) {
          if (mat[i] && mat[i].dispose) mat[i].dispose();
        }
      } else if (mat.dispose) mat.dispose();
    }

    function applyTierAMaterialsToEntities() {
      var b = ensureTextureBundle();
      var nodes = rootEl.querySelectorAll('[data-wg-surf]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var kind = el.getAttribute('data-wg-surf');
        var mesh = getEntityMesh(el);
        if (!mesh) continue;
        if (mesh.material && mesh.material.userData && mesh.material.userData.wgTierA) continue;

        var set =
          kind === 'floor' ? b.floor : kind === 'ceiling' ? b.ceiling : b.wall;

        el.removeAttribute('material');
        el.removeAttribute('color');

        var dispMap = null;
        var dScale = 0;
        var dBias = 0;
        if (useDisp && kind !== 'trim') {
          dispMap = set.displacement;
          if (kind === 'floor') dScale = scF;
          else if (kind === 'ceiling') dScale = scC;
          else dScale = scW;
          dBias = -dScale * 0.5;
        }

        disposeMaterial(mesh.material);
        var matParams = {
          color: 0xffffff,
          map: set.albedo,
          roughnessMap: set.roughness,
          normalMap: set.normal,
          normalScale: new THREE.Vector2(2.8, 2.8),
          roughness: 1,
          metalness: 0.05,
          envMapIntensity: 0.58
        };
        if (dispMap && dScale > 0) {
          matParams.displacementMap = dispMap;
          matParams.displacementScale = dScale;
          matParams.displacementBias = dBias;
        }
        var mat = new THREE.MeshStandardMaterial(matParams);
        mat.userData.wgTierA = 1;
        mesh.material = mat;
        el.setAttribute('data-wg-tier-a-mat', '1');
      }
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        applyTierAMaterialsToEntities();
        setTimeout(applyTierAMaterialsToEntities, 120);
        setTimeout(applyTierAMaterialsToEntities, 400);
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
    var toys = [
      { dx: -0.4, dz: 0 },
      { dx: 0, dz: 0 },
      { dx: 0.4, dz: 0 }
    ];
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

  /**
   * Baseboard / trim along floor edges where the neighbor cell is wall (Tier A).
   */
  function appendTrims(rootEl, tiles, W, H, cellSize, trimH, trimD, tierA) {
    var y;
    var x;
    /* North edge of row y (toward smaller z): neighbor row y - 1 is wall. */
    for (y = 0; y < H; y++) {
      x = 0;
      while (x < W) {
        var northWall = y === 0 || tiles[y - 1][x] === 'wall';
        if (tiles[y][x] !== 'floor' || !northWall) {
          x++;
          continue;
        }
        var x0 = x;
        while (x < W && tiles[y][x] === 'floor' && (y === 0 || tiles[y - 1][x] === 'wall')) x++;
        var run = x - x0;
        var widthW = run * cellSize;
        var cx = x0 * cellSize + widthW / 2;
        var cz = y * cellSize + trimD / 2;
        var tr = document.createElement('a-box');
        tr.setAttribute('width', String(widthW));
        tr.setAttribute('height', String(trimH));
        tr.setAttribute('depth', String(trimD));
        tr.setAttribute('position', cx + ' ' + trimH / 2 + ' ' + cz);
        if (tierA) tr.setAttribute('data-wg-surf', 'trim');
        else tr.setAttribute('color', '#4a5560');
        tr.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(tr);
      }
    }
    /* South edge of row y: neighbor y + 1 is wall. */
    for (y = 0; y < H; y++) {
      x = 0;
      while (x < W) {
        var southWall = y === H - 1 || tiles[y + 1][x] === 'wall';
        if (tiles[y][x] !== 'floor' || !southWall) {
          x++;
          continue;
        }
        var x0s = x;
        while (x < W && tiles[y][x] === 'floor' && (y === H - 1 || tiles[y + 1][x] === 'wall')) x++;
        var runs = x - x0s;
        var wW = runs * cellSize;
        var cxs = x0s * cellSize + wW / 2;
        var czs = (y + 1) * cellSize - trimD / 2;
        var trs = document.createElement('a-box');
        trs.setAttribute('width', String(wW));
        trs.setAttribute('height', String(trimH));
        trs.setAttribute('depth', String(trimD));
        trs.setAttribute('position', cxs + ' ' + trimH / 2 + ' ' + czs);
        if (tierA) trs.setAttribute('data-wg-surf', 'trim');
        else trs.setAttribute('color', '#4a5560');
        trs.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(trs);
      }
    }
    /* East trim: wall at x + 1, merged along z. */
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        var eastWall = x === W - 1 || tiles[y][x + 1] === 'wall';
        if (tiles[y][x] !== 'floor' || !eastWall) {
          y++;
          continue;
        }
        var y0e = y;
        while (y < H && tiles[y][x] === 'floor' && (x === W - 1 || tiles[y][x + 1] === 'wall')) y++;
        var runH = (y - y0e) * cellSize;
        var cxe = (x + 1) * cellSize - trimD / 2;
        var cze = y0e * cellSize + runH / 2;
        var tre = document.createElement('a-box');
        tre.setAttribute('width', String(trimD));
        tre.setAttribute('height', String(trimH));
        tre.setAttribute('depth', String(runH));
        tre.setAttribute('position', cxe + ' ' + trimH / 2 + ' ' + cze);
        if (tierA) tre.setAttribute('data-wg-surf', 'trim');
        else tre.setAttribute('color', '#4a5560');
        tre.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(tre);
      }
    }
    /* West trim: wall at x - 1. */
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        var westWall = x === 0 || tiles[y][x - 1] === 'wall';
        if (tiles[y][x] !== 'floor' || !westWall) {
          y++;
          continue;
        }
        var y0w = y;
        while (y < H && tiles[y][x] === 'floor' && (x === 0 || tiles[y][x - 1] === 'wall')) y++;
        var runHw = (y - y0w) * cellSize;
        var cxw = x * cellSize + trimD / 2;
        var czw = y0w * cellSize + runHw / 2;
        var trw = document.createElement('a-box');
        trw.setAttribute('width', String(trimD));
        trw.setAttribute('height', String(trimH));
        trw.setAttribute('depth', String(runHw));
        trw.setAttribute('position', cxw + ' ' + trimH / 2 + ' ' + czw);
        if (tierA) trw.setAttribute('data-wg-surf', 'trim');
        else trw.setAttribute('color', '#4a5560');
        trw.setAttribute('shadow', 'cast: false; receive: true');
        rootEl.appendChild(trw);
      }
    }
  }

  /**
   * @param {HTMLElement} rootEl
   * @param {string[][]} tiles row-major: tiles[y][x]
   * @param {{
   *   cellSize?: number,
   *   wallHeight?: number,
   *   floorThickness?: number,
   *   ceilingThickness?: number,
   *   trimHeight?: number,
   *   trimDepth?: number,
   *   markerTile?: {x:number,y:number},
   *   goalTile?: {x:number,y:number},
   *   seed?: number,
   *   includeToys?: boolean,
   *   crateCount?: number,
   *   visualDetail?: 'basic' | 'tierA',
   *   displacement?: boolean,
   *   displacementScaleFloor?: number,
   *   displacementScaleWall?: number,
   *   displacementScaleCeiling?: number
   * }} [options]
   * @returns {{ spawnWorld: {x:number,y:number,z:number}, gridW: number, gridH: number, markerTile: {x:number,y:number}, goalTile?: {x:number,y:number} }}
   */
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

    var spawnWorld = {
      x: (mt.x + 0.5) * cellSize,
      y: 0,
      z: (mt.y + 0.5) * cellSize
    };

    var start = document.createElement('a-box');
    start.setAttribute('start', '');
    start.setAttribute('position', spawnWorld.x + ' 0.01 ' + spawnWorld.z);
    start.setAttribute('width', '0.02');
    start.setAttribute('height', '0.02');
    start.setAttribute('depth', '0.02');
    start.setAttribute('visible', 'false');
    rootEl.appendChild(start);

    var floorY = -floorThickness / 2;
    var ceilY = wallHeight - ceilingThickness / 2;

    for (var y = 0; y < H; y++) {
      var x = 0;
      while (x < W) {
        if (tiles[y][x] !== 'floor') {
          x++;
          continue;
        }
        var x0 = x;
        while (x < W && tiles[y][x] === 'floor') x++;
        var run = x - x0;
        var widthW = run * cellSize;
        var cx = x0 * cellSize + widthW / 2;
        var cz = y * cellSize + cellSize / 2;
        var fb = document.createElement('a-box');
        fb.setAttribute('floor', '');
        if (tierA) {
          fb.setAttribute('data-wg-surf', 'floor');
          applyTierABoxGeometry(fb, widthW, floorThickness, cellSize, 'floor', cellSize);
        } else {
          fb.setAttribute('color', '#5c6b5c');
          fb.setAttribute('width', String(widthW));
          fb.setAttribute('height', String(floorThickness));
          fb.setAttribute('depth', String(cellSize));
        }
        fb.setAttribute('position', cx + ' ' + floorY + ' ' + cz);
        fb.setAttribute('shadow', 'receive: true');
        rootEl.appendChild(fb);

        if (tierA) {
          var cb = document.createElement('a-box');
          cb.setAttribute('data-wg-surf', 'ceiling');
          applyTierABoxGeometry(cb, widthW, ceilingThickness, cellSize, 'ceiling', cellSize);
          cb.setAttribute('position', cx + ' ' + ceilY + ' ' + cz);
          cb.setAttribute('shadow', 'cast: true; receive: false');
          rootEl.appendChild(cb);
        }
      }
    }

    for (var wy = 0; wy < H; wy++) {
      var wx = 0;
      while (wx < W) {
        if (tiles[wy][wx] !== 'wall') {
          wx++;
          continue;
        }
        var wx0 = wx;
        while (wx < W && tiles[wy][wx] === 'wall') wx++;
        var wrun = wx - wx0;
        var wWidth = wrun * cellSize;
        var wcx = wx0 * cellSize + wWidth / 2;
        var wcz = wy * cellSize + cellSize / 2;
        var wb = document.createElement('a-box');
        wb.setAttribute('wall', '');
        if (tierA) {
          wb.setAttribute('data-wg-surf', 'wall');
          applyTierABoxGeometry(wb, wWidth, wallHeight, cellSize, 'wall', cellSize);
        } else {
          wb.setAttribute('color', '#3d4a4f');
          wb.setAttribute('width', String(wWidth));
          wb.setAttribute('height', String(wallHeight));
          wb.setAttribute('depth', String(cellSize));
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

      var wxp = (tx + 0.5) * cellSize;
      var wzp = (ty + 0.5) * cellSize;
      var crate = document.createElement('a-box');
      var s = 0.22 + rng() * 0.18;
      crate.setAttribute('body', 'type: dynamic; mass: 0.85');
      crate.setAttribute('grabbable', 'physics: true; kinematicGrab: true');
      crate.setAttribute('color', randomHexColor(rng));
      crate.setAttribute('width', String(s));
      crate.setAttribute('height', String(s));
      crate.setAttribute('depth', String(s));
      var floorTop = floorThickness;
      var drop = rng() < 0.4 ? 1 + rng() * 2 : 0;
      crate.setAttribute('position', wxp + ' ' + (floorTop + s / 2 + drop).toFixed(2) + ' ' + wzp);
      crate.setAttribute('rotation', '0 ' + Math.floor(rng() * 4) * 90 + ' 0');
      rootEl.appendChild(crate);
    }

    if (tierA) {
      scheduleTierAMaterials(rootEl, {
        seed: seed,
        displacement: options.displacement !== false,
        displacementScaleFloor: options.displacementScaleFloor,
        displacementScaleWall: options.displacementScaleWall,
        displacementScaleCeiling: options.displacementScaleCeiling
      });
    }

    var result = {
      spawnWorld: spawnWorld,
      gridW: W,
      gridH: H,
      markerTile: mt
    };
    if (outGoal) result.goalTile = outGoal;
    return result;
  }

  window.buildAgameTileWorld = buildAgameTileWorld;
})();
