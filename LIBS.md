# Where everything lives (all local, committed in this repo)

The app does **not** load scripts or assets from the public internet. After `git clone`, serve the repo root over HTTP and open `index.html` — **no npm install, no vendor script, no CDN.**

## What `index.html` loads

| File | Purpose |
|------|---------|
| `js/aframe-cdn-rewrite.js` | Sends `https://cdn.aframe.io/…` requests to `libs/aframe-cdn/…` |
| `libs/aframe/aframe-v1.3.0.min.js` | A-Frame 1.3.0 (inspector default URL patched to local file below) |
| `libs/a-game/a-game.min.js` | a-game |
| `libs/a-game/cannonWorker.min.js` | Physics worker (`physics="workerUrl: …"`) |
| `js/world/generator.js` | Procedural world |

## `glb-room/` (second demo at repo root)

[`glb-room/index.html`](glb-room/index.html) loads the same **`../libs/`** + **`../js/aframe-cdn-rewrite.js`** as the main app, plus local **`glb-room/room_maru.glb`**, **`spawn-in-circle.js`**, and **`random-color.js`**. Serve from repo root and open `/glb-room/`.

## Under `libs/` (vendored third-party)

- **`libs/aframe/`** — A-Frame UMD bundle.
- **`libs/a-game/`** — a-game + Cannon worker (keep both on the same package version).
- **`libs/aframe-cdn/`** — Full mirror of everything A-Frame 1.3 can request from `cdn.aframe.io` (controllers, fonts, glTF sidecars). Microsoft controllers are mirrored from WebXR Input Profiles into `controllers/microsoft/` (see `scripts/vendor-libs.mjs`).  
  *This tree may also contain extra controller files from older vendor runs; that is harmless.*
- **`libs/aframe-inspector/`** — A-Frame Inspector (used when the inspector is opened; the bundle in `libs/aframe/` is patched to load this path instead of unpkg).
- **`libs/draco/`** — Draco decoder (optional; not referenced by the default `index.html`; keep if you add `gltf-model` + Draco later).

## Maintainer note

`scripts/vendor-libs.mjs` exists **only** to refresh `libs/aframe-cdn/` when **you** upgrade A-Frame or intentionally change the asset list (`scripts/aframe-1.3-cdn-paths.mjs`). **End users and normal clones should not need to run it** — the files are meant to be **committed in git**.

`libs/aframe/aframe-v1.3.0.min.js` contains a **small local patch**: default inspector script URL points at `libs/aframe-inspector/aframe-inspector.min.js` instead of unpkg/aframe.io. Re-apply after replacing the file from upstream (search for `INSPECTOR_DEV_URL` in that file).
