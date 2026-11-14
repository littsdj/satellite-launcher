// Endless mode controller. DOM-free: talks to `ui`.
// ui: setCount(n), setBest(n), toast(text), hideGameOver(), showGameOver({ score, best, isBest, line, hit })
import { describeCollision } from './messages.js';

export const ENDLESS_LEVEL = {
  mode: 'endless',
  traffic: 0,
  debrisOnCollision: true,
  showTrajectoryPreview: true,
};

/** Connect the score to the lesson. Uses only numbers from the article. */
export function lessonLine(score) {
  if (score <= 0) {
    return 'Your sky turned on you before a single satellite settled. Real operators work among about 40,000 tracked objects.';
  }
  const n = score === 1 ? '1 satellite' : `${score} satellites`;
  if (score < 5) {
    return `You put up ${n} before your sky turned on you. Real operators face the same problem with about 40,000 tracked objects.`;
  }
  if (score < 15) {
    return `${n} placed, and each one made the next launch harder. The real sky has about 11,000 working satellites among those 40,000 tracked objects.`;
  }
  return `${n}! The real sky holds about 11,000 working satellites among about 40,000 tracked objects, so it is a much busier place than yours.`;
}

export function createEndless({ game, ui, storage }) {
  let best = storage.getBest();
  let lastHit = null;

  function start() {
    lastHit = null;
    ui.hideGameOver();
    ui.setCount(0);
    ui.setBest(best);
    game.loadLevel(ENDLESS_LEVEL);
  }

  function handle(type, detail = {}) {
    if (type === 'orbit') ui.setCount(detail.orbiting ?? 0);
    else if (type === 'crash' || type === 'lost') ui.toast('Lost that one. Keep going.');
    else if (type === 'collision') lastHit = describeCollision(detail);
    else if (type === 'gameover') {
      const score = detail.score ?? 0;
      const isBest = score > best;
      if (isBest) {
        best = score;
        storage.setBest(best);
        ui.setBest(best);
      }
      ui.showGameOver({
        score,
        best,
        isBest,
        line: lessonLine(score),
        hit: lastHit ? lastHit.phrase : null,
      });
    }
  }

  return { start, handle, get best() { return best; } };
}
