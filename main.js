// Memory Tree landing page behaviour.
// - Live Three.js tree in the hero (tree.js), loaded lazily so a failed CDN or
//   missing WebGL leaves the static tree image in place.
// - Memory card rises from where the blossom lands.
// - Reveal-on-scroll for screenshots and bands.
// Springs use Motion (window.Motion from the pinned UMD build). Apple terms:
// damping 1.0 everywhere in UI = Motion bounce 0; response ≈ visualDuration.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const M = window.Motion;

// UI springs (critically damped, no overshoot)
const SPRING_CARD = { type: 'spring', visualDuration: 0.45, bounce: 0 };
const SPRING_CARD_OUT = { type: 'spring', visualDuration: 0.35, bounce: 0 };
const SPRING_REVEAL = { type: 'spring', visualDuration: 0.6, bounce: 0 };
const FADE = { duration: 0.2, ease: 'easeOut' };

function animate(el, keyframes, options) {
  if (M && M.animate) return M.animate(el, keyframes, options);
  // Fallback without Motion: jump to the final frame.
  for (const [k, v] of Object.entries(keyframes)) {
    const end = Array.isArray(v) ? v[v.length - 1] : v;
    if (k === 'opacity') el.style.opacity = end;
    if (k === 'y') el.style.transform = `translateY(${end}px)`;
  }
  return { finished: Promise.resolve(), stop() {} };
}

// iOS Safari only applies :active on touch if a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

// ---------- Reveal on scroll ----------
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target); // once
      if (REDUCED) {
        e.target.style.transform = 'none';
        animate(e.target, { opacity: [0, 1] }, { duration: 0.3, ease: 'easeOut' });
      } else {
        animate(e.target, { opacity: [0, 1], y: [14, 0] }, SPRING_REVEAL);
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
}

// ---------- Hero tree + memory card ----------
const stage = document.getElementById('stage');
const canvas = document.getElementById('tree-canvas');
const staticImg = document.getElementById('tree-static');
const shakeBtn = document.getElementById('shake');
const card = document.getElementById('memcard');
const cardDate = document.getElementById('card-date');
const cardText = document.getElementById('card-text');
const live = document.getElementById('card-live');

const SAMPLES = [
  ['Monday, 13 October 2025', 'Walked home the long way because the air smelled like rain.'],
  ['Saturday, 11 October 2025', 'Mum called just to say the persimmons are ripe.'],
  ['Saturday, 4 October 2025', 'Found a tiny snail on the balcony rail, going nowhere slowly.'],
];
let sampleIndex = 0;

// Tree framing for the wide hero stage (camera zoom is baked into the scene).
const TREE_OPTS = { count: 48, lens: 1.75, lookY: 1.6, groundRadius: 1.9, fitAspect: 0.85 };

let tree = null;
let cardOpen = false;
let cardTimer = 0;
let cardAnim = null;

function stageSize() {
  const r = stage.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
}

function placeCard(point) {
  const { w, h } = stageSize();
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const pad = 8;
  // Centre over the landing point, sit just above it, keep inside the stage.
  let x = point ? point.x - cw / 2 : (w - cw) / 2;
  let y = point ? point.y - ch - 18 : h - ch - 84;
  x = Math.min(Math.max(pad, x), w - cw - pad);
  y = Math.min(Math.max(pad, y), h - ch - 64);
  card.style.left = `${Math.round(x)}px`;
  card.style.top = `${Math.round(y)}px`;
}

function showCard(point) {
  const [date, text] = SAMPLES[sampleIndex++ % SAMPLES.length];
  cardDate.textContent = date;
  cardText.textContent = text;
  card.hidden = false;
  placeCard(point);
  cardOpen = true;
  live.textContent = `A memory fell: ${date}. ${text} A year ago.`;
  cardAnim && cardAnim.stop();
  if (REDUCED) {
    card.style.transform = 'none';
    cardAnim = animate(card, { opacity: [0, 1] }, FADE);
  } else {
    cardAnim = animate(card, { opacity: [0, 1], y: [26, 0], scale: [0.94, 1] }, SPRING_CARD);
  }
  clearTimeout(cardTimer);
  cardTimer = setTimeout(hideCard, 5500);
}

function hideCard() {
  if (!cardOpen) return;
  cardOpen = false;
  clearTimeout(cardTimer);
  cardAnim && cardAnim.stop();
  const opts = REDUCED ? FADE : SPRING_CARD_OUT;
  const kf = REDUCED ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 };
  cardAnim = animate(card, kf, opts);
  cardAnim.finished.then(() => { if (!cardOpen) card.hidden = true; });
  tree && tree.restoreLeaf();
}

function shake() {
  if (cardOpen) { hideCard(); return; }
  if (tree) {
    tree.shake(); // card appears from onLeafLanded
  } else {
    showCard(null); // static fallback (reduced motion or no WebGL)
  }
}

shakeBtn.addEventListener('click', (e) => { e.stopPropagation(); shake(); });
stage.addEventListener('click', (e) => {
  if (e.target.closest('.memcard')) return;
  shake();
});
card.addEventListener('click', (e) => { e.stopPropagation(); hideCard(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(); });

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

async function initTree() {
  if (!hasWebGL()) return; // keep assets/tree.png
  let mod;
  try { mod = await import('./tree.js'); } catch (err) { console.warn('Tree unavailable, showing the static image.', err); return; }
  const { w, h } = stageSize();

  if (REDUCED) {
    // Static snapshot, no fall; the card cross-fades in on tap.
    try {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const url = mod.renderSnapshot({ ...TREE_OPTS, width: Math.round(w * dpr), height: Math.round(h * dpr) });
      staticImg.src = url;
    } catch { /* keep the shipped image */ }
    return;
  }

  try {
    tree = mod.createLiveTree(canvas, {
      ...TREE_OPTS, width: w, height: h,
      onLeafLanded: ({ point }) => showCard(point),
    });
  } catch (err) {
    console.warn('Live tree failed, showing the static image.', err);
    tree = null;
    return;
  }
  stage.classList.add('live');

  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const s = stageSize();
      tree.resize(s.w, s.h);
      if (cardOpen) placeCard(null);
    });
  }).observe(stage);
}

initTree();
