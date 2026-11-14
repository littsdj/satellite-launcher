// Run with: node js/game/test/sim.test.mjs
import assert from 'node:assert/strict';
import { createSim, stepFreeBody, circularPeriod } from '../sim.js';
import { CONFIG } from '../config.js';
import { SCRIPTED, LEVEL2_TRAFFIC, makeCrowdedSky, ENDLESS_LEVEL } from '../../story/levels.js';
import { mulberry32, makeSim, runUntil, timeToApex, botTrial, BOT, endlessRun, KID } from './bot.mjs';

const GM = CONFIG.GM;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const types = (events) => events.map((e) => e.type);
const altitudeOf = (r) => (r - CONFIG.BAND_MIN) / (CONFIG.BAND_MAX - CONFIG.BAND_MIN);
const SINGLE_EMPTY = { mode: 'single', traffic: 0, debrisOnCollision: false, showTrajectoryPreview: true };
const ENDLESS_EMPTY = { ...SINGLE_EMPTY, mode: 'endless' };

/** Launch straight up with `power` and burn at the apex; returns after the burn is accepted. */
function launchAndBurnAtApex(sim, power, angle = Math.PI / 2) {
  const apex = timeToApex(sim.predict(angle, power, 15));
  sim.launch(angle, power);
  runUntil(sim, () => sim.phase !== 'flight' || sim.time >= apex, 20);
  sim.burn();
}

const energy = (b) => 0.5 * (b.vx * b.vx + b.vy * b.vy) - GM / Math.hypot(b.x, b.y);

// ---------------------------------------------------------------------------
// 1. Physics
// ---------------------------------------------------------------------------

test('period sanity at band edges', () => {
  const lo = circularPeriod(CONFIG.BAND_MIN);
  const hi = circularPeriod(CONFIG.BAND_MAX);
  console.log(`    period at BAND_MIN=${lo.toFixed(2)} s, at BAND_MAX=${hi.toFixed(2)} s`);
  assert.ok(lo > 4.5 && lo < 6, 'inner period');
  assert.ok(hi > 11 && hi < 13, 'outer period');
});

test('all traffic orbits counter-clockwise (positive omega), lower lanes faster', () => {
  const sets = [
    makeSim(3, { ...SINGLE_EMPTY, traffic: 80 }).sim.objects,
    makeSim(3, { ...SINGLE_EMPTY, traffic: LEVEL2_TRAFFIC.map((o) => ({ ...o })) }).sim.objects,
    makeSim(3, { ...SINGLE_EMPTY, traffic: makeCrowdedSky() }).sim.objects,
    makeSim(3, { ...SINGLE_EMPTY, traffic: [{ altitude: 0.5, angle: 1 }] }).sim.objects,
  ];
  for (const objs of sets) {
    assert.ok(objs.length > 0);
    for (const o of objs) assert.ok(o.omega > 0, 'omega must be positive');
  }
  assert.ok(circularPeriod(CONFIG.BAND_MAX) / circularPeriod(CONFIG.BAND_MIN) >= 2, 'period ratio >= 2');
});

test('on-rails orbit keeps exact radius over 100 revolutions', () => {
  const { sim } = makeSim(1, { ...SINGLE_EMPTY, traffic: [
    { altitude: 0.5, angle: 0.3 }, { altitude: 0.1, angle: 2 },
  ] });
  for (const o of sim.objects) {
    const r0 = o.r;
    const period = circularPeriod(r0);
    const frames = Math.round((100 * period) / 0.05);
    for (let i = 0; i < frames; i++) sim.step(0.05);
    assert.equal(o.r, r0, 'r field unchanged');
    assert.ok(Math.abs(Math.hypot(o.x, o.y) - r0) < 1e-9, 'x,y radius');
    assert.ok(Math.abs(Math.hypot(o.vx, o.vy) - Math.sqrt(GM / r0)) < 1e-9, 'circular speed');
  }
});

test('free-flight integrator: circular orbit stays circular', () => {
  const r0 = 1.8;
  const b = { x: r0, y: 0, vx: 0, vy: Math.sqrt(GM / r0) };
  const steps = Math.round((20 * circularPeriod(r0)) / CONFIG.MAX_SUBSTEP);
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    stepFreeBody(b, CONFIG.MAX_SUBSTEP);
    worst = Math.max(worst, Math.abs(Math.hypot(b.x, b.y) - r0) / r0);
  }
  assert.ok(worst < 1e-3, `radius drift ${worst}`);
});

test('free-flight integrator conserves energy over 20 elliptical revolutions', () => {
  const rp = 1.2;
  const b = { x: rp, y: 0, vx: 0, vy: 1.15 * Math.sqrt(GM / rp) };
  const e0 = energy(b);
  const a = -GM / (2 * e0);
  const steps = Math.round((20 * 2 * Math.PI * Math.sqrt((a * a * a) / GM)) / CONFIG.MAX_SUBSTEP);
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    stepFreeBody(b, CONFIG.MAX_SUBSTEP);
    worst = Math.max(worst, Math.abs((energy(b) - e0) / e0));
  }
  console.log(`    max relative energy error over 20 revs: ${(worst * 100).toExponential(2)} %`);
  assert.ok(worst < 0.01);
});

test('player in flight (sim path) conserves energy', () => {
  const { sim } = makeSim(1, SINGLE_EMPTY);
  sim.launch(Math.PI / 2 - 0.4, 0.7);
  const e0 = energy(sim.player);
  let worst = 0;
  runUntil(sim, () => {
    if (sim.player) worst = Math.max(worst, Math.abs((energy(sim.player) - e0) / e0));
    return sim.phase !== 'flight';
  }, 20);
  assert.ok(worst < 0.01, `energy error ${worst}`);
});

// ---------------------------------------------------------------------------
// 2. Burn
// ---------------------------------------------------------------------------

test('burn circularises near apex', () => {
  const { sim, events } = makeSim(2, SINGLE_EMPTY);
  launchAndBurnAtApex(sim, 0.7);
  const rBurn = sim.player.r;
  assert.equal(sim.phase, 'confirming');
  assert.equal(sim.player.burning, true);
  assert.ok(Math.hypot(sim.player.thrustX, sim.player.thrustY) > 0.99, 'unit thrust vector while burning');
  runUntil(sim, () => !sim.player.burning, 5);
  const p = sim.player;
  assert.equal(sim.phase, 'confirming');
  assert.equal(p.onRails, true);
  assert.equal(p.thrustX, 0);
  assert.ok(Math.abs(p.r - rBurn) < 0.06, `r drift ${p.r - rBurn}`);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - Math.sqrt(GM / p.r)) < 1e-6, 'circular speed');
  assert.ok(Math.abs(p.x * p.vx + p.y * p.vy) < 1e-6, 'velocity tangential');
  assert.deepEqual(types(events), ['launch', 'burn']);
});

test('empty level: any burn between ATMOSPHERE_TOP and BURN_MAX_R succeeds', () => {
  for (const power of [0.55, 0.65, 0.75]) {
    const path = makeSim(1, SINGLE_EMPTY).sim.predict(Math.PI / 2 - 0.2, power, 15);
    for (let k = 2; k < path.length; k += 7) {
      const { sim, events } = makeSim(3, SINGLE_EMPTY);
      sim.launch(Math.PI / 2 - 0.2, power);
      runUntil(sim, () => sim.phase !== 'flight' || sim.time >= k * 0.05 - 0.02, 20);
      if (sim.phase !== 'flight') continue;
      const r = sim.player.r;
      sim.burn();
      runUntil(sim, () => sim.phase !== 'confirming', 30);
      const inWindow = r >= CONFIG.ATMOSPHERE_TOP && r <= CONFIG.BURN_MAX_R;
      assert.equal(types(events).includes('orbit'), inWindow, `power ${power} k ${k} r ${r.toFixed(2)}: ${types(events)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Events
// ---------------------------------------------------------------------------

test('events: launch, burn, orbit (with count)', () => {
  const { sim, events } = makeSim(4, SINGLE_EMPTY);
  assert.equal(sim.canLaunch(), true);
  sim.launch(Math.PI / 2, 0.7);
  assert.deepEqual(events, [{ type: 'launch', detail: {} }]);
  assert.equal(sim.phase, 'flight');
  assert.equal(sim.canBurn(), true);
  launchAndBurnAtApex(sim, 0.7); // phase is 'flight' only before; launch above is no-op second time
  runUntil(sim, () => sim.phase === 'resolved', 40);
  assert.deepEqual(events.map((e) => e.type), ['launch', 'burn', 'orbit']);
  assert.deepEqual(events[1].detail, {});
  assert.deepEqual(events[2].detail, { orbiting: 1 });
  assert.equal(sim.getState().orbiting, 1);
  assert.equal(sim.player.settled, true, 'single mode keeps the settled satellite as sim.player');
  assert.equal(sim.objects.length, 0);
});

test('events: crash (falls back, and burn too low)', () => {
  let { sim, events } = makeSim(5, SINGLE_EMPTY);
  sim.launch(Math.PI / 2, 0.3);
  runUntil(sim, () => sim.phase !== 'flight', 30);
  assert.deepEqual(events, [{ type: 'launch', detail: {} }, { type: 'crash', detail: {} }]);
  assert.equal(sim.phase, 'resolved');
  assert.equal(sim.player, null);

  ({ sim, events } = makeSim(5, SINGLE_EMPTY));
  sim.launch(Math.PI / 2, 0.7);
  sim.step(0.05);
  assert.ok(sim.player.r < CONFIG.ATMOSPHERE_TOP);
  sim.burn();
  assert.deepEqual(types(events), ['launch', 'crash']);
  assert.equal(sim.phase, 'resolved');
});

test('events: lost (too much power, burn too high, timeout)', () => {
  let { sim, events } = makeSim(6, SINGLE_EMPTY);
  sim.launch(Math.PI / 2, 1);
  runUntil(sim, () => sim.phase !== 'flight', 30);
  assert.deepEqual(types(events), ['launch', 'lost']);

  ({ sim, events } = makeSim(6, SINGLE_EMPTY));
  sim.launch(Math.PI / 2, 0.88);
  runUntil(sim, () => sim.player.r > CONFIG.BURN_MAX_R + 0.05, 20);
  sim.burn();
  assert.deepEqual(types(events), ['launch', 'lost']);
  assert.equal(sim.phase, 'resolved');

  // A ballistic flight from the surface cannot outlast 15 s inside LOST_R, so shrink the timeout.
  const saved = CONFIG.FLIGHT_TIMEOUT;
  try {
    CONFIG.FLIGHT_TIMEOUT = 1;
    ({ sim, events } = makeSim(6, SINGLE_EMPTY));
    sim.launch(Math.PI / 2, 0.7);
    runUntil(sim, () => sim.phase !== 'flight', 30);
    assert.deepEqual(types(events), ['launch', 'lost']);
    assert.ok(sim.time < 1.1);
  } finally {
    CONFIG.FLIGHT_TIMEOUT = saved;
  }
});

/** Traffic spec that a vertical launch at `power` will meet at radius rHit. */
function ambushSpec(power, rHit, extra = {}) {
  const probe = makeSim(1, SINGLE_EMPTY).sim;
  const path = probe.predict(Math.PI / 2, power, 15);
  const i = path.findIndex((p) => Math.hypot(p.x, p.y) >= rHit);
  const tHit = i * 0.05;
  const omega = Math.sqrt(GM / (rHit * rHit * rHit));

  const angle = Math.PI / 2 - omega * tHit;
  return { altitude: altitudeOf(rHit), angle, ...extra };
}

test('events: collision with name/kind (single), world keeps running', () => {
  const spec = ambushSpec(0.7, 1.7, { name: 'Test Sat', kind: 'satellite' });
  const { sim, events } = makeSim(7, { ...SINGLE_EMPTY, traffic: [spec] });
  sim.launch(Math.PI / 2, 0.7);
  runUntil(sim, () => sim.phase !== 'flight', 20);
  assert.deepEqual(types(events), ['launch', 'collision']);
  assert.deepEqual(events[1].detail, { withName: 'Test Sat', withKind: 'satellite' });
  assert.equal(sim.phase, 'resolved');
  assert.equal(sim.player, null);
  assert.equal(sim.objects.length, 0, 'both destroyed without debris');
  const fx = sim.drainEffects().map((f) => f.type);
  assert.ok(fx.includes('launch') && fx.includes('explosion'));
  assert.deepEqual(sim.drainEffects(), []);
});

test('single mode: launch/burn are no-ops after resolved', () => {
  const { sim, events } = makeSim(8, SINGLE_EMPTY);
  sim.launch(Math.PI / 2, 0.3);
  runUntil(sim, () => sim.phase === 'resolved', 30);
  const n = events.length;
  sim.launch(Math.PI / 2, 0.7);
  sim.burn();
  sim.step(0.05);
  assert.equal(events.length, n);
  assert.equal(sim.phase, 'resolved');
  assert.equal(sim.canLaunch(), false);
  assert.equal(sim.canBurn(), false);
  assert.equal(sim.player, null);
});

test('endless: success -> aiming with +1 object; crash -> aiming, run continues', () => {
  const { sim, events } = makeSim(9, ENDLESS_EMPTY);
  launchAndBurnAtApex(sim, 0.6);
  runUntil(sim, () => sim.phase !== 'confirming', 40);
  assert.equal(sim.phase, 'aiming');
  assert.equal(sim.player, null);
  assert.equal(sim.objects.length, 1);
  const o = sim.objects[0];
  assert.equal(o.name, 'Your satellite 1');
  assert.equal(o.kind, 'satellite');
  assert.equal(o.playerPlaced, true);
  assert.equal(o.onRails, true);
  assert.deepEqual(events.at(-1), { type: 'orbit', detail: { orbiting: 1 } });
  assert.deepEqual(sim.getState(), { phase: 'aiming', orbiting: 1, objects: 1, newcomers: 0 });

  sim.launch(Math.PI / 2, 0.3); // too weak: crash
  runUntil(sim, () => sim.phase !== 'flight', 30);
  assert.equal(events.at(-1).type, 'crash');
  assert.equal(sim.phase, 'aiming');
  assert.equal(sim.player, null);
  assert.equal(sim.objects.length, 1);
  assert.equal(sim.canLaunch(), true);

  sim.launch(Math.PI / 2, 1); // too strong: lost, still aiming
  runUntil(sim, () => sim.phase !== 'flight', 30);
  assert.equal(events.at(-1).type, 'lost');
  assert.equal(sim.phase, 'aiming');
});

test('endless: collision then gameover with score, in that order', () => {
  const { sim, events } = makeSim(10, ENDLESS_EMPTY);
  launchAndBurnAtApex(sim, 0.55); // places satellite 1
  runUntil(sim, () => sim.phase !== 'confirming', 40);
  assert.equal(sim.getState().orbiting, 1);
  const placed = sim.objects[0];
  // Wait until the placed satellite is where a second vertical shot will cross its radius.
  const power = 0.75;
  const path = sim.predict(Math.PI / 2, power, 15);
  const tHit = path.findIndex((p) => Math.hypot(p.x, p.y) >= placed.r) * 0.05;
  const lead = placed.omega * tHit; // angle the satellite will advance during the climb
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  runUntil(sim, () => Math.abs(wrap(placed.theta + lead - Math.PI / 2)) < 0.01, 60, 1 / 120);
  sim.launch(Math.PI / 2, power);
  runUntil(sim, () => sim.phase !== 'flight', 20);
  const tail = events.slice(-3);
  assert.deepEqual(types(tail), ['launch', 'collision', 'gameover']);
  assert.deepEqual(tail[1].detail, { withName: 'Your satellite 1', withKind: 'satellite' });
  assert.deepEqual(tail[2].detail, { score: 1 });
  assert.equal(sim.phase, 'gameover');
  sim.step(0.05); // keeps animating
  assert.equal(sim.canLaunch(), false);
});

// ---------------------------------------------------------------------------
// 4. Prediction
// ---------------------------------------------------------------------------

test('predict() matches the real flight', () => {
  for (const [angle, power] of [[Math.PI / 2, 0.7], [1.3, 0.6], [2.0, 0.8]]) {
    const { sim } = makeSim(11, SINGLE_EMPTY);
    const path = sim.predict(angle, power, 10);
    sim.launch(angle, power);
    let worst = 0;
    for (let k = 1; k < path.length - 1 && sim.phase === 'flight'; k++) {
      // 0.05 s per sample = 3 frames of 1/60
      for (let f = 0; f < 3; f++) sim.step(1 / 60);
      if (!sim.player) break;
      worst = Math.max(worst, Math.hypot(sim.player.x - path[k].x, sim.player.y - path[k].y));
    }
    assert.ok(worst < 1e-3, `max deviation ${worst}`);
  }
  const { sim } = makeSim(11, SINGLE_EMPTY);
  const weak = sim.predict(Math.PI / 2, 0.3, 10);
  assert.ok(Math.hypot(weak.at(-1).x, weak.at(-1).y) <= 1, 'stops at the ground');
  const strong = sim.predict(Math.PI / 2, 1, 30);
  assert.ok(Math.hypot(strong.at(-1).x, strong.at(-1).y) > CONFIG.LOST_R, 'stops beyond LOST_R');
});

test('launch angle is clamped above the horizon', () => {
  const { sim } = makeSim(12, SINGLE_EMPTY);
  sim.launch(-1, 0.5); // straight into the ground
  assert.ok(sim.player.vy > 0);
  runUntil(sim, () => sim.phase !== 'flight', 30);
  assert.equal(sim.phase, 'resolved');
});

// ---------------------------------------------------------------------------
// 5. Cascades
// ---------------------------------------------------------------------------

test('debris cascade: fragments appear, cap respected, fragments hit traffic', () => {
  let seedsWithCascade = 0;
  let maxSeen = 0;
  let sawFragments = false;
  for (let seed = 1; seed <= 12; seed++) {
    const { sim } = makeSim(seed, { ...SINGLE_EMPTY, traffic: 120, debrisOnCollision: true });
    sim.launch(Math.PI / 2 + (seed % 3 - 1) * 0.1, 0.72);
    let explosions = 0;
    for (let f = 0; f < 60 * 45; f++) {
      sim.step(1 / 60);
      maxSeen = Math.max(maxSeen, sim.objects.length);
      assert.ok(sim.objects.length <= CONFIG.MAX_OBJECTS, 'MAX_OBJECTS exceeded');
      if (f % 15 === 0) {
        explosions += sim.drainEffects().filter((e) => e.type === 'explosion').length;
        if (sim.objects.some((o) => o.name === 'Fragment')) sawFragments = true;
      }
    }
    if (explosions >= 3) seedsWithCascade++;
  }
  console.log(`    cascades in ${seedsWithCascade}/12 seeds, max objects seen ${maxSeen}`);
  assert.ok(sawFragments, 'collision should create fragments');
  assert.ok(seedsWithCascade >= 1, 'fragments should hit other traffic in some seeds');
});

test('debris off: no fragments are ever created', () => {
  const { sim } = makeSim(3, { ...SINGLE_EMPTY, traffic: 70, debrisOnCollision: false });
  sim.launch(Math.PI / 2, 0.7);
  runUntil(sim, () => false, 30);
  assert.ok(sim.objects.every((o) => o.name !== 'Fragment'));
  assert.ok(sim.objects.length <= 70 && sim.objects.length >= 69, 'only the hit object may disappear');
});

// ---------------------------------------------------------------------------
// 6. Isolation
// ---------------------------------------------------------------------------

test('two sims do not share state', () => {
  const levelA = { ...SINGLE_EMPTY, traffic: 20, debrisOnCollision: true };
  const levelB = { ...ENDLESS_EMPTY, traffic: 9 };
  const snapshot = (s) => JSON.stringify([s.phase, s.time, s.objects.map((o) => [o.x, o.y]), s.player && [s.player.x, s.player.y]]);
  const script = (s, which) => {
    s.launch(Math.PI / 2 + which * 0.1, 0.65);
    for (let i = 0; i < 400; i++) s.step(1 / 60);
  };
  const soloA = makeSim(21, levelA).sim;
  script(soloA, 1);
  const soloB = makeSim(22, levelB).sim;
  script(soloB, -1);

  const a = makeSim(21, levelA).sim;
  const b = makeSim(22, levelB).sim;
  a.launch(Math.PI / 2 + 0.1, 0.65);
  b.launch(Math.PI / 2 - 0.1, 0.65);
  for (let i = 0; i < 400; i++) {
    a.step(1 / 60);
    b.step(1 / 60);
  }
  assert.equal(snapshot(a), snapshot(soloA));
  assert.equal(snapshot(b), snapshot(soloB));
});

test('numeric traffic: kinds, spacing, launch clearance, names', () => {
  const { sim } = makeSim(31, { ...SINGLE_EMPTY, traffic: 40 });
  assert.equal(sim.objects.length, 40);
  const kinds = new Set(sim.objects.map((o) => o.kind));
  assert.ok(kinds.has('satellite') && kinds.has('derelict') && kinds.has('debris'));
  for (const o of sim.objects) {
    const fromUp = Math.atan2(Math.sin(o.theta - Math.PI / 2), Math.cos(o.theta - Math.PI / 2));
    assert.ok(Math.abs(fromUp) >= CONFIG.SPAWN_CLEAR_ANGLE - 1e-9);
    assert.ok(o.r >= CONFIG.BAND_MIN && o.r <= CONFIG.BAND_MAX);
    assert.ok(typeof o.name === 'string' && o.name.length > 0);
  }
  const ids = new Set(sim.objects.map((o) => o.id));
  assert.equal(ids.size, 40);
});

// ---------------------------------------------------------------------------
// 7. Difficulty Monte Carlo + performance
// ---------------------------------------------------------------------------

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('difficulty Monte Carlo (kid bot)', () => {
  const TRIALS = 300;
  const levels = [
    ['empty (0, debris off)', { ...SINGLE_EMPTY, traffic: 0 }, 0.9, 1],
    ['level 2 (6 satellites)', SCRIPTED[1].def, 0.35, 0.65],
    ['level 3 (crowded sky)', SCRIPTED[2].def, 0, 0.08],
  ];
  console.log(`    bot: angle +-${(BOT.angleSpread * 180 / Math.PI).toFixed(0)} deg of up, power ${BOT.powerMin}..${BOT.powerMax}, burn at ${BOT.burnEarly * 100}% of apex time .. apex+${BOT.burnLate}s`);
  console.log('    level                        success  orbit crash lost collision');
  for (const [name, level, lo, hi] of levels) {
    const counts = { orbit: 0, crash: 0, lost: 0, collision: 0, none: 0 };
    const wins = [];
    for (let i = 0; i < TRIALS; i++) {
      const r = botTrial(1000 + i * 17, level);
      counts[r.outcome]++;
      if (r.success) wins.push(r);
    }
    const rate = counts.orbit / TRIALS;
    console.log(`    ${name.padEnd(28)} ${(rate * 100).toFixed(1).padStart(5)}%  ${String(counts.orbit).padStart(5)} ${String(counts.crash).padStart(5)} ${String(counts.lost).padStart(4)} ${String(counts.collision).padStart(9)}`);
    if (level.traffic === 0 && wins.length) {
      const pw = wins.map((w) => w.power);
      const an = wins.map((w) => ((w.angle * 180) / Math.PI - 90));
      console.log(`      empty-level winners: median power ${median(pw).toFixed(2)} (range ${Math.min(...pw).toFixed(2)}..${Math.max(...pw).toFixed(2)}), median angle off vertical ${median(an).toFixed(1)} deg (range ${Math.min(...an).toFixed(1)}..${Math.max(...an).toFixed(1)})`);
    }
    assert.ok(rate >= lo && rate <= hi, `${name}: success ${rate} outside [${lo}, ${hi}]`);
  }
});

test('performance: 60 s of a debris level after a cascade', () => {
  for (const traffic of [70, 140]) {
    let best = null;
    for (let seed = 1; seed <= 20 && !best; seed++) {
      const { sim } = makeSim(seed, { ...SINGLE_EMPTY, traffic, debrisOnCollision: true });
      sim.launch(Math.PI / 2, 0.7);
      runUntil(sim, () => sim.phase !== 'flight', 20);
      if (sim.objects.filter((o) => o.name === 'Fragment').length >= 5) best = sim;
    }
    assert.ok(best, 'cascade triggered');
    const sim = best;
    const frames = 60 * 60;
    let peak = 0;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < frames; i++) {
      sim.step(1 / 60);
      peak = Math.max(peak, sim.objects.length);
      if (i % 30 === 0) sim.drainEffects();
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`    traffic ${traffic}: ${ms.toFixed(1)} ms for 60 simulated s (${(ms / frames).toFixed(4)} ms/frame), peak objects ${peak}`);
    assert.ok(ms / frames < 2);
    assert.ok(peak <= CONFIG.MAX_OBJECTS);
  }
});

// ---------------------------------------------------------------------------
// 8. Endless: starting traffic, newcomers, pace
// ---------------------------------------------------------------------------

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const NEWCOMER_RULES = ENDLESS_LEVEL.newcomers.schedule;
const ruleFor = (score) => NEWCOMER_RULES.filter((e) => e.atScore <= score).pop() || null;

/**
 * Play a full endless run with the bot, recording every newcomer spawn.
 * Each record checks clearance at spawn and, on later steps, during the appear window.
 */
function observedRun(seed, level = ENDLESS_LEVEL) {
  const spawns = [];
  const seen = new Set();
  let sim = null;
  const onSim = (s) => {
    sim = s;
    const orig = s.step;
    s.step = (dt) => {
      orig(dt);
      for (const o of s.objects) {
        if (!o.newcomer || seen.has(o.id)) continue;
        seen.add(o.id);
        spawns.push({ id: o.id, t0: s.time, appear: o.appear, minDist: Infinity, atSpawn: Infinity, grace: o.grace, playerPlaced: o.playerPlaced });
      }
      for (const sp of spawns) {
        if (s.time - sp.t0 > sp.appear) continue;
        const me = s.objects.find((o) => o.id === sp.id);
        if (!me) continue;
        for (const o of s.objects) {
          if (o === me || o.dead) continue;
          const d = Math.hypot(o.x - me.x, o.y - me.y) - (o.radius + me.radius);
          sp.minDist = Math.min(sp.minDist, d);
          if (s.time === sp.t0) sp.atSpawn = Math.min(sp.atSpawn, d);
        }
      }
    };
  };
  const run = endlessRun(seed, level, BOT, { ...KID, onSim });
  return { run, sim, spawns };
}

test('endless start: ~8 objects, in band, clear of launch angle, altitudes spread over the lanes', () => {
  let full = 0;
  const quart = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const { sim } = makeSim(seed, ENDLESS_LEVEL);
    assert.ok(sim.objects.length >= 7 && sim.objects.length <= 8, `seed ${seed}: ${sim.objects.length} objects`);
    const bins = new Set();
    for (const o of sim.objects) {
      assert.ok(o.r >= CONFIG.BAND_MIN && o.r <= CONFIG.BAND_MAX);
      assert.ok(Math.abs(wrapAngle(o.theta - Math.PI / 2)) >= CONFIG.SPAWN_CLEAR_ANGLE - 1e-9, 'clear of launch angle');
      const alt = altitudeOf(o.r);
      bins.add(Math.min(7, Math.floor(alt * 8)));
      quart[Math.min(3, Math.floor(alt * 4))]++;
      assert.equal(o.newcomer, undefined);
    }
    if (sim.objects.length === 8) {
      full++;
      assert.equal(bins.size, 8, `seed ${seed}: every altitude bin holds one object`);
    }
  }
  assert.ok(full >= 190, `8 objects in ${full}/200 seeds`);
  assert.ok(quart.every((n) => n > 0));
});

test('spreadTraffic off: generation is the same as before (default level unchanged)', () => {
  const a = makeSim(5, { ...SINGLE_EMPTY, traffic: 12 }).sim;
  const b = makeSim(5, { ...SINGLE_EMPTY, traffic: 12, spreadTraffic: false }).sim;
  const key = (s) => JSON.stringify(s.objects.map((o) => [o.kind, o.r, o.theta, o.name]));
  assert.equal(key(a), key(b));
  assert.equal(a.level.spreadTraffic, false);
  assert.equal(a.level.confirmTime, null);
  assert.equal(a.level.newcomers, null);
});

test('scripted levels carry none of the new options', () => {
  for (const l of SCRIPTED) {
    for (const k of ['confirmTime', 'newcomers', 'spreadTraffic']) assert.equal(l.def[k], undefined, `${l.id}.${k}`);
    const { sim } = makeSim(1, l.def);
    assert.equal(sim.level.confirmTime, null);
    assert.equal(sim.level.newcomers, null);
    assert.equal(sim.level.spreadTraffic, false);
    assert.ok(sim.objects.every((o) => !o.newcomer));
  }
});

test('newcomers: per-success count follows the schedule and ramps up; events in order', () => {
  const byScore = new Map(); // orbiting -> counts
  let successes = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { run, sim } = observedRun(seed);
    const ev = run.events;
    let total = 0;
    ev.forEach((e, i) => {
      if (e.type !== 'newcomers') return;
      assert.equal(ev[i - 1].type, 'orbit', 'newcomers directly follows orbit');
      const score = ev[i - 1].detail.orbiting;
      const rule = ruleFor(score);
      assert.ok(rule, 'no newcomers below the first schedule entry');
      assert.ok(e.detail.count >= 1 && e.detail.count <= rule.max, `count ${e.detail.count} at score ${score}`);
      total += e.detail.count;
      assert.equal(e.detail.total, total);
      assert.equal(e.detail.score, score);
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(e.detail.count);
    });
    successes += ev.filter((e) => e.type === 'orbit').length;
    assert.equal(sim.getState().newcomers, total);
    assert.equal(run.newcomers, total);
  }
  assert.ok(successes > 100);
  const mean = (lo, hi) => {
    const xs = [...byScore].filter(([s]) => s >= lo && s <= hi).flatMap(([, v]) => v);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const [e1, e2, e3] = [mean(1, 3), mean(4, 6), mean(7, 99)];
  console.log(`    mean newcomers per success: score 1-3 ${e1.toFixed(2)}, 4-6 ${e2.toFixed(2)}, 7+ ${e3.toFixed(2)}`);
  assert.ok(e1 >= 1 && e1 <= 2 && e2 > e1 && e3 > e2 && e3 <= 4);
});

test('newcomers: no overlapping spawns, clear over the whole appear window', () => {
  let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { spawns } = observedRun(seed);
    for (const sp of spawns) {
      n++;
      assert.ok(sp.atSpawn > CONFIG.SPAWN_GAP - 1e-6, `seed ${seed}: gap at spawn ${sp.atSpawn}`);
      assert.ok(sp.minDist > 0, `seed ${seed}: overlap during appear window (${sp.minDist})`);
      assert.equal(sp.playerPlaced, false);
    }
  }
  assert.ok(n > 300);
});

test('newcomers: fields, effect, names and score unaffected', () => {
  const effects = [];
  const { sim, events } = makeSim(4, { ...ENDLESS_EMPTY, newcomers: { schedule: [{ atScore: 1, min: 2, max: 2 }], appear: 1.5 } });
  launchAndBurnAtApex(sim, 0.6);
  runUntil(sim, () => sim.phase !== 'confirming', 40);
  effects.push(...sim.drainEffects());
  const nc = sim.objects.filter((o) => o.newcomer);
  assert.equal(nc.length, 2);
  for (const o of nc) {
    assert.equal(o.kind, 'satellite');
    assert.equal(o.playerPlaced, false);
    assert.equal(o.onRails, true);
    assert.equal(o.appear, 1.5);
    assert.ok(o.grace > 1.4 && o.grace <= 1.5, `grace ${o.grace}`);
    assert.ok(/^[A-Za-z]+ \d+$/.test(o.name) && !/^Your/.test(o.name), o.name);
    assert.ok(effects.some((f) => f.type === 'arrival' && f.id === o.id && Math.hypot(f.x - o.x, f.y - o.y) < 0.05));
  }
  assert.equal(new Set(sim.objects.map((o) => o.id)).size, 3);
  assert.deepEqual(types(events.slice(-2)), ['orbit', 'newcomers']);
  assert.deepEqual(events.at(-1).detail, { count: 2, total: 2, score: 1 });
  assert.deepEqual(sim.getState(), { phase: 'aiming', orbiting: 1, objects: 3, newcomers: 2 });
});

test('newcomers: grace counts down for rails objects; hazardous only after it', () => {
  // Grace counts down on rails objects.
  const { sim } = makeSim(6, { ...ENDLESS_EMPTY, traffic: [{ altitude: 0.5, angle: 0.4 }] });
  sim.objects[0].grace = 1;
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.objects[0].grace - 0.5) < 0.02, `grace ${sim.objects[0].grace}`);
  for (let i = 0; i < 40; i++) sim.step(1 / 60);
  assert.ok(sim.objects[0].grace <= 0);

  // A vertical shot crosses an object at tHit: grace longer than that -> pass through, shorter -> collision.
  const crossing = (graceFor) => {
    const { sim: s, events } = makeSim(7, { ...ENDLESS_EMPTY, traffic: [{ altitude: 0.5, angle: 0.4 }] });
    const o = s.objects[0];
    const power = 0.75;
    const path = s.predict(Math.PI / 2, power, 15);
    const tHit = path.findIndex((p) => Math.hypot(p.x, p.y) >= o.r) * 0.05;
    runUntil(s, () => Math.abs(wrapAngle(o.theta + o.omega * tHit - Math.PI / 2)) < 0.01, 60, 1 / 120);
    o.grace = graceFor(tHit);
    s.launch(Math.PI / 2, power);
    runUntil(s, () => s.time > 0 && (events.some((e) => e.type === 'collision') || s.time > 0 && false) || !s.player || s.player.r > o.r + 0.5, 10, 1 / 120);
    return events.some((e) => e.type === 'collision');
  };
  assert.equal(crossing((t) => t + 1), false, 'inside grace: no collision');
  assert.equal(crossing(() => 0), true, 'no grace: collision');
});

test('newcomers: MAX_OBJECTS respected', () => {
  const { sim } = makeSim(8, { ...ENDLESS_EMPTY, newcomers: { schedule: [{ atScore: 1, min: 3, max: 4 }], appear: 1 } });
  const dummy = (i) => ({
    id: 1000 + i, kind: 'debris', name: 'far', x: 5, y: 0, vx: 0, vy: 0, radius: 0.03, onRails: true,
    r: 5, theta: i, omega: 0.1, age: 0, playerPlaced: false, grace: 0, dead: false,
  });
  for (let i = 0; i < CONFIG.MAX_OBJECTS - 2; i++) sim.objects.push(dummy(i));
  launchAndBurnAtApex(sim, 0.6);
  runUntil(sim, () => sim.phase !== 'confirming', 40);
  assert.equal(sim.getState().orbiting, 1);
  assert.equal(sim.objects.length, CONFIG.MAX_OBJECTS, 'player + one newcomer fill the cap');
  assert.equal(sim.getState().newcomers, 1);
});

test('score counts only the player: newcomers never add to it', () => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { run, sim } = observedRun(seed);
    const orbits = run.events.filter((e) => e.type === 'orbit').length;
    assert.equal(run.score, orbits);
    assert.equal(sim.getState().orbiting, orbits);
    const over = run.events.filter((e) => e.type === 'gameover');
    if (over.length) {
      assert.equal(over[0].detail.score, orbits);
      checked++;
    }
    const placed = sim.objects.filter((o) => o.playerPlaced).length;
    assert.ok(placed <= orbits);
  }
  assert.ok(checked > 30);
});

test('confirmation: endless confirmTime is used; single mode keeps clamp(period, 5, 10)', () => {
  const confirmSeconds = (level) => {
    const { sim } = makeSim(2, level);
    launchAndBurnAtApex(sim, 0.7);
    runUntil(sim, () => !sim.player.burning, 5, 1 / 120);
    const r = sim.player.r;
    const t0 = sim.time;
    runUntil(sim, () => sim.phase !== 'confirming', 30, 1 / 120);
    return { dur: sim.time - t0, r };
  };
  const a = confirmSeconds({ ...ENDLESS_EMPTY, confirmTime: 3 });
  assert.ok(Math.abs(a.dur - 3) < 0.02, `endless confirm ${a.dur}`);
  const b = confirmSeconds(SINGLE_EMPTY);
  const expected = Math.min(10, Math.max(5, circularPeriod(b.r)));
  assert.ok(Math.abs(b.dur - expected) < 0.02, `single confirm ${b.dur} vs ${expected}`);
  const c = confirmSeconds({ ...SINGLE_EMPTY, confirmTime: 0 }); // invalid: ignored
  assert.ok(Math.abs(c.dur - expected) < 0.02);
});

// ---------------------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    console.log(`- ${name}`);
    fn();
    console.log('    ok');
  } catch (err) {
    failed++;
    console.log(`    FAIL: ${err.message}`);
    if (process.env.VERBOSE) console.log(err.stack);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
