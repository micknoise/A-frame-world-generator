/**
 * Procedural layout for a-game (floor / wall / grabbable). Classic script: `window.generateWorld`.
 * Near-spawn physics toys sit on a static plinth; do not set `shape`; body autoShape adds it.
 */
(function () {
  'use strict';

  function appendSpawnPhysicsToys(rootEl) {
    const platform = document.createElement('a-box');
    platform.setAttribute('position', '0 0.25 -2');
    platform.setAttribute('color', '#9b5de5');
    platform.setAttribute('width', '1.4');
    platform.setAttribute('height', '0.5');
    platform.setAttribute('depth', '1.4');
    platform.setAttribute('body', 'type: static; mass: 5');
    rootEl.appendChild(platform);

    const half = 0.11;
    const topY = 0.25 + 0.25 + half;
    const toys = [
      { pos: `-0.4 ${topY} -2`, color: '#e63946' },
      { pos: `0 ${topY} -2`, color: '#2a9d8f' },
      { pos: `0.4 ${topY} -2`, color: '#f4a261' }
    ];
    for (const t of toys) {
      const el = document.createElement('a-box');
      el.setAttribute('position', t.pos);
      el.setAttribute('color', t.color);
      el.setAttribute('width', '0.22');
      el.setAttribute('height', '0.22');
      el.setAttribute('depth', '0.22');
      el.setAttribute('body', 'type: dynamic; mass: 0.35');
      el.setAttribute('grabbable', 'physics: true; kinematicGrab: true');
      rootEl.appendChild(el);
    }
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomHexColor(rng) {
    const n = (rng() * 0xffffff) >>> 0;
    return `#${n.toString(16).padStart(6, '0')}`;
  }

  function generateWorld(rootEl, seed) {
    const rng = mulberry32(seed >>> 0);

    const start = document.createElement('a-box');
    start.setAttribute('start', '');
    start.setAttribute('position', '0 0.01 0');
    start.setAttribute('width', '0.02');
    start.setAttribute('height', '0.02');
    start.setAttribute('depth', '0.02');
    start.setAttribute('visible', 'false');
    rootEl.appendChild(start);

    const floor = document.createElement('a-box');
    floor.setAttribute('floor', '');
    floor.setAttribute('color', '#6b9080');
    floor.setAttribute('width', '48');
    floor.setAttribute('height', '0.4');
    floor.setAttribute('depth', '48');
    floor.setAttribute('position', '0 -0.2 0');
    rootEl.appendChild(floor);

    const wallHeight = 3;
    const wallThickness = 0.35;
    const arena = 24;

    const walls = [
      { w: arena * 2, d: wallThickness, x: 0, z: -arena },
      { w: arena * 2, d: wallThickness, x: 0, z: arena },
      { w: wallThickness, d: arena * 2, x: -arena, z: 0 },
      { w: wallThickness, d: arena * 2, x: arena, z: 0 }
    ];

    for (const b of walls) {
      const w = document.createElement('a-box');
      w.setAttribute('wall', '');
      w.setAttribute('color', '#4a5759');
      w.setAttribute('width', String(b.w));
      w.setAttribute('height', String(wallHeight));
      w.setAttribute('depth', String(b.d));
      w.setAttribute('position', `${b.x} ${wallHeight / 2} ${b.z}`);
      rootEl.appendChild(w);
    }

    appendSpawnPhysicsToys(rootEl);

    const crateCount = 18;
    for (let i = 0; i < crateCount; i++) {
      const x = (rng() * 2 - 1) * (arena - 3);
      const z = (rng() * 2 - 1) * (arena - 3);
      if (Math.abs(x) < 0.75 && Math.abs(z + 2) < 0.75) continue;

      const crate = document.createElement('a-box');
      const s = 0.25 + rng() * 0.2;
      crate.setAttribute('body', 'type: dynamic; mass: 0.9');
      crate.setAttribute('grabbable', 'physics: true; kinematicGrab: true');
      crate.setAttribute('color', randomHexColor(rng));
      crate.setAttribute('width', String(s));
      crate.setAttribute('height', String(s));
      crate.setAttribute('depth', String(s));
      const floorY = s / 2;
      const drop = rng() < 0.45 ? 1.2 + rng() * 2.5 : 0;
      crate.setAttribute('position', `${x.toFixed(2)} ${(floorY + drop).toFixed(2)} ${z.toFixed(2)}`);
      crate.setAttribute('rotation', `0 ${Math.floor(rng() * 4) * 90} 0`);
      rootEl.appendChild(crate);
    }

    const debrisCount = 12;
    for (let i = 0; i < debrisCount; i++) {
      const x = (rng() * 2 - 1) * (arena - 4);
      const z = (rng() * 2 - 1) * (arena - 4);
      if (Math.abs(x) < 0.75 && Math.abs(z + 2) < 0.75) continue;

      const rock = document.createElement('a-box');
      const s = 0.12 + rng() * 0.1;
      rock.setAttribute('body', 'type: dynamic; mass: 0.35');
      rock.setAttribute('color', randomHexColor(rng));
      rock.setAttribute('width', String(s));
      rock.setAttribute('height', String(s * 0.6));
      rock.setAttribute('depth', String(s));
      rock.setAttribute(
        'position',
        `${x.toFixed(2)} ${(2 + rng() * 2).toFixed(2)} ${z.toFixed(2)}`
      );
      rock.setAttribute('rotation', `${rng() * 40} ${rng() * 360} ${rng() * 40}`);
      rootEl.appendChild(rock);
    }
  }

  window.generateWorld = generateWorld;
})();
