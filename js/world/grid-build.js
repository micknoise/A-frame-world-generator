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

  /** Canvas grayscale noise for MeshStandardMaterial map + roughnessMap (Tier A). */
  function makeNoiseCanvasTexture(THREE, size, seed, contrast) {
    contrast = contrast == null ? 0.75 : contrast;
    var rng = mulberry32(seed >>> 0);
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(size, size);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var t = rng();
      var v = Math.floor(255 * (0.35 + contrast * t * 0.55));
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Low-frequency blurred heightfield for displacementMap (avoids harsh spikes on subdivided boxes).
   * Neutral mid-grey ≈ 0.5 after bias so displacementScale controls amplitude around the surface.
   */
  function makeDisplacementCanvasTexture(THREE, outSize, seed) {
    var rng = mulberry32(seed >>> 0);
    var n = 36;
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
    outSize = outSize || 128;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = outSize;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(outSize, outSize);
    var data = img.data;
    for (var py = 0; py < outSize; py++) {
      for (var px = 0; px < outSize; px++) {
        var fx = (px / (outSize - 1)) * (n - 1);
        var fy = (py / (outSize - 1)) * (n - 1);
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
        var v = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
        var byte = Math.floor(255 * (0.38 + 0.42 * v));
        var idx = (py * outSize + px) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = byte;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.5, 2.5);
    tex.needsUpdate = true;
    return tex;
  }

  /** A-Frame box geometry is capped at 20 segments per axis (see geometry box schema). */
  function applyTierABoxGeometry(el, width, height, depth, kind, cellSize) {
    var sw;
    var sh;
    var sd;
    if (kind === 'floor' || kind === 'ceiling') {
      sw = Math.max(2, Math.min(20, Math.round(width / Math.max(cellSize * 0.5, 0.05))));
      sd = Math.max(2, Math.min(20, 8));
      sh = 1;
    } else {
      sw = Math.max(2, Math.min(20, Math.round(width / Math.max(cellSize * 0.5, 0.05))));
      sh = Math.max(2, Math.min(20, Math.round(height / 0.4)));
      sd = Math.max(2, Math.min(20, 6));
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
    var scF = matOpts.displacementScaleFloor != null ? matOpts.displacementScaleFloor : 0.042;
    var scW = matOpts.displacementScaleWall != null ? matOpts.displacementScaleWall : 0.028;
    var scC = matOpts.displacementScaleCeiling != null ? matOpts.displacementScaleCeiling : 0.034;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var texFloor = makeNoiseCanvasTexture(THREE, 96, seed ^ 0x243f6a88, 0.85);
        var texWall = makeNoiseCanvasTexture(THREE, 96, (seed + 1) ^ 0x85a308d3, 0.7);
        var texCeil = makeNoiseCanvasTexture(THREE, 96, (seed + 2) ^ 0x13198a2e, 0.55);
        texFloor.repeat.set(2.2, 2.2);
        texWall.repeat.set(1.8, 2.4);
        texCeil.repeat.set(2, 2);
        [texFloor, texWall, texCeil].forEach(function (t) {
          t.needsUpdate = true;
        });

        var dispFloor = useDisp ? makeDisplacementCanvasTexture(THREE, 112, seed ^ 0xdeadbeef) : null;
        var dispWall = useDisp ? makeDisplacementCanvasTexture(THREE, 112, (seed + 3) ^ 0xcafebabe) : null;
        var dispCeil = useDisp ? makeDisplacementCanvasTexture(THREE, 112, (seed + 5) ^ 0x0badf00d) : null;
        if (dispFloor) {
          dispFloor.repeat.set(2.2, 2.2);
          dispWall.repeat.set(1.8, 2.4);
          dispCeil.repeat.set(2, 2);
          [dispFloor, dispWall, dispCeil].forEach(function (t) {
            t.needsUpdate = true;
          });
        }

        var nodes = rootEl.querySelectorAll('[data-wg-surf]');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var kind = el.getAttribute('data-wg-surf');
          var mesh = el.getObject3D('mesh');
          if (!mesh || !mesh.material) continue;
          var map = kind === 'wall' || kind === 'trim' ? texWall : kind === 'ceiling' ? texCeil : texFloor;
          var color =
            kind === 'wall' || kind === 'trim'
              ? 0xc5cdd4
              : kind === 'ceiling'
                ? 0xa8b8c8
                : 0x8faa8e;
          var rough = kind === 'wall' || kind === 'trim' ? 0.82 : kind === 'ceiling' ? 0.88 : 0.86;
          var dispMap = null;
          var dScale = 0;
          var dBias = 0;
          if (useDisp && kind !== 'trim') {
            if (kind === 'floor') {
              dispMap = dispFloor;
              dScale = scF;
            } else if (kind === 'ceiling') {
              dispMap = dispCeil;
              dScale = scC;
            } else {
              dispMap = dispWall;
              dScale = scW;
            }
            dBias = -dScale * 0.5;
          }
          mesh.material.dispose();
          var matParams = {
            color: color,
            map: map,
            roughnessMap: map,
            roughness: rough,
            metalness: 0.06,
            envMapIntensity: 0.45
          };
          if (dispMap && dScale > 0) {
            matParams.displacementMap = dispMap;
            matParams.displacementScale = dScale;
            matParams.displacementBias = dBias;
          }
          mesh.material = new THREE.MeshStandardMaterial(matParams);
        }
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
        if (tierA) {
          tr.setAttribute('data-wg-surf', 'trim');
          tr.setAttribute('material', 'color: #b8c0c8; roughness: 0.88; metalness: 0.05');
        } else tr.setAttribute('color', '#4a5560');
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
        if (tierA) {
          trs.setAttribute('data-wg-surf', 'trim');
          trs.setAttribute('material', 'color: #b8c0c8; roughness: 0.88; metalness: 0.05');
        } else trs.setAttribute('color', '#4a5560');
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
        if (tierA) {
          tre.setAttribute('data-wg-surf', 'trim');
          tre.setAttribute('material', 'color: #b8c0c8; roughness: 0.88; metalness: 0.05');
        } else tre.setAttribute('color', '#4a5560');
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
        if (tierA) {
          trw.setAttribute('data-wg-surf', 'trim');
          trw.setAttribute('material', 'color: #b8c0c8; roughness: 0.88; metalness: 0.05');
        } else trw.setAttribute('color', '#4a5560');
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
          fb.setAttribute('material', 'color: #8faa8e; roughness: 0.9; metalness: 0.04');
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
          cb.setAttribute('material', 'color: #a8b8c8; roughness: 0.92; metalness: 0.05');
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
          wb.setAttribute('material', 'color: #c5cdd4; roughness: 0.85; metalness: 0.06');
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
