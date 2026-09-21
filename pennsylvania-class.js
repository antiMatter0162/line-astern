// Pennsylvania-Class Battleship.
// Every number here is copied directly from what used to be hardcoded at
// the top of main.js, so switching createShip() over to this type is meant
// to be behavior-preserving — nothing here is new tuning, just relocated.
registerShipType({
  id: "pennsylvania",
  label: "Pennsylvania-Class Battleship",

  // Texture keys are namespaced per class so multiple ship types can be
  // loaded into the same Phaser texture cache without collisions.
  //
  // The hull is a single static image. All ship animation lives in the two
  // wake spritesheets, which are drawn as a separate sprite on top of it.
  textures: {
    hullStationary: "pennsylvania-hull-stationary",
    wakeMoving: "pennsylvania-wake",
    wakeAcceleration: "pennsylvania-acceleration",
    turretA: "pennsylvania-turret-a",
    turretB: "pennsylvania-turret-b",
  },
  assetPaths: {
    hullStationary: "assets/Pennyslvania-Class.png",
    wakeMoving: "assets/Pennsylvania-Wake.png",
    wakeAcceleration: "assets/Pennsylvania-Acceleration.png",
    turretA: "assets/Pennsylvania Turret A.png",
    turretB: "assets/Pennsylvania Turret B.png",
  },

  // Size of the blank hull AND of every frame in both wake sheets — they
  // must match exactly so the wake sprite lines up with the hull.
  hullFrameWidth: 960,
  hullFrameHeight: 2220,

  // Frames actually used in each wake sheet (each sheet has an empty
  // trailing cell that Phaser counts as a frame but we never play).
  wakeMovingFrames: 7,        // Pennsylvania-Wake.png: 4 cols x 2 rows
  wakeAccelerationFrames: 9,  // Pennsylvania-Acceleration.png: 5 cols x 2 rows,
                              // frame 0 = full spray, last frame = nearly gone

  displayWidth: 56,
  displayHeight: 130,
  turretDisplaySize: 21,
  
  maxHealth: 52000,

  maxSpeed: 90,
  acceleration: 108,
  deceleration: 108,
  turnRate: Phaser.Math.DegToRad(20),
  collisionRadius: 28,

  // Local offsets are in "unrotated ship space" (same axes as the hull
  // texture: +y toward the stern, matching ship.sprite.rotation === 0, i.e.
  // bow facing up). Bow pair (A, B) start rotated 180° from the native art
  // (whose barrels point "down"); stern pair (B, A) keep native 0°
  // rotation. Order is bow -> stern: A, B, B, A.
  turretMounts: [
    { type: "A", dx: 0, dy: -35, baseRotation: Math.PI }, // bow-most
    { type: "B", dx: 0, dy: -20, baseRotation: Math.PI }, // bow, superfiring
    { type: "B", dx: 0, dy: 23.5, baseRotation: 0 }, // stern, superfiring
    { type: "A", dx: 0, dy: 38, baseRotation: 0 }, // stern-most
  ],
  turretTraverse: Phaser.Math.DegToRad(0.15),
  turretReloadSeconds: 10,

  minFiringDistance: 150,
  // vertical = across beam line, horizontal = perpendicular to beam line
  dispersionCurve: {
    vertical: { base: 3, coefficient: 0.04, exponent: 0.85 },
    horizontal: { base: 6, coefficient: 0.075, exponent: 0.95 },
  },
  dispersionSigma: 1.8,

  barrelNativeSpacing: 60,
  barrelNativeMuzzleDy: 164,
});