// Tuning helper: bot success rates against the real story levels.
// usage: node js/game/test/tune.mjs [seeds=500]
import { botTrial } from './bot.mjs';
import { SCRIPTED } from '../../story/levels.js';

export function rates(level, n) {
  const counts = {};
  let ok = 0;
  for (let s = 1; s <= n; s++) {
    const r = botTrial(s, level);
    counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    if (r.success) ok++;
  }
  return { rate: ok / n, counts };
}

if (process.argv[1].endsWith('tune.mjs')) {
  const n = Number(process.argv[2]) || 500;
  const levels = [...SCRIPTED.map((l, i) => [`level ${i + 1}`, l.def]),
    ['endless', { mode: 'endless', traffic: 0, debrisOnCollision: true }]];
  for (const [name, def] of levels) {
    const { rate, counts } = rates(def, n);
    console.log(`${name}: ${(rate * 100).toFixed(1)}% (N=${n})`, JSON.stringify(counts));
  }
}
