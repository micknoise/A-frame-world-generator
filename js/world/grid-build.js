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
 *   - Static purple platform + three small dynamic grabbable cubes near spawn (optional).
 *   - Scattered dynamic crates on random floor cells (seeded).
 *
 * WORLD SPACE
 * -----------
 *   cellSize (default 1) — one tile = cellSize meters in X and Z.
 *   Tile (tx, tz) cell center: ((tx+0.5)*cellSize, 0, (tz+0.5)*cellSize) with tz = row index y.
 *   Floor boxes sit with their top near y=0; walls rise from y=0 to wallHeight.
 *
 * PUBLIC API
 * ----------
 *   buildAgameTileWorld(rootEl, tiles, options?)
 *     options:
 *       cellSize, wallHeight, floorThickness — geometry scale
 *       markerTile: { x, y } — tile coords for spawn; if not floor, falls back to first floor tile
 *       seed — crate / color RNG (mulberry32)
 *       includeToys — default true (platform + grabbables)
 *       crateCount — default 10
 *     returns { spawnWorld: {x,y,z}, gridW, gridH, markerTile }
 *
 * PERFORMANCE
 * -----------
 * Merging runs along each row reduces entity count vs one box per tile; very large grids still cost
 * physics — tune GRID_W/H in generator.js or lower crateCount for VR.
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

  /** Static plinth + grab toys slightly in front of spawn (-Z) for immediate physics play. */
  function appendSpawnPhysicsToys(rootEl, worldX, worldZ) {
    var platform = document.createElement('a-box');
    platform.setAttribute('position', worldX + ' 0.25 ' + (worldZ - 2));
    platform.setAttribute('color', '#9b5de5');
    platform.setAttribute('width', '1.4');
    platform.setAttribute('height', '0.5');
    platform.setAttribute('depth', '1.4');
    platform.setAttribute('body', 'type: static; mass: 5');
    rootEl.appendChild(platform);

    var half = 0.11;
    var topY = 0.25 + 0.25 + half;
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

  /**
   * @param {HTMLElement} rootEl
   * @param {string[][]} tiles row-major: tiles[y][x]
   * @param {{
   *   cellSize?: number,
   *   wallHeight?: number,
   *   floorThickness?: number,
   *   markerTile?: {x:number,y:number},
   *   seed?: number,
   *   includeToys?: boolean,
   *   crateCount?: number
   * }} [options]
   * @returns {{ spawnWorld: {x:number,y:number,z:number}, gridW: number, gridH: number, markerTile: {x:number,y:number} }}
   */
  function buildAgameTileWorld(rootEl, tiles, options) {
    options = options || {};
    var cellSize = options.cellSize != null ? options.cellSize : 1;
    var wallHeight = options.wallHeight != null ? options.wallHeight : 3;
    var floorThickness = options.floorThickness != null ? options.floorThickness : 0.25;
    var seed = options.seed != null ? options.seed >>> 0 : 1;
    var includeToys = options.includeToys !== false;
    var crateCount = options.crateCount != null ? options.crateCount : 10;

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

    /* One merged box per maximal horizontal run of floor cells in each row. */
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
        fb.setAttribute('color', '#5c6b5c');
        fb.setAttribute('width', String(widthW));
        fb.setAttribute('height', String(floorThickness));
        fb.setAttribute('depth', String(cellSize));
        fb.setAttribute('position', cx + ' ' + floorY + ' ' + cz);
        rootEl.appendChild(fb);
      }
    }

    /* Same run-length idea for walls — tall boxes centered at wallHeight/2. */
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
        wb.setAttribute('color', '#3d4a4f');
        wb.setAttribute('width', String(wWidth));
        wb.setAttribute('height', String(wallHeight));
        wb.setAttribute('depth', String(cellSize));
        wb.setAttribute('position', wcx + ' ' + wallHeight / 2 + ' ' + wcz);
        rootEl.appendChild(wb);
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

    return { spawnWorld: spawnWorld, gridW: W, gridH: H, markerTile: mt };
  }

  window.buildAgameTileWorld = buildAgameTileWorld;
})();
