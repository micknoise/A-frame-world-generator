/**
 * @fileoverview Entry point for the root demo’s procedural world.
 *
 * PIPELINE (default “carve” hybrid)
 * ---------------------------------
 * 1. generateBspDungeon — rectangular rooms + L-shaped corridors on a 2D grid (tiles[y][x] ∈ 'floor'|'wall').
 * 2. WorldGenRidge.sampleRidgeGrid — ridged fractal noise sampled per cell → boolean “open” mask.
 * 3. WorldGenCombine.carveFromBsp — grow organic pockets: wall → floor only if ridge-open AND touching
 *    existing BSP floor (repeat `passes` times). BSP connectivity is mostly preserved.
 * 4. buildAgameTileWorld — merge horizontal runs of floor/wall into <a-box> entities with a-game tags.
 *
 * PUBLIC API
 * ----------
 *   window.generateWorld(rootEl: HTMLElement, seed: number)
 *     → { spawnWorld: { x, y, z }, gridW, gridH, markerTile }
 *
 * DEPENDENCIES (must be loaded before this file, in order)
 * --------------------------------------------------------
 *   bsp-dungeon.js, ridge-field.js, combine-bsp-ridge.js, grid-build.js
 *
 * CUSTOMISING
 * -----------
 * - Change GRID_W / GRID_H for map size (performance: more cells → more boxes after merge).
 * - Swap step 3 for WorldGenCombine.unionFloor + floodPruneToComponent, or roomsInRidge — see examples/.
 * - Tune BSP opts: minLeafSize, maxDepth. Tune ridge: scale, octaves, threshold (0..1).
 * - buildAgameTileWorld options: cellSize, wallHeight, crateCount, includeToys, markerTile.
 *
 * Algorithm provenance: github.com/micknoise/world-gen tutorials 03 (BSP) + 09 (ridge).
 */
(function () {
  'use strict';

  /** Grid width/height in tiles (rows = height, cols = width). Indexing: tiles[row][col] === tiles[y][x]. */
  var GRID_W = 44;
  var GRID_H = 36;

  function generateWorld(rootEl, seed) {
    if (
      typeof generateBspDungeon !== 'function' ||
      !window.WorldGenRidge ||
      !window.WorldGenCombine ||
      typeof buildAgameTileWorld !== 'function'
    ) {
      console.error(
        'generateWorld: missing BSP/ridge/combine/grid-build scripts. Load js/world/bsp-dungeon.js, ridge-field.js, combine-bsp-ridge.js, grid-build.js before generator.js.'
      );
      return { spawnWorld: { x: 0, y: 0, z: 2 } };
    }

    var bsp = generateBspDungeon(seed, {
      width: GRID_W,
      height: GRID_H,
      minLeafSize: 8,
      maxDepth: 4
    });

    var ridge = WorldGenRidge.sampleRidgeGrid(GRID_W, GRID_H, seed, {
      scale: 13,
      octaves: 5,
      threshold: 0.56
    });

    /* Carve hybrid (default): organic growth from BSP. Alternatives live in examples/*. */
    var tiles = WorldGenCombine.carveFromBsp(bsp.tiles, ridge.open, 2);

    var mk = bsp.markers && bsp.markers[0];
    var markerTile = mk ? { x: mk.x, y: mk.y } : undefined;

    return buildAgameTileWorld(rootEl, tiles, { markerTile: markerTile, seed: seed });
  }

  window.generateWorld = generateWorld;
})();
