/**
 * BSP dungeon grid generator — logic adapted from github.com/micknoise/world-gen
 * (tutorials/03-bsp-dungeon). Produces tile grids compatible with combine + grid-build.
 */
(function () {
  'use strict';

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

  function makeNode(x, y, width, height, depth) {
    return { x: x, y: y, width: width, height: height, depth: depth, left: null, right: null, room: null, center: null };
  }

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

  function connectTree(node, tiles) {
    if (!node.left && !node.right) return node.center;
    var leftCenter = connectTree(node.left, tiles);
    var rightCenter = connectTree(node.right, tiles);
    carveCorridor(tiles, leftCenter, rightCenter);
    node.center = {
      x: Math.floor((leftCenter.x + rightCenter.x) / 2),
      y: Math.floor((leftCenter.y + rightCenter.y) / 2)
    };
    return node.center;
  }

  /**
   * @param {number} seed
   * @param {{ width?: number, height?: number, minLeafSize?: number, maxDepth?: number }} [opts]
   * @returns {{ tiles: string[][], width: number, height: number, markers: Array<{kind:string,x:number,y:number}>, regions: object[] }}
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

    connectTree(root, tiles);

    var markers = nodes.length ? [{ kind: 'start', x: nodes[0].x, y: nodes[0].y }] : [];

    return {
      tiles: tiles,
      width: width,
      height: height,
      markers: markers,
      regions: regions,
      nodes: nodes
    };
  }

  window.generateBspDungeon = generateBspDungeon;
})();
