/**
 * @fileoverview Perfect maze on a tile grid (recursive backtracker) with start + goal markers.
 *
 * Grid uses the same convention as BSP: tiles[y][x] is 'floor' or 'wall'. The algorithm carves
 * 1-cell-wide passages on a lattice of odd coordinates (1,1), (1,3), … with solid walls on even
 * indices and outer border. Every floor cell is reachable (simply connected maze).
 *
 * PUBLIC API
 * ----------
 *   generateMaze(seed, opts?)
 *     opts: { width, height } — both bumped to odd numbers ≥ 7 if needed.
 *     returns { tiles, width, height, markers: [{kind:'start',x,y},{kind:'goal',x,y}] }
 *
 *   Goal tile = farthest floor cell from start by BFS (longest shortest path), good for “other end”
 *   of the maze without storing the full solution tree.
 */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ensureOdd(n, minVal) {
    n = Math.max(minVal, Math.floor(Math.abs(n)));
    if (n % 2 === 0) n += 1;
    return n;
  }

  function createGrid(width, height, fill) {
    var rows = [];
    for (var y = 0; y < height; y++) {
      var row = [];
      for (var x = 0; x < width; x++) row.push(fill);
      rows.push(row);
    }
    return rows;
  }

  /**
   * @param {string[][]} tiles
   * @param {number} sx
   * @param {number} sy
   * @returns {{ x: number, y: number }}
   */
  function farthestFloorBfs(tiles, sx, sy) {
    var H = tiles.length;
    var W = tiles[0].length;
    var bestX = sx;
    var bestY = sy;
    var bestD = 0;
    var seen = [];
    for (var y = 0; y < H; y++) seen.push(new Uint8Array(W));
    var q = [sx, sy, 0];
    seen[sy][sx] = 1;
    for (var qi = 0; qi < q.length; qi += 3) {
      var cx = q[qi];
      var cy = q[qi + 1];
      var d = q[qi + 2];
      if (d > bestD) {
        bestD = d;
        bestX = cx;
        bestY = cy;
      }
      var nbs = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];
      for (var i = 0; i < 4; i++) {
        var nx = nbs[i][0];
        var ny = nbs[i][1];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (seen[ny][nx] || tiles[ny][nx] !== 'floor') continue;
        seen[ny][nx] = 1;
        q.push(nx, ny, d + 1);
      }
    }
    return { x: bestX, y: bestY };
  }

  /**
   * @param {number} seed
   * @param {{ width?: number, height?: number }} [opts]
   */
  function generateMaze(seed, opts) {
    opts = opts || {};
    var W = ensureOdd(opts.width != null ? opts.width : 31, 7);
    var H = ensureOdd(opts.height != null ? opts.height : 21, 7);
    var rng = mulberry32(seed >>> 0);

    var tiles = createGrid(W, H, 'wall');
    var stack = [[1, 1]];
    tiles[1][1] = 'floor';

    function shuffledDirs() {
      var dirs = [
        [0, -2, 0, -1],
        [2, 0, 1, 0],
        [0, 2, 0, 1],
        [-2, 0, -1, 0]
      ];
      for (var i = dirs.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = dirs[i];
        dirs[i] = dirs[j];
        dirs[j] = t;
      }
      return dirs;
    }

    while (stack.length) {
      var top = stack[stack.length - 1];
      var cx = top[0];
      var cy = top[1];
      var dirs = shuffledDirs();
      var advanced = false;
      for (var d = 0; d < 4; d++) {
        var dx = dirs[d][0];
        var dy = dirs[d][1];
        var wx = cx + dirs[d][2];
        var wy = cy + dirs[d][3];
        var nx = cx + dx;
        var ny = cy + dy;
        if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue;
        if (tiles[ny][nx] !== 'wall') continue;
        tiles[wy][wx] = 'floor';
        tiles[ny][nx] = 'floor';
        stack.push([nx, ny]);
        advanced = true;
        break;
      }
      if (!advanced) stack.pop();
    }

    var sx = 1;
    var sy = 1;
    var goal = farthestFloorBfs(tiles, sx, sy);

    return {
      tiles: tiles,
      width: W,
      height: H,
      markers: [
        { kind: 'start', x: sx, y: sy },
        { kind: 'goal', x: goal.x, y: goal.y }
      ]
    };
  }

  window.generateMaze = generateMaze;
})();
