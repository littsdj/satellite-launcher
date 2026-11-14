// DOM-free simulation core for the satellite launcher game.
// No module-level mutable state: every createSim() call owns its own world.
//
// Conventions: Earth radius 1, origin at Earth's centre, +y up, seconds.
// Two kinds of body:
//   * "on rails": circular orbit advanced analytically (theta += omega*dt)
//   * "free": integrated with velocity Verlet (player in flight, fragments)

import { CONFIG } from './config.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Advance a free body one velocity-Verlet (symplectic) step under point-mass gravity.
 * @param {{x:number,y:number,vx:number,vy:number}} b mutated in place
 * @param {number} h timestep in seconds
 */
export function stepFreeBody(b, h) {
  const gm = CONFIG.GM;
  let r2 = b.x * b.x + b.y * b.y;
  let k = -gm / (r2 * Math.sqrt(r2));
  const ax = k * b.x;
  const ay = k * b.y;
  b.x += b.vx * h + 0.5 * ax * h * h;
  b.y += b.vy * h + 0.5 * ay * h * h;
  r2 = b.x * b.x + b.y * b.y;
  k = -gm / (r2 * Math.sqrt(r2));
  b.vx += 0.5 * (ax + k * b.x) * h;
  b.vy += 0.5 * (ay + k * b.y) * h;
}

/** Orbital period of a circular orbit of radius r. */
export function circularPeriod(r) {
  return TAU * Math.sqrt((r * r * r) / CONFIG.GM);
}

/** Refresh r/theta/omega of a free body from its Cartesian state. */
function syncPolar(b) {
  const r2 = b.x * b.x + b.y * b.y;
  b.r = Math.sqrt(r2);
  b.theta = Math.atan2(b.y, b.x);
  b.omega = (b.x * b.vy - b.y * b.vx) / r2;
}

/** Refresh x/y/vx/vy of an on-rails body from r/theta/omega. */
function syncRails(b) {
  const c = Math.cos(b.theta);
  const s = Math.sin(b.theta);
  const speed = b.r * b.omega;
  b.x = b.r * c;
  b.y = b.r * s;
  b.vx = -speed * s;
  b.vy = speed * c;
}

/** Advance an on-rails body by h seconds. */
function advanceRails(b, h) {
  b.theta += b.omega * h;
  if (b.theta > Math.PI) b.theta -= TAU;
  else if (b.theta < -Math.PI) b.theta += TAU;
  syncRails(b);
}

/** Clamp an aim angle so the launch velocity never points into the ground. */
function clampLaunchAngle(angle) {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle)); // normalise to (-pi, pi]
  const lo = CONFIG.MIN_LAUNCH_ELEVATION;
  if (Math.sin(a) >= Math.sin(lo)) return a;
  return Math.cos(a) >= 0 ? lo : Math.PI - lo;
}

/** Initial position/velocity for a launch. */
function launchVector(angle, power) {
  const a = clampLaunchAngle(Number.isFinite(angle) ? angle : Math.PI / 2);
  const p = Math.min(1, Math.max(0, Number.isFinite(power) ? power : 0));
  const speed = CONFIG.LAUNCH_SPEED_MIN + p * (CONFIG.LAUNCH_SPEED_MAX - CONFIG.LAUNCH_SPEED_MIN);
  return {
    angle: a,
    x: CONFIG.LAUNCH_SITE.x,
    y: CONFIG.LAUNCH_SITE.y + CONFIG.LAUNCH_LIFT,
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
  };
}

const KIND_NAMES = {
  satellite: ['WeatherSat', 'SpaceCam', 'MapSat', 'RadioSat', 'StarGazer', 'ClimateSat', 'GPS Buddy'],
  derelict: ['Old rocket body', 'Retired probe', 'Silent satellite', 'Dead antenna'],
  debris: ['Paint fleck', 'Loose bolt', 'Metal shard', 'Tiny screw', 'Glove'],
};

/** Made-up names for satellites of other countries and companies (endless "newcomers"). */
const NEWCOMER_NAMES = ['OceanEye', 'FarmWatch', 'SkyLink', 'StormSpotter', 'NaviStar', 'CityNet', 'IceTracker', 'TideWatch', 'CropSat', 'AeroNet'];

/** Sample spacing (s) used to check that a newcomer stays clear while it appears. */
const APPEAR_SAMPLE_DT = 0.025; // rel. speed <= ~3 -> <= 0.075 between samples, under 2x SPAWN_GAP
const NEWCOMER_ATTEMPTS = 60;

// ---------------------------------------------------------------------------
// Simulation factory
// ---------------------------------------------------------------------------

/**
 * Create an independent simulation instance.
 * @param {{onEvent?:(type:string, detail:object)=>void, random?:()=>number}} [opts]
 */
export function createSim({ onEvent = () => {}, random = Math.random } = {}) {
  const C = CONFIG;
  const objects = []; // live world objects; mutated in place so references stay valid
  let effects = [];
  let nextId = 1;
  let orbiting = 0;
  let deadCount = 0; // objects flagged .dead awaiting compaction
  let nameCounter = 0;
  let newcomerTotal = 0; // newcomers spawned this level (never counts towards the score)
  // Per-flight bookkeeping for the player.
  const fl = { time: 0, burnUsed: false, burnT: 0, rB: 0, dir: 1, confirmT: 0, confirmDur: 0 };
  const fragmentScratch = [];
  const targetScratch = [];

  const sim = {
    config: C,
    phase: 'aiming',
    time: 0,
    level: null,
    objects,
    player: null,
    loadLevel,
    canLaunch,
    launch,
    canBurn,
    burn,
    step,
    predict,
    getState,
    drainEffects,
  };

  // ----- small utilities ---------------------------------------------------

  const rand = (lo, hi) => lo + (hi - lo) * random();
  const randInt = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const emit = (type, detail = {}) => onEvent(type, detail);
  const isEndless = () => sim.level.mode === 'endless';

  function pushEffect(fx) {
    effects.push(fx);
    if (effects.length > 500) effects.shift(); // renderer not draining: keep memory bounded
  }

  function radiusFor(kind) {
    return kind === 'derelict' ? C.DERELICT_RADIUS : kind === 'debris' ? C.DEBRIS_RADIUS : C.SATELLITE_RADIUS;
  }

  function nameFor(kind, names = null) {
    const list = names || KIND_NAMES[kind] || KIND_NAMES.satellite;
    nameCounter += 1;
    const base = list[Math.floor(random() * list.length)];
    return kind === 'satellite' ? `${base} ${nameCounter}` : base;
  }

  function pickKind() {
    const mix = C.TRAFFIC_MIX;
    const u = random();
    if (u < mix.satellite) return 'satellite';
    if (u < mix.satellite + mix.derelict) return 'derelict';
    return 'debris';
  }

  // ----- level / traffic ---------------------------------------------------

  function makeRailsObject(spec) {
    const kind = spec.kind || 'satellite';
    const r = C.BAND_MIN + Math.min(1, Math.max(0, spec.altitude)) * (C.BAND_MAX - C.BAND_MIN);
    const omega = Math.sqrt(C.GM / (r * r * r));
    const o = {
      id: nextId++,
      kind,
      name: spec.name || nameFor(kind),
      x: 0, y: 0, vx: 0, vy: 0,
      radius: radiusFor(kind),
      onRails: true,
      r,
      theta: spec.angle,
      omega,
      age: 0,
      playerPlaced: false,
      grace: 0,
      dead: false,
    };
    syncRails(o);
    return o;
  }

  /**
   * spreadTraffic: altitude bins 0..count-1 in shuffled order (one object per lane band),
   * or null when the option is off (then no random numbers are consumed).
   */
  function spreadBins(count) {
    if (!sim.level.spreadTraffic) return null;
    const bins = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bins[i], bins[j]] = [bins[j], bins[i]];
    }
    return bins;
  }

  /** Random traffic specs: mixed kinds, away from the launch site, not overlapping at t=0. */
  function generateSpecs(count) {
    const specs = [];
    const placed = [];
    const bins = spreadBins(count);
    for (let i = 0; i < count; i++) {
      const kind = pickKind();
      let spec = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = rand(-Math.PI, Math.PI);
        const fromUp = Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2));
        if (Math.abs(fromUp) < C.SPAWN_CLEAR_ANGLE) continue;
        const altitude = bins ? (bins[i] + random()) / count : random();
        spec = { kind, altitude, angle };
        const r = C.BAND_MIN + altitude * (C.BAND_MAX - C.BAND_MIN);
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        const rad = radiusFor(kind);
        const clear = placed.every((q) => {
          const min = rad + q.rad + C.SPAWN_GAP;
          return (x - q.x) ** 2 + (y - q.y) ** 2 > min * min;
        });
        if (clear) {
          placed.push({ x, y, rad });
          break;
        }
      }
      if (spec) specs.push(spec);
    }
    return specs;
  }

  /**
   * Reset the world and generate traffic. Phase becomes 'aiming'.
   * @param {object} level see the game contract (mode, traffic, debrisOnCollision, showTrajectoryPreview)
   */
  function loadLevel(level) {
    sim.level = {
      mode: 'single',
      traffic: 0,
      debrisOnCollision: false,
      showTrajectoryPreview: true,
      spreadTraffic: false, // stratify generated altitudes over the lanes
      confirmTime: null, // seconds; overrides the period-based confirmation
      newcomers: null, // endless: { schedule: [{atScore,min,max}], appear } other launchers
      ...level,
    };
    objects.length = 0;
    effects = [];
    deadCount = 0;
    nameCounter = 0;
    newcomerTotal = 0;
    orbiting = 0;
    sim.player = null;
    sim.time = 0;
    sim.phase = 'aiming';
    const t = sim.level.traffic;
    const specs = Array.isArray(t) ? t : generateSpecs(Math.max(0, Math.floor(t) || 0));
    for (const spec of specs) objects.push(makeRailsObject(spec));
  }

  // ----- player actions ----------------------------------------------------

  /** True when a launch is allowed (phase 'aiming'). */
  function canLaunch() {
    return sim.phase === 'aiming';
  }

  /**
   * Launch a satellite from the launch site. No-op unless phase is 'aiming'.
   * @param {number} angle radians in world coordinates (0 = +x, PI/2 = up)
   * @param {number} power 0..1
   */
  function launch(angle, power) {
    if (!canLaunch()) return;
    const v = launchVector(angle, power);
    const p = {
      x: v.x, y: v.y, vx: v.vx, vy: v.vy,
      radius: C.PLAYER_RADIUS,
      burning: false, thrustX: 0, thrustY: 0,
      onRails: false, r: 0, theta: 0, omega: 0,
      settled: false,
    };
    syncPolar(p);
    sim.player = p;
    fl.time = 0;
    fl.burnUsed = false;
    fl.burnT = 0;
    fl.confirmT = 0;
    sim.phase = 'flight';
    pushEffect({ type: 'launch', x: p.x, y: p.y, angle: v.angle });
    emit('launch', {});
  }

  /** True while in flight and the burn has not been used. */
  function canBurn() {
    return sim.phase === 'flight' && !fl.burnUsed && sim.player !== null;
  }

  /**
   * Fire the circularising burn. Returns true if the burn was accepted
   * (too low -> 'crash', too high -> 'lost' instead).
   */
  function burn() {
    if (!canBurn()) return false;
    const p = sim.player;
    fl.burnUsed = true;
    if (p.r < C.ATMOSPHERE_TOP) {
      loseSatellite('crash');
      return false;
    }
    if (p.r > C.BURN_MAX_R) {
      loseSatellite('lost');
      return false;
    }
    const h = p.x * p.vy - p.y * p.vx; // angular momentum picks the orbit direction
    fl.dir = Math.abs(h) < 1e-6 ? 1 : Math.sign(h);
    fl.rB = p.r;
    fl.burnT = 0;
    fl.confirmT = 0;
    p.burning = true;
    setThrustDirection(p);
    sim.phase = 'confirming';
    pushEffect({ type: 'burnStart', x: p.x, y: p.y });
    emit('burn', {});
    return true;
  }

  // ----- burn mechanics ----------------------------------------------------

  /** Velocity change still needed to reach the circular tangential velocity at rB. */
  function burnDeltaV(p, r) {
    const vc = Math.sqrt(C.GM / fl.rB);
    return {
      dvx: vc * ((-fl.dir * p.y) / r) - p.vx,
      dvy: vc * ((fl.dir * p.x) / r) - p.vy,
    };
  }

  /** Point the (unit) thrust vector along the remaining delta-v. */
  function setThrustDirection(p) {
    const { dvx, dvy } = burnDeltaV(p, Math.hypot(p.x, p.y));
    const mag = Math.hypot(dvx, dvy);
    if (mag > 1e-9) {
      p.thrustX = dvx / mag;
      p.thrustY = dvy / mag;
    }
  }

  /** One substep of thrust: ease velocity to circular-tangential and radius to rB. */
  function applyBurnThrust(p, h) {
    const k = 1 - Math.exp(-C.BURN_RATE * h);
    const r = Math.hypot(p.x, p.y);
    const { dvx, dvy } = burnDeltaV(p, r);
    setThrustDirection(p);
    p.vx += dvx * k;
    p.vy += dvy * k;
    const s = 1 + (fl.rB / r - 1) * k;
    p.x *= s;
    p.y *= s;
  }

  /** End of burn: snap onto an exactly circular orbit at the current radius. */
  function finishBurn(p) {
    syncPolar(p);
    p.omega = fl.dir * Math.sqrt(C.GM / (p.r * p.r * p.r));
    p.onRails = true;
    p.burning = false;
    p.thrustX = 0;
    p.thrustY = 0;
    syncRails(p);
    const custom = sim.level.confirmTime;
    fl.confirmDur = Number.isFinite(custom) && custom > 0
      ? custom
      : Math.min(C.CONFIRM_MAX, Math.max(C.CONFIRM_MIN, circularPeriod(p.r)));
    fl.confirmT = 0;
  }

  // ----- outcomes ----------------------------------------------------------

  /** Phase to enter once the player's attempt is over. */
  function afterAttemptPhase() {
    return isEndless() ? 'aiming' : 'resolved';
  }

  /** The satellite fell to Earth or flew away. */
  function loseSatellite(kind) {
    const p = sim.player;
    pushEffect({ type: kind, x: p.x, y: p.y });
    sim.player = null;
    sim.phase = afterAttemptPhase();
    emit(kind, {});
  }

  /** Confirmation survived. */
  function succeed() {
    const p = sim.player;
    orbiting += 1;
    pushEffect({ type: 'orbit', x: p.x, y: p.y });
    if (isEndless()) {
      objects.push({
        id: nextId++,
        kind: 'satellite',
        name: `Your satellite ${orbiting}`,
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        radius: p.radius,
        onRails: true,
        r: p.r, theta: p.theta, omega: p.omega,
        age: 0,
        playerPlaced: true,
        grace: 0,
        dead: false,
      });
      sim.player = null;
      sim.phase = 'aiming';
    } else {
      p.settled = true;
      sim.phase = 'resolved';
    }
    emit('orbit', { orbiting });
    if (isEndless() && sim.level.newcomers) spawnNewcomers();
  }

  // ----- newcomers (other launchers) -----------------------------------------

  /** The schedule entry for the current score (last with atScore <= orbiting), or null. */
  function newcomerRule() {
    let rule = null;
    for (const e of sim.level.newcomers.schedule || []) {
      if (e.atScore <= orbiting) rule = e;
    }
    return rule;
  }

  /** Position of a rails/free body `t` seconds from now (free bodies stay put). */
  function futurePos(o, t) {
    if (!o.onRails) return { x: o.x, y: o.y };
    const th = o.theta + o.omega * t;
    return { x: o.r * Math.cos(th), y: o.r * Math.sin(th) };
  }

  /** True when `cand` stays clear of every live object (and the player) for `appear` seconds. */
  function newcomerClear(cand, appear) {
    const others = objects.filter((o) => !o.dead);
    if (sim.player) others.push(sim.player);
    for (let t = 0; t <= appear + 1e-9; t += APPEAR_SAMPLE_DT) {
      const a = futurePos(cand, t);
      for (const o of others) {
        const b = futurePos(o, t);
        const min = cand.radius + o.radius + C.SPAWN_GAP;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= min * min) return false;
      }
    }
    return true;
  }

  /** Try to place one newcomer; returns the object or null if no clear spot was found. */
  function placeNewcomer(appear) {
    for (let attempt = 0; attempt < NEWCOMER_ATTEMPTS; attempt++) {
      const angle = rand(-Math.PI, Math.PI);
      const fromUp = Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2));
      if (Math.abs(fromUp) < C.SPAWN_CLEAR_ANGLE) continue;
      const cand = makeRailsObject({ kind: 'satellite', altitude: random(), angle, name: 'tmp' });
      if (!newcomerClear(cand, appear)) continue;
      cand.name = nameFor('satellite', NEWCOMER_NAMES);
      cand.newcomer = true;
      cand.appear = appear;
      cand.grace = appear;
      return cand;
    }
    return null;
  }

  /** After a player success: other launchers put satellites up, never overlapping anything. */
  function spawnNewcomers() {
    const rule = newcomerRule();
    if (!rule) return;
    const appear = sim.level.newcomers.appear ?? 1.5;
    const wanted = randInt(rule.min, rule.max);
    const room = Math.max(0, C.MAX_OBJECTS - (objects.length - deadCount));
    let spawned = 0;
    for (let i = 0; i < Math.min(wanted, room); i++) {
      const o = placeNewcomer(appear);
      if (!o) continue;
      objects.push(o);
      pushEffect({ type: 'arrival', x: o.x, y: o.y, id: o.id });
      spawned += 1;
    }
    if (spawned > 0) {
      newcomerTotal += spawned;
      emit('newcomers', { count: spawned, total: newcomerTotal, score: orbiting });
    }
  }

  /** The player's satellite hit `other`: both are destroyed (and burst if debris is on). */
  function playerCollision(other) {
    const p = sim.player;
    const x = (p.x + other.x) / 2;
    const y = (p.y + other.y) / 2;
    pushEffect({ type: 'explosion', x, y, size: 1 });
    kill(other);
    if (sim.level.debrisOnCollision) {
      burst(p, 'satellite');
      burst(other, other.kind);
    }
    removeDead();
    sim.player = null;
    const endless = isEndless();
    sim.phase = endless ? 'gameover' : 'resolved';
    emit('collision', { withName: other.name, withKind: other.kind });
    if (endless) emit('gameover', { score: orbiting });
  }

  // ----- debris ------------------------------------------------------------

  function kill(o) {
    if (!o.dead) {
      o.dead = true;
      deadCount += 1;
    }
  }

  /** Compact the objects array in place, dropping flagged objects. */
  function removeDead() {
    if (deadCount === 0) return;
    let j = 0;
    for (let i = 0; i < objects.length; i++) {
      if (!objects[i].dead) objects[j++] = objects[i];
    }
    objects.length = j;
    deadCount = 0;
  }

  /**
   * Spawn fragments from `src` (player or object): same velocity plus a random kick
   * of 5-12% of the speed, so they scatter onto different orbits. Respects MAX_OBJECTS.
   */
  function burst(src, kind) {
    const wanted = kind === 'debris'
      ? randInt(C.DEBRIS_FRAGMENTS_MIN, C.DEBRIS_FRAGMENTS_MAX)
      : randInt(C.FRAGMENTS_MIN, C.FRAGMENTS_MAX);
    const room = C.MAX_OBJECTS - (objects.length - deadCount);
    const n = Math.min(wanted, Math.max(0, room));
    const speed = Math.hypot(src.vx, src.vy);
    for (let i = 0; i < n; i++) {
      const dir = rand(0, TAU);
      const kick = speed * rand(C.FRAGMENT_KICK_MIN, C.FRAGMENT_KICK_MAX);
      const off = rand(0, src.radius * 0.5);
      const f = {
        id: nextId++,
        kind: 'debris',
        name: 'Fragment',
        x: src.x + Math.cos(dir) * off,
        y: src.y + Math.sin(dir) * off,
        vx: src.vx + Math.cos(dir) * kick,
        vy: src.vy + Math.sin(dir) * kick,
        radius: C.FRAGMENT_RADIUS,
        onRails: false,
        r: 0, theta: 0, omega: 0,
        age: 0,
        playerPlaced: false,
        grace: C.FRAGMENT_GRACE,
        dead: false,
      };
      syncPolar(f);
      objects.push(f);
    }
  }

  // ----- stepping ----------------------------------------------------------

  /**
   * Advance the whole world. dt is clamped to 0.05 s and split into substeps of
   * at most 1/120 s.
   */
  function step(dt) {
    if (!(dt > 0)) return;
    const d = Math.min(dt, C.MAX_DT);
    const n = Math.max(1, Math.ceil(d / C.MAX_SUBSTEP - 1e-9));
    const h = d / n;
    for (let i = 0; i < n; i++) substep(h);
  }

  function substep(h) {
    sim.time += h;
    advanceObjects(h);
    if (sim.player) advancePlayer(h);
    if (sim.player) collidePlayer();
    if (sim.level.debrisOnCollision) collideFragments();
    removeDead();
  }

  function advanceObjects(h) {
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      o.age += h;
      if (o.onRails) {
        advanceRails(o, h);
        if (o.grace > 0) o.grace -= h;
        continue;
      }
      stepFreeBody(o, h);
      syncPolar(o);
      if (o.grace > 0) o.grace -= h;
      if (o.r <= C.BURNUP_R || o.r > C.LOST_R) kill(o);
    }
  }

  function advancePlayer(h) {
    const p = sim.player;
    if (p.onRails) {
      advanceRails(p, h);
    } else {
      stepFreeBody(p, h);
      if (p.burning) applyBurnThrust(p, h);
      syncPolar(p);
    }
    if (sim.phase === 'flight') {
      fl.time += h;
      if (p.r <= C.EARTH_R) loseSatellite('crash');
      else if (p.r > C.LOST_R || fl.time > C.FLIGHT_TIMEOUT) loseSatellite('lost');
    } else if (sim.phase === 'confirming') {
      if (p.burning) {
        fl.burnT += h;
        if (p.r <= C.EARTH_R) loseSatellite('crash');
        else if (fl.burnT >= C.BURN_DURATION) finishBurn(p);
      } else {
        fl.confirmT += h;
        if (fl.confirmT >= fl.confirmDur) succeed();
      }
    }
  }

  /** Player (flight or confirming) versus every live object. */
  function collidePlayer() {
    if (sim.phase !== 'flight' && sim.phase !== 'confirming') return;
    const p = sim.player;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o.dead || o.grace > 0) continue;
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const rr = p.radius + o.radius;
      if (dx * dx + dy * dy < rr * rr) {
        playerCollision(o);
        return;
      }
    }
  }

  /**
   * Free fragments versus non-debris objects (cascade) and the player.
   * Debris-vs-debris is ignored. A hit removes the fragment and bursts the target.
   */
  function collideFragments() {
    const frags = fragmentScratch;
    const targets = targetScratch;
    frags.length = 0;
    targets.length = 0;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o.dead) continue;
      if (o.kind !== 'debris') targets.push(o);
      else if (!o.onRails && o.grace <= 0) frags.push(o);
    }
    if (frags.length === 0) return;
    const playerLive = sim.player && (sim.phase === 'flight' || sim.phase === 'confirming');
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i];
      if (f.dead) continue;
      if (playerLive && sim.player) {
        const p = sim.player;
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const rr = p.radius + f.radius;
        if (dx * dx + dy * dy < rr * rr) {
          playerCollision(f);
          continue;
        }
      }
      for (let j = 0; j < targets.length; j++) {
        const t = targets[j];
        if (t.dead) continue;
        const dx = t.x - f.x;
        const dy = t.y - f.y;
        const rr = t.radius + f.radius;
        if (dx * dx + dy * dy < rr * rr) {
          pushEffect({ type: 'explosion', x: t.x, y: t.y, size: t.kind === 'derelict' ? 0.7 : 0.85 });
          kill(f);
          kill(t);
          burst(t, t.kind);
          break;
        }
      }
    }
  }

  // ----- queries -----------------------------------------------------------

  /**
   * Ballistic path (ignoring traffic) for a hypothetical launch, sampled every 0.05 s.
   * Uses the same integrator and substep as step(), so it matches the real flight.
   * @returns {{x:number,y:number}[]}
   */
  function predict(angle, power, maxTime = 6) {
    const v = launchVector(angle, power);
    const b = { x: v.x, y: v.y, vx: v.vx, vy: v.vy };
    const pts = [{ x: b.x, y: b.y }];
    const h = C.MAX_SUBSTEP;
    const perSample = Math.round(0.05 / h);
    const total = Math.round(maxTime / h);
    for (let i = 1; i <= total; i++) {
      stepFreeBody(b, h);
      const r = Math.hypot(b.x, b.y);
      const done = r <= C.EARTH_R || r > C.LOST_R;
      if (i % perSample === 0 || done) pts.push({ x: b.x, y: b.y });
      if (done) break;
    }
    return pts;
  }

  /** Snapshot for the UI. */
  function getState() {
    return { phase: sim.phase, orbiting, objects: objects.length, newcomers: newcomerTotal };
  }

  /** Return and clear the queued visual effects. */
  function drainEffects() {
    const out = effects;
    effects = [];
    return out;
  }

  loadLevel({});
  return sim;
}
