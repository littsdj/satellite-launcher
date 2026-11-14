// Article effects: a living sky whose debris density follows the story, the
// chain-diagram step-through, the size-ladder reveal and a reading-progress
// satellite. Everything is progressive enhancement: the `fx` class that hides
// elements until revealed is only added once setup has succeeded.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

export function initFx() {
  const story = document.getElementById('story');
  const canvas = story && story.querySelector('.sky-canvas');
  const progress = story && story.querySelector('.orbit-progress');
  if (!story || !('IntersectionObserver' in window)) return;

  const rmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = rmQuery.matches;

  // ---------------------------------------------------------------- sky
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  const css = getComputedStyle(document.documentElement);
  const col = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const C_INK = col('--ink', '#0B1230');
  const C_STAR = col('--starlight', '#EEF1FF');
  const C_DIM = col('--dim', '#A9B3D9');
  const C_HAZ = col('--hazard', '#FF5470');
  const C_TRACK = col('--track', '#5BD6E8');

  const markers = Array.from(story.querySelectorAll('[data-sky]'));
  const markerVal = markers.map((m) => clamp(parseFloat(m.dataset.sky) || 0, 0, 1));
  const markerTop = new Float64Array(markers.length); // document offsets
  let storyTop = 0;
  let storyH = 1;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let scrollY = window.scrollY || 0;
  let density = markerVal.length ? markerVal[0] : 0.2;
  let inView = false;
  let raf = 0;
  let last = 0;
  let scrim = null;

  // Stars: normalized positions, three parallax layers.
  const STAR_COUNT = [90, 60, 34];
  const STAR_SIZE = [1, 1.3, 1.8];
  const STAR_ALPHA = [0.35, 0.5, 0.7];
  const STAR_PARALLAX = [0.03, 0.06, 0.1];
  const stars = STAR_COUNT.map((n) => {
    const a = new Float32Array(n * 2);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
  });

  // Debris pool (typed arrays: nothing is allocated per frame).
  const MAX = 300;
  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const pvx = new Float32Array(MAX);
  const pvy = new Float32Array(MAX);
  const prot = new Float32Array(MAX);
  const pvr = new Float32Array(MAX);
  const plen = new Float32Array(MAX); // 0 = speck
  const pa = new Float32Array(MAX); // base alpha
  const phaz = new Uint8Array(MAX);
  for (let i = 0; i < MAX; i++) {
    px[i] = Math.random();
    py[i] = Math.random();
    const speed = 5 + Math.random() * 16;
    const ang = 0.35 + Math.random() * 0.5; // gentle diagonal
    const dir = Math.random() < 0.5 ? 1 : -1;
    pvx[i] = Math.cos(ang) * speed * dir;
    pvy[i] = Math.sin(ang) * speed * 0.6 * (Math.random() < 0.5 ? 1 : -1);
    prot[i] = Math.random() * TAU;
    pvr[i] = Math.random() < 0.4 ? (Math.random() - 0.5) * 0.8 : 0;
    plen[i] = Math.random() < 0.4 ? 0 : 4 + Math.random() * 9;
    phaz[i] = Math.random() < 0.14 ? 1 : 0;
    pa[i] = (phaz[i] ? 0.35 : 0.45) + Math.random() * (phaz[i] ? 0.25 : 0.4);
  }
  let poolMax = MAX;
  let needScatter = true; // positions are normalized until first size

  const DASH = [6, 12];
  const NO_DASH = [];

  function measureMarkers() {
    const sy = window.scrollY || 0;
    const r = story.getBoundingClientRect();
    storyTop = r.top + sy;
    storyH = Math.max(1, r.height);
    for (let i = 0; i < markers.length; i++) markerTop[i] = markers[i].getBoundingClientRect().top + sy;
  }

  function resize() {
    if (!ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const first = needScatter;
    const ow = W;
    const oh = H;
    W = w;
    H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    poolMax = w < 700 ? 150 : MAX;
    for (let i = 0; i < MAX; i++) {
      if (first) {
        px[i] *= w;
        py[i] *= h;
      } else if (ow && oh) {
        px[i] *= w / ow;
        py[i] *= h / oh;
      }
    }
    needScatter = false;
    // Central scrim: darkens the reading column so debris behind text is dimmer.
    const half = Math.min(w * 0.5, 420);
    const edge = Math.max(0, 0.5 - (half + 110) / w);
    const inner = Math.max(edge, 0.5 - half / w);
    scrim = ctx.createLinearGradient(0, 0, w, 0);
    const clear = 'rgba(11,18,48,0)';
    // On phones the column spans the whole width; a lighter scrim keeps the sky visible.
    const dark = w < 700 ? 'rgba(11,18,48,0.3)' : 'rgba(11,18,48,0.55)';
    scrim.addColorStop(0, clear);
    scrim.addColorStop(edge, clear);
    scrim.addColorStop(inner, dark);
    scrim.addColorStop(1 - inner, dark);
    scrim.addColorStop(1 - edge, clear);
    scrim.addColorStop(1, clear);
    measureMarkers();
  }

  function targetDensity() {
    if (!markers.length) return 0.3;
    const line = scrollY + H * 0.6;
    let v = markerVal[0];
    for (let i = 0; i < markers.length; i++) {
      if (markerTop[i] < line) v = markerVal[i];
    }
    return v;
  }

  function draw(dt, parallax) {
    ctx.clearRect(0, 0, W, H);

    // Stars
    ctx.fillStyle = C_STAR;
    for (let l = 0; l < 3; l++) {
      const arr = stars[l];
      const size = STAR_SIZE[l];
      const off = parallax ? scrollY * STAR_PARALLAX[l] : 0;
      ctx.globalAlpha = STAR_ALPHA[l];
      const n = W < 700 ? arr.length / 2 : arr.length;
      for (let i = 0; i < n; i += 2) {
        let y = (arr[i + 1] * H - off) % H;
        if (y < 0) y += H;
        ctx.fillRect(arr[i] * W, y, size, size);
      }
    }

    // Debris
    const count = density * poolMax;
    if (dt > 0) {
      for (let i = 0; i < poolMax; i++) {
        let x = px[i] + pvx[i] * dt;
        let y = py[i] + pvy[i] * dt;
        if (x < -12) x = W + 12;
        else if (x > W + 12) x = -12;
        if (y < -12) y = H + 12;
        else if (y > H + 12) y = -12;
        px[i] = x;
        py[i] = y;
        prot[i] += pvr[i] * dt;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const colr = pass ? C_HAZ : C_DIM;
      ctx.fillStyle = colr;
      ctx.strokeStyle = colr;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < poolMax; i++) {
        if (phaz[i] !== pass) continue;
        const f = clamp(count - i, 0, 1);
        if (f <= 0.01) continue;
        ctx.globalAlpha = pa[i] * f;
        const len = plen[i];
        if (len === 0) {
          ctx.fillRect(px[i], py[i], 2.4, 2.4);
        } else {
          const dx = Math.cos(prot[i]) * len * 0.5;
          const dy = Math.sin(prot[i]) * len * 0.5;
          ctx.beginPath();
          ctx.moveTo(px[i] - dx, py[i] - dy);
          ctx.lineTo(px[i] + dx, py[i] + dy);
          ctx.stroke();
        }
      }
    }

    // One faint orbit arc at the densest part of the story
    if (density > 0.8) {
      ctx.globalAlpha = ((density - 0.8) / 0.2) * 0.16;
      ctx.strokeStyle = C_TRACK;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DASH);
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.55, W * 0.62, H * 0.3, -0.35, 0, TAU);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }

    // Reading-column scrim
    ctx.globalAlpha = 1;
    if (scrim) {
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function frame(t) {
    raf = 0;
    if (!inView || document.hidden || reduced) return;
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    density += (targetDensity() - density) * (1 - Math.exp(-dt / 0.5));
    draw(dt, true);
    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    if (!ctx || !W) return;
    density = 0.5;
    draw(0, false);
  }

  function sync() {
    const run = inView && !document.hidden && !reduced && !!ctx && W > 0;
    if (run && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // ---------------------------------------------------------------- progress
  let progQueued = false;
  function updateProgress() {
    progQueued = false;
    if (!progress) return;
    const p = clamp((scrollY - storyTop) / Math.max(1, storyH - window.innerHeight), 0, 1);
    progress.style.setProperty('--p', p.toFixed(4));
  }
  function onScroll() {
    scrollY = window.scrollY;
    if (inView && !progQueued) {
      progQueued = true;
      requestAnimationFrame(updateProgress);
    }
  }

  // ---------------------------------------------------------------- observers
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) inView = e.isIntersecting;
      if (inView) {
        measureMarkers();
        scrollY = window.scrollY;
        if (reduced) drawStatic();
        updateProgress();
      }
      sync();
    },
    { rootMargin: '100px' },
  );
  io.observe(story);

  const ioBar = progress
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) progress.classList.toggle('is-on', e.isIntersecting);
        },
        { rootMargin: '-40% 0px -40% 0px' },
      )
    : null;
  if (ioBar) ioBar.observe(story);

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (reduced) drawStatic();
      updateProgress();
    }, 150);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', sync);

  // Article height changes (fonts, opener text) move the markers.
  let roQueued = false;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (roQueued) return;
      roQueued = true;
      requestAnimationFrame(() => {
        roQueued = false;
        measureMarkers();
        updateProgress();
      });
    }).observe(story);
  }

  const onMotionChange = () => {
    reduced = rmQuery.matches;
    if (reduced) {
      sync();
      drawStatic();
    } else {
      sync();
    }
  };
  if (rmQuery.addEventListener) rmQuery.addEventListener('change', onMotionChange);
  else if (rmQuery.addListener) rmQuery.addListener(onMotionChange);

  resize();
  if (reduced) drawStatic();

  // ---------------------------------------------------------------- reveals
  const pastOrIn = (e) => e.isIntersecting || e.boundingClientRect.top < 0;
  const reveal = (selector, threshold, onReveal) => {
    const els = Array.from(story.querySelectorAll(selector));
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!pastOrIn(e)) continue;
          // Already scrolled past (e.g. after the skip button): reveal without fanfare.
          const above = !e.isIntersecting;
          e.target.classList.add('is-in');
          if (onReveal) onReveal(e.target, above);
          obs.unobserve(e.target);
        }
      },
      { threshold },
    );
    els.forEach((el) => obs.observe(el));
  };

  // Ladder: dot stagger delays and count-up numbers.
  story.querySelectorAll('.dots').forEach((box) => {
    const spans = box.children;
    for (let i = 0; i < spans.length; i++) spans[i].style.setProperty('--i', String(Math.min(i, 75)));
  });

  const counters = new Map();
  const NUM_RE = /\d[\d,]*(?:\.\d+)?/;
  story.querySelectorAll('.rung .num').forEach((p) => {
    const m = NUM_RE.exec(p.textContent);
    if (!m) return;
    const txt = p.textContent;
    const i = m.index;
    const span = document.createElement('span');
    span.textContent = m[0];
    p.replaceChildren(txt.slice(0, i), span, txt.slice(i + m[0].length));
    const decimals = m[0].includes('.') ? m[0].split('.')[1].length : 0;
    counters.set(p, { span, final: m[0], value: parseFloat(m[0].replace(/,/g, '')), decimals });
  });

  const fmt = (v, d) =>
    d ? v.toFixed(d) : Math.round(v).toLocaleString('en-US');
  function countUp(c) {
    const start = performance.now();
    const step = (now) => {
      const k = clamp((now - start) / 900, 0, 1);
      if (k >= 1) {
        c.span.textContent = c.final; // exact original text
        return;
      }
      const eased = 1 - Math.pow(1 - k, 3);
      c.span.textContent = fmt(c.value * eased, c.decimals);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const chain = story.querySelector('.chain');
  if (chain) reveal('.chain', 0.35);
  reveal('.rung', 0.4, (rung, above) => {
    const num = rung.querySelector('.num');
    const c = num && counters.get(num);
    if (!c) return;
    if (above || reduced) c.span.textContent = c.final;
    else countUp(c);
  });

  // Prepare count-up start values only now that nothing below can throw.
  if (!reduced) counters.forEach((c) => { c.span.textContent = fmt(0, c.decimals); });

  document.documentElement.classList.add('fx');
}
