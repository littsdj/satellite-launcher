// Scripted level state machine. No DOM access: everything goes through `ui`,
// so it can be tested with a fake game and a fake ui.
//
// ui: setPrompt(text), setLevel(n, done), setAttempt(text|null), hideResult(),
//     showResult({ tone, heading, line, label, onAction })
// onFinish({ outcome: 'success'|'collision'|'failure'|'skip', failure?, collision? })
import { SCRIPTED, HOLD_MS } from './levels.js';
import { failureCopy, describeCollision } from './messages.js';

const isTouch = () => !!globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches;
const promptLaunched = () => (isTouch() ? 'Tap the screen to fire your burn' : 'Press Space or tap to fire your burn');
const PROMPT_BURNED = 'Burn fired. Will it hold?';

export function createFlow({ game, ui, onFinish = () => {}, timers = globalThis }) {
  let index = 0;
  let attempt = 1;
  let resolved = false;
  let active = false;
  let holdTimer = null;

  const clearHold = () => {
    if (holdTimer !== null) timers.clearTimeout(holdTimer);
    holdTimer = null;
  };

  function load(i, att = 1) {
    clearHold();
    index = i;
    attempt = att;
    resolved = false;
    active = true;
    const level = SCRIPTED[i];
    ui.hideResult();
    ui.setLevel(level.id, false);
    ui.setAttempt(level.attempts > 1 ? `Attempt ${att} of ${level.attempts}` : null);
    ui.setPrompt(level.prompts.aim);
    game.loadLevel(level.def);
  }

  function hold(kind, detail) {
    const failure = kind === 'success' ? null : kind;
    const collision = kind === 'collision' ? describeCollision(detail) : null;
    const message =
      kind === 'success'
        ? 'You made it into orbit.'
        : kind === 'collision'
          ? `${failureCopy(kind, detail).line} Watch the pieces spread.`
          : failureCopy(kind, detail).line;
    ui.setPrompt(message);
    holdTimer = timers.setTimeout(
      () => {
        holdTimer = null;
        active = false;
        onFinish({
          outcome: kind === 'success' ? 'success' : kind === 'collision' ? 'collision' : 'failure',
          failure,
          collision,
        });
      },
      kind === 'collision' ? HOLD_MS.collision : HOLD_MS.other,
    );
  }

  function outcome(kind, detail) {
    resolved = true;
    const level = SCRIPTED[index];
    ui.setPrompt('');

    if (kind === 'success') {
      ui.setLevel(level.id, true);
      if (level.final) return hold('success');
      ui.showResult({
        tone: 'good',
        ...level.success,
        onAction: () => load(index + 1),
      });
      return;
    }

    if (level.final && attempt >= level.attempts) return hold(kind, detail);

    const copy = failureCopy(kind, detail);
    const more = level.final;
    ui.showResult({
      tone: 'bad',
      heading: copy.heading,
      line: more ? `${copy.line} You have one attempt left.` : copy.line,
      label: more ? 'Last attempt' : 'Try again',
      onAction: () => load(index, attempt + 1),
    });
  }

  function handle(type, detail = {}) {
    if (!active || resolved) return;
    if (type === 'launch') ui.setPrompt(promptLaunched());
    else if (type === 'burn') ui.setPrompt(PROMPT_BURNED);
    else if (type === 'orbit') outcome('success', detail);
    else if (type === 'crash' || type === 'lost' || type === 'collision') outcome(type, detail);
  }

  return {
    handle,
    start: () => load(0),
    replay: () => load(0),
    skip() {
      clearHold();
      active = false;
      ui.hideResult();
      onFinish({ outcome: 'skip', failure: null, collision: null });
    },
    get state() {
      return { index, attempt, resolved, active };
    },
  };
}
