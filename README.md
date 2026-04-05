# A-frame-world-generator

**Everything runs from this repository.** A-Frame 1.3 + a-game: JavaScript, workers, controller mirrors, fonts, and inspector assets live under **`libs/`** and **`js/`**. Clone, serve the repo root over HTTP, open the site — **no npm** for end users.

- **[LIBS.md](LIBS.md)** — folder layout and vendored files.
- **Procedural world** — this README focuses on how generation works and how to plug into it.

---

## Quick start

```bash
python3 -m http.server 8080
```

| URL | What |
|-----|------|
| [http://localhost:8080/](http://localhost:8080/) | Main procedural dungeon (`index.html`) |
| [http://localhost:8080/?seed=42](http://localhost:8080/?seed=42) | Same with fixed seed |
| [http://localhost:8080/examples/](http://localhost:8080/examples/) | Maze, BSP + ridge combinations |
| [http://localhost:8080/glb-room/](http://localhost:8080/glb-room/) | GLB room demo (shared `libs/`) |

**Do not open `index.html` via `file://`.** Relative URLs and the Cannon worker must be same-origin HTTP.

**GitHub Pages (project site):** live site at `https://<user>.github.io/<repo>/`. Document-relative paths usually work without `<base>`. If anything 404s, uncomment `<base href="/A-frame-world-generator/" />` in `index.html` (match your repo name). **[`.nojekyll`](.nojekyll)** at the repo root disables Jekyll so static assets are served as-is.

**Optional check:** `node scripts/verify-offline.mjs` — fails if a tracked path under `libs/` / `js/` is missing.

**Maintainers:** refresh vendors with `node scripts/vendor-libs.mjs`; see [LIBS.md](LIBS.md) for A-Frame / a-game upgrades.

The folder [`A-FRAME-1.3-A-GAME-Working/`](A-FRAME-1.3-A-GAME-Working/) is a legacy sample, **not** used by the root app. Archived A-Frame 1.7 code is in [`archive/aframe-1.7-app/`](archive/aframe-1.7-app/).

---

## How procedural generation works

The pipeline turns a **numeric seed** into a walkable **tile grid**, then into **`<a-box>`** entities tagged for **a-game** (`floor`, `wall`, `start`, physics, `grabbable`). Algorithms are adapted from **[world-gen](https://github.com/micknoise/world-gen)** (tutorial **03 — BSP dungeon**, **09 — ridge dungeon**).

### Pipeline (high level)

```text
seed
  │
  ├─► generateBspDungeon(seed, opts)
  │     Recursive BSP split → room rectangles → L-shaped corridors
  │     Output: tiles[y][x] ∈ { 'floor', 'wall' }, markers, regions
  │
  ├─► WorldGenRidge.sampleRidgeGrid(W, H, seed, opts)
  │     Ridged fbm per cell → open[y][x] boolean (passage vs solid)
  │
  ├─► WorldGenCombine.* (choose strategy)
  │     e.g. carveFromBsp: grow ridge-open walls that touch BSP floor
  │     e.g. unionFloor + floodPruneToComponent: OR masks, then one component
  │     e.g. roomsInRidge: ridge base + BSP room rectangles stamped in
  │
  └─► buildAgameTileWorld(rootEl, tiles, options)
        Merge horizontal runs of floor/wall; optional ceiling, trims, procedural PBR textures (Tier A);
        spawn + crates + toys; optional goal pillar (mazes)
        Returns { spawnWorld, gridW, gridH, markerTile, goalTile? }
```

**Alternate source:** [`generateMaze(seed, opts)`](js/world/maze.js) — perfect maze (recursive backtracker), `markers` with `start` and `goal` where **goal** is the **BFS-farthest** floor tile from start. Feed the same `tiles` into `buildAgameTileWorld` with `goalTile` set from that marker. Example: [`examples/world-maze/`](examples/world-maze/).

The **root** [`index.html`](index.html) uses **carve** (BSP + `carveFromBsp`). **[`examples/`](examples/)** pages document **maze**, **union**, and **rooms-in-ridge** with inline comments.

### Visual detail (Tier A vs basic)

[`buildAgameTileWorld`](js/world/grid-build.js) defaults to **`visualDetail: 'tierA'`**:

- **Ceiling** slabs aligned with merged floor runs (same XZ footprint, at `wallHeight`).
- **Baseboard trims** on floor↔wall edges (merged segments; cosmetic, tagged `trim`, no `floor`/`wall`).
- **Procedural canvas textures** (repeating noise) applied after two `requestAnimationFrame` ticks as `MeshStandardMaterial` on `data-wg-surf` (`floor` / `wall` / `ceiling` / `trim`).
- **Displacement** (default on with tierA): floor/wall/ceiling boxes use **subdivided `BoxGeometry`** (up to 20 segments per axis, A-Frame’s cap) so `displacementMap` + **`displacementScale`** + **`displacementBias`** (`-0.5 * scale` so mid-grey is neutral) can subtly deform the mesh in the vertex shader. The height map is a **separate, smoothed** procedural texture (blur + upscale) so silhouettes stay organic without spikes. **Cannon colliders stay the original boxes** — only the rendered mesh is displaced. Trims skip displacement to save vertices.

The displacement texture is **centered on mid-grey** so `displacementBias = -0.5 × displacementScale` keeps the mesh near its original shape; an off-center map made the effect nearly invisible before.

Albedo / roughness use **texture repeat below 1** so each procedural tile covers more world space (bigger, less “fine sand” look). Tune the `rep*` constants in `scheduleTierAMaterials` if you want even larger features.

Options: **`displacement: false`** to keep PBR maps only; **`displacementScaleFloor` / `displacementScaleWall` / `displacementScaleCeiling`** override amplitudes (world units; defaults ~0.09–0.14 for visible undulation).

Pass **`visualDetail: 'basic'`** to keep the older flat colors only (still merged geometry).

**`goalTile: { x, y }`** — if set and that tile is `floor`, spawns a visible **emissive pillar** at the cell center (no physics body). Use with `generateMaze` for a clear exit landmark.

### Coordinate systems

- **Tile grid:** `tiles[row][col]` with `row` = `y` (top of map is `y = 0`), `col` = `x` (left is `x = 0`). Values are only `'floor'` or `'wall'`.
- **World (A-Frame):** Tile center `(tx, ty)` maps to world position roughly `((tx + 0.5) * cellSize, 0, (ty + 0.5) * cellSize)` with default `cellSize = 1`. Floor boxes sit under the player’s feet; walls extend upward to `wallHeight` (default `3`).

### Script load order (critical)

[`index.html`](index.html) loads scripts in this order:

1. `AFRAME_CDN_ROOT` inline + `js/aframe-cdn-rewrite.js` — local mirror for `cdn.aframe.io` (offline VR assets).
2. `libs/aframe/aframe-v1.3.0.min.js`
3. Inline: delete `AFRAME.components.grabbable` (a-game replaces it).
4. `libs/a-game/a-game.min.js`
5. `js/world/bsp-dungeon.js` → `generateBspDungeon`
6. `js/world/ridge-field.js` → `WorldGenRidge`
7. `js/world/combine-bsp-ridge.js` → `WorldGenCombine`
8. `js/world/grid-build.js` → `buildAgameTileWorld`
9. `js/world/generator.js` → `window.generateWorld`

If you reorder or omit files, `generateWorld` will log an error and fall back to a dummy spawn.

---

## Public API — how to interface with generation

### 1. URL / page-level (no code changes)

- **`?seed=N`** on the root page — integer seed for the full chain (BSP, ridge, crate scatter). Default `1` if missing or invalid.

### 2. `window.generateWorld(rootEl, seed)` — main entry

Defined in [`js/world/generator.js`](js/world/generator.js).

- **Arguments:** `rootEl` — DOM node (typically `#world-root`); `seed` — number (unsigned coercion inside children).
- **Returns:** `{ spawnWorld, gridW, gridH, markerTile, goalTile? }` from `buildAgameTileWorld` (goal only if you passed `goalTile` and it was valid). Use `spawnWorld` to place `<a-player>` after generation.
- **Side effects:** Appends many elements under `rootEl`. Clear `rootEl` first if regenerating.

**Regenerating at runtime:** remove children from `#world-root`, call `generateWorld` again with a new seed, move the player, then refresh a-game raycasters (see [`index.html`](index.html) `refreshRaycasters`).

### 3. Lower-level building blocks

Use these when you write a custom page (like [`examples/world-bsp-ridge-union/index.html`](examples/world-bsp-ridge-union/index.html)) instead of `generateWorld`.

| Symbol | Module | Role |
|--------|--------|------|
| `generateBspDungeon(seed, opts?)` | [`bsp-dungeon.js`](js/world/bsp-dungeon.js) | BSP rooms + corridors → `tiles`, `markers`, `regions` |
| `WorldGenRidge.sampleRidgeGrid(W,H,seed,opts?)` | [`ridge-field.js`](js/world/ridge-field.js) | `{ open, raw }` boolean + float grids |
| `WorldGenCombine.carveFromBsp` / `unionFloor` / `roomsInRidge` / `floodPruneToComponent` | [`combine-bsp-ridge.js`](js/world/combine-bsp-ridge.js) | Merge BSP with ridge |
| `buildAgameTileWorld(rootEl, tiles, opts?)` | [`grid-build.js`](js/world/grid-build.js) | Tiles → DOM + spawn metadata |
| `generateMaze(seed, opts?)` | [`maze.js`](js/world/maze.js) | Perfect maze → `tiles`, `markers` (`start` + `goal`) |

**`generateBspDungeon` options:** `width`, `height`, `minLeafSize`, `maxDepth` — control room count and granularity.

**`sampleRidgeGrid` options:** `scale` (feature size), `octaves` (detail), `threshold` in `0..1` (higher = narrower passages).

**`generateMaze` options:** `width`, `height` — forced odd and ≥ 7.

**`buildAgameTileWorld` options:** `cellSize`, `wallHeight`, `floorThickness`, `ceilingThickness`, `trimHeight`, `trimDepth`, `markerTile`, `goalTile`, `seed`, `includeToys`, `crateCount`, `visualDetail` (`'tierA'` | `'basic'`), `displacement`, `displacementScaleFloor`, `displacementScaleWall`, `displacementScaleCeiling`.

### 4. Customising the root demo

Edit [`js/world/generator.js`](js/world/generator.js):

- **`GRID_W` / `GRID_H`** — map size in tiles.
- **BSP opts** — `minLeafSize`, `maxDepth`.
- **Ridge opts** — `scale`, `octaves`, `threshold`.
- **Combine step** — replace `carveFromBsp` with e.g. `unionFloor` + `floodPruneToComponent(tiles, mk.x, mk.y)` (copy pattern from `examples/`).

Do not change the **tile string values** (`'floor'`, `'wall'`) without updating `grid-build.js` accordingly.

---

## Scene integration (root `index.html`)

After `<a-scene>` emits `loaded`, the boot script:

1. Reads `seed` from `URLSearchParams`.
2. Calls `generateWorld(document.getElementById('world-root'), seed)`.
3. Sets `#player` position from `spawnWorld`.
4. Calls `refreshRaycasters` (twice, with a short delay) so a-game picks up new meshes.
5. Disables pointer lock on desktop for friendlier embedded use.

`index.html` and each `js/world/*.js` file contain **inline comments** explaining edge cases (physics worker URL, double `requestAnimationFrame`, etc.).

---

## Related

- **Upstream tutorials & JSON shape:** [world-gen](https://github.com/micknoise/world-gen) (this repo targets a-game + merged boxes, not the tutorial `AFrameRenderer` nav-mesh path).
- **GLB room:** [`glb-room/index.html`](glb-room/index.html) — heavily commented loader / a-game setup.
