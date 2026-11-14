// Tuning helper: bot success rates against the real story levels, then full endless runs.
// usage: node js/game/test/tune.mjs [seeds=500] [endlessRuns=300]
import { botTrial, endlessRun, BOT, KID } from './bot.mjs';
import { SCRIPTED, ENDLESS_LEVEL } from '../../story/levels.js';

export const OLD_ENDLESS = { mode: 'endless', traffic: 0, debrisOnCollision: true };

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

/** Full endless runs for seeds 1..n. */
export function endlessStats(level, n, kid = KID) {
  const runs = [];
  for (let s = 1; s <= n; s++) runs.push(endlessRun(s, level, BOT, kid));
  const scores = runs.map((r) => r.score).sort((a, b) => a - b);
  const q = (p) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
  const hist = {};
  for (const sc of scores) hist[sc] = (hist[sc] || 0) + 1;
  const risk = [];
  for (let k = 1; k <= 12; k++) {
    const reached = runs.filter((r) => r.launches >= k);
    const died = reached.filter((r) => r.deathLaunch === k).length;
    risk.push({ k, reached: reached.length, p: reached.length ? died / reached.length : NaN });
  }
  return {
    median: q(0.5), p10: q(0.1), p90: q(0.9),
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    hist, risk,
    meanNewcomers: runs.reduce((a, r) => a + r.newcomers, 0) / runs.length,
  };
}

function printEndless(name, st, n) {
  console.log(`${name} (N=${n}): median ${st.median}, p10 ${st.p10}, p90 ${st.p90}, mean ${st.mean.toFixed(1)}, mean newcomers ${st.meanNewcomers.toFixed(1)}`);
  console.log('  score histogram:', Object.entries(st.hist).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('  collision/failure probability per launch (reached): ' +
    st.risk.map((r) => `#${r.k} ${(r.p * 100).toFixed(0)}% (${r.reached})`).join(', '));
}

if (process.argv[1].endsWith('tune.mjs')) {
  const n = Number(process.argv[2]) || 500;
  const runsN = Number(process.argv[3]) || 300;
  const levels = SCRIPTED.map((l, i) => [`level ${i + 1}`, l.def]);
  for (const [name, def] of levels) {
    const { rate, counts } = rates(def, n);
    console.log(`${name}: ${(rate * 100).toFixed(1)}% (N=${n})`, JSON.stringify(counts));
  }
  printEndless('endless NEW full runs', endlessStats(ENDLESS_LEVEL, runsN), runsN);
  printEndless('endless OLD full runs', endlessStats(OLD_ENDLESS, runsN), runsN);
}
