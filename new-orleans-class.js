// New Orleans-Class Cruiser

registerShipType({
  id: "new-orleans",
  label: "New Orleans-Class Cruiser",

  textures: {
    hullStationary: "new-orleans-hull-stationary",
    wakeMoving: "new-orleans-wake",
    wakeAcceleration: "new-orleans-acceleration",
    turretA: "new-orleans-turret-a",
    turretB: "new-orleans-turret-b",
  },
  assetPaths: {
    hullStationary: "assets/New Orleans.png",
    wakeMoving: "assets/New Orleans-Wake.png",
    wakeAcceleration: "assets/New Orleans-Acceleration.png",
    turretA: "assets/New Orleans Turret A.png",
    turretB: "assets/New Orleans Turret B.png",
  },

  hullFrameWidth: 960,
  hullFrameHeight: 2220,

  wakeMovingFrames: 7,
  wakeAccelerationFrames: 17, 


  displayWidth: 56,
  displayHeight: 130,
  turretDisplaySize: 17,
  
  maxHealth: 21000,
  shellAlpha: 900,

  maxSpeed: 125,
  acceleration: 85,
  deceleration: 90,
  turnRate: Phaser.Math.DegToRad(35),
  collisionRadius: 28,

  turretMounts: [
    { type: "B", dx: 0, dy: -35, baseRotation: Math.PI, arc: "front" }, // bow-most
    { type: "A", dx: 0, dy: -25.5, baseRotation: Math.PI, arc: "front" }, // bow, superfiring
    { type: "A", dx: 0, dy: 38, baseRotation: 0,         arc: "back"  }, // stern-most
  ],
  turretTraverse: Phaser.Math.DegToRad(28),
  turretReloadSeconds: 7.5,

  frontFiringArc: Phaser.Math.DegToRad(265),
  backFiringArc: Phaser.Math.DegToRad(280),

  minFiringDistance: 100,
  maxFiringDistance: 2500,

  // vertical = across beam line, horizontal = perpendicular to beam line
  dispersionCurve: {
    vertical: { base: 3, coefficient: 0.065, exponent: 0.9 },
    horizontal: { base: 5.5, coefficient: 0.090, exponent: 0.98 },
  },
  dispersionSigma: 1.65,

  barrelNativeSpacing: 60,
  barrelNativeMuzzleDy: 164,
});