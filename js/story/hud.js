// DOM adapters: turn flow/endless `ui` calls into HUD updates.

const focusNoScroll = (el) => el && el.focus({ preventScroll: true });

// A result button gets focus the moment a launch ends. A burn key still held
// or mashed at that moment would "click" it before the message is read, so
// ignore activations in the first moment after the button appears.
const shownAt = new WeakMap();
const SETTLE_MS = 700;
const markShown = (btn) => shownAt.set(btn, performance.now());
function guardKeyboardClick(btn) {
  btn.addEventListener('click', (e) => {
    if (performance.now() - (shownAt.get(btn) || 0) < SETTLE_MS) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}

/** HUD for the scripted (top) game. `stage` is the section holding canvas + overlay. */
export function createScriptedHud(stage, canvas) {
  const $ = (s) => stage.querySelector(s);
  const prompt = $('#prompt');
  const attemptEl = $('#attempt');
  const result = $('#result');
  const rHead = $('#result-h');
  const rLine = $('#result-line');
  const rBtn = $('#result-btn');
  const live = $('#live');
  const rings = [...stage.querySelectorAll('.levels li')];
  guardKeyboardClick(rBtn);

  const ui = {
    setPrompt(text) {
      prompt.textContent = text;
      if (text) live.textContent = text;
    },
    setLevel(n, done) {
      rings.forEach((li, i) => {
        li.classList.toggle('done', i < n - 1 || (i === n - 1 && done));
        li.classList.toggle('current', i === n - 1 && !done);
        if (i === n - 1) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
    },
    setAttempt(text) {
      attemptEl.hidden = !text;
      attemptEl.textContent = text || '';
    },
    hideResult() {
      result.hidden = true;
      rBtn.onclick = null;
    },
    showResult({ tone, heading, line, label, onAction }) {
      result.dataset.tone = tone;
      rHead.textContent = heading;
      rLine.textContent = line;
      rBtn.textContent = label;
      result.hidden = false;
      live.textContent = `${heading} ${line}`;
      rBtn.onclick = () => {
        ui.hideResult();
        focusNoScroll(canvas);
        onAction();
      };
      markShown(rBtn);
      focusNoScroll(rBtn);
    },
  };

  return {
    ui,
    fade: () => stage.classList.add('is-fading'),
    unfade: () => stage.classList.remove('is-fading'),
    setNotice(text) {
      const n = $('#engine-notice');
      n.textContent = text;
      n.hidden = !text;
    },
  };
}

/** HUD for the endless (bottom) game. */
export function createEndlessHud(stage, canvas) {
  const $ = (s) => stage.querySelector(s);
  const count = $('#e-count');
  const bestEl = $('#e-best');
  const toast = $('#e-toast');
  const over = $('#e-over');
  const live = $('#e-live');
  const btn = $('#e-over-btn');
  let toastTimer = null;
  guardKeyboardClick(btn);

  return {
    setCount: (n) => { count.textContent = String(n); },
    setBest: (n) => { bestEl.textContent = String(n); },
    toast(text, ms = 2200) {
      toast.textContent = text;
      toast.hidden = false;
      live.textContent = text;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
    },
    hideGameOver() {
      over.hidden = true;
      btn.onclick = null;
    },
    showGameOver({ score, best, isBest, line, hit }) {
      $('#e-over-score').textContent = String(score);
      $('#e-over-best').textContent = isBest ? `New best! ${best}` : `Best: ${best}`;
      $('#e-over-hit').textContent = hit ? `Crash! You hit ${hit}.` : '';
      $('#e-over-line').textContent = line;
      toast.hidden = true;
      over.hidden = false;
      live.textContent = `Game over. You placed ${score}. ${line}`;
      markShown(btn);
      focusNoScroll(btn);
    },
    onPlayAgain(fn) {
      btn.addEventListener('click', () => {
        focusNoScroll(canvas);
        fn();
      });
    },
  };
}
