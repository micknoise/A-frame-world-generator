# A-frame-world-generator

**Everything runs from this repository.** A-Frame 1.3 + a-game: all JavaScript, workers, controller models, fonts, and inspector bits live under **`libs/`** and **`js/`**. Clone, serve the repo root over HTTP, open the site — **no npm, no downloads, no “run a vendor script”** for anyone using or deploying the project.

See **[LIBS.md](LIBS.md)** for the exact layout and what each folder is for.

```bash
python3 -m http.server 8080
# → http://localhost:8080/              procedural world (?seed=42)
# → http://localhost:8080/glb-room/   Maru GLB room (same local libs/)
```

**GitHub Pages (project site):** uncomment `<base href="/REPO_NAME/">` in [`index.html`](index.html). Keep [`.nojekyll`](.nojekyll) at the repo root.

**CI / sanity check (optional):** `node scripts/verify-offline.mjs` — fails if a tracked path under `libs/` / `js/` is missing.

**Upgrading dependencies (maintainers only):** refresh mirrors with `node scripts/vendor-libs.mjs`, update `libs/aframe/aframe-v1.3.0.min.js` / a-game as needed, re-apply the inspector local URL patch if you replace A-Frame (see [LIBS.md](LIBS.md)).

The folder [`A-FRAME-1.3-A-GAME-Working/`](A-FRAME-1.3-A-GAME-Working/) is an old sample and is **not** used by the root app. The archived **A-Frame 1.7** stack is in [`archive/aframe-1.7-app/`](archive/aframe-1.7-app/).
