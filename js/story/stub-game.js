// Demo stand-in for the real engine (js/game/index.js). Same interface,
// fake physics: after a launch and a burn it picks a random outcome.
// Debug keys (stub only): O/C/L/X force orbit/crash/lost/collision next.

const TAU = Math.PI * 2;
const KEY_OUTCOMES = { o: 'orbit', c: 'crash', l: 'lost', x: 'collision' };

export function createGame(canvas, { onEvent = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  let level = null;
  let phase = 'aiming';
  let orbiting = 0;
  let objects = [];
  let paused = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let drag = null;
  let flightT = 0;
  let burnT = 0;
  let forced = null;
  let active = false;

  const emit = (type, detail = {}) => {
    try { onEvent(type, detail); } catch (e) { console.error(e); }
  };

  const geo = () => {
    const R = Math.min(w, h) * 0.16;
    return { cx: w / 2, cy: h * 0.68, R, inner: R * 1.35, span: R * 1.6 };
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro && ro.observe(canvas);
  resize();

  function normaliseTraffic(t) {
    if (Array.isArray(t)) return t.map((o) => ({ kind: 'satellite', name: 'Satellite', ...o }));
    return Array.from({ length: t || 0 }, (_, i) => ({
      altitude: ((i * 0.37) % 0.8) + 0.1,
      angle: (i * 2.399) % TAU,
      kind: 'satellite',
      name: 'Satellite',
    }));
  }

  function loadLevel(l) {
    level = l;
    objects = normaliseTraffic(l.traffic);
    orbiting = 0;
    phase = 'aiming';
    drag = null;
    forced = null;
  }

  const inputOpen = () => !paused && (phase === 'aiming' || phase === 'flight');

  function startBurn() {
    phase = 'confirming';
    burnT = 1;
    emit('burn');
  }

  function resolve() {
    const traffic = objects;
    let kind = forced;
    forced = null;
    if (!kind) {
      const r = Math.random();
      kind = r < 0.5 ? 'orbit' : ['crash', 'lost', 'collision'][Math.floor(Math.random() * 3)];
    }
    if (kind === 'collision' && !traffic.length) kind = 'crash';
    const endless = level.mode === 'endless';

    if (kind === 'orbit') {
      orbiting += 1;
      if (endless) {
        objects.push({ altitude: 0.15 + Math.random() * 0.8, angle: Math.random() * TAU, kind: 'satellite', name: 'Your satellite', mine: true });
      }
      phase = endless ? 'aiming' : 'resolved';
      emit('orbit', { orbiting });
    } else if (kind === 'collision') {
      const hit = traffic[Math.floor(Math.random() * traffic.length)];
      emit('collision', { withName: hit.name, withKind: hit.kind });
      if (endless) {
        phase = 'gameover';
        emit('gameover', { score: orbiting });
      } else {
        phase = 'resolved';
      }
    } else {
      phase = endless ? 'aiming' : 'resolved';
      emit(kind);
    }
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    active = true;
    canvas.focus({ preventScroll: true });
    if (!inputOpen()) return;
    if (phase === 'flight') return startBurn();
    drag = { ...point(e), ...point(e), sx: point(e).x, sy: point(e).y };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onPointerMove(e) {
    if (drag) Object.assign(drag, point(e));
  }
  function onPointerUp(e) {
    if (!drag) return;
    const p = point(e);
    const far = Math.hypot(p.x - drag.sx, p.y - drag.sy) > 12;
    drag = null;
    if (far && phase === 'aiming' && !paused) {
      phase = 'flight';
      flightT = 0;
      emit('launch');
    }
  }
  function onKey(e) {
    if (destroyed || !active || paused) return;
    if (e.code === 'Space') {
      if (phase === 'flight') { e.preventDefault(); startBurn(); }
      return;
    }
    const o = KEY_OUTCOMES[e.key && e.key.toLowerCase()];
    if (o) { forced = o; console.info(`[stub] next outcome forced: ${o}`); }
  }
  const onBlur = () => { active = false; };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey);

  function draw() {
    const { cx, cy, R, inner, span } = geo();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0B1230';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(169,179,217,0.18)';
    ctx.lineWidth = 1;
    [0, 1].forEach((a) => {
      ctx.beginPath();
      ctx.arc(cx, cy, inner + a * span, 0, TAU);
      ctx.stroke();
    });

    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#5BD6E8');
    g.addColorStop(1, '#16224F');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    for (const o of objects) {
      const r = inner + o.altitude * span;
      const x = cx + Math.cos(o.angle) * r;
      const y = cy - Math.sin(o.angle) * r;
      ctx.fillStyle = o.mine ? '#FF6A2B' : o.kind === 'debris' ? '#FF5470' : o.kind === 'derelict' ? '#A9B3D9' : '#5BD6E8';
      ctx.beginPath();
      ctx.arc(x, y, o.kind === 'debris' ? 2 : 3.5, 0, TAU);
      ctx.fill();
    }

    if (drag) {
      ctx.strokeStyle = '#FF6A2B';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(drag.sx, drag.sy);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (phase === 'flight' || phase === 'confirming') {
      const r = R + Math.min(flightT, 3) * R * 0.3;
      ctx.fillStyle = '#FF6A2B';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(flightT) * r, cy - Math.sin(flightT) * r, 5, 0, TAU);
      ctx.fill();
    }
    if (phase === 'flight') {
      ctx.fillStyle = '#EEF1FF';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('(stub) Space or tap to burn', cx, cy + R + 26);
    }
  }

  function frame(t) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000 || 0, 0.1);
    last = t;
    if (!paused) {
      for (const o of objects) o.angle += dt * 0.15;
      if (phase === 'flight' || phase === 'confirming') flightT += dt;
      if (phase === 'confirming') {
        burnT -= dt;
        if (burnT <= 0) resolve();
      }
    }
    draw();
  }
  raf = requestAnimationFrame(frame);

  return {
    loadLevel,
    setPaused(p) { paused = !!p; },
    getState: () => ({ phase, orbiting, objects: objects.map((o) => ({ ...o })) }),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro && ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
    },
  };
}
