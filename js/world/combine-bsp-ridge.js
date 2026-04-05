/**
 * Ways to merge BSP dungeon tiles with ridge noise masks.
 * BSP gives readable rooms/corridors; ridge adds organic cave-like branching.
 */
(function () {
  'use strict';

  function cloneTiles(tiles) {
    var h = tiles.length;
    var w = tiles[0].length;
    var out = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) row.push(tiles[y][x]);
      out.push(row);
    }
    return out;
  }

  /**
   * Union: walkable if BSP floor OR ridge-open. Often creates extra caverns; use flood prune.
   */
  function unionFloor(bspTiles, ridgeOpen) {
    var h = bspTiles.length;
    var w = bspTiles[0].length;
    var out = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) {
        var b = bspTiles[y][x] === 'floor';
        var r = ridgeOpen[y] && ridgeOpen[y][x];
        row.push(b || r ? 'floor' : 'wall');
      }
      out.push(row);
    }
    return out;
  }

  function neighbors4(x, y, w, h) {
    var n = [];
    if (x > 0) n.push([x - 1, y]);
    if (x < w - 1) n.push([x + 1, y]);
    if (y > 0) n.push([x, y - 1]);
    if (y < h - 1) n.push([x, y + 1]);
    return n;
  }

  /**
   * Carve: start from BSP layout; a wall cell becomes floor if ridge says open AND it touches
   * existing floor (4-neighbor). Repeat `passes` times to grow organic tendrils from the dungeon.
   */
  function carveFromBsp(bspTiles, ridgeOpen, passes) {
    passes = passes == null ? 2 : passes;
    var tiles = cloneTiles(bspTiles);
    var h = tiles.length;
    var w = tiles[0].length;
    for (var p = 0; p < passes; p++) {
      var next = cloneTiles(tiles);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (tiles[y][x] !== 'wall') continue;
          if (!ridgeOpen[y] || !ridgeOpen[y][x]) continue;
          var adj = neighbors4(x, y, w, h);
          var touchesFloor = false;
          for (var i = 0; i < adj.length; i++) {
            var ax = adj[i][0];
            var ay = adj[i][1];
            if (tiles[ay][ax] === 'floor') {
              touchesFloor = true;
              break;
            }
          }
          if (touchesFloor) next[y][x] = 'floor';
        }
      }
      tiles = next;
    }
    return tiles;
  }

  /**
   * Ridge-first cavern with rectangular BSP rooms forced open (no BSP corridors unless ridge connects).
   */
  function roomsInRidge(regions, ridgeOpen, width, height) {
    var tiles = [];
    for (var y = 0; y < height; y++) {
      var row = [];
      for (var x = 0; x < width; x++) {
        row.push(ridgeOpen[y] && ridgeOpen[y][x] ? 'floor' : 'wall');
      }
      tiles.push(row);
    }
    for (var r = 0; r < regions.length; r++) {
      var room = regions[r];
      for (var yy = room.y; yy < room.y + room.height; yy++) {
        for (var xx = room.x; xx < room.x + room.width; xx++) {
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) tiles[yy][xx] = 'floor';
        }
      }
    }
    return tiles;
  }

  /**
   * Keep only floor cells reachable from (sx,sy) in 4-neighborhood; rest become wall.
   */
  function floodPruneToComponent(tiles, sx, sy) {
    var h = tiles.length;
    var w = tiles[0].length;
    if (sy < 0 || sy >= h || sx < 0 || sx >= w || tiles[sy][sx] !== 'floor') return tiles;

    var seen = [];
    for (var y = 0; y < h; y++) seen.push(new Uint8Array(w));
    var q = [[sx, sy]];
    seen[sy][sx] = 1;
    for (var qi = 0; qi < q.length; qi++) {
      var cx = q[qi][0];
      var cy = q[qi][1];
      var adj = neighbors4(cx, cy, w, h);
      for (var i = 0; i < adj.length; i++) {
        var nx = adj[i][0];
        var ny = adj[i][1];
        if (seen[ny][nx] || tiles[ny][nx] !== 'floor') continue;
        seen[ny][nx] = 1;
        q.push([nx, ny]);
      }
    }

    var out = [];
    for (var yy = 0; yy < h; yy++) {
      var row = [];
      for (var xx = 0; xx < w; xx++) {
        row.push(seen[yy][xx] ? 'floor' : 'wall');
      }
      out.push(row);
    }
    return out;
  }

  window.WorldGenCombine = {
    unionFloor: unionFloor,
    carveFromBsp: carveFromBsp,
    roomsInRidge: roomsInRidge,
    floodPruneToComponent: floodPruneToComponent
  };
})();
