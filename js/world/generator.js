/**
 * Procedural layout for a-game (floor / wall / start / physics toys + crates).
 * Backbone: BSP dungeon + ridge carve (from github.com/micknoise/world-gen tutorials 03 + 09),
 * built through buildAgameTileWorld for merged floor/wall segments.
 *
 * Requires (load before this file): bsp-dungeon.js, ridge-field.js, combine-bsp-ridge.js, grid-build.js
 *
 * @returns {{ spawnWorld: { x: number, y: number, z: number } }}
 */
(function () {
  'use strict';

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
    var tiles = WorldGenCombine.carveFromBsp(bsp.tiles, ridge.open, 2);
    var mk = bsp.markers && bsp.markers[0];
    var markerTile = mk ? { x: mk.x, y: mk.y } : undefined;
    return buildAgameTileWorld(rootEl, tiles, { markerTile: markerTile, seed: seed });
  }

  window.generateWorld = generateWorld;
})();
