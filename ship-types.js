// ---- Ship type registry ----
// Each ship class lives in its own file (see pennsylvania-class.js) and
// registers itself here via registerShipType(). LOAD ORDER MATTERS:
//   1. Phaser
//   2. ship-types.js (this file)
//   3. every ship class file (pennsylvania-class.js, etc.)
//   4. main.js
// main.js reads ship stats out of SHIP_TYPES

// Fallback values so a class file only has to specify what makes it unique

// Tactical tuning is overridable per ship type and through level ai.parameters.
// Defaults retain the existing AI behavior; distances are world units.
const SHIP_AI_DEFAULTS = {
  avoidBattleships: false,
  battleshipAvoidanceTrigger: 2150,
  battleshipAvoidanceDistance: 2250,
  targetSwitchRangeFactor: 0.85,
  preferredRange: null,
  engagementRangeFactor: 0.45,
  engagementRangeCap: 1300,
  minimumRangeMargin: 200,
  maximumRangeMargin: 100,
  flankDistance: 700,
  fullDistance: 300,
  matchSpeedDistance: 120,
  fullSpeedOrderId: "ahead_full",
  waypointIntervalMs: 20000,
  avoidanceWaypointIntervalMs: 1500,
};

const SHIP_TYPE_DEFAULTS = {
  displayWidth: 56,
  displayHeight: 130,
  wakeFrameWidth: 240,
  wakeFrameHeight: 555,
  turretDisplaySize: 21,

  maxHealth: 25000,
  shellAlpha: 600,

  maxSpeed: 40,
  acceleration: 50,
  deceleration: 50,
  turnRate: Phaser.Math.DegToRad(18),
  rudderRampTimeSeconds: 2,
  collisionRadius: 26,

  turretTraverse: Phaser.Math.DegToRad(20),
  turretReloadSeconds: 12,
  minFiringDistance: 150,

  frontFiringArc: Phaser.Math.DegToRad(150),
  backFiringArc: Phaser.Math.DegToRad(150),

  dispersionCurve: {
    vertical: { base: 4, coefficient: 0.05, exponent: 0.9 },
    horizontal: { base: 7, coefficient: 0.08, exponent: 0.95 },
  },
  dispersionSigma: 1.6,

  barrelNativeSpacing: 60,
  barrelNativeMuzzleDy: 164,

  hullFrameWidth: 960,
  hullFrameHeight: 2220,
};

const SHIP_TYPES = {};

// Call once per class file: registerShipType({ id: "pennsylvania", ... }).
// Anything the class file doesn't specify is filled in from
// SHIP_TYPE_DEFAULTS; anything it DOES specify always wins.
function registerShipType(typeDef) {
  if (!typeDef || !typeDef.id) {
    throw new Error("registerShipType: typeDef needs an id");
  }
  SHIP_TYPES[typeDef.id] = {
    ...SHIP_TYPE_DEFAULTS,
    ...typeDef,
    textures: { ...typeDef.textures },
    assetPaths: { ...typeDef.assetPaths },
    aiParameters: {
      ...SHIP_AI_DEFAULTS,
      // Heavy and light cruisers retain their existing battleship avoidance.
      avoidBattleships: typeDef.shipClass === 1 || typeDef.shipClass === 2,
      ...typeDef.aiParameters,
    },
    dispersionCurve: {
      ...SHIP_TYPE_DEFAULTS.dispersionCurve,
      ...typeDef.dispersionCurve,
    },
  };
}

// Wake animation keys are namespaced per type
function movingWakeAnimKey(stats) {
  return `${stats.id}-wake-moving`;
}
function slowingWakeAnimKey(stats) {
  return `${stats.id}-wake-slowing-down`;
}
function acceleratingWakeAnimKey(stats) {
  return `${stats.id}-wake-accelerating`;
}

// Barrel muzzle offsets depend on turretDisplaySize
function computeBarrelLocalOffsets(stats) {
  return [-1, 0, 1].map((i) => ({
    dx: i * stats.barrelNativeSpacing * (stats.turretDisplaySize / 360),
    dy: stats.barrelNativeMuzzleDy * (stats.turretDisplaySize / 360),
  }));
}
