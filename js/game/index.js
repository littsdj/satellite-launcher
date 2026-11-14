// Public entry point: createGame(canvas, { onEvent }) -> game
// Owns the rAF loop, pointer/keyboard input and the renderer. All state is per instance.

import { CONFIG } from './config.js';
import { createSim } from './sim.js';
import { createRenderer } from './render.js';

const CLAIM_EVENT = 'satlauncher:claim';
const MIN_PULL_PX = 10;

function isEditable(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

export function createGame(canvas, { onEvent, hintText = true } = {}) {
  const token = {};
  let destroyed = false;
  let paused = false;
  let loaded = false;
  let level = null;
  let raf = null;
  let last = 0;
  let pointerActive = false; // last pointerdown on the page landed on our canvas
  let launchActive = false; // we were the last instance to launch
  let spaceHeld = false; // a Space press we handled is still down (swallow its repeats)
  let hasDragged = false;
  let launchedAt = -Infinity; // performance.now() of the last launch
  let drag = null;
  let kbAim = null; // keyboard aim state { angle, power } while aiming with the arrow keys

  const ui = {
    dragging: false,
    angle: Math.PI / 2,
    power: 0,
    pts: null,
    hintText, // draw the on-canvas instruction text (the page may carry its own prompts)
    showAimHint: false,
    showBurnHint: false,
  };

  function claim() {
    document.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: token }));
  }

  function handleEvent(type, detail) {
    if (type === 'launch') {
      launchActive = true;
      launchedAt = performance.now();
      claim();
    }
    if (typeof onEvent === 'function') {
      try {
        onEvent(type, detail);
      } catch (err) {
        console.error(err);
      }
    }
  }

  const sim = createSim({ onEvent: handleEvent, random: Math.random });
  const cfg = sim.config || CONFIG;
  const renderer = createRenderer(canvas, cfg);

  canvas.style.touchAction = 'none';

  // ---- loop ------------------------------------------------------------------------------
  function frame(dt) {
    try {
      if (loaded) {
        sim.step(dt);
        if ((drag || kbAim) && !sim.canLaunch()) cancelDrag();
        ui.showAimHint = !hasDragged && sim.canLaunch();
        ui.showBurnHint = sim.canBurn();
      } else {
        ui.showAimHint = false;
        ui.showBurnHint = false;
      }
      ui.dragging = !!drag || !!kbAim;
      renderer.render(loaded ? sim : null, ui, dt);
    } catch (err) {
      console.error(err);
    }
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (last === 0) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    frame(dt);
  }

  function updateRunning() {
    const run = !paused && !destroyed && !document.hidden;
    if (run && raf === null) {
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!run && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  // ---- resize ----------------------------------------------------------------------------
  const ro = new ResizeObserver(() => {
    if (destroyed) return;
    if (renderer.resize() && raf === null && !destroyed) frame(0);
  });
  ro.observe(canvas);
  renderer.resize();

  // ---- pointer input ---------------------------------------------------------------------
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function cancelDrag() {
    if (drag) {
      try {
        canvas.releasePointerCapture(drag.id);
      } catch (_) {
        /* not captured */
      }
    }
    drag = null;
    kbAim = null;
    ui.dragging = false;
    ui.pts = null;
  }

  function applyKbAim() {
    ui.angle = kbAim.angle;
    ui.power = kbAim.power;
    ui.pts = level && level.showTrajectoryPreview ? sim.predict(kbAim.angle, kbAim.power) : null;
  }

  function updateDrag(e) {
    const p = localXY(e);
    const s = renderer.getSize();
    const pullX = drag.x0 - p.x;
    const pullY = drag.y0 - p.y;
    const len = Math.hypot(pullX, pullY);
    const maxPull = 0.35 * Math.min(s.w, s.h);
    drag.len = len;
    drag.power = Math.min(1, len / maxPull);
    drag.angle = Math.atan2(-pullY, pullX); // screen y is down, world y is up
    ui.angle = drag.angle;
    ui.power = drag.power;
    if (len >= MIN_PULL_PX && level && level.showTrajectoryPreview) {
      ui.pts = sim.predict(drag.angle, drag.power);
    } else {
      ui.pts = null;
    }
  }

  function onPointerDown(e) {
    pointerActive = true;
    claim();
    if (!loaded || paused) return;
    if (kbAim) cancelDrag();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (sim.canLaunch()) {
      if (drag) return;
      const p = localXY(e);
      hasDragged = true;
      drag = { id: e.pointerId, x0: p.x, y0: p.y, len: 0, power: 0, angle: Math.PI / 2 };
      ui.power = 0;
      ui.angle = Math.PI / 2;
      ui.pts = null;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      e.preventDefault();
    } else if (sim.canBurn()) {
      // Ignore a stray tap right after release (kids double-tap); an instant burn would crash in the atmosphere.
      if (performance.now() - launchedAt < 250) return;
      sim.burn();
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    updateDrag(e);
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    updateDrag(e);
    const d = drag;
    cancelDrag();
    if (d.len >= MIN_PULL_PX && loaded && !paused && sim.canLaunch()) {
      sim.launch(d.angle, d.power);
    }
  }

  function onPointerCancel(e) {
    if (drag && e.pointerId === drag.id) cancelDrag();
  }

  function onDocPointerDown(e) {
    if (e.target !== canvas) pointerActive = false;
  }

  function onClaim(e) {
    if (e.detail !== token) {
      pointerActive = false;
      launchActive = false;
    }
  }

  // ---- keyboard --------------------------------------------------------------------------
  function mostlyOnScreen() {
    const r = canvas.getBoundingClientRect();
    const seen = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    return r.height > 0 && seen / Math.min(r.height, window.innerHeight) >= 0.6;
  }

  function isSpace(e) {
    return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
  }

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const ANGLE_STEP = Math.PI / 90; // 2 degrees
  const POWER_STEP = 0.03;

  // Keyboard aiming: only while this canvas itself has focus, so page scrolling and buttons are untouched.
  function onAimKey(e) {
    if (e.target !== canvas || paused || document.hidden || !loaded || !sim.canLaunch()) return false;
    const arrow = ARROWS.includes(e.key);
    if (!arrow && e.key !== 'Enter') return false;
    if (drag) return false;
    if (e.key === 'Enter') {
      if (!kbAim) return false;
      e.preventDefault();
      if (e.repeat) return true;
      const k = kbAim;
      cancelDrag();
      if (k.power > 0.02) sim.launch(k.angle, k.power);
      return true;
    }
    e.preventDefault();
    if (!kbAim) {
      kbAim = { angle: Math.PI / 2, power: 0.5 };
      hasDragged = true;
      claim();
      pointerActive = true;
    }
    // Screen-relative: Right tilts the aim clockwise (towards the right horizon).
    if (e.key === 'ArrowLeft') kbAim.angle += ANGLE_STEP;
    else if (e.key === 'ArrowRight') kbAim.angle -= ANGLE_STEP;
    else if (e.key === 'ArrowUp') kbAim.power += POWER_STEP;
    else kbAim.power -= POWER_STEP;
    kbAim.angle = Math.max(0.05, Math.min(Math.PI - 0.05, kbAim.angle));
    kbAim.power = Math.max(0.05, Math.min(1, kbAim.power));
    applyKbAim();
    return true;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target)) return;
    if (!isSpace(e)) {
      onAimKey(e);
      return;
    }
    if (!(pointerActive || launchActive || e.target === canvas)) return;
    if (paused || document.hidden || !loaded) return;
    if (e.repeat) {
      // swallow repeats of a press we handled so the page does not scroll
      if (spaceHeld) e.preventDefault();
      return;
    }
    // While this game is active and mostly on screen, Space belongs to it: a mistimed press must not scroll the page away.
    if (!sim.canBurn()) {
      if (mostlyOnScreen()) e.preventDefault();
      return;
    }
    e.preventDefault();
    spaceHeld = true;
    sim.burn();
  }

  function onKeyUp(e) {
    if (isSpace(e)) spaceHeld = false;
  }

  function onVisibility() {
    updateRunning();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener(CLAIM_EVENT, onClaim);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', onVisibility);

  updateRunning();

  // ---- public API ------------------------------------------------------------------------
  return {
    loadLevel(lv) {
      if (destroyed) return;
      level = lv;
      cancelDrag();
      hasDragged = false;
      spaceHeld = false;
      renderer.reset();
      sim.loadLevel(lv);
      loaded = true;
      if (raf === null) frame(0);
    },
    setPaused(p) {
      paused = !!p;
      if (paused) cancelDrag();
      updateRunning();
    },
    getState() {
      return sim.getState();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      ro.disconnect();
      cancelDrag();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener(CLAIM_EVENT, onClaim);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
