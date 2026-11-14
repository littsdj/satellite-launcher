// Canvas renderer for the satellite launcher. DOM-light, no module-level mutable state:
// every piece of state lives inside the closure returned by createRenderer(), so several
// instances can share a page.
//
//   const r = createRenderer(canvas, CONFIG);
//   r.resize();                       // call on size change; returns false if canvas has no size
//   r.render(simOrNull, ui, dt);      // draws one frame (and drains sim effects)
//   r.reset();                        // clears particles / trails (new level)
//   r.getSize();                      // { w, h, scale } in CSS px

const TAU = Math.PI * 2;
const MAX_PARTICLES = 600;
const MAX_RINGS = 40;

// Deterministic PRNG (pure function) so the starfield is stable across resizes.
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(id) {
  let h = 0;
  if (typeof id === 'number') {
    h = Math.imul(id | 0, 2654435761) >>> 0;
  } else {
    const s = String(id);
    h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return ((h >>> 3) % 10007) / 10007;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---- sprite factories (drawn in a -1..1 unit space, facing +x) --------------------------

function makeSprite(drawFn, size = 64) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  g.scale(size / 2, size / 2);
  g.lineJoin = 'round';
  drawFn(g);
  return c;
}

function solarPanel(g, y0, y1, fill, line) {
  // panel spans x -0.3..0.3, y between y0..y1
  const yMin = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  g.fillStyle = fill;
  g.fillRect(-0.32, yMin, 0.64, h);
  g.strokeStyle = line;
  g.lineWidth = 0.035;
  g.strokeRect(-0.32, yMin, 0.64, h);
  g.beginPath();
  const cells = 3;
  for (let i = 1; i < cells; i++) {
    const yy = yMin + (h * i) / cells;
    g.moveTo(-0.32, yy);
    g.lineTo(0.32, yy);
  }
  g.moveTo(0, yMin);
  g.lineTo(0, yMin + h);
  g.stroke();
}

function satelliteSprite(body, stripe, panel, panelLine, outline) {
  return makeSprite((g) => {
    solarPanel(g, 0.3, 0.98, panel, panelLine);
    solarPanel(g, -0.98, -0.3, panel, panelLine);
    // boom between body and panels
    g.fillStyle = outline;
    g.fillRect(-0.04, -0.32, 0.08, 0.64);
    // body
    g.fillStyle = body;
    g.strokeStyle = outline;
    g.lineWidth = 0.05;
    g.beginPath();
    g.rect(-0.3, -0.3, 0.6, 0.6);
    g.fill();
    g.stroke();
    g.fillStyle = stripe;
    g.fillRect(-0.3, -0.07, 0.6, 0.14);
    // dish at front
    g.strokeStyle = body;
    g.lineWidth = 0.06;
    g.beginPath();
    g.arc(0.3, 0, 0.2, -1.1, 1.1);
    g.stroke();
    g.fillStyle = stripe;
    g.beginPath();
    g.arc(0.34, 0, 0.05, 0, TAU);
    g.fill();
  });
}

function derelictSprite() {
  return makeSprite((g) => {
    const panel = '#6b5f55';
    const line = '#3d352e';
    // intact panel (slightly bent)
    g.save();
    g.rotate(0.12);
    solarPanel(g, 0.3, 0.9, panel, line);
    g.restore();
    // broken panel: short, jagged end
    g.fillStyle = panel;
    g.strokeStyle = line;
    g.lineWidth = 0.035;
    g.beginPath();
    g.moveTo(-0.3, -0.3);
    g.lineTo(0.32, -0.3);
    g.lineTo(0.3, -0.55);
    g.lineTo(0.12, -0.5);
    g.lineTo(0.1, -0.68);
    g.lineTo(-0.1, -0.6);
    g.lineTo(-0.16, -0.8);
    g.lineTo(-0.3, -0.52);
    g.closePath();
    g.fill();
    g.stroke();
    // dangling bit
    g.beginPath();
    g.moveTo(-0.1, -0.62);
    g.lineTo(-0.28, -0.98);
    g.stroke();
    // body
    g.fillStyle = '#8c8176';
    g.strokeStyle = '#2f2923';
    g.lineWidth = 0.05;
    g.beginPath();
    g.rect(-0.3, -0.3, 0.6, 0.6);
    g.fill();
    g.stroke();
    g.fillStyle = '#4b433b';
    g.fillRect(-0.3, -0.07, 0.6, 0.14);
    // scorch / dent
    g.fillStyle = '#2f2923';
    g.beginPath();
    g.moveTo(0.1, 0.3);
    g.lineTo(0.3, 0.1);
    g.lineTo(0.3, 0.3);
    g.closePath();
    g.fill();
    // bent antenna
    g.strokeStyle = '#a89c8f';
    g.lineWidth = 0.05;
    g.beginPath();
    g.moveTo(0.3, 0);
    g.lineTo(0.5, 0.1);
    g.lineTo(0.62, 0.32);
    g.stroke();
  });
}

function debrisSprite(seed) {
  return makeSprite((g) => {
    const rnd = mulberry32(seed);
    const n = 7;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.4;
      const r = 0.45 + rnd() * 0.55;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    const grad = g.createLinearGradient(-1, -1, 1, 1);
    grad.addColorStop(0, '#ffb066');
    grad.addColorStop(0.5, '#ff6a2a');
    grad.addColorStop(1, '#a8311a');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = '#ffd9a0';
    g.lineWidth = 0.12;
    g.stroke();
  }, 32);
}

function glowSprite(color, size = 64) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// soft glow: bright core fading to transparent. `rgb` like '255,180,80'
function softGlow(rgb, size = 64) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(' + rgb + ',1)');
  grad.addColorStop(0.2, 'rgba(' + rgb + ',0.55)');
  grad.addColorStop(0.55, 'rgba(' + rgb + ',0.14)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// Particle palettes: 5 types x 4 age stages.
const PARTICLE_PALETTE = [
  // 0 fire: white-hot -> yellow -> orange -> red
  ['255,250,230', '255,220,110', '255,140,40', '200,50,25'],
  // 1 exhaust / cool: white -> cyan -> blue
  ['255,255,255', '170,235,255', '90,170,255', '60,100,220'],
  // 2 gold sparkle
  ['255,255,240', '255,235,140', '255,200,70', '255,170,50'],
  // 3 smoke
  ['235,235,240', '200,200,210', '150,150,165', '110,110,125'],
  // 4 green celebratory
  ['240,255,240', '160,255,180', '90,230,130', '50,180,100'],
];

const RING_COLORS = ['#ffb347', '#ffffff', '#7dffa0', '#ffd84a', '#8fd8ff', '#ff5a3a', '#b9c2d6'];
const RING_GLOW_RGB = ['255,170,70', '255,255,255', '125,255,160', '255,216,74', '143,216,255', '255,90,58', '185,194,214'];

// ------------------------------------------------------------------------------------------

export function createRenderer(canvas, CONFIG) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const SITE = CONFIG.LAUNCH_SITE || { x: 0, y: 1 };

  let dpr = 1;
  let W = 0;
  let H = 0;
  let scale = 1;
  let cx = 0;
  let cy = 0;
  let T = 0; // renderer clock (seconds)
  let frameNo = 0;
  let shakeAmp = 0;
  let shx = 0;
  let shy = 0;
  let burnEmit = 0;

  // ---- sprites -------------------------------------------------------------------------
  const SPR = {
    sat: satelliteSprite('#d8ecff', '#2a7bd6', '#1f5fb8', '#8fd6ff', '#0e2a4d'),
    placed: satelliteSprite('#fff0b8', '#2fae5a', '#1f9a52', '#a6f5bb', '#1d4a2a'),
    player: satelliteSprite('#ffffff', '#ffb62e', '#ffcf4a', '#fff3b0', '#6b4a05'),
    derelict: derelictSprite(),
    debris: [debrisSprite(11), debrisSprite(23), debrisSprite(37)],
  };
  const GLOW = {
    sat: softGlow('95,208,255'),
    placed: softGlow('125,255,154'),
    player: softGlow('255,226,122'),
    debris: softGlow('255,106,42'),
    derelict: softGlow('170,150,130'),
  };
  const PGLOW = [];
  for (let t = 0; t < PARTICLE_PALETTE.length; t++) {
    for (let s = 0; s < 4; s++) PGLOW.push(softGlow(PARTICLE_PALETTE[t][s], 32));
  }
  const RGLOW = RING_GLOW_RGB.map((c) => softGlow(c, 64));

  // ---- starfield -----------------------------------------------------------------------
  const starCanvas = makeCanvas(2, 2);
  const STAR_N = 340;
  const starData = new Float32Array(STAR_N * 5); // x,y,size,bright,tint
  {
    const rnd = mulberry32(90210);
    for (let i = 0; i < STAR_N; i++) {
      starData[i * 5] = rnd();
      starData[i * 5 + 1] = rnd();
      starData[i * 5 + 2] = rnd() < 0.08 ? 1.3 + rnd() * 0.8 : 0.4 + rnd() * 0.8;
      starData[i * 5 + 3] = 0.3 + rnd() * 0.7;
      starData[i * 5 + 4] = Math.floor(rnd() * 7);
    }
  }
  const TWINKLE_N = 36;
  const STAR_TINTS = ['255,255,255', '255,255,255', '255,255,255', '200,220,255', '255,236,205', '255,185,185', '170,205,255'];

  function buildStars() {
    starCanvas.width = canvas.width;
    starCanvas.height = canvas.height;
    const g = starCanvas.getContext('2d');
    const w = starCanvas.width;
    const h = starCanvas.height;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#03050d');
    bg.addColorStop(1, '#080d20');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // faint nebulae
    const neb = [
      [0.18, 0.22, 0.5, '90,60,170', 0.1],
      [0.85, 0.7, 0.55, '40,90,180', 0.09],
      [0.6, 0.12, 0.35, '170,60,120', 0.06],
    ];
    const m = Math.max(w, h);
    for (let i = 0; i < neb.length; i++) {
      const n = neb[i];
      const rg = g.createRadialGradient(n[0] * w, n[1] * h, 0, n[0] * w, n[1] * h, n[2] * m);
      rg.addColorStop(0, 'rgba(' + n[3] + ',' + n[4] + ')');
      rg.addColorStop(1, 'rgba(' + n[3] + ',0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }
    for (let i = TWINKLE_N; i < STAR_N; i++) {
      const x = starData[i * 5] * w;
      const y = starData[i * 5 + 1] * h;
      const s = starData[i * 5 + 2] * dpr;
      const b = starData[i * 5 + 3];
      const tint = STAR_TINTS[starData[i * 5 + 4] | 0];
      g.fillStyle = 'rgba(' + tint + ',' + b.toFixed(2) + ')';
      g.beginPath();
      g.arc(x, y, s, 0, TAU);
      g.fill();
      if (s > 1.4 * dpr) {
        g.fillStyle = 'rgba(' + tint + ',0.12)';
        g.beginPath();
        g.arc(x, y, s * 3, 0, TAU);
        g.fill();
      }
    }
  }

  // ---- Earth assets (world units, unit-disc coordinates) --------------------------------
  const landPath = new Path2D();
  const desertPath = new Path2D();
  const cloudPath = new Path2D();
  {
    const rnd = mulberry32(4242);
    const blobs = [
      [-0.38, 0.32, 0.3],
      [0.42, 0.16, 0.27],
      [0.04, -0.46, 0.3],
      [-0.55, -0.32, 0.17],
      [0.58, -0.42, 0.15],
      [0.12, 0.7, 0.2],
      [-0.1, 0.05, 0.13],
    ];
    for (let b = 0; b < blobs.length; b++) {
      const [bx, by, br] = blobs[b];
      const p1 = rnd() * 6;
      const p2 = rnd() * 6;
      const path = b === 6 ? desertPath : landPath;
      const N = 36;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * TAU;
        const r = br * (1 + 0.32 * Math.sin(3 * t + p1) + 0.2 * Math.sin(5 * t + p2) + 0.1 * Math.sin(9 * t));
        const x = bx + Math.cos(t) * r;
        const y = by + Math.sin(t) * r * 0.85;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU;
      const d = rnd() * 0.8;
      cloudPath.ellipse(Math.cos(a) * d, Math.sin(a) * d, 0.1 + rnd() * 0.18, 0.025 + rnd() * 0.03, rnd() * 3, 0, TAU);
      cloudPath.closePath();
    }
  }

  const earthGrads = {};
  {
    const AT = CONFIG.ATMOSPHERE_TOP || 1.25;
    const ocean = ctx.createRadialGradient(-0.3, 0.3, 0.05, 0, 0, 1.05);
    ocean.addColorStop(0, '#4aa0ee');
    ocean.addColorStop(0.55, '#1e66c0');
    ocean.addColorStop(1, '#0a2c68');
    earthGrads.ocean = ocean;
    const shade = ctx.createRadialGradient(-0.5, 0.5, 0.1, -0.15, 0.15, 1.75);
    shade.addColorStop(0, 'rgba(0,10,40,0)');
    shade.addColorStop(0.45, 'rgba(0,8,34,0.08)');
    shade.addColorStop(0.8, 'rgba(0,4,24,0.55)');
    shade.addColorStop(1, 'rgba(0,2,16,0.85)');
    earthGrads.shade = shade;
    const t0 = (1 - 0.94) / (AT * 1.08 - 0.94);
    const tm = (AT - 0.94) / (AT * 1.08 - 0.94);
    const atmo = ctx.createRadialGradient(0, 0, 0.94, 0, 0, AT * 1.08);
    atmo.addColorStop(0, 'rgba(130,200,255,0.0)');
    atmo.addColorStop(t0, 'rgba(130,200,255,0.55)');
    atmo.addColorStop(t0 + (tm - t0) * 0.45, 'rgba(110,170,255,0.2)');
    atmo.addColorStop(tm, 'rgba(110,150,255,0.07)');
    atmo.addColorStop(1, 'rgba(100,130,255,0)');
    earthGrads.atmo = atmo;
    const bandMin = CONFIG.BAND_MIN || 1.4;
    const bandMax = CONFIG.BAND_MAX || 2.5;
    const band = ctx.createRadialGradient(0, 0, bandMin, 0, 0, bandMax);
    band.addColorStop(0, 'rgba(120,190,255,0.0)');
    band.addColorStop(0.12, 'rgba(120,190,255,0.05)');
    band.addColorStop(0.88, 'rgba(120,190,255,0.05)');
    band.addColorStop(1, 'rgba(120,190,255,0.0)');
    earthGrads.band = band;
  }

  // ---- trails (per-id ring buffers) -----------------------------------------------------
  const trails = new Map();
  function getTrail(id, cap) {
    let tr = trails.get(id);
    if (!tr) {
      tr = { xs: new Float32Array(cap), ys: new Float32Array(cap), n: 0, head: 0, cap, stamp: 0 };
      trails.set(id, tr);
    }
    tr.stamp = frameNo;
    return tr;
  }
  function pushTrail(tr, x, y, minD2) {
    if (tr.n > 0) {
      const i = (tr.head - 1 + tr.cap) % tr.cap;
      const dx = x - tr.xs[i];
      const dy = y - tr.ys[i];
      if (dx * dx + dy * dy < minD2) return;
    }
    tr.xs[tr.head] = x;
    tr.ys[tr.head] = y;
    tr.head = (tr.head + 1) % tr.cap;
    if (tr.n < tr.cap) tr.n++;
  }

  // ---- particles -----------------------------------------------------------------------
  const pX = new Float32Array(MAX_PARTICLES);
  const pY = new Float32Array(MAX_PARTICLES);
  const pVX = new Float32Array(MAX_PARTICLES);
  const pVY = new Float32Array(MAX_PARTICLES);
  const pAge = new Float32Array(MAX_PARTICLES);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pSize = new Float32Array(MAX_PARTICLES); // css px at birth
  const pDrag = new Float32Array(MAX_PARTICLES);
  const pType = new Uint8Array(MAX_PARTICLES);
  let pN = 0;

  function spawn(x, y, vx, vy, life, sizePx, type, drag) {
    if (pN >= MAX_PARTICLES) return;
    const i = pN++;
    pX[i] = x;
    pY[i] = y;
    pVX[i] = vx;
    pVY[i] = vy;
    pAge[i] = 0;
    pLife[i] = life;
    pSize[i] = sizePx;
    pType[i] = type;
    pDrag[i] = drag;
  }

  // ---- rings / flashes / streaks (pooled) -----------------------------------------------
  const rings = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    rings.push({ on: false, kind: 0, x: 0, y: 0, age: 0, dur: 1, maxR: 0.3, col: 0, width: 2 });
  }
  function addRing(kind, x, y, delay, dur, maxR, col, width) {
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = rings[i];
      if (!r.on) {
        r.on = true;
        r.kind = kind;
        r.x = x;
        r.y = y;
        r.age = -delay;
        r.dur = dur;
        r.maxR = maxR;
        r.col = col;
        r.width = width || 2;
        return;
      }
    }
  }

  function addShake(a) {
    if (a > shakeAmp) shakeAmp = Math.min(a, 10);
  }

  // ---- effect spawning -------------------------------------------------------------------
  function handleEffect(e) {
    const x = e.x;
    const y = e.y;
    switch (e.type) {
      case 'launch': {
        const a = e.angle || Math.PI / 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const ox = SITE.x;
        const oy = SITE.y;
        for (let i = 0; i < 16; i++) {
          const spread = (Math.random() - 0.5) * 1.6;
          const sp = 0.1 + Math.random() * 0.35;
          // exhaust goes opposite to the launch direction, fanned out sideways
          const dx = -ca * Math.cos(spread) + sa * Math.sin(spread);
          const dy = -sa * Math.cos(spread) - ca * Math.sin(spread);
          spawn(ox, oy, dx * sp, dy * sp, 0.7 + Math.random() * 0.7, 9 + Math.random() * 12, 3, 1.6);
        }
        for (let i = 0; i < 12; i++) {
          const sp = 0.3 + Math.random() * 0.8;
          const sd = a + Math.PI + (Math.random() - 0.5) * 0.9;
          spawn(ox, oy, Math.cos(sd) * sp, Math.sin(sd) * sp, 0.3 + Math.random() * 0.4, 5 + Math.random() * 5, 0, 2.5);
        }
        addRing(1, ox, oy, 0, 0.35, 0.18, 0, 0);
        addRing(0, ox, oy, 0, 0.5, 0.2, 6, 2);
        break;
      }
      case 'burnStart': {
        addRing(1, x, y, 0, 0.3, 0.14, 4, 0);
        addRing(0, x, y, 0, 0.45, 0.16, 4, 2);
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * TAU;
          const sp = 0.15 + Math.random() * 0.35;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, 4 + Math.random() * 4, 1, 2.2);
        }
        break;
      }
      case 'explosion': {
        const size = clamp(e.size == null ? 0.5 : e.size, 0, 1);
        const thin = pN > 420 ? 0.35 : 1;
        const n = Math.max(4, Math.round((12 + size * 54) * thin));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const sp = (0.15 + Math.random() * 1.1) * (0.55 + size * 0.9);
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * (0.6 + size * 0.6), 3 + Math.random() * (3 + size * 5), 0, 1.8);
        }
        // a few lingering embers
        const ne = Math.round((2 + size * 8) * thin);
        for (let i = 0; i < ne; i++) {
          const a = Math.random() * TAU;
          const sp = 0.05 + Math.random() * 0.25;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.0 + Math.random() * 1.0, 7 + Math.random() * 9, 3, 1.2);
        }
        addRing(1, x, y, 0, 0.28 + size * 0.25, 0.16 + size * 0.42, 1, 0);
        addRing(1, x, y, 0, 0.5 + size * 0.3, 0.12 + size * 0.34, 0, 0);
        addRing(0, x, y, 0, 0.45 + size * 0.45, 0.2 + size * 0.75, 0, 2 + size * 3);
        if (size > 0.45) addRing(0, x, y, 0.07, 0.6 + size * 0.4, 0.15 + size * 0.55, 5, 2);
        if (size > 0.6) addRing(0, x, y, 0, 0.35, 0.1 + size * 0.3, 1, 3);
        if (size > 0.4) addShake(2.5 + size * 6.5);
        break;
      }
      case 'crash': {
        const d = Math.sqrt(x * x + y * y) || 1;
        const ux = x / d;
        const uy = y / d;
        for (let i = 0; i < 30; i++) {
          const spread = (Math.random() - 0.5) * 2.2;
          const ca = Math.cos(spread);
          const sa = Math.sin(spread);
          const dx = ux * ca - uy * sa;
          const dy = ux * sa + uy * ca;
          const sp = 0.1 + Math.random() * 0.8;
          spawn(x, y, dx * sp, dy * sp, 0.5 + Math.random() * 0.9, 4 + Math.random() * 7, Math.random() < 0.3 ? 3 : 0, 1.8);
        }
        addRing(1, x, y, 0, 0.45, 0.3, 0, 0);
        addRing(0, x, y, 0, 0.6, 0.35, 5, 3);
        addShake(5);
        break;
      }
      case 'lost': {
        addRing(2, x, y, 0, 1.6, 0.6, 4, 3);
        for (let i = 0; i < 8; i++) {
          const d = Math.sqrt(x * x + y * y) || 1;
          spawn(x, y, (x / d) * (0.2 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.1, (y / d) * (0.2 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.1, 0.8 + Math.random() * 0.5, 3 + Math.random() * 3, 1, 1.5);
        }
        break;
      }
      case 'orbit': {
        addRing(0, x, y, 0, 0.9, 0.55, 2, 3);
        addRing(0, x, y, 0.18, 0.9, 0.55, 3, 2.5);
        addRing(0, x, y, 0.36, 0.9, 0.55, 1, 2);
        addRing(1, x, y, 0, 0.5, 0.2, 3, 0);
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * TAU + Math.random() * 0.2;
          const sp = 0.2 + Math.random() * 0.45;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.8 + Math.random() * 0.8, 3 + Math.random() * 5, i % 3 === 0 ? 4 : 2, 1.6);
        }
        break;
      }
      default:
        break;
    }
  }

  // ---- coordinate helpers ----------------------------------------------------------------
  function setWorld() {
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * (cx + shx), dpr * (cy + shy));
  }
  function setShaken() {
    ctx.setTransform(dpr, 0, 0, dpr, dpr * shx, dpr * shy);
  }
  function setUi() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- scene pieces ----------------------------------------------------------------------
  function drawStars() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03050d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(starCanvas, Math.round(shx * dpr * 0.5), Math.round(shy * dpr * 0.5));
    // live twinkle
    setUi();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < TWINKLE_N; i++) {
      const x = starData[i * 5] * W;
      const y = starData[i * 5 + 1] * H;
      const s = starData[i * 5 + 2];
      const b = starData[i * 5 + 3];
      const a = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(T * (0.8 + b * 2.2) + i * 1.7));
      ctx.globalAlpha = a * b;
      ctx.fillStyle = '#fff';
      const sz = (s + 0.5) * 1.2;
      ctx.fillRect(x + shx * 0.5 - sz / 2, y + shy * 0.5 - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawEarth() {
    const AT = CONFIG.ATMOSPHERE_TOP || 1.25;
    const px = 1 / scale;
    setWorld();
    ctx.globalCompositeOperation = 'source-over';
    // playable band shading and rings
    ctx.fillStyle = earthGrads.band;
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.BAND_MAX, 0, TAU);
    ctx.arc(0, 0, CONFIG.BAND_MIN, 0, TAU, true);
    ctx.fill();
    ctx.lineWidth = px * 1.2;
    ctx.strokeStyle = 'rgba(150,210,255,0.2)';
    ctx.setLineDash([px * 7, px * 9]);
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.BAND_MIN, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.BAND_MAX, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,210,255,0.08)';
    ctx.setLineDash([px * 3, px * 12]);
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.BURN_MAX_R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // atmosphere glow
    ctx.fillStyle = earthGrads.atmo;
    ctx.beginPath();
    ctx.arc(0, 0, AT * 1.08, 0, TAU);
    ctx.fill();
    // atmosphere edge hint (thin dotted line at the top of the atmosphere)
    ctx.strokeStyle = 'rgba(255,150,110,0.22)';
    ctx.lineWidth = px;
    ctx.setLineDash([px * 2, px * 6]);
    ctx.beginPath();
    ctx.arc(0, 0, AT, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // ocean
    ctx.fillStyle = earthGrads.ocean;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();

    // land + clouds, rotating slowly
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.clip();
    ctx.rotate(T * 0.02);
    ctx.fillStyle = '#3f9d52';
    ctx.fill(landPath);
    ctx.fillStyle = '#b9a45c';
    ctx.fill(desertPath);
    ctx.strokeStyle = 'rgba(170,230,150,0.45)';
    ctx.lineWidth = px * 1.5;
    ctx.stroke(landPath);
    ctx.rotate(T * 0.012);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill(cloudPath);
    ctx.restore();

    // shading
    ctx.fillStyle = earthGrads.shade;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,215,255,0.5)';
    ctx.lineWidth = px * 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.stroke();
  }

  function drawLaunchSite(ui) {
    setShaken();
    const sx = cx + SITE.x * scale;
    const sy = cy - SITE.y * scale;
    const a = Math.atan2(SITE.y, SITE.x);
    const k = clamp(scale / 150, 0.7, 1.5);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-a); // local +x = radially outward
    ctx.scale(k, k);
    // pad
    ctx.fillStyle = '#9aa3b5';
    ctx.fillRect(-2, -9, 4, 18);
    ctx.fillStyle = '#5d6577';
    ctx.fillRect(-2, -9, 1.5, 18);
    // tower
    ctx.strokeStyle = '#d6dcea';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(2, -6);
    ctx.lineTo(15, -6);
    ctx.moveTo(2, -2);
    ctx.lineTo(15, -2);
    ctx.moveTo(4, -6);
    ctx.lineTo(8, -2);
    ctx.lineTo(12, -6);
    ctx.stroke();
    // rocket nub
    ctx.fillStyle = '#f2f4fa';
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.lineTo(11, 2);
    ctx.lineTo(15, 4);
    ctx.lineTo(11, 6);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    // blinking beacon
    const blink = 0.5 + 0.5 * Math.sin(T * 5);
    ctx.fillStyle = 'rgba(255,80,80,' + (0.4 + 0.6 * blink).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(15, -6, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (ui.showAimHint) {
      const pulse = 0.5 + 0.5 * Math.sin(T * 3.2);
      setUi();
      ctx.strokeStyle = 'rgba(255,240,140,' + (0.35 + 0.5 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(-a) * 6 * k, sy + Math.sin(-a) * 6 * k, (15 + pulse * 7) * k, 0, TAU);
      ctx.stroke();
    }
  }

  function trailColor(kind, placed) {
    if (kind === 'debris') return '255,140,70';
    if (kind === 'derelict') return '170,150,130';
    return placed ? '125,255,154' : '110,210,255';
  }

  function drawObjects(sim, objs, n) {
    const px = 1 / scale;
    const lim = Math.max(W, H) / 2 / scale + 0.35;
    const segs = n > 100 ? 2 : 4;
    const segLen = 0.15;
    const trailW = 2 * px;

    // ---- trails
    setWorld();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const o = objs[i];
      if (o.dead || Math.abs(o.x) > lim || Math.abs(o.y) > lim) continue;
      const isDebris = o.kind === 'debris';
      const col = trailColor(o.kind, o.playerPlaced);
      if (o.onRails && o.r > 0.05) {
        const dir = o.omega >= 0 ? 1 : -1;
        const baseA = isDebris ? 0.4 : o.kind === 'derelict' ? 0.22 : 0.55;
        ctx.lineWidth = isDebris ? trailW * 0.8 : trailW * 1.3;
        ctx.strokeStyle = 'rgb(' + col + ')';
        for (let s = 0; s < segs; s++) {
          const f = 1 - s / segs;
          ctx.globalAlpha = baseA * f * f;
          const d0 = s * (0.6 / segs);
          const d1 = (s + 1) * (0.6 / segs) + 0.01;
          ctx.beginPath();
          if (dir > 0) ctx.arc(0, 0, o.r, o.theta - d1, o.theta - d0);
          else ctx.arc(0, 0, o.r, o.theta + d0, o.theta + d1);
          ctx.stroke();
        }
      } else {
        const tr = getTrail(o.id, 16);
        pushTrail(tr, o.x, o.y, 0.00008);
        drawRingTrail(tr, o.x, o.y, col, isDebris ? 0.65 : 0.5, trailW);
      }
    }
    ctx.globalAlpha = 1;

    // ---- glows
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shx), dpr * (cy + shy));
    for (let i = 0; i < n; i++) {
      const o = objs[i];
      if (o.dead || Math.abs(o.x) > lim || Math.abs(o.y) > lim) continue;
      const kind = o.kind;
      const h = spriteHalf(o);
      let g;
      let gs;
      let ga;
      if (kind === 'debris') {
        g = GLOW.debris;
        gs = h * 3.2;
        ga = 0.55;
      } else if (kind === 'derelict') {
        g = GLOW.derelict;
        gs = h * 2.2;
        ga = 0.18;
      } else if (o.playerPlaced) {
        g = GLOW.placed;
        gs = h * 3;
        ga = 0.6;
      } else {
        g = GLOW.sat;
        gs = h * 3;
        ga = 0.55;
      }
      ctx.globalAlpha = ga;
      ctx.drawImage(g, o.x * scale - gs, -o.y * scale - gs, gs * 2, gs * 2);
    }
    ctx.globalAlpha = 1;

    // ---- sprites
    ctx.globalCompositeOperation = 'source-over';
    const ox = dpr * (cx + shx);
    const oy = dpr * (cy + shy);
    for (let i = 0; i < n; i++) {
      const o = objs[i];
      if (o.dead || Math.abs(o.x) > lim || Math.abs(o.y) > lim) continue;
      const kind = o.kind;
      const hh = hash01(o.id);
      const h = spriteHalf(o);
      let ang;
      let spr;
      if (kind === 'debris') {
        ang = T * (2 + hh * 5) * (hh > 0.5 ? 1 : -1) + hh * 6;
        spr = SPR.debris[(hh * 3) | 0];
      } else if (kind === 'derelict') {
        ang = hh * 6 + T * (0.25 + hh * 0.6) * (hh > 0.5 ? 1 : -1);
        spr = SPR.derelict;
      } else {
        ang = headingOf(o);
        spr = o.playerPlaced ? SPR.placed : SPR.sat;
      }
      const c = Math.cos(ang) * dpr;
      const s = Math.sin(ang) * dpr;
      ctx.setTransform(c, -s, s, c, ox + o.x * scale * dpr, oy - o.y * scale * dpr);
      ctx.drawImage(spr, -h, -h, h * 2, h * 2);
    }
  }

  function headingOf(o) {
    const sp2 = o.vx * o.vx + o.vy * o.vy;
    if (sp2 > 1e-8) return Math.atan2(o.vy, o.vx);
    return Math.atan2(o.y, o.x) + Math.PI / 2;
  }

  function spriteHalf(o) {
    const r = (o.radius || 0.03) * scale;
    if (o.kind === 'debris') return clamp(r * 1.5, 3.2, 12);
    if (o.kind === 'derelict') return clamp(r * 1.8, 8, 22);
    return clamp(r * 2, 9, 24);
  }

  // draws a fading polyline of a ring-buffer trail (3 alpha groups); assumes world transform
  function drawRingTrail(tr, hx, hy, col, baseA, lw) {
    const n = tr.n;
    if (n < 1) return;
    ctx.strokeStyle = 'rgb(' + col + ')';
    ctx.lineWidth = lw;
    const groups = n >= 6 ? 3 : 1;
    const per = n / groups;
    for (let g = 0; g < groups; g++) {
      const k0 = Math.floor(g * per);
      const k1 = g === groups - 1 ? n : Math.floor((g + 1) * per) + 1;
      ctx.globalAlpha = baseA * (0.18 + (0.82 * (g + 1)) / groups) * (g === groups - 1 ? 1 : 0.7);
      ctx.beginPath();
      for (let k = k0; k < k1; k++) {
        const idx = (tr.head - n + k + tr.cap * 2) % tr.cap;
        if (k === k0) ctx.moveTo(tr.xs[idx], tr.ys[idx]);
        else ctx.lineTo(tr.xs[idx], tr.ys[idx]);
      }
      if (g === groups - 1) ctx.lineTo(hx, hy);
      ctx.stroke();
    }
  }

  function drawPlayer(p, dt) {
    const px = 1 / scale;
    const hSz = clamp((p.radius || 0.03) * scale * 2.2, 12, 26);
    // trail
    setWorld();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p.onRails && p.r > 0.05) {
      const dir = p.omega >= 0 ? 1 : -1;
      ctx.lineWidth = 2.6 * px;
      ctx.strokeStyle = 'rgb(255,226,140)';
      for (let s = 0; s < 6; s++) {
        const f = 1 - s / 6;
        ctx.globalAlpha = 0.75 * f * f;
        const d0 = s * 0.12;
        const d1 = d0 + 0.125;
        ctx.beginPath();
        if (dir > 0) ctx.arc(0, 0, p.r, p.theta - d1, p.theta - d0);
        else ctx.arc(0, 0, p.r, p.theta + d0, p.theta + d1);
        ctx.stroke();
      }
    } else {
      const tr = getTrail('__player', 56);
      pushTrail(tr, p.x, p.y, 0.00004);
      drawRingTrail(tr, p.x, p.y, '255,226,140', 0.85, 2.8 * px);
    }
    ctx.globalAlpha = 1;

    // burn exhaust particles
    if (p.burning) {
      burnEmit += dt * 110;
      const tx = p.thrustX || 0;
      const ty = p.thrustY || 0;
      while (burnEmit >= 1) {
        burnEmit -= 1;
        const sp = 0.5 + Math.random() * 0.6;
        spawn(
          p.x - tx * 0.03,
          p.y - ty * 0.03,
          (p.vx || 0) * 0.55 - tx * sp + (Math.random() - 0.5) * 0.18,
          (p.vy || 0) * 0.55 - ty * sp + (Math.random() - 0.5) * 0.18,
          0.35 + Math.random() * 0.35,
          3.5 + Math.random() * 4,
          Math.random() < 0.6 ? 0 : 1,
          2.2
        );
      }
    } else {
      burnEmit = 0;
    }

    // glow
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shx), dpr * (cy + shy));
    const pulse = 3 + 0.5 * Math.sin(T * 6);
    const gs = hSz * pulse;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(GLOW.player, p.x * scale - gs, -p.y * scale - gs, gs * 2, gs * 2);
    ctx.globalAlpha = 1;
    // locator ring while flying
    if (!p.settled) {
      const rr = hSz * (1.8 + 0.25 * Math.sin(T * 5));
      ctx.strokeStyle = 'rgba(255,240,170,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x * scale, -p.y * scale, rr, 0, TAU);
      ctx.stroke();
    }

    // flame
    if (p.burning) {
      const tx = p.thrustX || 0;
      const ty = -(p.thrustY || 0); // screen space
      const bx = p.x * scale - tx * hSz * 0.55;
      const by = -p.y * scale - ty * hSz * 0.55;
      const len = hSz * (1.9 + 0.7 * Math.random());
      const wd = hSz * 0.38;
      const nx = -ty;
      const ny = tx;
      ctx.fillStyle = 'rgba(255,120,30,0.85)';
      ctx.beginPath();
      ctx.moveTo(bx + nx * wd, by + ny * wd);
      ctx.lineTo(bx - tx * len, by - ty * len);
      ctx.lineTo(bx - nx * wd, by - ny * wd);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,170,0.95)';
      ctx.beginPath();
      ctx.moveTo(bx + nx * wd * 0.5, by + ny * wd * 0.5);
      ctx.lineTo(bx - tx * len * 0.62, by - ty * len * 0.62);
      ctx.lineTo(bx - nx * wd * 0.5, by - ny * wd * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // sprite
    ctx.globalCompositeOperation = 'source-over';
    let ang;
    if (p.burning && (p.thrustX || p.thrustY)) ang = Math.atan2(p.thrustY, p.thrustX);
    else ang = headingOf(p);
    const c = Math.cos(ang) * dpr;
    const s = Math.sin(ang) * dpr;
    ctx.setTransform(c, -s, s, c, dpr * (cx + shx + p.x * scale), dpr * (cy + shy - p.y * scale));
    ctx.drawImage(SPR.player, -hSz, -hSz, hSz * 2, hSz * 2);
  }

  function updateAndDrawParticles(dt) {
    // update (swap-remove)
    let i = 0;
    while (i < pN) {
      const age = pAge[i] + dt;
      if (age >= pLife[i]) {
        pN--;
        if (i !== pN) {
          pX[i] = pX[pN];
          pY[i] = pY[pN];
          pVX[i] = pVX[pN];
          pVY[i] = pVY[pN];
          pAge[i] = pAge[pN];
          pLife[i] = pLife[pN];
          pSize[i] = pSize[pN];
          pDrag[i] = pDrag[pN];
          pType[i] = pType[pN];
        }
        continue;
      }
      pAge[i] = age;
      const damp = Math.max(0, 1 - pDrag[i] * dt);
      pVX[i] *= damp;
      pVY[i] *= damp;
      pX[i] += pVX[i] * dt;
      pY[i] += pVY[i] * dt;
      i++;
    }
    // draw
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shx), dpr * (cy + shy));
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < pN; k++) {
      const t = pAge[k] / pLife[k];
      const stage = t < 0.2 ? 0 : t < 0.5 ? 1 : t < 0.8 ? 2 : 3;
      const spr = PGLOW[pType[k] * 4 + stage];
      const sz = pSize[k] * (1 - t * 0.55);
      const a = (1 - t) * (pType[k] === 3 ? 0.4 : 1);
      ctx.globalAlpha = a;
      ctx.drawImage(spr, pX[k] * scale - sz, -pY[k] * scale - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
  }

  function updateAndDrawRings(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shx), dpr * (cy + shy));
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = rings[i];
      if (!r.on) continue;
      r.age += dt;
      if (r.age >= r.dur) {
        r.on = false;
        continue;
      }
      if (r.age < 0) continue;
      const t = r.age / r.dur;
      const e = 1 - (1 - t) * (1 - t) * (1 - t); // ease out
      const sx = r.x * scale;
      const sy = -r.y * scale;
      if (r.kind === 0) {
        const rad = r.maxR * scale * (0.15 + 0.85 * e);
        ctx.globalAlpha = (1 - t) * (1 - t) * 0.95;
        ctx.strokeStyle = RING_COLORS[r.col];
        ctx.lineWidth = Math.max(0.8, r.width * (1 - t));
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, TAU);
        ctx.stroke();
      } else if (r.kind === 1) {
        const rad = r.maxR * scale * (0.35 + 0.65 * e);
        ctx.globalAlpha = (1 - t) * (1 - t);
        ctx.drawImage(RGLOW[r.col], sx - rad, sy - rad, rad * 2, rad * 2);
      } else {
        // 'lost' streak: arrow flying outward, fading
        const d = Math.sqrt(r.x * r.x + r.y * r.y) || 1;
        const ux = r.x / d;
        const uy = -r.y / d;
        const len = 18 + 70 * e;
        const x0 = sx + ux * 8 * e;
        const y0 = sy + uy * 8 * e;
        const x1 = x0 + ux * len;
        const y1 = y0 + uy * len;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = RING_COLORS[r.col];
        ctx.fillStyle = RING_COLORS[r.col];
        ctx.lineWidth = r.width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 + ux * 10, y1 + uy * 10);
        ctx.lineTo(x1 - uy * 6, y1 + ux * 6);
        ctx.lineTo(x1 + uy * 6, y1 - ux * 6);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function powerColor(p) {
    return 'hsl(' + Math.round(125 - 125 * p) + ',95%,58%)';
  }

  function drawAim(ui) {
    setUi();
    const sx = cx + SITE.x * scale;
    const sy = cy - SITE.y * scale;
    const a = ui.angle;
    const p = ui.power;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const col = powerColor(p);
    const maxPull = 0.35 * Math.min(W, H);
    const pull = p * maxPull;
    const bx = sx - dx * pull;
    const by = sy - dy * pull;
    const nx = -dy;
    const ny = dx;

    // elastic band
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx + nx * 9, sy + ny * 9);
    ctx.lineTo(bx, by);
    ctx.lineTo(sx - nx * 9, sy - ny * 9);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // aim arrow (launch direction), length shows power
    const len = 26 + p * maxPull * 0.85;
    const ex = sx + dx * len;
    const ey = sy + dy * len;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex + dx * 13, ey + dy * 13);
    ctx.lineTo(ex + nx * 8, ey + ny * 8);
    ctx.lineTo(ex - nx * 8, ey - ny * 8);
    ctx.closePath();
    ctx.fill();

    // trajectory preview dots
    const pts = ui.pts;
    if (pts && pts.length > 1) {
      const n = pts.length;
      const step = Math.max(1, Math.floor(n / 44));
      ctx.fillStyle = '#fff';
      for (let i = step; i < n; i += step) {
        const q = pts[i];
        const f = i / n;
        ctx.globalAlpha = 0.9 * (1 - f) * (1 - f * 0.4);
        ctx.beginPath();
        ctx.arc(cx + q.x * scale, cy - q.y * scale, 2.8 - 1.3 * f, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHintText(text, x, y, alpha, size) {
    ctx.font = '600 ' + size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const padX = 10;
    const hw = tw / 2 + padX;
    const cxp = clamp(x, hw + 6, W - hw - 6);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,10,28,0.7)';
    const bh = size + 12;
    const rx = cxp - hw;
    const ry = y - bh / 2;
    ctx.beginPath();
    const rad = bh / 2;
    ctx.moveTo(rx + rad, ry);
    ctx.lineTo(rx + hw * 2 - rad, ry);
    ctx.arc(rx + hw * 2 - rad, ry + rad, rad, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(rx + rad, ry + bh);
    ctx.arc(rx + rad, ry + rad, rad, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cxp, y + 0.5);
    ctx.globalAlpha = 1;
  }

  // ---- public ----------------------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 2 || h < 2) return false;
    const nd = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * nd);
    const ph = Math.round(h * nd);
    if (pw === canvas.width && ph === canvas.height && nd === dpr && w === W && h === H) return true;
    dpr = nd;
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    W = w;
    H = h;
    cx = w / 2;
    cy = h / 2;
    scale = Math.min(w, h) / 2 / CONFIG.VIEW_RADIUS;
    buildStars();
    return true;
  }

  function reset() {
    pN = 0;
    for (let i = 0; i < MAX_RINGS; i++) rings[i].on = false;
    trails.clear();
    shakeAmp = 0;
    burnEmit = 0;
  }

  function render(sim, ui, dt) {
    if (W < 2 || H < 2) return;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    T += dt;
    frameNo++;

    // effects from the sim
    if (sim) {
      const fx = sim.drainEffects();
      if (fx) for (let i = 0; i < fx.length; i++) handleEffect(fx[i]);
    }

    // shake
    if (shakeAmp > 0.25) {
      shx = (Math.random() * 2 - 1) * shakeAmp;
      shy = (Math.random() * 2 - 1) * shakeAmp;
      shakeAmp *= Math.exp(-dt * 8);
    } else {
      shakeAmp = 0;
      shx = 0;
      shy = 0;
    }

    drawStars();
    drawEarth();
    drawLaunchSite(ui);

    ctx.globalCompositeOperation = 'source-over';
    if (sim) {
      const objs = sim.objects;
      drawObjects(sim, objs, objs.length);
      ctx.globalCompositeOperation = 'source-over';
      if (sim.player) drawPlayer(sim.player, dt);
    }
    updateAndDrawParticles(dt);
    updateAndDrawRings(dt);

    // prune trails of vanished objects
    if (trails.size > 0 && (frameNo & 15) === 0) {
      for (const [id, tr] of trails) {
        if (frameNo - tr.stamp > 2) trails.delete(id);
      }
    }

    // UI overlays
    ctx.globalCompositeOperation = 'source-over';
    if (ui.dragging) drawAim(ui);
    setUi();
    const fs = W < 420 ? 12 : 14;
    if (ui.showAimHint && ui.hintText !== false && !ui.dragging) {
      const sx = cx + SITE.x * scale;
      const sy = cy - SITE.y * scale;
      drawHintText('Drag back to aim, let go to launch', sx, Math.max(fs + 14, sy - 44), 0.75 + 0.25 * Math.sin(T * 3.2), fs);
    }
    if (ui.showBurnHint && ui.hintText !== false) {
      drawHintText('SPACE / tap to burn', W / 2, H - 24, 0.65 + 0.35 * Math.sin(T * 5), fs);
    }
    ctx.globalAlpha = 1;
  }

  function getSize() {
    return { w: W, h: H, scale };
  }

  return { resize, render, reset, getSize };
}
