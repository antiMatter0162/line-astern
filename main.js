// Controls:
//   Left-click a ship (or drag a box over ships) to select them
//   Right-click on the ocean to move selected ships there
//   Ships turn and accelerate like real vessels (no instant snapping)


window.onerror = function (message, source, lineno, colno, error) {
  document.body.innerHTML =
    '<pre style="color:red;background:#fff;padding:20px;font-size:14px;white-space:pre-wrap;">' +
    'ERROR: ' + message + '\n' +
    'Line: ' + lineno + ', Col: ' + colno + '\n' +
    (error && error.stack ? error.stack : '') +
    '</pre>';
};


const config = {
  type: Phaser.CANVAS,

  width: 1280,
  height: 800,

  backgroundColor: "#06345a",

  render: {
    roundPixels: true,
    antialias: true,
  },

  scale: {
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 800,
    autoRound: true,
  },

  scene: {
    preload,
    create,
    update,
  },
};

new Phaser.Game(config);

let ships = [];
let selectedShips = [];
let panStart = null;
let waypointMarkers = [];
let cameraPanKeys = null;
let cameraZoomKeys = null;
const waypointSize = 48;
const waypointSourceSize = 480;
const waypointReachLeeway = 0;
const turnWindowLeeway = 3;

const WAKE_FPS = 12;
const CAMERA_PAN_SPEED = 450;

// Turret A/B mounts render at different depths
const TURRET_DEPTH = { A: 2.6, B: 2.4 };

const TEAMS = {
  PLAYER: "player",
  ENEMY: "enemy",
};

const SINKING_HULL_DEPTH = 1.2;
const SINKING_TURRET_DEPTH = 1.5;
const SINKING_WATER_OVERLAY_DEPTH = 1.6;
const SINKING_EXPLOSION_DEPTH = 1.7;
const ORDER_MARKER_DEPTH = 1.8;

// ---- Firing mode ----
let firingModeActive = false;
let firingModeIndicator = null;
const FIRE_TARGET_TOGGLE_RADIUS = 24; // right-clicking within this many world units of the current target cancels it

// Shell art/speed is shared across all ship classes for now
const SHELL_SCALE = (56 / 960) * 0.5;
const shellDisplayWidth = 75 * SHELL_SCALE;
const shellDisplayHeight = 135 * SHELL_SCALE;
const SHELL_SPEED = 260;
let activeShells = [];

//sinking parameters
const SINK_DURATION = 30; 
const SINK_PIXEL = 2;     
const SINK_JITTER = 0.22;
const SINK_LIST_ANGLE = 0.5; 
const SINK_FOAM_DENSITY = 0.35;

const SPLASH_DISPLAY_SIZE = 40;
const HIT_EXPLOSION_DISPLAY_SIZE = 25;

// Naval "bell order" style speed settings
const SPEED_ORDERS = [
  { id: "ahead_1_3", label: "1 · Ahead 1/3", fraction: 1 / 5, key: "ONE" },
  { id: "ahead_2_3", label: "2 · Ahead 2/3", fraction: 1 / 2, key: "TWO" },
  { id: "ahead_standard", label: "3 · Ahead Standard", fraction: 0.75, key: "THREE" },
  { id: "ahead_full", label: "4 · Ahead Full", fraction: 0.85, key: "FOUR" },
  { id: "ahead_flank", label: "5 · Ahead Flank", fraction: 1, key: "FIVE" },
];
const DEFAULT_SPEED_ORDER_INDEX = 2; // Ahead Standard
let speedHudButtons = null;
let speedHudBackdrop = null;
let speedHudTitle = null;
let speedHudTitleText = null;

function preload() {
  this.load.image("selection-circle", "assets/Selection-Circle.png");
  this.load.image("waypoint", "assets/Waypoint.png");
  this.load.image("shell", "assets/Shell.png");
  this.load.spritesheet("explosion", "assets/Explosion.png", {
    frameWidth: 720,
    frameHeight: 720,
  });
  this.load.spritesheet("splash", "assets/Splash.png", {
    frameWidth: 480,
    frameHeight: 480,
  });
  this.load.spritesheet("hit-explosion", "assets/Hit-Explosion.png", {
    frameWidth: 480,
    frameHeight: 480,
  });

  Object.values(SHIP_TYPES).forEach((stats) => {
    this.load.image(stats.textures.hullStationary, stats.assetPaths.hullStationary);
    this.load.image(stats.textures.turretA, stats.assetPaths.turretA);
    this.load.image(stats.textures.turretB, stats.assetPaths.turretB);
    this.load.spritesheet(stats.textures.wakeMoving, stats.assetPaths.wakeMoving, {
      frameWidth: stats.hullFrameWidth,
      frameHeight: stats.hullFrameHeight,
    });
    this.load.spritesheet(stats.textures.wakeAcceleration, stats.assetPaths.wakeAcceleration, {
      frameWidth: stats.hullFrameWidth,
      frameHeight: stats.hullFrameHeight,
    });
  });
  Object.values(SHIP_TYPES).forEach((stats) => {
    this.textures.get(stats.textures.turretA).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.turretB).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.hullStationary).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get("explosion").setFilter(Phaser.Textures.FilterMode.NEAREST);
  });
}

let gamePaused = false;
let pauseOverlayElements = null;

function createPauseOverlay(scene) {
  const { width, height } = scene.scale;

  const backdrop = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.65)
    .setDepth(20).setVisible(false);
  const title = scene.add.text(width / 2, height / 2 - 60, "PAUSED", {
    fontSize: "40px", color: "#ffffff",
  }).setOrigin(0.5).setDepth(21).setVisible(false);
  const exitButton = scene.add.text(width / 2, height / 2 + 20, "Exit Game", {
    fontSize: "22px", color: "#ffffff", backgroundColor: "#7a1010", padding: { x: 16, y: 10 },
  })
    .setOrigin(0.5).setDepth(21).setVisible(false)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", () => window.electronAPI?.exitGame());

  scene.cameras.main.ignore([backdrop, title, exitButton]);
  pauseOverlayElements = { scene, backdrop, title, exitButton }; // NEW: keep the scene reference
}

function togglePause() {
  gamePaused = !gamePaused;
  const { scene, backdrop, title, exitButton } = pauseOverlayElements;
  backdrop.setVisible(gamePaused);
  title.setVisible(gamePaused);
  exitButton.setVisible(gamePaused);

  if (gamePaused) {
    scene.anims.pauseAll(); 
    scene.time.paused = true; 
  } else {
    scene.anims.resumeAll();
    scene.time.paused = false;
  }
}

let cannotAimMessage = null;

function createCannotAimHud(scene) {
  cannotAimMessage = scene.add.text(
    config.width / 2, 60, "Cannot aim there!",
    { fontSize: "20px", color: "#ffffff", backgroundColor: "#7a1010", padding: { x: 14, y: 8 } },
  ).setOrigin(0.5, 0).setDepth(10).setVisible(false);
  scene.cameras.main.ignore(cannotAimMessage);
}

function flashCannotAimMessage(scene) {
  if (!cannotAimMessage) return;
  cannotAimMessage.setVisible(true);
  scene.time.delayedCall(900, () => cannotAimMessage.setVisible(false));
}

function create() {
  worldContainer = this.add.layer();

  // Uniform deep-blue ocean background
  worldContainer.add(this.add.rectangle(6400, 4000, 12800, 8000, 0x06345a));

  const camera = this.cameras.main;
  camera.setBounds(0, 0, 12800, 8000);
  camera.centerOn(6400, 4000);

  cameraPanKeys = setupCameraPanKeys(this);
  cameraZoomKeys = setupCameraZoomKeys(this);
  // A second camera, permanently un-zoomed and un-scrolled, dedicated to HUD
  // elements.
  uiCamera = this.cameras.add(0, 0, config.width, config.height);
  uiCamera.ignore(worldContainer);

  this.input.on("wheel", (pointer, currentlyOver, deltaX, deltaY)  => {
    setCameraZoom(camera, camera.zoom - deltaY * 0.001);
  });

  // Every registered ship type gets its own set of WAKE animations
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  Object.values(SHIP_TYPES).forEach((stats) => {
    const movingFrames = range(stats.wakeMovingFrames)
      .map((frame) => ({ key: stats.textures.wakeMoving, frame }));
    const decayFrames = range(stats.wakeAccelerationFrames)
      .map((frame) => ({ key: stats.textures.wakeAcceleration, frame }));

    this.anims.create({
      key: movingWakeAnimKey(stats),
      frames: movingFrames,
      frameRate: WAKE_FPS,
      repeat: -1,
    });

    this.anims.create({
      key: slowingWakeAnimKey(stats),
      frames: decayFrames,
      frameRate: WAKE_FPS,
      repeat: 0,
    });

    this.anims.create({
      key: acceleratingWakeAnimKey(stats),
      frames: [...decayFrames].reverse(),
      frameRate: WAKE_FPS,
      repeat: 0,
    });
     this.anims.create({
      key: "explosion",
      frames: this.anims.generateFrameNumbers("explosion", { start: 0, end: 11 }),
      frameRate: 12,
      repeat: 0,
    });
    this.anims.create({
      key: "splash",
      frames: this.anims.generateFrameNumbers("splash", { start: 0, end: 8 }),
      frameRate: 12,
      repeat: 0,
    });
    this.anims.create({
      key: "hit-explosion",
      frames: this.anims.generateFrameNumbers("hit-explosion", { start: 0, end: 9 }),
      frameRate: 12,
      repeat: 0,
    });
  });

  // Precompute each ship type's real hull-row edge profile (bow-to-stern
  // width at every row) once, up front — sinking/submersion checks then
  // just look this up instead of re-scanning the hull texture live.
  Object.values(SHIP_TYPES).forEach((stats) => {
    buildHullRowProfile(this, stats);
  });

  // Create a small starting fleet
  ships = [createShip(this, 6400, 4000, "pennsylvania"),
          createShip(this, 6400, 4500, "pennsylvania"),
          createShip(this, 5600, 4000, "new-orleans"),
          createShip(this, 5200, 4000, "new-orleans", TEAMS.ENEMY)];

  // Speed order shortcuts: 1=Ahead 1/3 ... 5=Ahead Flank
  SPEED_ORDERS.forEach((order, index) => {
    this.input.keyboard.on(`keydown-${order.key}`, () => setSpeedOrder(index));
  });
  createSpeedHud(this);
  updateSpeedHud();
  createFiringHud(this);
  createCannotAimHud(this);
  createPauseOverlay(this);
  this.input.keyboard.on("keydown-ESC", togglePause);
  this.input.keyboard.on("keydown-F", toggleFiringMode);
  this.input.keyboard.on("keydown-X", stopFiring);
  this.input.keyboard.on("keydown-S", stopSelectedShips);
  //this.input.keyboard.on("keydown-PERIOD", killSelectedShips); // debug: force-sink selected ships
  this.input.keyboard.on("keydown-P", () => {
    if (!firingModeActive) return; // arc overlay only makes sense while firing mode is on
    firingArcDebugActive = !firingArcDebugActive;
    if (!firingArcDebugActive) clearFiringArcDebug();
    if (firingArcDebugActive) drawFiringArcDebug(this);
  });

  this.input.on("pointerdown", (pointer) => {
    if (pointer.middleButtonDown()) {
      panStart = { x: pointer.x, y: pointer.y };
      return;
    }
    if (isPointerOverSpeedHud(pointer)) {
      return;
    }
    if (pointer.rightButtonDown()) {
      if (firingModeActive) {
        issueFireOrder(pointer.worldX, pointer.worldY);
      } else {
        issueMoveOrder(pointer.worldX, pointer.worldY, Boolean(pointer.event && pointer.event.shiftKey));
      }
      return;
    }

    const shiftHeld = Boolean(pointer.event && pointer.event.shiftKey);

    // Find the ship under the click, if any (closest one wins if overlapping)
    let clickedShip = null;
    let clickedDist = Infinity;
    ships.forEach((ship) => {
      if (ship.sinking) return;
      if (ship.team !== TEAMS.PLAYER) return;
      const dist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, ship.sprite.x, ship.sprite.y);
      if (dist < 20 && dist < clickedDist) {
        clickedShip = ship;
        clickedDist = dist;
      }
    });

    if (shiftHeld) {
      if (clickedShip) {
        const idx = selectedShips.indexOf(clickedShip);
        if (idx === -1) {
          clickedShip.selectedRing.setVisible(true);
          selectedShips.push(clickedShip);
        } else {
          clickedShip.selectedRing.setVisible(false);
          selectedShips.splice(idx, 1);
        }
        setFiringMode(false);
      }
    } else {
      selectedShips.forEach((s) => s.selectedRing.setVisible(false));
      selectedShips = [];
      if (clickedShip) {
        clickedShip.selectedRing.setVisible(true);
        selectedShips.push(clickedShip);
      }
      setFiringMode(false);
    }

    updateSpeedHud();
    updateDispersionEllipseVisibility();
  });

  this.input.on("pointermove", (pointer) => {
    if (panStart) {
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - panStart.x) / camera.zoom;
      camera.scrollY -= (pointer.y - panStart.y) / camera.zoom;
      panStart = { x: pointer.x, y: pointer.y };
    }
  });

  const finishSelection = (pointer) => {
    if (panStart) {
      panStart = null;
    }
  };

  this.input.on("pointerup", finishSelection);
  this.input.on("pointerupoutside", finishSelection);

  // Disable the browser right-click context menu so right-click can be used for move orders
  this.input.mouse.disableContextMenu();
}

function update(time, delta) {
  if (gamePaused) return;
  const dt = delta / 1000;
  ships.forEach((ship) => updateShip(ship, dt));
  ships = ships.filter((ship) => !ship.sunk);
  updateCameraPan(this.cameras.main, cameraPanKeys, dt);
  updateCameraZoom(this.cameras.main, cameraZoomKeys, dt);
  resolveShipCollisions(dt);
  updateShells(dt);
  updateWakes(dt);
  if (firingArcDebugActive) drawFiringArcDebug(this);
}

// ---- Ship creation & behavior ----

// typeId is a key into SHIP_TYPES (see ship-types.js), e.g. "pennsylvania".
function createShip(scene, x, y, typeId, team = TEAMS.PLAYER) {
  const stats = SHIP_TYPES[typeId];
  if (!stats) {
    throw new Error(`createShip: unknown ship type "${typeId}"`);
  }

  // Hull: one static image, never re-textured while the ship is under way.
  const sprite = scene.add.sprite(x, y, stats.textures.hullStationary)
    .setDisplaySize(stats.displayWidth, stats.displayHeight)
    .setDepth(2);

  // Wake: separate sprite drawn just above the hull, hidden until the ship
  // moves. Owns every animation (moving loop, slowdown, acceleration).
  const wakeSprite = scene.add.sprite(x, y, stats.textures.wakeMoving, 0)
    .setDisplaySize(stats.displayWidth, stats.displayHeight)
    .setDepth(2.05) // above hull (2), below turrets (2.4+)
    .setVisible(false);

  const turrets = createTurrets(scene, x, y, stats);

  const selectedRing = scene.add.image(x, y, "selection-circle")
    .setDisplaySize(120, 120)
    .setDepth(3);
  selectedRing.setVisible(false);

  const minRangeCircle = drawPixelatedCircleOutline(scene, stats.minFiringDistance,  0xEBBE4D)
    .setDepth(4)
    .setVisible(false);

  const maxRangeCircle = drawPixelatedCircleOutline(scene, stats.maxFiringDistance, 0xFF0000)
    .setDepth(4)
    .setVisible(false);

  const healthBar = scene.add.graphics().setDepth(3.5).setVisible(false);

  worldContainer.add([sprite, wakeSprite, selectedRing, minRangeCircle, maxRangeCircle, healthBar]);

  return {
    sprite,
    wakeSprite,
    turrets,
    stats,
    barrelLocalOffsets: computeBarrelLocalOffsets(stats),
    selectedRing,
    minRangeCircle,
    maxRangeCircle,
    healthBar,
    target: null,
    waypoints: [],
    pathPreviewLastUpdate: -Infinity,
    moving: false,
    accelerating: false,
    slowingDown: false,
    movementFrameClock: 0,
    accelerationFrameClock: 0,
    slowdownFrameClock: 0,
    speed: 0,
    maxSpeed: stats.maxSpeed,
    acceleration: stats.acceleration,
    deceleration: stats.deceleration,
    accelTimeScale: (stats.wakeAccelerationFrames / WAKE_FPS) / (stats.maxSpeed / stats.acceleration),
    decelTimeScale: (stats.wakeAccelerationFrames / WAKE_FPS) / (stats.maxSpeed / stats.deceleration),
    braking: false,
    turnRate: stats.turnRate,
    speedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
    collisionRadius: stats.collisionRadius,
    team,
    fireTarget: null,
    dispersionEllipse: null,
    dispersionEllipseRangeAtBuild: null,
    maxHealth: stats.maxHealth,
    health: stats.maxHealth,
    collisionDamageCooldown: 0,
    sinking: false,
    sunk: false,
    sinkElapsed: 0,
    sinkProgress: 0,
    listSide: 1,
    deathRotation: 0,
    waterlineSeed: null,
    waterOverlay: null,
    waterOverlayLastUpdate: 0,
  };
}

// Builds the four turret sprites for a ship, anchored per stats.turretMounts.
// Each turret tracks its own local offset and a fixed base rotation
function createTurrets(scene, shipX, shipY, stats) {
  return stats.turretMounts.map((mount) => {
    const textureKey = mount.type === "A" ? stats.textures.turretA : stats.textures.turretB;
    const sprite = scene.add.sprite(shipX, shipY, textureKey)
      .setDisplaySize(stats.turretDisplaySize, stats.turretDisplaySize)
      .setOrigin(0.5, 0.33)   // (0,0)=top-left, (0.5,0.5)=canvas center, (1,1)=bottom-right
      .setDepth(TURRET_DEPTH[mount.type])
      .setRotation(mount.baseRotation);
    worldContainer.add(sprite);
    return {
      sprite,
      dx: mount.dx,
      dy: mount.dy,
      arc: mount.arc,
      rotationOffset: mount.baseRotation,
      reloadTimer: 0,
      onTarget: false,
    };
  });
}

function clampAngleToTurretArc(ship, turret, desiredRotation) {
  const reference = ship.sprite.rotation + turret.rotationOffset;
  const halfArc = (turret.arc === "back" ? ship.stats.backFiringArc : ship.stats.frontFiringArc) / 2;

  const localAngle = Phaser.Math.Angle.Wrap(desiredRotation - reference);
  const withinArc = Math.abs(localAngle) <= halfArc;

  let clampedLocal;
  if (withinArc) {
    clampedLocal = localAngle;
  } else {
    const currentLocal = Phaser.Math.Angle.Wrap(turret.sprite.rotation - reference);
    const distToPositiveEdge = Math.abs(Phaser.Math.Angle.Wrap(halfArc - currentLocal));
    const distToNegativeEdge = Math.abs(Phaser.Math.Angle.Wrap(-halfArc - currentLocal));
    clampedLocal = distToPositiveEdge <= distToNegativeEdge ? halfArc : -halfArc;
  }

  return { angle: Phaser.Math.Angle.Wrap(reference + clampedLocal), withinArc };
}

const HEALTH_BAR_WIDTH = 60;
const HEALTH_BAR_HEIGHT = 5;
const HEALTH_BAR_OFFSET_Y = -15; // above the selection ring

function updateHealthBar(ship) {
  const isSelected = selectedShips.includes(ship);
  ship.healthBar.setVisible(isSelected);
  if (!isSelected) return;

  const { healthBar, sprite, health, maxHealth } = ship;
  const barX = sprite.x - HEALTH_BAR_WIDTH / 2;
  const barY = sprite.y - sprite.displayHeight / 2 + HEALTH_BAR_OFFSET_Y;
  const healthFraction = Phaser.Math.Clamp(health / maxHealth, 0, 1);

  healthBar.clear();

  // Background/border
  healthBar.fillStyle(0x000000, 0.6);
  healthBar.fillRect(barX - 1, barY - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);

  // Fill — green when healthy, shifting to red as health drops
  const fillColor = Phaser.Display.Color.Interpolate.ColorWithColor(
    new Phaser.Display.Color(200, 40, 40),
    new Phaser.Display.Color(60, 200, 80),
    100,
    Math.round(healthFraction * 100),
  );
  healthBar.fillStyle(Phaser.Display.Color.GetColor(fillColor.r, fillColor.g, fillColor.b), 1);
  healthBar.fillRect(barX, barY, HEALTH_BAR_WIDTH * healthFraction, HEALTH_BAR_HEIGHT);
}

// Repositions and reorients a ship's turrets to follow the hull

function updateTurrets(ship, dt) {
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);
  const maxTraverse = ship.stats.turretTraverse * dt;

  ship.turrets.forEach((turret) => {
    const worldOffsetX = turret.dx * cos - turret.dy * sin;
    const worldOffsetY = turret.dx * sin + turret.dy * cos;
    turret.sprite.x = ship.sprite.x + worldOffsetX;
    turret.sprite.y = ship.sprite.y + worldOffsetY;

    const reference = ship.sprite.rotation + turret.rotationOffset;
    const halfArc = (turret.arc === "back" ? ship.stats.backFiringArc : ship.stats.frontFiringArc) / 2;

    const currentLocal = Phaser.Math.Clamp(
      Phaser.Math.Angle.Wrap(turret.sprite.rotation - reference),
      -halfArc,
      halfArc,
    );

    let targetLocal;
    let withinArc;

    if (ship.fireTarget) {

      const rawAngleToTarget = Phaser.Math.Angle.Between(
        turret.sprite.x, turret.sprite.y, ship.fireTarget.x, ship.fireTarget.y
      ) - Math.PI / 2;
      const localAngle = Phaser.Math.Angle.Wrap(rawAngleToTarget - reference);
      withinArc = Math.abs(localAngle) <= halfArc;

      if (withinArc) {
        targetLocal = localAngle;
      } else {
        const shipAngleToTarget = Phaser.Math.Angle.Between(
          ship.sprite.x, ship.sprite.y, ship.fireTarget.x, ship.fireTarget.y
        ) - Math.PI / 2;
        const groupLocalAngle = Phaser.Math.Angle.Wrap(shipAngleToTarget - reference);
        targetLocal = groupLocalAngle >= 0 ? halfArc : -halfArc;
      }
    } else {
      targetLocal = 0;
      withinArc = false;
    }

    const traverseDelta = targetLocal - currentLocal;
    turret.onTarget = Boolean(ship.fireTarget) && withinArc && Math.abs(traverseDelta) <= maxTraverse;

    const nextLocal = Phaser.Math.Clamp(
      currentLocal + Phaser.Math.Clamp(traverseDelta, -maxTraverse, maxTraverse),
      -halfArc,
      halfArc,
    );
    turret.sprite.rotation = reference + nextLocal;
  });
}

function createFiringHud(scene) {
  firingModeIndicator = scene.add.text(
    config.width / 2, 16, "FIRING MODE — right-click to target, F to toggle, X to stop firing",
    { fontSize: "16px", color: "#ffffff", backgroundColor: "#7a1010", padding: { x: 12, y: 6 } },
  ).setOrigin(0.5, 0).setDepth(10).setVisible(false);
  scene.cameras.main.ignore(firingModeIndicator);
}

function setFiringMode(active) {
  firingModeActive = active;
  if (firingModeIndicator) firingModeIndicator.setVisible(firingModeActive);

  if (!firingModeActive && firingArcDebugActive) {
    firingArcDebugActive = false;
    clearFiringArcDebug();
  }
}

function toggleFiringMode() {
  setFiringMode(!firingModeActive);
}
function stopFiring() {
  if (selectedShips.length === 0) return;

  selectedShips.forEach((ship) => {
    ship.fireTarget = null;
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.destroy();
      ship.dispersionEllipse = null;
    }
  });
}

function issueFireOrder(x, y) {
  if (selectedShips.length === 0) return;

  selectedShips.forEach((ship) => {
    const distanceFromShip = Phaser.Math.Distance.Between(ship.sprite.x, ship.sprite.y, x, y);
    if (distanceFromShip < ship.stats.minFiringDistance || distanceFromShip > ship.stats.maxFiringDistance) {
      flashCannotAimMessage(ship.sprite.scene);
      return; // leaves ship.fireTarget (and its dispersion ellipse) exactly as it was
    }

    if (ship.fireTarget && Phaser.Math.Distance.Between(ship.fireTarget.x, ship.fireTarget.y, x, y) <= FIRE_TARGET_TOGGLE_RADIUS) {
      ship.fireTarget = null;
      if (ship.dispersionEllipse) {
        ship.dispersionEllipse.destroy();
        ship.dispersionEllipse = null;
      }
    } else {
      ship.fireTarget = { x, y };
      refreshShipDispersionEllipse(ship);
    }
  });
}

function updateFiring(ship, dt) {
  if (!ship.fireTarget) return;
  ship.turrets.forEach((turret) => {
    turret.reloadTimer -= dt;
    if (turret.reloadTimer > 0) return;
    if (!turret.onTarget) return;
    fireTurretVolley(ship, turret);
    turret.reloadTimer = ship.stats.turretReloadSeconds;
  });
}

function fireTurretVolley(ship, turret) {
  const scene = ship.sprite.scene;
  const { x: targetX, y: targetY } = ship.fireTarget;
  const cos = Math.cos(turret.sprite.rotation);
  const sin = Math.sin(turret.sprite.rotation);
  ship.barrelLocalOffsets.forEach((barrel) => {
    const muzzleX = turret.sprite.x + barrel.dx * cos - barrel.dy * sin;
    const muzzleY = turret.sprite.y + barrel.dx * sin + barrel.dy * cos;
    const distance = Phaser.Math.Distance.Between(muzzleX, muzzleY, targetX, targetY);
    const dispersion = getDispersionOffset(
      distance,
      getShipTargetBearing(ship),
      ship.stats.dispersionCurve,
      ship.stats.dispersionSigma
    );
    spawnShell(scene, muzzleX, muzzleY, targetX + dispersion.x, targetY + dispersion.y, ship.stats.shellAlpha);
  });
}

function getShipTargetBearing(ship) {
  if (!ship.fireTarget) return ship.sprite.rotation;
  return Phaser.Math.Angle.Between(
    ship.sprite.x, ship.sprite.y, ship.fireTarget.x, ship.fireTarget.y
  );
}

// Returns the dispersion ellipse's semi-axes (world units) for a shot at
// the given range, using the given ship type's dispersion curve.
function getDispersionForRange(distance, curve) {
  const applyCurve = ({ base, coefficient, exponent }) =>
    base + coefficient * Math.pow(distance, exponent);
  return {
    vertical: applyCurve(curve.vertical),
    horizontal: applyCurve(curve.horizontal),
  };
}

// Samples one random point-of-impact offset, in WORLD space, for a shot at
// the given range fired from a ship with the given heading, using the given
// ship type's dispersion curve and sigma (central-tendency shaping).
function getDispersionOffset(distance, shipRotation, curve, sigma) {
  const { vertical, horizontal } = getDispersionForRange(distance, curve);
  const centeredRandom = (s = sigma) => {
    const base = Math.random() + Math.random() - 1;
    const sign = Math.sign(base) || 1;
    return sign * Math.pow(Math.abs(base), s);
  };

  const localX = centeredRandom() * vertical;
  const localY = centeredRandom() * horizontal;

  const cos = Math.cos(shipRotation);
  const sin = Math.sin(shipRotation);
  return {
    x: localX * cos - localY * sin,
    y: localX * sin + localY * cos,
  };
}

function drawPixelatedCircleOutline(scene, radius, color, pixel = 2) {
  const graphics = scene.add.graphics();
  const half = pixel / 2;
  const cell = (px, py) => graphics.fillRect(px - half, py - half, pixel, pixel);
  graphics.fillStyle(color, 0.9);

  for (let x = 0; x <= radius; x += pixel) {
    const y = Math.round(Math.sqrt(Math.max(0, radius * radius - x * x)) / pixel) * pixel;
    const px = Math.round(x / pixel) * pixel;
    [1, -1].forEach((sx) => [1, -1].forEach((sy) => cell(sx * px, sy * y)));
  }
  for (let y = 0; y <= radius; y += pixel) {
    const x = Math.round(Math.sqrt(Math.max(0, radius * radius - y * y)) / pixel) * pixel;
    const py = Math.round(y / pixel) * pixel;
    [1, -1].forEach((sx) => [1, -1].forEach((sy) => cell(sx * x, sy * py)));
  }

  return graphics;
}

// Draws a dispersion ellipse (fill + outline + axis ticks) in LOCAL
// coordinates centered on (0,0) — it is NOT positioned or rotated here.
function drawDispersionEllipseGraphics(scene, semiMajor, semiMinor) {
  const graphics = scene.add.graphics();
  const pixel = 2;
  const half = pixel / 2;
  graphics.setDepth(4);

  const cell = (px, py) => graphics.fillRect(px - half, py - half, pixel, pixel);

  // Semi-transparent fill
  graphics.fillStyle(0xff0000, 0.18);
  for (let py = -semiMinor; py <= semiMinor; py += pixel) {
    const normalizedY = py / semiMinor;
    const halfWidth = semiMajor * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    const halfWidthPixels = Math.round(halfWidth / pixel) * pixel;
    graphics.fillRect(-halfWidthPixels, py - half, halfWidthPixels * 2, pixel);
  }

  graphics.fillStyle(0xff0000, 0.9);
    for (let x = 0; x <= semiMajor; x += pixel) {
      const yRaw = semiMinor * Math.sqrt(Math.max(0, 1 - (x / semiMajor) * (x / semiMajor)));
      const y = Math.round(yRaw / pixel) * pixel;
      const px = Math.round(x / pixel) * pixel;
      [1, -1].forEach((sx) => [1, -1].forEach((sy) => cell(sx * px, sy * y)));
    }
    for (let y = 0; y <= semiMinor; y += pixel) {
      const xRaw = semiMajor * Math.sqrt(Math.max(0, 1 - (y / semiMinor) * (y / semiMinor)));
      const x = Math.round(xRaw / pixel) * pixel;
      const py = Math.round(y / pixel) * pixel;
      [1, -1].forEach((sx) => [1, -1].forEach((sy) => cell(sx * x, sy * py)));
    }

  // Axis ticks
  const tickLength = Math.round(Math.min(semiMajor, semiMinor) * 0.5);
  graphics.fillRect(-semiMajor, -half, tickLength, pixel);
  graphics.fillRect(semiMajor - tickLength, -half, tickLength, pixel);
  graphics.fillRect(-half, -semiMinor, pixel, tickLength);
  graphics.fillRect(-half, semiMinor - tickLength, pixel, tickLength);

  return graphics;
}

// (Re)builds a ship's dispersion ellipse sized for its current range to
// target, and immediately positions/orients it.
function refreshShipDispersionEllipse(ship) {
  if (!ship.fireTarget) return;

  const scene = ship.sprite.scene;
  const distance = Phaser.Math.Distance.Between(
    ship.sprite.x, ship.sprite.y, ship.fireTarget.x, ship.fireTarget.y
  );
  const { vertical, horizontal } = getDispersionForRange(distance, ship.stats.dispersionCurve);

  if (ship.dispersionEllipse) {
    ship.dispersionEllipse.destroy();
  }

  ship.dispersionEllipse = drawDispersionEllipseGraphics(scene, vertical, horizontal);
  ship.dispersionEllipse.setPosition(ship.fireTarget.x, ship.fireTarget.y);
  ship.dispersionEllipse.setRotation(getShipTargetBearing(ship));
  ship.dispersionEllipse.setVisible(selectedShips.includes(ship));
  worldContainer.add(ship.dispersionEllipse);
  ship.dispersionEllipseRangeAtBuild = distance;
}

// Called every frame for every ship. Keeps the ellipse's rotation locked to
// the bearing toward the target at all times
// several hundred fillRect calls every single frame.
function updateDispersionEllipseTransform(ship) {
  if (!ship.dispersionEllipse) return;

  if (!ship.fireTarget) {
    ship.dispersionEllipse.destroy();
    ship.dispersionEllipse = null;
    return;
  }

  ship.dispersionEllipse.setRotation(getShipTargetBearing(ship));

  const distance = Phaser.Math.Distance.Between(
    ship.sprite.x, ship.sprite.y, ship.fireTarget.x, ship.fireTarget.y
  );
  if (Math.abs(distance - ship.dispersionEllipseRangeAtBuild) > 5) {
    refreshShipDispersionEllipse(ship);
  }
}

// Syncs every ship's dispersion ellipse visibility to the current
// selection.
function updateDispersionEllipseVisibility() {
  ships.forEach((ship) => {
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.setVisible(selectedShips.includes(ship));
    }
  });
}

function spawnShell(scene, x, y, targetX, targetY, damage) {
  const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
  const sprite = scene.add.sprite(x, y, "shell")
    .setDisplaySize(shellDisplayWidth, shellDisplayHeight)
    .setRotation(angle + Math.PI / 2)
    .setDepth(2.8);
  worldContainer.add(sprite);
  activeShells.push({
    sprite,
    vx: Math.cos(angle) * SHELL_SPEED,
    vy: Math.sin(angle) * SHELL_SPEED,
    targetX,
    targetY,
    damage,
  });
}

function updateShells(dt) {
  for (let i = activeShells.length - 1; i >= 0; i -= 1) {
    const shell = activeShells[i];
    const remaining = Phaser.Math.Distance.Between(shell.sprite.x, shell.sprite.y, shell.targetX, shell.targetY);
    const step = SHELL_SPEED * dt;
    if (step >= remaining) {
      resolveShellSplash(shell);
      shell.sprite.destroy();
      activeShells.splice(i, 1);
      continue;
    }
    shell.sprite.x += shell.vx * dt;
    shell.sprite.y += shell.vy * dt;
  }
}

function toShipLocal(ship, worldX, worldY) {
  const dx = worldX - ship.sprite.x;
  const dy = worldY - ship.sprite.y;
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

function shipLocalToWorld(ship, localX, localY) {
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);
  return {
    x: ship.sprite.x + localX * cos - localY * sin,
    y: ship.sprite.y + localX * sin + localY * cos,
  };
}

const HULL_EDGE_SCAN_STEP = 1;

function isHullTextureHitAtLocal(scene, stats, localX, localY) {
  const texWidth = stats.hullFrameWidth;
  const texHeight = stats.hullFrameHeight;
  const texScaleX = texWidth / stats.displayWidth;
  const texScaleY = texHeight / stats.displayHeight;
  const texX = Math.round(localX * texScaleX + texWidth / 2);
  const texY = Math.round(localY * texScaleY + texHeight / 2);
  if (texX < 0 || texY < 0 || texX >= texWidth || texY >= texHeight) return false;
  const alpha = scene.textures.getPixelAlpha(texX, texY, stats.textures.hullStationary);
  return alpha !== null && alpha > 0;
}

// Finds the hull's real left/right extent (ship-local x) at a given
// ship-local y, for a given ship type's texture.
function findHullTextureRowEdges(scene, stats, localY) {
  const halfWidth = stats.displayWidth / 2;
  let left = null;
  let right = null;
  for (let localX = -halfWidth; localX <= halfWidth; localX += HULL_EDGE_SCAN_STEP) {
    if (isHullTextureHitAtLocal(scene, stats, localX, localY)) {
      if (left === null) left = localX;
      right = localX;
    }
  }
  return left === null ? null : { left, right };
}

const hullRowProfileCache = {};

function buildHullRowProfile(scene, stats) {
  const texKey = stats.textures.hullStationary;
  if (hullRowProfileCache[texKey]) return hullRowProfileCache[texKey];

  const halfHeight = stats.displayHeight / 2;
  const profile = [];
  for (let localY = -halfHeight; localY <= halfHeight; localY += SINK_PIXEL) {
    const edges = findHullTextureRowEdges(scene, stats, localY);
    if (edges) profile.push({ localY, left: edges.left, right: edges.right });
  }

  hullRowProfileCache[texKey] = profile;
  return profile;
}

// Looks up the cached row nearest a given ship-local y. A live sinking
// ship's exact local.y won't always land precisely on a SINK_PIXEL-spaced
// sample, so this finds the closest one.
function getHullRowEdgesNear(ship, localY) {
  const profile = hullRowProfileCache[ship.stats.textures.hullStationary];
  if (!profile || profile.length === 0) return null;

  let nearest = profile[0];
  let nearestDist = Math.abs(nearest.localY - localY);
  for (let i = 1; i < profile.length; i += 1) {
    const dist = Math.abs(profile[i].localY - localY);
    if (dist < nearestDist) { nearest = profile[i]; nearestDist = dist; }
  }
  return nearest;
}

const STERN_SCAN_STEP = 4;

function findHullSternPoint(ship) {
  const { stats } = ship;
  const halfHeight = stats.displayHeight / 2;
  const halfWidth = stats.displayWidth / 2;

  let sternLocalY = null;
  for (let localY = halfHeight; localY >= -halfHeight; localY -= STERN_SCAN_STEP) {
    let rowHit = false;
    for (let localX = -halfWidth; localX <= halfWidth; localX += STERN_SCAN_STEP) {
      const world = shipLocalToWorld(ship, localX, localY);
      if (isHullHitAt(ship, world.x, world.y)) { rowHit = true; break; }
    }
    if (rowHit) { sternLocalY = localY; break; }
  }
  if (sternLocalY === null) return null; // shouldn't happen for a real hull

  let left = null;
  let right = null;
  for (let localX = -halfWidth; localX <= halfWidth; localX += STERN_SCAN_STEP) {
    const world = shipLocalToWorld(ship, localX, sternLocalY);
    if (isHullHitAt(ship, world.x, world.y)) {
      if (left === null) left = localX;
      right = localX;
    }
  }

  return { localY: sternLocalY, left: left ?? 0, right: right ?? 0 };
}

function isPointSubmerged(ship, worldX, worldY) {
  const local = toShipLocal(ship, worldX, worldY);
  const row = getHullRowEdgesNear(ship, local.y);
  if (!row) return false; // point isn't over the hull at all

  const rowWidth = row.right - row.left;
  const halfHeight = ship.stats.displayHeight / 2;
  const normalizedY = row.localY / halfHeight;
  const waveAmplitude = rowWidth * SINK_JITTER * (1 - ship.sinkProgress * 0.6);
  const offset = waterlineOffset(ship.waterlineSeed, normalizedY, ship.sinkElapsed) * waveAmplitude;
  const depth = Phaser.Math.Clamp(rowWidth * ship.sinkProgress + offset, 0, rowWidth);

  const edgeX = ship.listSide === 1 ? row.right - depth : row.left + depth;
  return ship.listSide === 1 ? local.x >= edgeX : local.x <= edgeX;
}

function isHullHitAt(ship, worldX, worldY) {
  const dx = worldX - ship.sprite.x;
  const dy = worldY - ship.sprite.y;
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);

  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;

  const texScaleX = ship.sprite.width / ship.stats.displayWidth;
  const texScaleY = ship.sprite.height / ship.stats.displayHeight;
  const texX = Math.round(localX * texScaleX + ship.sprite.width / 2);
  const texY = Math.round(localY * texScaleY + ship.sprite.height / 2);

  if (texX < 0 || texY < 0 || texX >= ship.sprite.width || texY >= ship.sprite.height) return false;

  const alpha = ship.sprite.scene.textures.getPixelAlpha(texX, texY, ship.stats.textures.hullStationary);
  return alpha !== null && alpha > 0;
}

function resolveShellSplash(shell) {
  const scene = shell.sprite.scene;
  let resolved = false;

  ships.forEach((ship) => {
    if (resolved) return;

    const dx = shell.targetX - ship.sprite.x;
    const dy = shell.targetY - ship.sprite.y;
    const maxReach = Math.max(ship.stats.displayWidth, ship.stats.displayHeight) * 0.6;
    if (dx * dx + dy * dy > maxReach * maxReach) return;

    if (!isHullHitAt(ship, shell.targetX, shell.targetY)) return;

    if (ship.sinking) {
      // Already dying — no further damage, just pick the effect that
      // matches whichever part of the hull got hit.
      if (isPointSubmerged(ship, shell.targetX, shell.targetY)) {
        spawnSplash(scene, shell.targetX, shell.targetY);
      } else {
        spawnHitExplosion(scene, shell.targetX, shell.targetY);
      }
    } else {
      ship.health = Math.max(0, ship.health - shell.damage);
      spawnHitExplosion(scene, shell.targetX, shell.targetY);
    }
    resolved = true;
  });

  if (!resolved) {
    spawnSplash(scene, shell.targetX, shell.targetY);
  }
}

function spawnSplash(scene, x, y) {
  const sprite = scene.add.sprite(x, y, "splash")
    .setDisplaySize(SPLASH_DISPLAY_SIZE, SPLASH_DISPLAY_SIZE)
    .setDepth(1.9); // above ocean/markers, still well under any hull
  worldContainer.add(sprite);
  sprite.play("splash");
  sprite.once("animationcomplete", () => sprite.destroy());
}

function spawnHitExplosion(scene, x, y) {
  const sprite = scene.add.sprite(x, y, "hit-explosion")
    .setDisplaySize(HIT_EXPLOSION_DISPLAY_SIZE, HIT_EXPLOSION_DISPLAY_SIZE)
    .setDepth(2.9); // above hulls (2) and shells (2.8), below turrets (2.4+ already covers this ship's own turrets since it's higher — see note below)
  worldContainer.add(sprite);
  sprite.play("hit-explosion");
  sprite.once("animationcomplete", () => sprite.destroy());
}

// ---- Wake trail ----
// (Procedural foam trail left behind the stern. Separate from the animated
// wake sprite that rides on each ship — see ship.wakeSprite.)
let activeWakes = [];
const WAKE_LIFETIME = 2.2; // seconds until a wake segment fully fades
const WAKE_MIN_SPACING = 14; // world units between spawns along the path
const WAKE_SPEED_THRESHOLD = 5; // don't spawn wake below this speed

function drawFoamClump(graphics, centerX, centerY, cellCount, pixel, alpha) {
  graphics.fillStyle(0xdff3ff, alpha);

  let px = centerX;
  let py = centerY;

  for (let i = 0; i < cellCount; i += 1) {
    graphics.fillRect(
      Math.round(px / pixel) * pixel - pixel / 2,
      Math.round(py / pixel) * pixel - pixel / 2,
      pixel,
      pixel,
    );

    // Randomly step to a neighboring cell (4-directional random walk) so
    // each clump grows into an irregular blob shape rather than a filled
    // rectangle
    if (Math.random() < 0.25) {
      px = centerX;
      py = centerY;
    } else {
      const dir = Phaser.Math.Between(0, 3);
      if (dir === 0) px += pixel;
      else if (dir === 1) px -= pixel;
      else if (dir === 2) py += pixel;
      else py -= pixel;
    }
  }
}

function drawWakeGraphics(scene, size, widthScale = 1) {
  const graphics = scene.add.graphics();
  const pixel = 2;

  const rx = size * 0.55;
  const ry = size * 1.1;

  const clumpCount = Math.round(Phaser.Math.Between(6, 11) * widthScale);

  for (let i = 0; i < clumpCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radiusFactor = Math.sqrt(Math.random());
    const clumpX = Math.cos(angle) * rx * radiusFactor;
    const clumpY = Math.sin(angle) * ry * radiusFactor;

    const cellCount = Phaser.Math.Between(4, 9);
    const alpha = Phaser.Math.FloatBetween(0.35, 0.7);

    drawFoamClump(graphics, clumpX, clumpY, cellCount, pixel, alpha);
  }

  return graphics;
}

const WAKE_REFERENCE_WIDTH = 38;
function spawnWake(ship) {
  const scene = ship.sprite.scene;
  const stats = ship.stats;

  const widthScale = stats.displayWidth / WAKE_REFERENCE_WIDTH;

  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);

  const sternPoint = findHullSternPoint(ship);
  const sternDy = sternPoint ? sternPoint.localY : stats.displayHeight * 0.42;
  const sternHalfWidth = sternPoint
    ? (sternPoint.right - sternPoint.left) / 2
    : 4 * widthScale;
  const sternDx = Phaser.Math.FloatBetween(-1, 1) * sternHalfWidth;

  const worldOffsetX = sternDx * cos - sternDy * sin;
  const worldOffsetY = sternDx * sin + sternDy * cos;
  const x = ship.sprite.x + worldOffsetX;
  const y = ship.sprite.y + worldOffsetY;

  const speedFraction = Phaser.Math.Clamp(ship.speed / ship.maxSpeed, 0, 1);
  const size = Phaser.Math.Linear(6, 16, speedFraction) * widthScale;

  const graphics = drawWakeGraphics(scene, size, widthScale);
  graphics.setPosition(x, y);
  graphics.setRotation(ship.sprite.rotation + Phaser.Math.FloatBetween(-0.15, 0.15));
  graphics.setDepth(1.2);
  worldContainer.add(graphics);

  activeWakes.push({
    graphics,
    age: 0,
    maxAlpha: Phaser.Math.Linear(0.25, 0.6, speedFraction),
  });
}

function updateShipWake(ship, dt) {
  if (!ship.moving || ship.speed < WAKE_SPEED_THRESHOLD) {
    ship.wakeDistanceAccum = 0;
    return;
  }

  const widthScale = ship.stats.displayWidth / WAKE_REFERENCE_WIDTH;
  const spacing = WAKE_MIN_SPACING / widthScale;

  ship.wakeDistanceAccum = (ship.wakeDistanceAccum || 0) + ship.speed * dt;

  if (ship.wakeDistanceAccum >= spacing) {
    ship.wakeDistanceAccum = 0;
    spawnWake(ship);
  }
}

function updateWakes(dt) {
  for (let i = activeWakes.length - 1; i >= 0; i -= 1) {
    const wake = activeWakes[i];
    wake.age += dt;
    const t = wake.age / WAKE_LIFETIME;

    if (t >= 1) {
      wake.graphics.destroy();
      activeWakes.splice(i, 1);
      continue;
    }

    // Fade out, and drift/expand slightly so it doesn't look static
    wake.graphics.setAlpha(wake.maxAlpha * (1 - t));
    wake.graphics.setScale(1 + t * 0.6);
  }
}

function computeAvoidanceSteering(ship) {
  let pushX = 0;
  let pushY = 0;

  // React earlier the faster you're going — gives the turn rate time to work
  const reactionTime = 2.5; // seconds of buffer
  const lookahead = ship.collisionRadius * 3 + ship.speed * reactionTime;

  ships.forEach((other) => {
    if (other === ship) return;
    if (other.team !== ship.team) return;

    const dx = ship.sprite.x - other.sprite.x;
    const dy = ship.sprite.y - other.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const safeDist = ship.collisionRadius + other.collisionRadius + lookahead;

    if (dist <= 0 || dist >= safeDist) return;

    const strength = (safeDist - dist) / safeDist; // 0 (far) → 1 (touching)

    // Direct push straight away from the other ship
    const awayX = dx / dist;
    const awayY = dy / dist;

    // Perpendicular ("always break right") component — this is what breaks
    // the head-on tie so both ships reliably pick the same side to dodge to,
    // instead of both wobbling between left/right unpredictably
    const rightX = -dy / dist;
    const rightY = dx / dist;

    pushX += awayX * strength * 0.6 + rightX * strength * 0.8;
    pushY += awayY * strength * 0.6 + rightY * strength * 0.8;
  });

  return { x: pushX, y: pushY };
}

// ---- Ship-to-ship collision ----
const COLLISION_RESTITUTION = 0.25; 
const COLLISION_SPEED_RETENTION = 0.15; 
const COLLISION_MIN_IMPACT_SPEED = 5; 
const COLLISION_DAMAGE_SCALE = 450; 
const COLLISION_DAMAGE_COOLDOWN = 0.75;

// Reconstructs a ship's velocity vector from its speed + heading, since
// ships don't store vx/vy directly — same heading convention used
// everywhere else (rotation - PI/2 is "forward").
function getShipVelocity(ship) {
  const heading = ship.sprite.rotation - Math.PI / 2;
  return {
    vx: Math.cos(heading) * ship.speed,
    vy: Math.sin(heading) * ship.speed,
  };
}

function resolveShipCollisions(dt) {
  ships.forEach((ship) => {
    if (ship.collisionDamageCooldown > 0) {
      ship.collisionDamageCooldown = Math.max(0, ship.collisionDamageCooldown - dt);
    }
  });

  for (let i = 0; i < ships.length; i += 1) {
    for (let j = i + 1; j < ships.length; j += 1) {
      const shipA = ships[i];
      const shipB = ships[j];

      const dx = shipB.sprite.x - shipA.sprite.x;
      const dy = shipB.sprite.y - shipA.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      const minDist = shipA.collisionRadius + shipB.collisionRadius;

      if (dist >= minDist) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      // --- Positional correction: shove both hulls apart along the contact
      // normal until they no longer overlap, split by relative radius so a
      // bigger ship gets displaced less than a smaller one (stand-in for
      // mass until there's an actual mass stat).
      const overlap = minDist - dist;
      const totalRadius = shipA.collisionRadius + shipB.collisionRadius;
      const pushA = overlap * (shipB.collisionRadius / totalRadius);
      const pushB = overlap * (shipA.collisionRadius / totalRadius);

      shipA.sprite.x -= nx * pushA;
      shipA.sprite.y -= ny * pushA;
      shipB.sprite.x += nx * pushB;
      shipB.sprite.y += ny * pushB;

      // --- Impact speed: how fast the two ships were closing along the
      // contact normal, independent of their heading — this drives both the
      // bounce and the damage below.
      const velA = getShipVelocity(shipA);
      const velB = getShipVelocity(shipB);
      const relVx = velB.vx - velA.vx;
      const relVy = velB.vy - velA.vy;
      const closingSpeed = -(relVx * nx + relVy * ny);

      if (closingSpeed <= COLLISION_MIN_IMPACT_SPEED) continue;

      // --- Bounce: ships lose almost all their speed (this is a slam, not
      // a rebound) and get a small extra shove apart proportional to how
      // hard they hit — COLLISION_RESTITUTION keeps this subtle.
      shipA.speed *= COLLISION_SPEED_RETENTION;
      shipB.speed *= COLLISION_SPEED_RETENTION;

      const bounceNudge = closingSpeed * COLLISION_RESTITUTION * dt;
      shipA.sprite.x -= nx * bounceNudge;
      shipA.sprite.y -= ny * bounceNudge;
      shipB.sprite.x += nx * bounceNudge;
      shipB.sprite.y += ny * bounceNudge;

      // --- Damage: scaled by impact speed, gated by a per-ship cooldown so
      // two hulls stuck overlapping don't get re-damaged every single frame.
      if (shipA.collisionDamageCooldown <= 0 && shipB.collisionDamageCooldown <= 0) {
        const damage = closingSpeed * COLLISION_DAMAGE_SCALE;
        shipA.health = Math.max(0, shipA.health - damage);
        shipB.health = Math.max(0, shipB.health - damage);
        shipA.collisionDamageCooldown = COLLISION_DAMAGE_COOLDOWN;
        shipB.collisionDamageCooldown = COLLISION_DAMAGE_COOLDOWN;
      }
    }
  }
}

function beginSinking(ship) {
  if (ship.sinking) return;
  const scene = ship.sprite.scene;

  ship.sprite.setDepth(SINKING_HULL_DEPTH);
  ship.turrets.forEach((turret) => turret.sprite.setDepth(SINKING_TURRET_DEPTH));

  const explosionSize = Math.max(ship.stats.displayWidth, ship.stats.displayHeight) * 0.6;
  const explosionSprite = scene.add.sprite(ship.sprite.x, ship.sprite.y, "explosion")
    .setDisplaySize(explosionSize, explosionSize)
    .setDepth(SINKING_EXPLOSION_DEPTH); // above hull/turrets/health bar, below HUD text
  worldContainer.add(explosionSprite);
  explosionSprite.play("explosion");
  explosionSprite.once("animationcomplete", () => explosionSprite.destroy());

  ship.sinking = true;
  ship.sinkElapsed = 0;
  ship.sinkProgress = 0;
  ship.listSide = Math.random() < 0.5 ? 1 : -1; // which beam floods first

  if (ship.target) removeWaypointMarker(ship.target);
  ship.waypoints.forEach(removeWaypointMarker);
  ship.waypoints = [];
  ship.target = null;
  ship.braking = false;
  ship.fireTarget = null;

  if (ship.dispersionEllipse) {
    ship.dispersionEllipse.destroy();
    ship.dispersionEllipse = null;
  }
  if (ship.pathLine) {
    ship.pathLine.destroy();
    ship.pathLine = null;
  }

  // A dead ship can't stay selected — its HUD elements (range circles,
  // health bar, selection ring) shouldn't keep drawing over the death
  // animation, and it shouldn't keep taking orders.
  const selIndex = selectedShips.indexOf(ship);
  if (selIndex >= 0) selectedShips.splice(selIndex, 1);
  ship.selectedRing.setVisible(false);
  ship.minRangeCircle.setVisible(false);
  ship.maxRangeCircle.setVisible(false);
  ship.healthBar.setVisible(false);
  ship.wakeSprite.setVisible(false);
  updateSpeedHud();

  ship.listSide = Math.random() < 0.5 ? 1 : -1; // which beam floods first
  ship.deathRotation = ship.sprite.rotation;

  ship.waterlineSeed = {
    a: Phaser.Math.FloatBetween(0, Math.PI * 2),
    b: Phaser.Math.FloatBetween(0, Math.PI * 2),
    c: Phaser.Math.FloatBetween(0, Math.PI * 2),
  };


  ship.waterOverlay = scene.add.graphics().setDepth(SINKING_WATER_OVERLAY_DEPTH);
  worldContainer.add(ship.waterOverlay);
}

function waterlineOffset(seed, normalizedY, time) {
  const swell = Math.sin(normalizedY * 5 + seed.a + time * 0.5) * 0.5;
  const chop = Math.sin(normalizedY * 12 + seed.b - time * 1.1) * 0.3;
  const ripple = Math.sin(normalizedY * 23 + seed.c + time * 1.8) * 0.2;
  return swell + chop + ripple; // roughly in [-1, 1]
}

function redrawWaterOverlay(ship) {
  const { stats, waterOverlay, listSide, waterlineSeed, sinkProgress } = ship;
  const time = ship.sinkElapsed;
  const pixel = SINK_PIXEL;
  const half = pixel / 2;
  const cell = (px, py) => waterOverlay.fillRect(px - half, py - half, pixel, pixel);

  waterOverlay.clear();
  waterOverlay.setPosition(Math.round(ship.sprite.x), Math.round(ship.sprite.y));
  waterOverlay.setRotation(ship.sprite.rotation);

  const bodyAlpha = Phaser.Math.Linear(0.65, 1, sinkProgress);
  const foamFade = Phaser.Math.Clamp(1 - sinkProgress / 0.85, 0, 1) * Phaser.Math.Clamp(sinkProgress / 0.25, 0, 1);
  waterOverlay.setAlpha(bodyAlpha);

  const profile = hullRowProfileCache[stats.textures.hullStationary];
  if (!profile || profile.length === 0) return;

  const halfHeight = stats.displayHeight / 2;
  const maxStepPerRow = pixel * 3;
  let prevDepth = null;
  const rows = [];

  profile.forEach(({ localY, left, right }) => {
    const rowWidth = right - left;
    const normalizedY = localY / halfHeight;
    const waveAmplitude = rowWidth * SINK_JITTER * (1 - sinkProgress * 0.6);
    const offset = waterlineOffset(waterlineSeed, normalizedY, time) * waveAmplitude;
    let depth = Math.round(Phaser.Math.Clamp(rowWidth * sinkProgress + offset, 0, rowWidth) / pixel) * pixel;

    if (prevDepth !== null) {
      depth = Phaser.Math.Clamp(depth, prevDepth - maxStepPerRow, prevDepth + maxStepPerRow);
    }
    prevDepth = depth;

    const outerX = listSide === 1 ? right : left;
    const edgeX = listSide === 1 ? right - depth : left + depth;
    rows.push({ localY, edgeX, outerX, rowWidth });
  });


  waterOverlay.fillStyle(0x06345a, 1);
  waterOverlay.beginPath();

  // Down the flood-edge side, top to bottom, in steps matching each row's
  // exact rect footprint.
  waterOverlay.moveTo(rows[0].edgeX, rows[0].localY - half);
  rows.forEach((r, i) => {
    waterOverlay.lineTo(r.edgeX, r.localY + half);
    const next = rows[i + 1];
    if (next) waterOverlay.lineTo(next.edgeX, r.localY + half);
  });

  // Across the bottom, then back up the fixed hull-edge side, bottom to top.
  const last = rows[rows.length - 1];
  waterOverlay.lineTo(last.outerX, last.localY + half);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    waterOverlay.lineTo(r.outerX, r.localY - half);
    const prev = rows[i - 1];
    if (prev) waterOverlay.lineTo(prev.outerX, r.localY - half);
  }

  waterOverlay.closePath();
  waterOverlay.fillPath();

  // Foam crest along the real waterline
  rows.forEach(({ localY, edgeX, rowWidth }, i) => {
    const edgeBlend = Math.min(1, i / 20, (rows.length - 1 - i) / 20);
    const crestDepth = Math.min(6, rowWidth);
    for (let s = 0; s < crestDepth; s += pixel) {
      if (Math.random() > SINK_FOAM_DENSITY * foamFade * edgeBlend) continue;
      const crestX = listSide === 1 ? edgeX + s : edgeX - s;
      waterOverlay.fillStyle(0xdff3ff, Phaser.Math.FloatBetween(0.5, 0.85) * foamFade * edgeBlend);
      cell(crestX, localY);
    }
  });
}

// Advances the death sequence
function updateSinking(ship, dt) {
  ship.sinkElapsed += dt;
  ship.sinkProgress = Phaser.Math.Clamp(ship.sinkElapsed / SINK_DURATION, 0, 1);

  const now = ship.sprite.scene.time.now;
  if (now - ship.waterOverlayLastUpdate >= 50) {
    ship.waterOverlayLastUpdate = now;
    redrawWaterOverlay(ship);
  }

  if (ship.sinkProgress >= 1) finishSinking(ship);
}

function finishSinking(ship) {
  ship.sprite.destroy();
  ship.wakeSprite.destroy();
  ship.turrets.forEach((turret) => turret.sprite.destroy());
  ship.selectedRing.destroy();
  ship.minRangeCircle.destroy();
  ship.maxRangeCircle.destroy();
  ship.healthBar.destroy();
  ship.waterOverlay.destroy();
  if (ship.pathLine) ship.pathLine.destroy();
  if (ship.dispersionEllipse) ship.dispersionEllipse.destroy();

  ship.sunk = true;
}

function isPointerOverSpeedHud(pointer) {
  if (!speedHudButtons) return false;
  return speedHudButtons.some(
    (button) => button.visible && button.getBounds().contains(pointer.x, pointer.y),
  );
}

// The speed a ship should currently be cruising at, based on its speed order.
function getCommandedSpeed(ship) {
  return ship.maxSpeed * SPEED_ORDERS[ship.speedOrderIndex].fraction;
}

function setSpeedOrder(orderIndex) {
  if (selectedShips.length === 0) return;
  selectedShips.forEach((ship) => {
    ship.speedOrderIndex = orderIndex;
  });
  updateSpeedHud();
}

function createSpeedHud(scene) {
  const startX = 45;
  const startY = config.height - 300;
  const spacing = 40;

  // Solid backdrop panel behind the buttons, purely so the HUD is unmistakable
  // when it's visible — makes it easy to tell "not rendering" apart from
  // "rendering but hard to see".
  const padding = 20;
   speedHudTitle = scene.add.rectangle(
    startX-15,
    startY-2.5*padding,
    startX*5,
    padding*1.5,
    0x0A625B,
    0.85,
  ).setOrigin(0, 0).setDepth(9).setVisible(false);

    speedHudTitleText = scene.add.text(startX, startY-2.2*padding, "Speed Orders", {
      fontSize: "18px",
      color: "#ffffff",
    }).setOrigin(0, 0).setDepth(10).setVisible(false);

  speedHudBackdrop = scene.add.rectangle(
    startX-15,
    startY-padding,
    startX*5,
    SPEED_ORDERS.length * spacing + 1.5 * padding,
    0x000000,
    0.55,
  ).setOrigin(0, 0).setDepth(9).setVisible(false);

  speedHudButtons = SPEED_ORDERS.map((order, index) =>
    scene.add.text(startX, startY + index * spacing, order.label, {
      fontSize: "15px",
      color: "#ffffff",
      backgroundColor: "#0a3d62",
      padding: { x: 8, y: 6 },
    })
      .setDepth(10)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => setSpeedOrder(index)),
  );
  scene.cameras.main.ignore(speedHudTitle);
  scene.cameras.main.ignore(speedHudTitleText);
  scene.cameras.main.ignore(speedHudBackdrop);
  scene.cameras.main.ignore(speedHudButtons);
}

function updateSpeedHud() {
  if (!speedHudButtons) return;

  const hasSelection = selectedShips.length > 0;

  let activeIndex = null;
  if (hasSelection) {
    const first = selectedShips[0].speedOrderIndex;
    activeIndex = selectedShips.every((ship) => ship.speedOrderIndex === first) ? first : null;
  }

  if (speedHudBackdrop) speedHudBackdrop.setVisible(hasSelection);
  if (speedHudTitle) speedHudTitle.setVisible(hasSelection);
  if(speedHudTitleText) speedHudTitleText.setVisible(hasSelection);


  speedHudButtons.forEach((button, index) => {
    button.setVisible(hasSelection);
    if (hasSelection) {
      button.setInteractive({ useHandCursor: true });
    } else {
      button.disableInteractive();
    }
    button.setStyle({ backgroundColor: index === activeIndex ? "#1abc9c" : "#0a3d62" });
  });
}

function issueMoveOrder(x, y, append) {
  if (selectedShips.length === 0) return;


  const scene = selectedShips[0].sprite.scene;

  if (!append) {
    // Only clear the waypoints/markers belonging to the ships that are actually
    // getting a new order — clearing the shared marker list unconditionally
    // would erase other, untouched ships' still-active waypoint markers too.
    selectedShips.forEach((ship) => {
      if (ship.target) removeWaypointMarker(ship.target);
      ship.waypoints.forEach(removeWaypointMarker);
      ship.waypoints = [];
      ship.target = null;
      ship.braking = false;

      if (ship.slowingDown && ship.speed > 0) {
        ship.slowingDown = false;
        ship.accelerating = false;
        ship.wakeSprite.stop();
        restoreShipVisual(ship);
      }
    });
  }

  const waypoint = { x, y };
  waypoint.marker = scene.add.image(x, y, "waypoint")
    .setDisplaySize(waypointSize, waypointSize)
    .setDepth(ORDER_MARKER_DEPTH);

  worldContainer.add(waypoint.marker);
  waypointMarkers.push(waypoint.marker);
  updateWaypointMarkerScales(scene.cameras.main);

  selectedShips.forEach((ship) => {
    ship.waypoints.push(waypoint);
    if (!ship.target) advanceToNextWaypoint(ship);
    if (!ship.pathLine) {
      ship.pathLine = scene.add.graphics().setDepth(ORDER_MARKER_DEPTH);
      worldContainer.add(ship.pathLine);
    }
    updatePathLine(ship);
  });
}

function advanceToNextWaypoint(ship) {
  ship.target = ship.waypoints.shift() || null;
}

function getTurnRadius(ship) {
  return ship.speed > 0 ? ship.speed / ship.turnRate : 0;
}

function calculateMinimumTurnWindow(ship) {
  const nextWaypoint = ship.waypoints[0];
  if (!nextWaypoint || !ship.target) return 0;

  const incomingAngle = Phaser.Math.Angle.Between(
    ship.sprite.x,
    ship.sprite.y,
    ship.target.x,
    ship.target.y,
  );
  const outgoingAngle = Phaser.Math.Angle.Between(
    ship.target.x,
    ship.target.y,
    nextWaypoint.x,
    nextWaypoint.y,
  );
  const cornerAngle = Math.abs(Phaser.Math.Angle.Wrap(outgoingAngle - incomingAngle));
  const turnRadius = getTurnRadius(ship);

  if (turnRadius <= 0 || cornerAngle <= 0.01) return 0;

  return turnRadius * Math.tan(cornerAngle / 2);
}

function getWaypointLookahead(ship) {
  return Math.max(calculateMinimumTurnWindow(ship), 32);
}

function shouldAdvanceForTurn(ship) {
  const distance = Phaser.Math.Distance.Between(ship.sprite.x, ship.sprite.y, ship.target.x, ship.target.y);

  return distance <= getWaypointLookahead(ship) + turnWindowLeeway;
}

function getSteeringTarget(ship) {
  const { sprite, target } = ship;
  const nextWaypoint = ship.waypoints[0];

  if (nextWaypoint) {
    const distanceToWaypoint = Phaser.Math.Distance.Between(sprite.x, sprite.y, target.x, target.y);
    if (distanceToWaypoint > getWaypointLookahead(ship)) {
      return target;
    }

    const segmentAngle = Phaser.Math.Angle.Between(target.x, target.y, nextWaypoint.x, nextWaypoint.y);
    const lookahead = Math.min(
      getWaypointLookahead(ship),
      Phaser.Math.Distance.Between(target.x, target.y, nextWaypoint.x, nextWaypoint.y),
    );

    return {
      x: target.x + Math.cos(segmentAngle) * lookahead,
      y: target.y + Math.sin(segmentAngle) * lookahead,
    };
  }

  const distance = Phaser.Math.Distance.Between(sprite.x, sprite.y, target.x, target.y);
  const desiredAngle = Phaser.Math.Angle.Between(sprite.x, sprite.y, target.x, target.y) + Math.PI / 2;
  const angleDelta = Phaser.Math.Angle.Wrap(desiredAngle - sprite.rotation);
  const clearanceDistance = Math.max(getTurnRadius(ship) * 1.1, 120);

  if (ship.speed > 0 && distance < clearanceDistance && Math.abs(angleDelta) > Math.PI * 0.56) {
    const forwardAngle = sprite.rotation - Math.PI / 2;
    return {
      x: sprite.x + Math.cos(forwardAngle) * clearanceDistance,
      y: sprite.y + Math.sin(forwardAngle) * clearanceDistance,
    };
  }

  return target;
}

function setupCameraZoomKeys(scene) {
  return scene.input.keyboard.addKeys({
    zoomIn: Phaser.Input.Keyboard.KeyCodes.PLUS,
    zoomOut: Phaser.Input.Keyboard.KeyCodes.MINUS,
    zoomInNumpad: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD,
    zoomOutNumpad: Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT,
  });
}

const CAMERA_ZOOM_SPEED = 1; // zoom levels per second while held

function updateCameraZoom(camera, keys, dt) {
  if (keys.zoomIn.isDown || keys.zoomInNumpad.isDown) {
    setCameraZoom(camera, camera.zoom + CAMERA_ZOOM_SPEED * dt);
  } else if (keys.zoomOut.isDown || keys.zoomOutNumpad.isDown) {
    setCameraZoom(camera, camera.zoom - CAMERA_ZOOM_SPEED * dt);
  }
}

function setupCameraPanKeys(scene) {
  return scene.input.keyboard.addKeys({
    up: 'W',
    down: 'S',
    left: 'A',
    right: 'D',
  });
}

// Continuous WASD panning
function updateCameraPan(camera, keys, dt) {
  let dx = 0;
  let dy = 0;
  if (keys.left.isDown) dx -= 1;
  if (keys.right.isDown) dx += 1;
  if (keys.up.isDown) dy -= 1;
  if (keys.down.isDown) dy += 1;

  if (dx === 0 && dy === 0) return;

  // Normalize so diagonal panning isn't faster than cardinal panning
  const length = Math.sqrt(dx * dx + dy * dy);
  dx /= length;
  dy /= length;

  // Divide by zoom so panning feels the same screen-speed
  camera.scrollX += (dx * CAMERA_PAN_SPEED * dt) / camera.zoom;
  camera.scrollY += (dy * CAMERA_PAN_SPEED * dt) / camera.zoom;
}

function setCameraZoom(camera, zoom) {
  const nextZoom = Phaser.Math.Clamp(zoom, 0.5, 2.2);
  camera.zoom = nextZoom;
  updateWaypointMarkerScales(camera);
  ships.forEach((ship) => {
    if (ship.pathLine) updatePathLine(ship);
  });
}

// The hull is a single static image; only the wake sprite animates.
function computeShipFrame(ship) {
  const { stats } = ship;
  if (!ship.moving) return null;

  if (ship.slowingDown) {
    const n = stats.wakeAccelerationFrames;
    const frame = Math.floor(ship.slowdownFrameClock * WAKE_FPS) % n;
    return {
      wakeKey: stats.textures.wakeAcceleration,
      wakeFrame: frame,
      wakeAnimKey: slowingWakeAnimKey(stats),
      animProgress: frame / n,
    };
  }

  if (ship.accelerating) {
    const n = stats.wakeAccelerationFrames;
    const frameIndex = Math.floor(ship.accelerationFrameClock * WAKE_FPS) % n;
    return {
      wakeKey: stats.textures.wakeAcceleration,
      wakeFrame: n - 1 - frameIndex,
      wakeAnimKey: acceleratingWakeAnimKey(stats),
      animProgress: frameIndex / n,
    };
  }

  const n = stats.wakeMovingFrames;
  const frame = Math.floor(ship.movementFrameClock * WAKE_FPS) % n;
  return {
    wakeKey: stats.textures.wakeMoving,
    wakeFrame: frame,
    wakeAnimKey: movingWakeAnimKey(stats),
    animProgress: frame / n,
  };
}

function restoreShipVisual(ship) {
  const { stats } = ship;

  ship.sprite.setTexture(stats.textures.hullStationary);
  ship.sprite.setDisplaySize(stats.displayWidth, stats.displayHeight);

  const wake = computeShipFrame(ship);
  if (!wake) {
    ship.wakeSprite.setVisible(false);
    return;
  }

  ship.wakeSprite.setVisible(true);
  ship.wakeSprite.setTexture(wake.wakeKey, wake.wakeFrame);
  ship.wakeSprite.setDisplaySize(stats.displayWidth, stats.displayHeight);
  ship.wakeSprite.anims.timeScale = ship.slowingDown
    ? ship.decelTimeScale
    : ship.accelerating
      ? ship.accelTimeScale
      : 1; // NEW
  ship.wakeSprite.play(wake.wakeAnimKey);
  ship.wakeSprite.setFrame(wake.wakeFrame);
  ship.wakeSprite.anims.setProgress(wake.animProgress);
}

function syncShipAnimationFrame(ship) {
  const wake = computeShipFrame(ship);
  if (!wake) {
    ship.wakeSprite.setVisible(false);
    return;
  }

  ship.wakeSprite.setVisible(true);
  ship.wakeSprite.setTexture(wake.wakeKey, wake.wakeFrame);
  ship.wakeSprite.setDisplaySize(ship.stats.displayWidth, ship.stats.displayHeight);
}

function updateShip(ship, dt) {
  if (ship.sinking) {
    updateSinking(ship, dt);
    return; // sinking ships ignore steering, firing, and wake spawning
  }
  if (ship.health <= 0) {
    beginSinking(ship);
    return; // death sequence starts this frame; sinking logic picks up next frame
  }
  const { sprite, stats } = ship;

  if (ship.moving && !ship.accelerating && !ship.slowingDown) {
    ship.movementFrameClock = (ship.movementFrameClock + dt) % (stats.wakeMovingFrames / WAKE_FPS);
  }
  if (ship.accelerating) {
    ship.accelerationFrameClock = (ship.accelerationFrameClock + dt * ship.accelTimeScale) % (stats.wakeAccelerationFrames / WAKE_FPS); // scaled
  }
  if (ship.slowingDown) {
    ship.slowdownFrameClock = (ship.slowdownFrameClock + dt * ship.decelTimeScale) % (stats.wakeAccelerationFrames / WAKE_FPS); // scaled
  }

   if (ship.target) {
    const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, ship.target.x, ship.target.y);
    const stoppingDistance = (ship.speed * ship.speed) / (2 * ship.deceleration);
    const finalWaypoint = ship.waypoints.length === 0;

    if (!finalWaypoint && dist >= waypointReachLeeway && shouldAdvanceForTurn(ship)) {
      advanceWaypointForTurn(ship);
    }

    const commandedSpeed = getCommandedSpeed(ship);

    // Latch: once triggered, braking stays true for the rest of this approach,
    // even if distance/stoppingDistance would momentarily say otherwise.
    if (finalWaypoint && dist <= stoppingDistance) {
      ship.braking = true;
    }

    if (dist <= waypointReachLeeway) {
      completeWaypoint(ship);
    } else if (ship.braking) {
        if (!ship.slowingDown) startSlowdownAnimation(ship);
        ship.speed = Math.max(0, ship.speed - ship.deceleration * dt);

        if (ship.speed <= 0) {
          completeWaypoint(ship, false); // stopped short — stay where it actually is, don't snap
        }
      } else {
      // Still under way toward the waypoint: steer as normal, and throttle
      // speed up or down toward whatever the current speed order calls for.
      const steeringTarget = getSteeringTarget(ship);
      let dirX = steeringTarget.x - sprite.x;
      let dirY = steeringTarget.y - sprite.y;

      // Normalize so avoidance strength doesn't get drowned out when the
      // steering target is far away
      const dirLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
      dirX /= dirLen;
      dirY /= dirLen;

      const avoidance = computeAvoidanceSteering(ship);
      const avoidanceWeight = 1.5;
      dirX += avoidance.x * avoidanceWeight;
      dirY += avoidance.y * avoidanceWeight;

      const desiredAngle = Math.atan2(dirY, dirX) + Math.PI / 2;
      const angleDelta = Phaser.Math.Angle.Wrap(desiredAngle - sprite.rotation);
      const maxTurn = ship.turnRate * dt;
      sprite.rotation += Phaser.Math.Clamp(angleDelta, -maxTurn, maxTurn);

      if (ship.speed < commandedSpeed) {
        ship.speed = Math.min(commandedSpeed, ship.speed + ship.acceleration * dt);
        if (!ship.moving || ship.slowingDown) {
          ship.moving = true;
          ship.slowingDown = false;
          ship.accelerating = true;
          startAccelerationAnimation(ship);
        }
       } else if (ship.speed > commandedSpeed) {
        if (!ship.slowingDown) startSlowdownAnimation(ship);
        ship.speed = Math.max(commandedSpeed, ship.speed - ship.deceleration * dt);
        if (ship.speed <= commandedSpeed) {
          ship.slowingDown = false;
          ship.wakeSprite.stop();
          ship.wakeSprite.anims.timeScale = 1; // NEW
          ship.wakeSprite.play(movingWakeAnimKey(stats));
        }
      } else if (!ship.moving) {
        ship.moving = true;
        ship.accelerating = true;
        startAccelerationAnimation(ship);
      }
    }
  } else {
    // Decelerate to a stop when no target (this is what runs after S is
    // pressed to order a stop) — play the slowdown wake for the whole stop.
    if (ship.speed > 0 && !ship.slowingDown) startSlowdownAnimation(ship);
    ship.speed = Math.max(0, ship.speed - ship.deceleration * dt);
  }

  if (ship.speed <= 0) {
    stopShipAnimation(ship);
  }

  syncShipAnimationFrame(ship);

  if (ship.speed > 0) {
    const heading = sprite.rotation - Math.PI / 2;
    const step = ship.speed * dt;
    if (ship.target && step >= Phaser.Math.Distance.Between(sprite.x, sprite.y, ship.target.x, ship.target.y)) {
      completeWaypoint(ship);
    } else {
      sprite.x += Math.cos(heading) * step;
      sprite.y += Math.sin(heading) * step;
    }
  }

  if (ship.target) {
    updatePathLine(ship);
  } else if (ship.pathLine) {
    ship.pathLine.destroy();
    ship.pathLine = null;
  }

  ship.selectedRing.x = sprite.x;
  ship.selectedRing.y = sprite.y;

  // Keep the wake sprite glued to the hull's position and heading.
  ship.wakeSprite.x = sprite.x;
  ship.wakeSprite.y = sprite.y;
  ship.wakeSprite.rotation = sprite.rotation;

  ship.minRangeCircle.setPosition(sprite.x, sprite.y);
  ship.minRangeCircle.setVisible(firingModeActive && selectedShips.includes(ship));

  ship.maxRangeCircle.setPosition(sprite.x, sprite.y);
  ship.maxRangeCircle.setVisible(firingModeActive && selectedShips.includes(ship));

  updateTurrets(ship, dt);
  updateFiring(ship, dt);
  updateDispersionEllipseTransform(ship);
  updateShipWake(ship, dt);
  updateHealthBar(ship);
}

function stopShipAnimation(ship) {
  if (!ship.moving) return;
  ship.moving = false;
  ship.accelerating = false;
  ship.slowingDown = false;

  ship.wakeSprite.stop();
  ship.wakeSprite.setVisible(false);

  ship.sprite.setTexture(ship.stats.textures.hullStationary);
  ship.sprite.setDisplaySize(ship.stats.displayWidth, ship.stats.displayHeight);
}

function completeWaypoint(ship, snap = true) {
  const completedWaypoint = ship.target;
  if (snap) {
    ship.sprite.setPosition(completedWaypoint.x, completedWaypoint.y);
  }
  advanceToNextWaypoint(ship);
  ship.braking = false;

  if (ship.target) updatePathLine(ship);
  removeWaypointMarker(completedWaypoint);

  if (!ship.target) {
    ship.speed = 0;
    stopShipAnimation(ship);
  }
}

function advanceWaypointForTurn(ship) {
  removeWaypointMarker(ship.target);
  advanceToNextWaypoint(ship);
}

function removeWaypointMarker(waypoint) {
  if (!waypoint.marker) return;

  const markerIndex = waypointMarkers.indexOf(waypoint.marker);
  if (markerIndex >= 0) waypointMarkers.splice(markerIndex, 1);
  waypoint.marker.destroy();
  waypoint.marker = null;
}

function startSlowdownAnimation(ship) {
  if (ship.slowingDown || ship.speed <= 0) return;
  const { stats } = ship;
  ship.slowingDown = true;
  ship.slowdownFrameClock = 0;

  ship.wakeSprite.setVisible(true);
  ship.wakeSprite.stop();
  ship.wakeSprite.setTexture(stats.textures.wakeAcceleration, 0);
  ship.wakeSprite.setDisplaySize(stats.displayWidth, stats.displayHeight);
  ship.wakeSprite.anims.timeScale = ship.decelTimeScale; // NEW
  ship.wakeSprite.play(slowingWakeAnimKey(stats));
}

function startAccelerationAnimation(ship) {
  const { stats } = ship;
  ship.accelerationFrameClock = 0;

  ship.wakeSprite.setVisible(true);
  ship.wakeSprite.stop();
  ship.wakeSprite.setTexture(stats.textures.wakeAcceleration, stats.wakeAccelerationFrames - 1);
  ship.wakeSprite.setDisplaySize(stats.displayWidth, stats.displayHeight);
  ship.wakeSprite.anims.timeScale = ship.accelTimeScale; // NEW
  ship.wakeSprite.play(acceleratingWakeAnimKey(stats));

  ship.wakeSprite.once(`animationcomplete-${acceleratingWakeAnimKey(stats)}`, () => {
    if (!ship.moving || ship.slowingDown) return;
    ship.accelerating = false;
    ship.wakeSprite.anims.timeScale = 1; // NEW — reset before handing off to the loop
    ship.wakeSprite.setTexture(stats.textures.wakeMoving);
    ship.wakeSprite.setDisplaySize(stats.displayWidth, stats.displayHeight);
    ship.wakeSprite.play(movingWakeAnimKey(stats));
  });
}

function updatePathLine(ship) {
  if (!ship.pathLine || !ship.target) return;
  const now = ship.sprite.scene.time.now;
  if (now - ship.pathPreviewLastUpdate < 80) return;
  ship.pathPreviewLastUpdate = now;
  ship.pathLine.clear();
  ship.pathLine.lineStyle(3 / ship.sprite.scene.cameras.main.zoom, 0xffffff, 0.55);
  ship.pathLine.beginPath();
  ship.pathLine.moveTo(ship.sprite.x, ship.sprite.y);
  calculatePredictedPath(ship).forEach((point) => {
    ship.pathLine.lineTo(point.x, point.y);
  });
  ship.pathLine.strokePath();
}

function stopSelectedShips() {
  if (selectedShips.length === 0) return;

  selectedShips.forEach((ship) => {
    if (ship.target) removeWaypointMarker(ship.target);
    ship.waypoints.forEach(removeWaypointMarker);
    ship.waypoints = [];
    ship.target = null;
    ship.braking = false;
  });
}

function calculatePredictedPath(ship) {
  const state = {
    sprite: { x: ship.sprite.x, y: ship.sprite.y, rotation: ship.sprite.rotation },
    target: ship.target ? { ...ship.target } : null,
    waypoints: ship.waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y })),
    speed: ship.speed,
    maxSpeed: getCommandedSpeed(ship),
    acceleration: ship.acceleration,
    deceleration: ship.deceleration,
    turnRate: ship.turnRate,
  };
  const points = [];
  const predictionStep = 1 / 12;

  for (let index = 0; state.target && index < 12000; index += 1) {
    const distance = Phaser.Math.Distance.Between(state.sprite.x, state.sprite.y, state.target.x, state.target.y);
    const finalWaypoint = state.waypoints.length === 0;

    if (!finalWaypoint && distance >= waypointReachLeeway && shouldAdvanceForTurn(state)) {
      state.target = state.waypoints.shift() || null;
      continue;
    }

    if (distance <= waypointReachLeeway) {
      state.sprite.x = state.target.x;
      state.sprite.y = state.target.y;
      state.target = state.waypoints.shift() || null;
      if (!state.target) state.speed = 0;
      points.push({ x: state.sprite.x, y: state.sprite.y });
      continue;
    }

    const steeringTarget = getSteeringTarget(state);
    const desiredAngle = Phaser.Math.Angle.Between(
      state.sprite.x,
      state.sprite.y,
      steeringTarget.x,
      steeringTarget.y,
    ) + Math.PI / 2;
    const angleDelta = Phaser.Math.Angle.Wrap(desiredAngle - state.sprite.rotation);
    state.sprite.rotation += Phaser.Math.Clamp(angleDelta, -state.turnRate * predictionStep, state.turnRate * predictionStep);

    const stoppingDistance = (state.speed * state.speed) / (2 * state.deceleration);
    if (finalWaypoint && distance <= stoppingDistance) {
      state.speed = Math.max(0, state.speed - state.deceleration * predictionStep);
    } else {
      state.speed = Math.min(state.maxSpeed, state.speed + state.acceleration * predictionStep);
    }

    const step = state.speed * predictionStep;
    const remainingDistance = Phaser.Math.Distance.Between(state.sprite.x, state.sprite.y, state.target.x, state.target.y);
    if (step >= remainingDistance) {
      state.sprite.x = state.target.x;
      state.sprite.y = state.target.y;
    } else {
      const heading = state.sprite.rotation - Math.PI / 2;
      state.sprite.x += Math.cos(heading) * step;
      state.sprite.y += Math.sin(heading) * step;
    }
    points.push({ x: state.sprite.x, y: state.sprite.y });
  }

  return points;
}

function updateWaypointMarkerScales(camera) {
  const scale = waypointSize / waypointSourceSize / camera.zoom;
  waypointMarkers.forEach((marker) => marker.setScale(scale));
}

//DEBUG FEATURES

function killSelectedShips() {
  if (selectedShips.length === 0) return;
  // Copy first — beginSinking (called from updateShip next frame) removes
  // ships from selectedShips as they die, which would otherwise mutate this
  // array out from under the forEach.
  [...selectedShips].forEach((ship) => {
    ship.health = 0;
  });
}

function drawPixelatedArcOutline(scene, radius, startAngle, endAngle, color, pixel = 2) {
  const graphics = scene.add.graphics();
  const half = pixel / 2;
  const cell = (px, py) => graphics.fillRect(px - half, py - half, pixel, pixel);
  graphics.fillStyle(color, 0.9);

  const angleStep = pixel / radius;
  for (let angle = startAngle; angle <= endAngle; angle += angleStep) {
    const x = Math.round((Math.cos(angle) * radius) / pixel) * pixel;
    const y = Math.round((Math.sin(angle) * radius) / pixel) * pixel;
    cell(x, y);
  }
  
  const xEnd = Math.round((Math.cos(endAngle) * radius) / pixel) * pixel;
  const yEnd = Math.round((Math.sin(endAngle) * radius) / pixel) * pixel;
  cell(xEnd, yEnd);

  [startAngle, endAngle].forEach((angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let r = 0; r <= radius; r += pixel) {
      const x = Math.round((cos * r) / pixel) * pixel;
      const y = Math.round((sin * r) / pixel) * pixel;
      cell(x, y);
    }
  });

  return graphics;
}

let firingArcDebugActive = false;
let firingArcDebugGraphics = [];

function clearFiringArcDebug() {
  firingArcDebugGraphics.forEach((g) => g.destroy());
  firingArcDebugGraphics = [];
}

function drawFiringArcDebug(scene) {
  clearFiringArcDebug();

  selectedShips.forEach((ship) => {
    if (ship.sinking) return;
    const radius = 400;

    ship.turrets.forEach((turret) => {
      const rotationReference = ship.sprite.rotation + turret.rotationOffset;
      const firingCenterAngle = rotationReference + Math.PI / 2;
      const halfArc = (turret.arc === "back" ? ship.stats.backFiringArc : ship.stats.frontFiringArc) / 2;
      const color = turret.arc === "back" ? 0x00aaff : 0xffaa00;

      const fillGraphics = scene.add.graphics().setDepth(5);
      fillGraphics.fillStyle(color, 0.07);
      fillGraphics.beginPath();
      fillGraphics.moveTo(turret.sprite.x, turret.sprite.y);
      fillGraphics.arc(turret.sprite.x, turret.sprite.y, radius, firingCenterAngle - halfArc, firingCenterAngle + halfArc, false);
      fillGraphics.lineTo(turret.sprite.x, turret.sprite.y);
      fillGraphics.closePath();
      fillGraphics.fillPath();
      worldContainer.add(fillGraphics);
      firingArcDebugGraphics.push(fillGraphics);

      const outlineGraphics = drawPixelatedArcOutline(
        scene, radius, firingCenterAngle - halfArc, firingCenterAngle + halfArc, color,
      ).setDepth(5);
      outlineGraphics.setPosition(turret.sprite.x, turret.sprite.y);
      worldContainer.add(outlineGraphics);
      firingArcDebugGraphics.push(outlineGraphics);

      const actualFiringAngle = turret.sprite.rotation + Math.PI / 2;
      const facingGraphics = scene.add.graphics().setDepth(5);
      facingGraphics.lineStyle(2, 0xffffff, 0.3);
      facingGraphics.lineBetween(
        turret.sprite.x, turret.sprite.y,
        turret.sprite.x + Math.cos(actualFiringAngle) * 100,
        turret.sprite.y + Math.sin(actualFiringAngle) * 100,
      );
      worldContainer.add(facingGraphics);
      firingArcDebugGraphics.push(facingGraphics);
    });
  });
}