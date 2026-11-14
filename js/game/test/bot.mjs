// Shared helpers for the sim tests: seeded PRNG and the "sensible kid" bot.
import { createSim } from '../sim.js';
import { CONFIG } from '../config.js';

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

// ---------------------------------------------------------------------------
// Full endless runs
// ---------------------------------------------------------------------------

/**
 * "Sensible kid" in endless mode. Model (fixed before tuning the level numbers):
 *  - reacts for 0.5-1.5 s after every attempt (the sky keeps moving),
 *  - glances at the sky before each launch: the predicted path up to the planned burn
 *    must keep a 0.03 visual margin from every object (rails traffic propagated analytically),
 *    and the burn point must not be crowded (nothing within 0.12 at burn time). The kid does
 *    NOT foresee the confirmation phase, which is where most late failures come from,
 *  - if the sky is not clear, waits 0.3 s and re-aims; after 8 s of waiting launches anyway,
 *  - then flies exactly like botTrial (same aim/power/burn jitter).
 * Stops at gameover, 60 launches or 600 sim seconds.
 */
export const KID = {
  reactMin: 0.5, reactMax: 1.5, margin: 0.03, crowd: 0.12, recheck: 0.3, patience: 8,
  foresee: 0.06, // margin (world units) of a coarse look along the confirmation arc; 0 = strict model, none
};

function objectAt(o, t) {
  if (!o.onRails) return { x: o.x, y: o.y };
  const th = o.theta + o.omega * t;
  return { x: o.r * Math.cos(th), y: o.r * Math.sin(th) };
}

/** Does the planned launch look clear? `path` is sim.predict output (0.05 s samples). */
function looksClear(sim, path, burnAt, kid) {
  const steps = Math.min(path.length - 1, Math.round(burnAt / 0.05));
  for (let i = 0; i <= steps; i++) {
    const t = i * 0.05;
    for (const o of sim.objects) {
      const q = objectAt(o, t);
      const lim = CONFIG.PLAYER_RADIUS + o.radius + kid.margin;
      if ((path[i].x - q.x) ** 2 + (path[i].y - q.y) ** 2 < lim * lim) return false;
    }
  }
  const bp = path[steps];
  if (kid.foresee > 0 && steps > 0) {
    // Coarse foresight: assume the burn leaves the satellite on a circle through the burn
    // point, and glance along it of the confirmation, with a generous margin.
    const prev = path[steps - 1];
    const dir = Math.sign(bp.x * (bp.y - prev.y) - bp.y * (bp.x - prev.x)) || 1;
    const rb = Math.hypot(bp.x, bp.y);
    const om = dir * Math.sqrt(CONFIG.GM / (rb * rb * rb));
    const th0 = Math.atan2(bp.y, bp.x);
    const confirm = sim.level.confirmTime || 5;
    for (let dt = 0.1; dt <= confirm + CONFIG.BURN_DURATION; dt += 0.1) {
      const px = rb * Math.cos(th0 + om * dt);
      const py = rb * Math.sin(th0 + om * dt);
      for (const o of sim.objects) {
        const q = objectAt(o, steps * 0.05 + dt);
        const lim = CONFIG.PLAYER_RADIUS + o.radius + kid.foresee;
        if ((px - q.x) ** 2 + (py - q.y) ** 2 < lim * lim) return false;
      }
    }
  }
  for (const o of sim.objects) {
    const q = objectAt(o, steps * 0.05);
    if (Math.hypot(bp.x - q.x, bp.y - q.y) < kid.crowd) return false;
  }
  return true;
}

/**
 * One full endless run.
 * @returns {{score:number, launches:number, outcomes:string[], waits:number[], events:object[], deathLaunch:number, newcomers:number, objectsAtEnd:number}}
 */
export function endlessRun(seed, level, bot = BOT, kid = KID) {
  const { sim, events } = makeSim(seed, level);
  if (kid.onSim) kid.onSim(sim);
  const rng = mulberry32(seed * 104729 + 7);
  const outcomes = [];
  const waits = [];
  let launches = 0;
  let deathLaunch = 0;
  while (sim.phase !== 'gameover' && launches < 60 && sim.time < 600) {
    runUntil(sim, () => false, kid.reactMin + rng() * (kid.reactMax - kid.reactMin));
    let waited = 0;
    let angle, power, burnAt;
    for (;;) {
      angle = Math.PI / 2 + (rng() * 2 - 1) * bot.angleSpread;
      power = bot.powerMin + rng() * (bot.powerMax - bot.powerMin);
      const path = sim.predict(angle, power, 15);
      const apex = timeToApex(path);
      burnAt = apex * (bot.burnEarly + rng() * (1 - bot.burnEarly)) + rng() * bot.burnLate;
      if (looksClear(sim, path, burnAt, kid) || waited >= kid.patience) break;
      runUntil(sim, () => false, kid.recheck);
      waited += kid.recheck;
    }
    launches += 1;
    waits.push(waited);
    const t0 = sim.time;
    const mark = events.length;
    sim.launch(angle, power);
    runUntil(sim, () => sim.phase !== 'flight' || sim.time - t0 >= burnAt, 20);
    if (sim.phase === 'flight') sim.burn();
    runUntil(sim, () => sim.phase === 'aiming' || sim.phase === 'gameover', 30);
    const last = events.slice(mark).filter((e) => ['orbit', 'crash', 'lost', 'collision'].includes(e.type)).pop();
    outcomes.push(last ? last.type : 'none');
    if (sim.phase === 'gameover') deathLaunch = launches;
  }
  const st = sim.getState();
  return { score: st.orbiting, launches, outcomes, waits, events, deathLaunch, newcomers: st.newcomers, objectsAtEnd: st.objects };
}
