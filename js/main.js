// Wiring: engine loading, two game instances, story flow, pausing.
import { createFlow } from './story/flow.js';
import { createEndless } from './story/endless.js';
import { createScriptedHud, createEndlessHud } from './story/hud.js';
import { setOpener, buildLadder } from './story/article.js';
import { initFx } from './story/fx.js';
import * as storage from './story/storage.js';

const $ = (s) => document.querySelector(s);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const behavior = () => (reducedMotion() ? 'auto' : 'smooth');

async function loadEngine() {
  if (new URLSearchParams(location.search).has('stub')) {
    console.warn('[satellite-launcher] ?stub set: running the demo stub engine.');
    return { createGame: (await import('./story/stub-game.js')).createGame, failed: false };
  }
  try {
    const mod = await import('./game/index.js');
    if (typeof mod.createGame !== 'function') throw new Error('createGame is not exported');
    return { createGame: mod.createGame, failed: false };
  } catch (err) {
    console.warn('[satellite-launcher] Game engine not found, running demo stub.', err);
    return { createGame: (await import('./story/stub-game.js')).createGame, failed: true };
  }
}

async function init() {
  buildLadder();
  try { initFx(); } catch (err) { console.warn('[satellite-launcher] story effects failed to start', err); }

  const stage = $('#game');
  const canvas = $('#game-canvas');
  const story = $('#story');
  const heading = $('#article-title');
  const opener = $('#opener-line');
  const eStage = $('#endless');
  const eCanvas = $('#endless-canvas');

  const { createGame, failed } = await loadEngine();
  const hud = createScriptedHud(stage, canvas);
  if (failed) hud.setNotice('Game engine not found, running demo stub');

  // Scripted game (top)
  let flow;
  const scripted = createGame(canvas, { hintText: false, onEvent: (t, d) => flow && flow.handle(t, d) });

  function toStory(result) {
    setOpener(opener, result);
    hud.fade();
    const go = () => {
      story.scrollIntoView({ behavior: behavior(), block: 'start' });
      heading.focus({ preventScroll: true });
    };
    if (reducedMotion()) go();
    else setTimeout(go, 700);
  }

  flow = createFlow({ game: scripted, ui: hud.ui, onFinish: toStory });

  // Endless game (bottom)
  const eHud = createEndlessHud(eStage, eCanvas);
  let endlessCtl;
  const endless = createGame(eCanvas, { onEvent: (t, d) => endlessCtl && endlessCtl.handle(t, d) });
  endlessCtl = createEndless({ game: endless, ui: eHud, storage });
  eHud.onPlayAgain(() => endlessCtl.start());

  // Buttons
  $('#skip-btn').addEventListener('click', () => flow.skip());
  // Phone-friendly skip below the canvas (outside it, so touch there always scrolls/taps normally).
  $('#skip-btn-2').addEventListener('click', () => {
    if (flow.state.active) flow.skip();
    else story.scrollIntoView({ behavior: behavior(), block: 'start' });
  });
  $('#replay-btn').addEventListener('click', () => {
    hud.unfade();
    window.scrollTo({ top: 0, behavior: behavior() });
    flow.replay();
    canvas.focus({ preventScroll: true });
  });
  $('#to-endless-btn').addEventListener('click', () => {
    eStage.scrollIntoView({ behavior: behavior(), block: 'start' });
  });

  // Pause whichever canvas is offscreen, and both when the tab is hidden.
  const visible = new Map();
  const apply = () => {
    scripted.setPaused(document.hidden || !visible.get(stage));
    endless.setPaused(document.hidden || !visible.get(eStage));
  };
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => visible.set(e.target, e.isIntersecting));
      apply();
    },
    { threshold: 0.05 },
  );
  io.observe(stage);
  io.observe(eStage);
  document.addEventListener('visibilitychange', apply);

  flow.start();
  endlessCtl.start();

  window.__story = { scripted, endless, flow, endlessCtl };
}

init().catch((err) => console.error('[satellite-launcher] failed to start', err));
