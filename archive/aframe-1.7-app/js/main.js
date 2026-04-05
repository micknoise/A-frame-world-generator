/**
 * Native A-Frame 1.7 (ESM) → delete core `grabbable` → a-game (classic IIFE) → scene.
 * a-game registers its own `grabbable`; no patches to A-Frame or merged grab implementation.
 *
 * Offline: all runtime library paths below are same-origin relatives (no `https:`). Pair with
 * `index.html` setting `window.AFRAME_CDN_ROOT` → `libs/aframe-cdn/`. See README + `scripts/verify-offline.mjs`.
 */
import '../libs/aframe/aframe-v1.7.0.module.min.js';

/** Same-origin paths; scene is built in JS only after a-game loads (see module order comment). */
const OFFLINE_LIBS = {
  dracoDecoderPath: 'libs/draco/1.5.7/',
  inspectorUrl: 'libs/aframe-inspector/aframe-inspector.min.js',
  cannonWorker: 'libs/a-game/cannonWorker.min.js?v=hull-guard-1',
  aGameScript: new URL('../libs/a-game/a-game.min.js', import.meta.url).href
};

const AF = globalThis.AFRAME;
if (AF?.components?.grabbable) {
  delete AF.components.grabbable;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

await loadClassicScript(OFFLINE_LIBS.aGameScript);

const { generateWorld } = await import('./world/generator.js');

const seedParam = new URLSearchParams(window.location.search).get('seed');
const seed = seedParam != null ? parseInt(seedParam, 10) || 1 : 1;

const physicsDebug = new URLSearchParams(location.search).has('physicsDebug');
const physicsAttr = physicsDebug
  ? `physics="workerUrl: ${OFFLINE_LIBS.cannonWorker}; gravity: 0 -10 0; debug: true"`
  : `physics="workerUrl: ${OFFLINE_LIBS.cannonWorker}; gravity: 0 -10 0"`;

window.addEventListener('unhandledrejection', (event) => {
  const name = event.reason && event.reason.name;
  const msg = String((event.reason && event.reason.message) || event.reason || '');
  if (name === 'WrongDocumentError' || msg.includes('Pointer lock')) {
    event.preventDefault();
  }
});

const host = document.getElementById('scene-host');
if (!host) {
  throw new Error('#scene-host missing');
}

// Must run after a-game: `import aframe` (above) is synchronous; if <a-scene> were already in the
// DOM it would upgrade before this await chain, so physics/body from a-game would not register.
host.innerHTML = `
  <a-scene
    gltf-model="dracoDecoderPath: ${OFFLINE_LIBS.dracoDecoderPath}"
    inspector="url: ${OFFLINE_LIBS.inspectorUrl}"
    ${physicsAttr}
    loading-screen="enabled: false"
    webxr="optionalFeatures: hand-tracking, local-floor;"
    renderer="colorManagement: true; antialias: true"
  >
    <a-assets></a-assets>
    <a-light type="ambient" color="#ffffff" intensity="0.55"></a-light>
    <a-light type="directional" color="#fff5e6" intensity="0.45" position="2 6 4"></a-light>
    <a-sky color="#b9e8ff"></a-sky>
    <a-entity id="world-root"></a-entity>
    <a-player locomotion grabbing position="0 0 2"></a-player>
  </a-scene>
`;

const scene = host.querySelector('a-scene');
if (!scene) {
  throw new Error('Failed to create <a-scene> under #scene-host');
}
const worldRoot = scene.querySelector('#world-root');
if (!worldRoot) {
  throw new Error('#world-root missing under a-scene');
}

function relaxPointerLockOnCamera() {
  const cam = scene.querySelector('a-camera');
  if (!cam) return;
  cam.setAttribute('look-controls', {
    pointerLockEnabled: false,
    touchEnabled: false
  });
}

function refreshAgameRaycasters(rootScene) {
  rootScene.querySelectorAll('[raycaster]').forEach((el) => {
    const rc = el.components?.raycaster;
    if (rc && typeof rc.refreshObjects === 'function') {
      rc.refreshObjects();
    }
  });
}

scene.addEventListener(
  'loaded',
  () => {
    const ph = scene.systems?.physics;
    const wUrl = ph?.data?.workerUrl;
    if (typeof wUrl === 'string' && (wUrl.includes('://') || wUrl.startsWith('//'))) {
      console.error(
        '[offline] Physics workerUrl must be a same-origin path, not a CDN URL:',
        wUrl
      );
    }
    const cdnRoot = globalThis.AFRAME_CDN_ROOT;
    if (typeof cdnRoot === 'string' && cdnRoot.includes('cdn.aframe.io')) {
      console.error(
        '[offline] window.AFRAME_CDN_ROOT still points at cdn.aframe.io; index.html should set it to libs/aframe-cdn/'
      );
    }
    const gltfSys = scene.systems?.['gltf-model'];
    const dracoPath = gltfSys?.data?.dracoDecoderPath;
    if (
      typeof dracoPath === 'string' &&
      (dracoPath.includes('://') || dracoPath.startsWith('//'))
    ) {
      console.error('[offline] gltf-model dracoDecoderPath must be local:', dracoPath);
    }
    if (physicsDebug) {
      console.info('[physics]', {
        worker: !!ph?.worker,
        workerUrl: ph?.data?.workerUrl,
        bodies: ph?.bodies?.length,
        moving: ph?.movingBodies?.filter(Boolean).length
      });
    }
    ph?.worker?.addEventListener?.('error', (e) => {
      const err = e.error || e.message;
      console.error('[cannon worker]', err || e, e.filename, e.lineno, e.colno);
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          const root = scene.querySelector('#world-root');
          if (!root) {
            console.error('[world] #world-root not found; cannot spawn procedural content');
            return;
          }
          generateWorld(root, seed);
        } catch (err) {
          console.error('[world] generateWorld failed', err);
        }
        requestAnimationFrame(() => {
          refreshAgameRaycasters(scene);
          setTimeout(() => refreshAgameRaycasters(scene), 120);
          requestAnimationFrame(() => requestAnimationFrame(relaxPointerLockOnCamera));
        });
      });
    });
  },
  { once: true }
);
