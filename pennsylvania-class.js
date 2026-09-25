// Pennsylvania-Class Battleship.

registerShipType({
  id: "pennsylvania",
  label: "Pennsylvania-Class Battleship",

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

  hullFrameWidth: 960,
  hullFrameHeight: 2220,

  wakeMovingFrames: 7,
  wakeAccelerationFrames: 9, 


  displayWidth: 56,
  displayHeight: 130,
  turretDisplaySize: 21,
  
  maxHealth: 56000,
  shellAlpha: 3200,

  maxSpeed: 90,
  acceleration: 108,
  deceleration: 108,
  turnRate: Phaser.Math.DegToRad(20),
  collisionRadius: 28,

  turretMounts: [
    { type: "B", dx: 0, dy: -35, baseRotation: Math.PI, arc: "front" }, // bow-most
    { type: "A", dx: 0, dy: -20, baseRotation: Math.PI, arc: "front" }, // bow, superfiring
    { type: "A", dx: 0, dy: 23.5, baseRotation: 0,       arc: "back"  }, // stern, superfiring
    { type: "B", dx: 0, dy: 38, baseRotation: 0,         arc: "back"  }, // stern-most
  ],
  turretTraverse: Phaser.Math.DegToRad(12),
  turretReloadSeconds: 20,

  frontFiringArc: Phaser.Math.DegToRad(260),
  backFiringArc: Phaser.Math.DegToRad(235),

  minFiringDistance: 150,
  maxFiringDistance: 3200,

  // vertical = across beam line, horizontal = perpendicular to beam line
  dispersionCurve: {
    vertical: { base: 3, coefficient: 0.07, exponent: 0.9 },
    horizontal: { base: 6, coefficient: 0.095, exponent: 1 },
  },
  dispersionSigma: 1.4,

  barrelNativeSpacing: 60,
  barrelNativeMuzzleDy: 164,
});