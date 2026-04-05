/**
 * @fileoverview Binary space partition (BSP) dungeon on a rectangular tile grid.
 *
 * Adapted from github.com/micknoise/world-gen (tutorials/03-bsp-dungeon). Same idea as classic
 * roguelike BSP: recursively split an axis-aligned rectangle into smaller rectangles until leaves
 * are small enough; carve a room in each leaf; connect sibling subtrees with L-shaped corridors
 * (first horizontal, then vertical) so the whole dungeon is one connected floor graph.
 *
 * COORDINATE SYSTEM
 * -----------------
 * - Output tiles is row-major: tiles[y][x] where y = 0 is the top row of the grid, x = 0 is left.
 * - World mapping (in grid-build.js): world X aligns with tile x, world Z aligns with tile y.
 * - Outer border (x=0, x=width-1, y=0, y=height-1) stays wall; carving happens in the inset
 *   rectangle from (1,1) with size (width-2, height-2) so there is always a solid rim.
 *
 * PUBLIC API
 * ----------
 *   generateBspDungeon(seed, opts?)
 *     opts: { width, height, minLeafSize, maxDepth } — all optional with sensible defaults.
 *     returns: { tiles, width, height, markers, regions, nodes }
 *       - markers[0]: { kind:'start', x, y } tile coords for first room center (integer grid coords).
 *       - regions: BSP leaf room rectangles { x, y, width, height } in tile space.
 *
 * RNG
 * ---
 * Seeded deterministic PRNG (same pattern as mulberry32-style mixing) — same seed → same dungeon
 * if width/height/params match.
 */
(function () {
  'use strict';

  /** Deterministic float in [0,1) and int in [min,max] for room placement and splits. */
  function createRng(seed) {
    var state = (Number(seed) >>> 0) || 1;
    return {
      next: function () {
        state = (state + 0x6d2b79f5) | 0;
        var value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      },
      int: function (min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
      }
    };
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

  /** BSP tree node: axis-aligned rectangle in tile space at given recursion depth. */
  function makeNode(x, y, width, height, depth) {
    return { x: x, y: y, width: width, height: height, depth: depth, left: null, right: null, room: null, center: null };
  }

  /**
   * Recursively split the node with a random partition line (vertical = left|right children,
   * horizontal = top|bottom). Stops when maxDepth reached or rectangle too small to split twice.
   */
  function splitNode(node, random, minLeafSize, maxDepth) {
    var canSplitWide = node.width >= minLeafSize * 2;
    var canSplitTall = node.height >= minLeafSize * 2;
    if (node.depth >= maxDepth || (!canSplitWide && !canSplitTall)) return;

    var splitVertical = node.width > node.height;
    if (canSplitWide && canSplitTall) splitVertical = random.next() < 0.5;
    else if (!canSplitWide) splitVertical = false;

    if (splitVertical) {
      var splitAt = random.int(minLeafSize, node.width - minLeafSize);
      node.left = makeNode(node.x, node.y, splitAt, node.height, node.depth + 1);
      node.right = makeNode(node.x + splitAt, node.y, node.width - splitAt, node.height, node.depth + 1);
    } else {
      var splitAtH = random.int(minLeafSize, node.height - minLeafSize);
      node.left = makeNode(node.x, node.y, node.width, splitAtH, node.depth + 1);
      node.right = makeNode(node.x, node.y + splitAtH, node.width, node.height - splitAtH, node.depth + 1);
    }

    splitNode(node.left, random, minLeafSize, maxDepth);
    splitNode(node.right, random, minLeafSize, maxDepth);
  }

  function gatherLeaves(node, leaves) {
    if (!node.left && !node.right) {
      leaves.push(node);
      return;
    }
    if (node.left) gatherLeaves(node.left, leaves);
    if (node.right) gatherLeaves(node.right, leaves);
  }

  /** Random rectangle room strictly inside the leaf, at least 4×4 where possible. */
  function carveRoom(node, random) {
    var maxRoomWidth = Math.max(4, node.width - 2);
    var maxRoomHeight = Math.max(4, node.height - 2);
    var roomWidth = random.int(4, maxRoomWidth);
    var roomHeight = random.int(4, maxRoomHeight);
    var x = random.int(node.x + 1, node.x + node.width - roomWidth - 1);
    var y = random.int(node.y + 1, node.y + node.height - roomHeight - 1);
    node.room = { id: 'room-' + x + '-' + y, kind: 'room', shape: 'rect', x: x, y: y, width: roomWidth, height: roomHeight };
    node.center = { x: Math.floor(x + roomWidth / 2), y: Math.floor(y + roomHeight / 2) };
  }

  function carveRoomTiles(tiles, room) {
    for (var y = room.y; y < room.y + room.height; y += 1) {
      for (var x = room.x; x < room.x + room.width; x += 1) {
        if (tiles[y] && tiles[y][x] !== undefined) tiles[y][x] = 'floor';
      }
    }
  }

  /** Axis-aligned L path: move in X until aligned with end, then in Y (tutorial 03 convention). */
  function carveCorridor(tiles, start, end) {
    var x = start.x;
    var y = start.y;
    while (x !== end.x) {
      if (tiles[y] && tiles[y][x] !== undefined) tiles[y][x] = 'floor';
      x += x < end.x ? 1 : -1;
    }
    while (y !== end.y) {
      if (tiles[y] && tiles[y][x] !== undefined) tiles[y][x] = 'floor';
      y += y < end.y ? 1 : -1;
    }
    if (tiles[y] && tiles[y][x] !== undefined) tiles[y][x] = 'floor';
  }

  /**
   * Post-order walk: connect each pair of child subtrees; propagate a center up the tree.
   * @param {{sx:number,sy:number,ex:number,ey:number}[]|null} [corridorLegs] — when provided, each
   *   axis-aligned leg of every carved L-corridor (same order as carveCorridor: horizontal then vertical).
   */
  function connectTree(node, tiles, corridorLegs) {
    if (!node.left && !node.right) return node.center;
    var leftCenter = connectTree(node.left, tiles, corridorLegs);
    var rightCenter = connectTree(node.right, tiles, corridorLegs);
    carveCorridor(tiles, leftCenter, rightCenter);
    if (corridorLegs) {
      var ax = leftCenter.x;
      var ay = leftCenter.y;
      var bx = rightCenter.x;
      var by = rightCenter.y;
      if (ax !== bx) {
        corridorLegs.push({ sx: ax, sy: ay, ex: bx, ey: ay });
      }
      if (ay !== by) {
        corridorLegs.push({ sx: bx, sy: ay, ex: bx, ey: by });
      }
    }
    node.center = {
      x: Math.floor((leftCenter.x + rightCenter.x) / 2),
      y: Math.floor((leftCenter.y + rightCenter.y) / 2)
    };
    return node.center;
  }

  /**
   * @param {number} seed
   * @param {{ width?: number, height?: number, minLeafSize?: number, maxDepth?: number }} [opts]
   * @returns {{ tiles: string[][], width: number, height: number, markers: Array<{kind:string,x:number,y:number}>, regions: object[], nodes: object[], corridorLegs: {sx:number,sy:number,ex:number,ey:number}[] }}
   */
  function generateBspDungeon(seed, opts) {
    opts = opts || {};
    var width = opts.width != null ? opts.width : 48;
    var height = opts.height != null ? opts.height : 40;
    var minLeafSize = opts.minLeafSize != null ? opts.minLeafSize : 8;
    var maxDepth = opts.maxDepth != null ? opts.maxDepth : 4;

    if (width < minLeafSize * 2 + 2 || height < minLeafSize * 2 + 2) {
      minLeafSize = Math.min(Math.floor(width / 4), Math.floor(height / 4), minLeafSize);
    }

    var random = createRng(seed);
    var root = makeNode(1, 1, width - 2, height - 2, 0);
    splitNode(root, random, minLeafSize, maxDepth);

    var leaves = [];
    gatherLeaves(root, leaves);
    var tiles = createGrid(width, height, 'wall');
    var regions = [];
    var nodes = [];

    for (var i = 0; i < leaves.length; i++) {
      var leaf = leaves[i];
      carveRoom(leaf, random);
      carveRoomTiles(tiles, leaf.room);
      regions.push(leaf.room);
      nodes.push({ id: leaf.room.id, x: leaf.center.x, y: leaf.center.y });
    }

    var corridorLegs = [];
    connectTree(root, tiles, corridorLegs);

    var markers = nodes.length ? [{ kind: 'start', x: nodes[0].x, y: nodes[0].y }] : [];

    return {
      tiles: tiles,
      width: width,
      height: height,
      markers: markers,
      regions: regions,
      nodes: nodes,
      corridorLegs: corridorLegs
    };
  }

  window.generateBspDungeon = generateBspDungeon;
})();
