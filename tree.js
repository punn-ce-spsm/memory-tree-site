// Procedural low-poly sakura tree in Three.js.
// Copied from prototype/tree.js and adapted for the landing-page hero:
// - transparent clear colour so the page's sky gradient shows through
// - optional small ground disc (groundRadius) instead of the full ground plane
// - zoom / lookY passthrough and a resize(width, height) method on the live tree
// - pauses itself when the canvas is off-screen or the tab is hidden
// Exports: createLiveTree(canvas, opts) and renderSnapshot(opts).

import * as THREE from 'three';

export const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Spring (Apple-style: response seconds + damping ratio) ----------
export class Spring {
  constructor({ response = 0.35, damping = 1, value = 0 } = {}) {
    this.configure(response, damping);
    this.value = value; this.target = value; this.velocity = 0;
  }
  configure(response, damping) {
    const w = (2 * Math.PI) / response;
    this.k = w * w; this.c = 2 * damping * w;
  }
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  get settled() { return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.005; }
  snap() { this.value = this.target; this.velocity = 0; }
}

// ---------- Palette ----------
const C = {
  blossom: ['#F7B8CC', '#F4A3BC', '#FFD6E2'],
  trunk: '#7A5C58',
  ground: '#E6EDDC',
  groundShade: '#D8E2C9',
  fog: '#F3E8F0',
  sky: '#FFE3EC',
  earth: '#C9D8B8',
};

const SEED = Number(new URLSearchParams(location.search).get("seed")) || 1234;
const MAX_BLOSSOMS = 320;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _grad;
function toonGradient() {
  if (_grad) return _grad;
  const d = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  _grad = t;
  return t;
}

function perpAt(d, az) {
  const a = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, a).normalize();
  const v = new THREE.Vector3().crossVectors(d, u).normalize();
  return u.multiplyScalar(Math.cos(az)).addScaledVector(v, Math.sin(az));
}

// ---------- Branches ----------
function buildBranches(rng) {
  const group = new THREE.Group();
  const tips = [];
  const mat = new THREE.MeshToonMaterial({ color: C.trunk, gradientMap: toonGradient() });
  const up = new THREE.Vector3(0, 1, 0);
  const MAX_DEPTH = 4;
  const geos = [];

  function branch(pos, dir, len, radius, depth) {
    const segs = depth === 0 ? 3 : 2;
    const p = pos.clone();
    const d = dir.clone();
    for (let s = 0; s < segs; s++) {
      const l = len / segs;
      const rBot = radius * (1 - (s / segs) * 0.35);
      const rTop = radius * (1 - ((s + 1) / segs) * 0.35);
      const geo = new THREE.CylinderGeometry(rTop, rBot, l, 7, 1);
      geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.setFromUnitVectors(up, d);
      m.position.copy(p).addScaledVector(d, l / 2);
      group.add(m);
      // joint sphere hides the seam where the next segment bends
      const jg = new THREE.SphereGeometry(rTop * 1.02, 6, 5);
      geos.push(jg);
      const j = new THREE.Mesh(jg, mat);
      p.addScaledVector(d, l);
      j.position.copy(p);
      group.add(j);
      d.add(perpAt(d, rng() * Math.PI * 2).multiplyScalar(0.14 * rng())).normalize();
    }
    if (depth >= MAX_DEPTH) { tips.push(p.clone()); return; }
    if (depth >= 2) tips.push(p.clone().addScaledVector(d, -len * 0.45));

    const n = depth === 0 ? 4 : rng() < 0.45 ? 3 : 2;
    const az0 = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i * Math.PI * 2) / n + (rng() - 0.5) * 0.9;
      const tilt = depth === 0 ? 0.5 + rng() * 0.25 : 0.38 + rng() * 0.3;
      const perp = perpAt(d, az);
      const nd = d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(perp, Math.sin(tilt));
      nd.y -= 0.09 * depth;
      nd.normalize();
      branch(p.clone(), nd, len * (0.62 + rng() * 0.1), radius * 0.58, depth + 1);
    }
  }

  branch(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0.05, 1, 0).normalize(), 1.35, 0.16, 0);
  return { group, tips, dispose: () => { geos.forEach((g) => g.dispose()); mat.dispose(); } };
}

// ---------- Blossoms ----------
function blossomRadius(count) {
  return THREE.MathUtils.clamp(0.19 - count * 0.0003, 0.085, 0.19);
}

function layoutBlossoms(tips, count, rng) {
  const order = tips.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const base = blossomRadius(count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const tip = order[i % order.length];
    const r = 0.34;
    const off = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2).normalize().multiplyScalar(r * Math.cbrt(rng()));
    out.push({
      pos: tip.clone().add(off),
      scale: base * (0.85 + rng() * 0.3),
      tint: Math.floor(rng() * 3),
      rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)),
    });
  }
  return out;
}

// ---------- Scene ----------
function buildScene({ count, width, height, zoom = 1, lookY = 1.0, groundRadius = 11 }) {
  const rng = mulberry32(SEED);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.fog, 12, 26);

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 80);
  camera.position.set(0, 2.9, 13.5 / zoom);
  camera.lookAt(0, lookY, 0);

  scene.add(new THREE.HemisphereLight(C.sky, C.earth, 1.25));
  const sun = new THREE.DirectionalLight('#FFF4F6', 1.5);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  scene.add(new THREE.AmbientLight('#FFFFFF', 0.2));

  // ground
  const groundGeo = new THREE.CircleGeometry(groundRadius, 48);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ color: C.ground, gradientMap: toonGradient() }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const shadeGeo = new THREE.CircleGeometry(1, 32);
  const shade = new THREE.Mesh(shadeGeo, new THREE.MeshToonMaterial({ color: C.groundShade, gradientMap: toonGradient() }));
  shade.rotation.x = -Math.PI / 2;
  shade.scale.set(1.5, 1, 1);
  shade.position.y = 0.004;
  scene.add(shade);

  // tree
  const tree = new THREE.Group();
  const branches = buildBranches(rng);
  tree.add(branches.group);

  const blossomGeo = new THREE.IcosahedronGeometry(1, 0);
  const blossomMat = new THREE.MeshToonMaterial({ color: '#FFFFFF', gradientMap: toonGradient() });
  const blossoms = new THREE.InstancedMesh(blossomGeo, blossomMat, MAX_BLOSSOMS);
  blossoms.count = 0;
  tree.add(blossoms);
  scene.add(tree);

  const data = layoutBlossoms(branches.tips, count, rng);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const one = new THREE.Vector3(1, 1, 1);
  function writeInstance(i, scaleMul = 1) {
    const b = data[i];
    m.compose(b.pos, b.rot, one.clone().multiplyScalar(b.scale * scaleMul));
    blossoms.setMatrixAt(i, m);
  }
  data.forEach((b, i) => { writeInstance(i); blossoms.setColorAt(i, col.set(C.blossom[b.tint])); });
  blossoms.count = data.length;
  blossoms.instanceMatrix.needsUpdate = true;
  if (blossoms.instanceColor) blossoms.instanceColor.needsUpdate = true;

  return {
    scene, camera, tree, blossoms, data, tips: branches.tips, rng, writeInstance, blossomGeo, blossomMat,
    dispose() { branches.dispose(); blossomGeo.dispose(); blossomMat.dispose(); groundGeo.dispose(); shadeGeo.dispose(); ground.material.dispose(); shade.material.dispose(); },
  };
}

function makeRenderer(canvas, preserve) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  r.setClearColor(0x000000, 0);
  return r;
}

// ---------- Snapshot for static frames ----------
let _snapRenderer;
export function renderSnapshot({ count = 48, width = 393, height = 852, zoom = 1, tilt = 0, falling = null, lookY, groundRadius, fitAspect = 0, lens = 1 } = {}) {
  if (!_snapRenderer) _snapRenderer = makeRenderer(document.createElement('canvas'), true);
  const r = _snapRenderer;
  r.setSize(width, height, false);
  const s = buildScene({ count, width, height, zoom, lookY, groundRadius });
  s.tree.rotation.z = tilt;
  s.camera.zoom = lens * (fitAspect ? Math.min(1, (width / height) / fitAspect) : 1);
  s.camera.updateProjectionMatrix();
  let fallMesh;
  if (falling) {
    // hide one blossom and show it mid-air
    const i = Math.min(falling.index ?? 5, s.data.length - 1);
    if (i >= 0) {
      s.writeInstance(i, 0);
      s.blossoms.instanceMatrix.needsUpdate = true;
      fallMesh = new THREE.Mesh(s.blossomGeo, new THREE.MeshToonMaterial({ color: C.blossom[1], gradientMap: toonGradient() }));
      fallMesh.position.set(falling.x ?? 0.3, falling.y ?? 1.0, falling.z ?? 1.2);
      fallMesh.rotation.set(0.6, 0.3, 0.9);
      fallMesh.scale.setScalar(s.data[i].scale);
      s.scene.add(fallMesh);
    }
  }
  r.render(s.scene, s.camera);
  const url = r.domElement.toDataURL('image/png');
  if (fallMesh) fallMesh.material.dispose();
  s.dispose();
  return url;
}

// ---------- Live tree ----------
export function createLiveTree(canvas, { count = 48, width = 393, height = 852, zoom = 1, lookY, groundRadius, fitAspect = 0, lens = 1, onLeafLanded } = {}) {
  const renderer = makeRenderer(canvas, false);
  renderer.setSize(width, height, false);
  const s = buildScene({ count, width, height, zoom, lookY, groundRadius });
  const { scene, camera, tree, blossoms, data, tips, rng, writeInstance } = s;

  const sway = new Spring({ response: 0.5, damping: 0.42 });
  const pops = []; // { i, spring }
  const hidden = new Set();
  let fall = null; // { mesh, vel, ang, i, squash, state }
  let running = false;
  let last = performance.now();
  let t = 0;

  // ambient petals
  const PETALS = REDUCED_MOTION ? 0 : 14;
  const petalGeo = new THREE.PlaneGeometry(0.09, 0.065);
  const petalMat = new THREE.MeshBasicMaterial({ color: C.blossom[2], side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, Math.max(PETALS, 1));
  petals.count = PETALS;
  const petalState = [];
  for (let i = 0; i < PETALS; i++) petalState.push({ x: (rng() - 0.5) * 5, y: rng() * 3.4, z: (rng() - 0.5) * 3, ph: rng() * 6.28, sp: 0.25 + rng() * 0.25, rx: rng() * 6, ry: rng() * 6 });
  scene.add(petals);
  const pm = new THREE.Matrix4();
  const pq = new THREE.Quaternion();
  const pe = new THREE.Euler();
  const pv = new THREE.Vector3();
  const ps = new THREE.Vector3(1, 1, 1);

  const fallMat = new THREE.MeshToonMaterial({ color: C.blossom[1], gradientMap: toonGradient() });

  function visibleIndices() { return data.map((_, i) => i).filter((i) => !hidden.has(i)); }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;

    // sway: slow idle sine + spring impulse from shakes
    sway.update(dt);
    tree.rotation.z = (REDUCED_MOTION ? 0 : 0.022 * Math.sin(t * 0.6)) + sway.value;
    tree.rotation.x = sway.value * 0.35;

    // blossom pops
    let dirty = false;
    for (let k = pops.length - 1; k >= 0; k--) {
      const p = pops[k];
      p.spring.update(dt);
      writeInstance(p.i, Math.max(0, p.spring.value));
      dirty = true;
      if (p.spring.settled) { writeInstance(p.i, 1); pops.splice(k, 1); }
    }
    if (dirty) blossoms.instanceMatrix.needsUpdate = true;

    // falling leaf
    if (fall) {
      const f = fall;
      if (f.state === 'falling') {
        f.vel.y -= 2.4 * dt;
        f.vel.multiplyScalar(1 - 1.1 * dt);
        f.mesh.position.addScaledVector(f.vel, dt);
        f.mesh.position.x += Math.sin(t * 3.1 + f.ph) * 0.45 * dt;
        f.mesh.rotation.x += f.ang.x * dt; f.mesh.rotation.y += f.ang.y * dt; f.mesh.rotation.z += f.ang.z * dt;
        const floor = f.r * 0.9;
        if (f.mesh.position.y <= floor) {
          f.mesh.position.y = floor;
          f.state = 'landed';
          f.squash = new Spring({ response: 0.3, damping: 0.6, value: 0.55 });
          f.squash.target = 1;
          f.squash.velocity = 4;
          onLeafLanded && onLeafLanded({ index: f.i, point: toScreen(f.mesh.position) });
        }
      } else if (f.state === 'landed') {
        f.squash.update(dt);
        const sy = f.squash.value;
        f.mesh.scale.set(f.r * (2 - sy), f.r * sy, f.r * (2 - sy));
      } else if (f.state === 'leaving') {
        f.squash.update(dt);
        const v = Math.max(0, f.squash.value);
        f.mesh.scale.setScalar(f.r * v);
        f.mesh.position.y += 0.6 * dt;
        if (f.squash.settled) { scene.remove(f.mesh); fall = null; }
      }
    }

    // petals
    if (PETALS) {
      for (let i = 0; i < PETALS; i++) {
        const p = petalState[i];
        p.y -= p.sp * dt;
        p.x += Math.sin(t * 1.3 + p.ph) * 0.25 * dt;
        p.rx += 1.2 * dt; p.ry += 0.8 * dt;
        if (p.y < -0.1) { p.y = 3.6; p.x = (rng() - 0.5) * 5; p.z = (rng() - 0.5) * 3; }
        pe.set(p.rx, p.ry, 0); pq.setFromEuler(pe); pv.set(p.x, p.y, p.z);
        pm.compose(pv, pq, ps); petals.setMatrixAt(i, pm);
      }
      petals.instanceMatrix.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  const _v = new THREE.Vector3();
  function toScreen(worldPos) {
    _v.copy(worldPos).project(camera);
    return { x: ((_v.x + 1) / 2) * width, y: ((1 - _v.y) / 2) * height };
  }

  function start() { if (running) return; running = true; last = performance.now(); renderer.setAnimationLoop(tick); }
  function stop() { running = false; renderer.setAnimationLoop(null); }

  function shake() {
    if (fall) return null;
    const vis = visibleIndices();
    if (!vis.length) return null;
    sway.velocity += (rng() > 0.5 ? 1 : -1) * (REDUCED_MOTION ? 0 : 1.6);
    const i = vis[Math.floor(rng() * vis.length)];
    hidden.add(i);
    writeInstance(i, 0);
    blossoms.instanceMatrix.needsUpdate = true;
    const b = data[i];
    const mesh = new THREE.Mesh(s.blossomGeo, fallMat);
    mesh.material = fallMat.clone(); mesh.material.color.set(C.blossom[b.tint]);
    mesh.position.copy(tree.localToWorld(b.pos.clone()));
    mesh.quaternion.copy(b.rot);
    const r = b.scale * 1.25;
    mesh.scale.setScalar(r);
    scene.add(mesh);
    fall = {
      mesh, i, r, ph: rng() * 6,
      vel: new THREE.Vector3((rng() - 0.5) * 0.5, 0.35, 0.6 + rng() * 0.4),
      ang: new THREE.Vector3((rng() - 0.5) * 5, (rng() - 0.5) * 5, (rng() - 0.5) * 5),
      state: 'falling',
    };
    if (REDUCED_MOTION) { // skip the fall: land immediately
      mesh.position.set(0, r * 0.9, 2.2);
      fall.state = 'landed';
      fall.squash = new Spring({ response: 0.3, damping: 1, value: 1 });
      onLeafLanded && onLeafLanded({ index: i, point: toScreen(mesh.position) });
    }
    return i;
  }

  function restoreLeaf() {
    if (!fall) return;
    const f = fall;
    f.state = 'leaving';
    f.squash = new Spring({ response: 0.35, damping: 1, value: 1 });
    f.squash.target = 0;
    hidden.delete(f.i);
    const sp = new Spring({ response: 0.45, damping: 0.6, value: 0 });
    sp.target = 1;
    pops.push({ i: f.i, spring: sp });
  }

  function addBlossom() {
    if (data.length >= MAX_BLOSSOMS) return data.length;
    const base = blossomRadius(data.length + 1);
    const tip = tips[Math.floor(rng() * tips.length)];
    const off = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(0.2 * Math.cbrt(rng()));
    const b = { pos: tip.clone().add(off), scale: base * (0.9 + rng() * 0.3), tint: Math.floor(rng() * 3), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)) };
    data.push(b);
    const i = data.length - 1;
    blossoms.count = data.length;
    blossoms.setColorAt(i, new THREE.Color(C.blossom[b.tint]));
    blossoms.instanceColor.needsUpdate = true;
    writeInstance(i, 0);
    blossoms.instanceMatrix.needsUpdate = true;
    const sp = new Spring({ response: 0.5, damping: 0.55, value: 0 });
    sp.target = 1;
    pops.push({ i, spring: sp });
    return data.length;
  }

  // lens = camera.zoom (narrower field of view without moving the camera, so the
  // ground keeps the app's low viewing angle). On narrow stages the lens widens so
  // the crown is never cropped.
  function fit() {
    camera.aspect = width / height;
    camera.zoom = lens * (fitAspect ? Math.min(1, camera.aspect / fitAspect) : 1);
    camera.updateProjectionMatrix();
  }
  fit();

  function resize(w, h) {
    width = w; height = h;
    renderer.setSize(w, h, false);
    fit();
    if (!running) renderer.render(scene, camera);
  }

  // pause when off-screen or when the tab is hidden
  let onScreen = false;
  const sync = () => (onScreen && !document.hidden ? start() : stop());
  const io = new IntersectionObserver((es) => es.forEach((e) => { onScreen = e.isIntersecting; sync(); }), { threshold: 0.05 });
  io.observe(canvas);
  document.addEventListener('visibilitychange', sync);

  return { start, stop, shake, restoreLeaf, addBlossom, resize, get count() { return data.length; }, get busy() { return !!fall; }, get running() { return running; } };
}
