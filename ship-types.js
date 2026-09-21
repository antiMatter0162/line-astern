// ---- Ship type registry ----
// Each ship class lives in its own file (see pennsylvania-class.js) and
// registers itself here via registerShipType(). LOAD ORDER MATTERS:
//   1. Phaser
//   2. ship-types.js (this file)
//   3. every ship class file (pennsylvania-class.js, etc.)
//   4. main.js
// main.js reads ship stats out of SHIP_TYPES; it never hardcodes a class's
// numbers itself.

// Fallback values so a class file only has to specify what makes it unique

const SHIP_TYPE_DEFAULTS = {
  displayWidth: 56,
  displayHeight: 130,
  turretDisplaySize: 21,

  maxSpeed: 80,
  acceleration: 100,
  deceleration: 100,
  turnRate: Phaser.Math.DegToRad(18),
  collisionRadius: 26,

  turretTraverse: Phaser.Math.DegToRad(0.15),
  turretReloadSeconds: 12,
  minFiringDistance: 150,

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
// SHIP_TYPE_DEFAULTS; anything it DOES specify always wins. textures/
// assetPaths/dispersionCurve are merged one level deep so overriding just
// one field inside them (e.g. only dispersionCurve.horizontal) doesn't
// silently drop the rest.
function registerShipType(typeDef) {
  if (!typeDef || !typeDef.id) {
    throw new Error("registerShipType: typeDef needs an id");
  }
  SHIP_TYPES[typeDef.id] = {
    ...SHIP_TYPE_DEFAULTS,
    ...typeDef,
    textures: { ...typeDef.textures },
    assetPaths: { ...typeDef.assetPaths },
    dispersionCurve: {
      ...SHIP_TYPE_DEFAULTS.dispersionCurve,
      ...typeDef.dispersionCurve,
    },
  };
}

// Animation keys are namespaced per type (e.g. "pennsylvania-moving") since
// different classes use different texture atlases and Phaser's animation
// keys are global — two classes can't share "ship-moving" once their
// underlying textures differ.
function movingAnimKey(stats) {
  return `${stats.id}-moving`;
}
function slowingAnimKey(stats) {
  return `${stats.id}-slowing-down`;
}
function acceleratingAnimKey(stats) {
  return `${stats.id}-accelerating`;
}

// Barrel muzzle offsets depend on turretDisplaySize, which varies per
// class, so these can't be precomputed once globally the way the old
// BARREL_LOCAL_OFFSETS constant was — each ship computes and caches its
// own copy at creation (see createShip in main.js).
function computeBarrelLocalOffsets(stats) {
  return [-1, 0, 1].map((i) => ({
    dx: i * stats.barrelNativeSpacing * (stats.turretDisplaySize / 360),
    dy: stats.barrelNativeMuzzleDy * (stats.turretDisplaySize / 360),
  }));
}