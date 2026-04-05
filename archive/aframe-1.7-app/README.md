# A-frame-world-generator

Static, client-only procedural scenes using [A-Frame 1.7.0](https://aframe.io/) and [a-game](https://github.com/poeticAndroid/a-game). Core scripts and workers are **local** under `libs/` (no runtime CDN for the main app). No Node.js build step: use any static file server (required for ES modules and the physics worker).

## Run locally

Serve the repo root over HTTP, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`. Optional query: `?seed=42` for a deterministic layout.

**Physics worker / `Unexpected token '<'` / nothing falls:** the worker file must be **minified JavaScript** (starts with `!function`), not HTML. **Do not** download [`accelerate-editor` `cannonWorker.min.js`](https://accelerate-editor.web.app/libs/a-game/cannonWorker.min.js) — it returns **`text/html`**. Use [`unpkg.com/a-game@0.37.0/dist/cannonWorker.min.js`](https://unpkg.com/a-game@0.37.0/dist/cannonWorker.min.js). [`js/main.js`](js/main.js) injects **`<a-scene>` only after** the a-game script loads so **`physics` / `body` exist before the scene initializes** (ESM runs `import aframe` before any `await`; a static scene in HTML would upgrade too early). It sets **`physics="workerUrl: libs/a-game/cannonWorker.min.js; …"`** so the worker is never created with a-game’s built-in default (**jsdelivr v0.33**). If the default runs once, `workerUrl` updates later are ignored and **a-game 0.37 + worker 0.33** breaks inside the worker (`m.length`, etc.). The path is **relative** (no `http:`) so a-game uses **`new Worker(url)`**. Serve over **http(s)** from the repo root. **`?physicsDebug`** turns on physics **`debug: true`** and logs worker info in the console.

**Pointer lock / `WrongDocumentError`:** a-game enables pointer lock on the injected camera; unfocused tabs or IDE iframes reject it. The app turns off `pointerLockEnabled` after load and suppresses that specific unhandled rejection so the console stays clean.

## GitHub Pages

- A [`.nojekyll`](.nojekyll) file is included so paths with underscores are served.
- For a **project site** (`https://user.github.io/REPO/`), uncomment and set [`<base href>`](index.html) in [`index.html`](index.html) to `/REPO/` (trailing slash) so the physics worker path `libs/a-game/cannonWorker.min.js` resolves under the repo.

## Vendored libraries

| Path | Source |
|------|--------|
| [`libs/aframe/aframe-v1.7.0.module.min.js`](libs/aframe/aframe-v1.7.0.module.min.js) | `https://unpkg.com/aframe@1.7.0/dist/aframe-v1.7.0.module.min.js` |
| [`libs/three/three.module.js`](libs/three/three.module.js) | `https://unpkg.com/super-three@0.173.4/build/three.module.js` (matches A-Frame 1.7’s `three` dependency) |
| [`libs/three/three.core.js`](libs/three/three.core.js) | `https://unpkg.com/super-three@0.173.4/build/three.core.js` (peer chunk imported by `three.module.js`) |
| [`libs/a-game/a-game.min.js`](libs/a-game/a-game.min.js) | `https://cdn.jsdelivr.net/npm/a-game@0.37.0/dist/a-game.min.js` |
| [`libs/a-game/cannonWorker.min.js`](libs/a-game/cannonWorker.min.js) | `https://cdn.jsdelivr.net/npm/a-game@0.37.0/dist/cannonWorker.min.js` (**not** accelerate-editor — that URL returns HTML). This repo applies a **one-line patch** in `clipAgainstHull` so `o.faces[u]` is never read when `u < 0` or the face is missing (fixes `TypeError: undefined is not an object (evaluating 'm.length')` in the worker). |
| [`libs/draco/1.5.7/`](libs/draco/1.5.7/) | [Draco decoders](https://www.gstatic.com/draco/versioned/decoders/1.5.7/) (`draco_wasm_wrapper.js`, `draco_decoder.wasm`) — used by the scene `gltf-model` system instead of loading from Google at runtime |
| [`libs/aframe-cdn/`](libs/aframe-cdn/) | Mirrored [cdn.aframe.io](https://cdn.aframe.io/) controllers + fonts (run `node scripts/vendor-aframe-cdn.mjs` after clone or to refresh) |
| [`libs/aframe-inspector/aframe-inspector.min.js`](libs/aframe-inspector/aframe-inspector.min.js) | `https://unpkg.com/aframe-inspector@1.7.x/dist/aframe-inspector.min.js` (scene `inspector` component `url`) |

[`index.html`](index.html) sets **`window.AFRAME_CDN_ROOT`** from `document.baseURI` (so it respects a project-site [`<base href>`](index.html)) and includes an [**import map**](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) for the bare `"three"` specifier. Refresh vendored files if you upgrade versions; keep `a-game.min.js` and `cannonWorker.min.js` on the **same** a-game version.

**Offline / no CDN (main app):** Keep the whole **`libs/`** tree in version control (including the many files under **`libs/aframe-cdn/`**) so air-gapped or no-internet loads keep working. [`js/main.js`](js/main.js) uses an **`OFFLINE_LIBS`** map (same-origin paths) for the injected scene and logs **`[offline]`** errors if physics, Draco, or `AFRAME_CDN_ROOT` ever point at a remote URL.

**Verify vendored files:** `node scripts/verify-offline.mjs` exits with an error if required paths are missing (run after clone or in CI). Controllers/fonts: `node scripts/vendor-aframe-cdn.mjs`.

**Runtime wiring:** **`physics` → `workerUrl: libs/a-game/cannonWorker.min.js`** (not a-game’s jsDelivr default); **`gltf-model` → `dracoDecoderPath: libs/draco/1.5.7/`**; **inspector → `libs/aframe-inspector/`**; **`AFRAME_CDN_ROOT` → `libs/aframe-cdn/`** (see [`index.html`](index.html)). **`stats`** / **rStats** (not used in the default scene) can still pull Google Fonts if you add them.

**Vendor script note:** `scripts/vendor-aframe-cdn.mjs` could not find **`controllers/microsoft/{left,right,universal}.glb`** on the public CDN (404). Windows Mixed Reality controller models may still be requested from the network if you use those controls.

The sample folder [`A-FRAME-1.3-A-GAME-Working/`](A-FRAME-1.3-A-GAME-Working/) still references **Firebase** and other scripts from the public internet; only the **root `index.html` + `js/main.js`** stack above is wired for fully local runtime assets.

**Spurious 404 for `aframe-v1.7.0.module.min.js.map`:** the published ESM file used to end with a `sourceMappingURL` pointing at that map. This repo strips that trailer so DevTools stop requesting a missing map. If you replace the A-Frame file from upstream, run the same strip or vendor the matching `.map` from unpkg.

## `grabbable`: A-Frame 1.7 + a-game

A-Frame **1.7**’s stock [`grabbable`](https://aframe.io/) targets `obb-collider` (XR). **a-game** registers a different `grabbable` (physics grab, `kinematicGrab`, etc.) expected by `grabbing`.

[`js/main.js`](js/main.js) **deletes** A-Frame’s `grabbable` **before** loading the a-game bundle, then loads a-game unchanged. **No** merged component: you get **a-game’s grabber** as published. You may see harmless `shape` / `present` console warnings from the empty `shape` schema on 1.7; physics still runs.

## A-Frame 1.3 fallback (if a-game breaks on 1.7)

a-game is primarily tested against older A-Frame releases. If you see raycaster, physics, or WebXR errors on 1.7:

1. Download a classic bundle, e.g. `https://aframe.io/releases/1.3.0/aframe.min.js`, into `libs/aframe/`.
2. Stop importing the 1.7 module from [`js/main.js`](js/main.js) and load that file with the same `loadClassicScript()` helper used for a-game, **before** a-game.
3. Re-test (see below).

## Manual smoke tests

1. Page loads with no uncaught errors in the console.
2. Physics worker starts (no failed worker network requests).
3. Floor collision: walk on the green floor (WASD / VR locomotion per a-game).
4. Grab a small crate (desktop: reticle + controls per a-game).
5. Optional: enter VR and repeat locomotion and grab.
6. **Spawn vs A-Frame version:** open [`tests/aframe13-procedural-spawn-test.html`](tests/aframe13-procedural-spawn-test.html) (same `generateWorld` logic as [`js/world/generator.js`](js/world/generator.js), but **A-Frame 1.3** from [`A-FRAME-1.3-A-GAME-Working/libs/`](A-FRAME-1.3-A-GAME-Working/libs/)). If crates fall through there too, fix **floor/body spawn order** in the generator, not the 1.7 ESM bootstrap.
