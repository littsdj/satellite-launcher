// Tuning constants for the satellite-launcher simulation.
// World units: Earth radius = 1, origin at Earth's centre, +y is UP, time in seconds.

export const CONFIG = {
  // --- Physics ---------------------------------------------------------
  GM: 4, // gravitational parameter: circular period at r is 2*pi*sqrt(r^3/GM)
  EARTH_R: 1,
  MAX_SUBSTEP: 1 / 120, // largest integration substep (s)
  MAX_DT: 0.05, // step(dt) clamps dt to this

  // --- Geometry / zones ------------------------------------------------
  ATMOSPHERE_TOP: 1.25, // burning below this -> crash
  BAND_MIN: 1.4, // traffic altitude 0 maps here
  BAND_MAX: 2.5, // traffic altitude 1 maps here
  BURN_MAX_R: 2.9, // burning above this -> lost ("too far out")
  LOST_R: 3.6, // flying beyond this -> lost
  VIEW_RADIUS: 3.2, // renderer fits this radius to the smaller canvas half-size

  // --- Launch ----------------------------------------------------------
  LAUNCH_SITE: { x: 0, y: 1 }, // top of the Earth
  LAUNCH_LIFT: 0.005, // start this far above the surface so we do not crash instantly
  LAUNCH_SPEED_MIN: 0.6, // power 0
  LAUNCH_SPEED_MAX: 2.7, // power 1 (escape speed at r=1 is 2.83)
  MIN_LAUNCH_ELEVATION: (5 * Math.PI) / 180, // never aim into the ground
  FLIGHT_TIMEOUT: 15, // seconds in flight without burning -> lost

  // --- Burn / confirmation --------------------------------------------
  BURN_DURATION: 0.6, // seconds of thrust before snapping onto rails
  BURN_RATE: 10, // 1/s: how fast velocity (and radius) are blended during the burn
  CONFIRM_MIN: 5, // confirmation = one orbital period clamped to [min, max]
  CONFIRM_MAX: 10,

  // --- Collision radii -------------------------------------------------
  PLAYER_RADIUS: 0.055,
  SATELLITE_RADIUS: 0.05,
  DERELICT_RADIUS: 0.055,
  DEBRIS_RADIUS: 0.03,
  FRAGMENT_RADIUS: 0.03,

  // --- Traffic generation ---------------------------------------------
  TRAFFIC_MIX: { satellite: 0.65, derelict: 0.2, debris: 0.15 },
  SPAWN_CLEAR_ANGLE: 0.4, // generated traffic avoids +-this many rad around straight up at t=0
  SPAWN_GAP: 0.04, // extra clearance between generated traffic at t=0

  // --- Debris / cascades ----------------------------------------------
  MAX_OBJECTS: 180,
  FRAGMENTS_MIN: 5, // per burst of a satellite / derelict / player
  FRAGMENTS_MAX: 8,
  DEBRIS_FRAGMENTS_MIN: 3, // per burst of a piece of debris
  DEBRIS_FRAGMENTS_MAX: 4,
  FRAGMENT_KICK_MIN: 0.05, // random kick as a fraction of the parent's speed
  FRAGMENT_KICK_MAX: 0.12,
  FRAGMENT_GRACE: 0.4, // seconds a new fragment cannot collide
  BURNUP_R: 1.05, // fragments at or below this radius are removed
};
