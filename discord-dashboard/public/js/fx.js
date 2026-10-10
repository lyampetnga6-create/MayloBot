/**
 * Décor animé (landing + dashboard) : aurores, grille en perspective, particules reliées,
 * halo qui suit le curseur. Tout est facultatif : sans JavaScript la page reste lisible,
 * et avec « réduire les animations » activé, plus rien ne bouge.
 */
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

function buildBackground() {
  if (document.querySelector('.bg')) return document.querySelector('.bg');
  const bg = document.createElement('div');
  bg.className = 'bg';
  bg.setAttribute('aria-hidden', 'true');
  for (const c of ['b1', 'b2', 'b3']) {
    const blob = document.createElement('i');
    blob.className = `blob ${c}`;
    bg.append(blob);
  }
  const floor = document.createElement('div');
  floor.className = 'floor';
  const canvas = document.createElement('canvas');
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  bg.append(floor, canvas, vignette);
  document.body.prepend(bg);
  return bg;
}

function particles(canvas, calm) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pointer = { x: -9999, y: -9999 };
  let w = 0;
  let h = 0;
  let dots = [];
  let raf = 0;

  const COLORS = ['168,85,247', '192,132,252', '232,121,249', '129,140,248'];
  const make = () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
    r: Math.random() * 1.6 + 0.6, c: COLORS[(Math.random() * COLORS.length) | 0], a: Math.random() * 0.5 + 0.35,
  });

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(90, Math.max(24, (w * h) / 17000)) * (calm ? 0.5 : 1));
    while (dots.length < target) dots.push(make());
    dots.length = target;
  }

  const LINK = 125;
  function frame(move = true) {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      if (move) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < -10) d.x = w + 10; else if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10; else if (d.y > h + 10) d.y = -10;
        const dx = d.x - pointer.x;
        const dy = d.y - pointer.y;
        const dist = dx * dx + dy * dy;
        if (dist < 14000) { const f = (1 - dist / 14000) * 0.9; d.x += dx * 0.02 * f; d.y += dy * 0.02 * f; }
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${d.c},${d.a})`;
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i];
        const b = dots[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          ctx.strokeStyle = `rgba(168,85,247,${(1 - Math.sqrt(d2) / LINK) * (calm ? 0.12 : 0.22)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
  }

  const loop = () => { frame(); raf = requestAnimationFrame(loop); };
  const start = () => { if (!raf && !reduce.matches && !document.hidden) raf = requestAnimationFrame(loop); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  resize();
  frame(false);
  start();
  window.addEventListener('resize', () => { resize(); if (!raf) frame(false); }, { passive: true });
  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.x = pointer.y = -9999; });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduce.addEventListener?.('change', () => (reduce.matches ? stop() : start()));
}

/** Pose --mx / --my sur l'élément `.spot` survolé : le halo CSS suit le curseur. */
function spotlight() {
  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('.spot') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

const bg = buildBackground();
const calm = document.body.dataset.fx === 'calm';
if (calm) document.body.classList.add('calm');
particles(bg.querySelector('canvas'), calm);
spotlight();
