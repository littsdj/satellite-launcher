// Endless mode controller. DOM-free: talks to `ui`.
// ui: setCount(n), setBest(n), toast(text), hideGameOver(), showGameOver({ score, best, isBest, line, hit })
import { describeCollision } from './messages.js';
import { ENDLESS_LEVEL } from './levels.js';

export { ENDLESS_LEVEL };

/** Kid-friendly toast for newly arrived satellites from other launchers. */
export function newcomerLine(count, first) {
  const c = Math.max(1, count | 0);
  const sats = c === 1 ? '1 new satellite' : `${c} new satellites`;
  if (first) {
    return c === 1
      ? "1 new satellite from another country or company just joined. You're not the only one launching!"
      : `${c} new satellites from other countries and companies just joined. You're not the only one launching!`;
  }
  const lines = [
    `+${sats} from other launchers.`,
    `Others are launching too: ${sats} arrived.`,
    `${sats} joined the sky.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

/** Connect the score to the lesson. Uses only numbers from the article. */
export function lessonLine(score) {
  if (score <= 0) {
    return 'Your sky turned on you before a single satellite settled. It was already busy with other launchers, and real operators work among about 40,000 tracked objects.';
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
  let newcomerToasts = 0;

  function start() {
    lastHit = null;
    newcomerToasts = 0;
    ui.hideGameOver();
    ui.setCount(0);
    ui.setBest(best);
    game.loadLevel(ENDLESS_LEVEL);
  }

  function handle(type, detail = {}) {
    if (type === 'orbit') ui.setCount(detail.orbiting ?? 0);
    else if (type === 'newcomers') {
      if (detail.count > 0) ui.toast(newcomerLine(detail.count, newcomerToasts++ === 0), 3500);
    } else if (type === 'crash' || type === 'lost') ui.toast('Lost that one. Keep going.');
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
