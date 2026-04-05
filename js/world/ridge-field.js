/**
 * Ridged fractal field — adapted from github.com/micknoise/world-gen (tutorials/09-ridge-dungeon).
 * Values are in ~[0,1]; values above threshold read as open passage when sampled on a grid.
 */
(function () {
  'use strict';

  function vnoise(x, y, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var tx = x - xi;
    var ty = y - yi;
    var sx = tx * tx * (3 - 2 * tx);
    var sy = ty * ty * (3 - 2 * ty);
    function h(a, b) {
      var v = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
      return v - Math.floor(v);
    }
    var n00 = h(xi, yi);
    var n10 = h(xi + 1, yi);
    var n01 = h(xi, yi + 1);
    var n11 = h(xi + 1, yi + 1);
    return n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
  }

  function ridgedFbm(x, y, seed, octaves) {
    var v = 0;
    var amp = 1;
    var freq = 1;
    var total = 0;
    for (var i = 0; i < octaves; i++) {
      v += (1 - Math.abs(vnoise(x * freq, y * freq, seed + i * 17) * 2 - 1)) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return v / total;
  }

  /**
   * @param {number} W
   * @param {number} H
   * @param {number} seed
   * @param {{ scale?: number, octaves?: number, threshold?: number }} [opts]
   *   threshold: 0..1, default 0.58
   * @returns {{ open: boolean[][], raw: number[][], width: number, height: number }}
   */
  function sampleRidgeGrid(W, H, seed, opts) {
    opts = opts || {};
    var scale = opts.scale != null ? opts.scale : 12;
    var octaves = opts.octaves != null ? Math.max(1, Math.min(8, opts.octaves | 0)) : 5;
    var threshold = opts.threshold != null ? opts.threshold : 0.58;

    var open = [];
    var raw = [];
    for (var y = 0; y < H; y++) {
      var oRow = [];
      var rRow = [];
      for (var x = 0; x < W; x++) {
        var v = ridgedFbm(x / scale, y / scale, seed, octaves);
        rRow.push(v);
        oRow.push(v > threshold);
      }
      open.push(oRow);
      raw.push(rRow);
    }
    return { open: open, raw: raw, width: W, height: H };
  }

  function makeRidgeFieldFn(seed, scale, octaves) {
    return function (col, row) {
      return ridgedFbm(col / scale, row / scale, seed, octaves);
    };
  }

  window.WorldGenRidge = {
    ridgedFbm: ridgedFbm,
    sampleRidgeGrid: sampleRidgeGrid,
    makeRidgeFieldFn: makeRidgeFieldFn
  };
})();
