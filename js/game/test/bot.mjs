// Shared helpers for the sim tests: seeded PRNG and the "sensible kid" bot.
import { createSim } from '../sim.js';

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a sim with an event log. */
export function makeSim(seed = 1, level = null) {
  const events = [];
  const sim = createSim({ random: mulberry32(seed), onEvent: (type, detail) => events.push({ type, detail }) });
  if (level) sim.loadLevel(level);
  return { sim, events };
}

/** Step the sim in 1/60 s frames until `done()` or maxSeconds. Returns elapsed sim seconds. */
export function runUntil(sim, done, maxSeconds = 60, dt = 1 / 60) {
  const t0 = sim.time;
  while (!done() && sim.time - t0 < maxSeconds) sim.step(dt);
  return sim.time - t0;
}

/** Time (s) at which a predicted path reaches its largest radius. */
export function timeToApex(path) {
  let best = 0;
  let bestR = -1;
  path.forEach((p, i) => {
    const r = Math.hypot(p.x, p.y);
    if (r > bestR) {
      bestR = r;
      best = i;
    }
  });
  return best * 0.05;
}

export const BOT = {
  angleSpread: (25 * Math.PI) / 180, // +-25 degrees around straight up
  powerMin: 0.5,
  powerMax: 0.8,
  burnEarly: 0.7, // burn at 70%..100% of time-to-apex ...
  burnLate: 0.3, // ... plus up to this many seconds after apex (reaction jitter)
};

/**
 * One trial of the "sensible kid" bot.
 * @returns {{success:boolean, outcome:string, angle:number, power:number}}
 */
export function botTrial(seed, level, bot = BOT) {
  const { sim, events } = makeSim(seed, level);
  const rng = mulberry32(seed * 7919 + 13);
  const angle = Math.PI / 2 + (rng() * 2 - 1) * bot.angleSpread;
  const power = bot.powerMin + rng() * (bot.powerMax - bot.powerMin);
  const apex = timeToApex(sim.predict(angle, power, 15));
  const burnAt = apex * (bot.burnEarly + rng() * (1 - bot.burnEarly)) + rng() * bot.burnLate;
  sim.launch(angle, power);
  runUntil(sim, () => sim.phase !== 'flight' || sim.time >= burnAt, 20);
  if (sim.phase === 'flight') sim.burn();
  runUntil(sim, () => sim.phase === 'resolved' || sim.phase === 'gameover', 30);
  const last = events.filter((e) => ['orbit', 'crash', 'lost', 'collision'].includes(e.type)).pop();
  const outcome = last ? last.type : 'none';
  return { success: outcome === 'orbit', outcome, angle, power };
}
