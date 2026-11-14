// Level definitions for the scripted story, plus the seeded generator for level 3.

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const VANGUARD = 'Vanguard 1';

export const LEVEL2_TRAFFIC = [
  { name: 'Weather satellite', kind: 'satellite', altitude: 0.24, angle: 0.6 },
  { name: 'GPS satellite', kind: 'satellite', altitude: 0.8, angle: 2.1 },
  { name: 'Space telescope', kind: 'satellite', altitude: 0.38, angle: 3.5 },
  { name: VANGUARD, kind: 'derelict', altitude: 0.56, angle: 4.5 },
  { name: 'TV satellite', kind: 'satellite', altitude: 0.9, angle: 5.4 },
  { name: 'Science probe', kind: 'satellite', altitude: 0.66, angle: 1.3 },
];

const SAT_NAMES = ['Weather satellite', 'GPS satellite', 'Space telescope', 'TV satellite', 'Science probe', 'Phone satellite'];
const DEAD_NAMES = ['Old weather satellite', 'Old TV satellite', 'Old science satellite'];
const DEBRIS_NAMES = ['Paint fleck', 'Broken fragment', 'Rocket piece'];

/** ~74 objects: 27 satellites, 17 derelicts (one is Vanguard 1), 30 debris. Same every time. */
export function makeCrowdedSky(seed = 1960) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const make = (kind, names) => ({
    name: pick(names),
    kind,
    altitude: rand() * 0.85,
    angle: rand() * Math.PI * 2,
  });
  const out = [];
  for (let i = 0; i < 27; i++) out.push(make('satellite', SAT_NAMES));
  for (let i = 0; i < 16; i++) out.push(make('derelict', DEAD_NAMES));
  for (let i = 0; i < 30; i++) out.push(make('debris', DEBRIS_NAMES));
  out.push({ name: VANGUARD, kind: 'derelict', altitude: 0.5, angle: 2.4 });
  return out;
}

export const SCRIPTED = [
  {
    id: 1,
    attempts: 1,
    def: { mode: 'single', traffic: 0, debrisOnCollision: false, showTrajectoryPreview: true },
    prompts: { aim: 'Pull back from the rocket to aim, then let go to launch' },
    success: {
      heading: 'You made it into orbit!',
      line: 'Your satellite is circling Earth. Next time, you will not be alone up there.',
      label: 'Next level',
    },
  },
  {
    id: 2,
    attempts: 1,
    def: { mode: 'single', traffic: LEVEL2_TRAFFIC, debrisOnCollision: false, showTrajectoryPreview: true },
    prompts: {
      aim: 'Six satellites share this sky. One is Vanguard 1: launched in 1958, silent since 1964. Aim between them.',
    },
    success: {
      heading: 'Through the gap!',
      line: 'Vanguard 1 went up in 1958. Sixty-odd years of launches later, about 40,000 objects are tracked in space, and only about 11,000 are working satellites.',
      label: 'Launch into a sky like today’s',
    },
  },
  {
    id: 3,
    attempts: 2,
    final: true,
    def: { mode: 'single', traffic: makeCrowdedSky(), debrisOnCollision: true, showTrajectoryPreview: true },
    prompts: { aim: 'A crowded sky, like today’s. Find a gap if you can.' },
  },
];

/** How long to hold on the final result before moving to the article (long enough to watch a cascade spread). */
export const HOLD_MS = { collision: 7000, other: 2500 };
