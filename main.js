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

  scale: {
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 800,
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
const waypointSize = 48;
const waypointSourceSize = 480;
const waypointReachLeeway = 0;
const turnWindowLeeway = 3;

// Frame rate shared by every wake animation (moving loop, slowdown, acceleration).
const WAKE_FPS = 12;

// Turret A/B mounts render at different depths (B, the inner/superfiring
// mount, always on top of A) — this convention is shared across every ship
// class, unlike the mount geometry itself, which lives per-class in
// stats.turretMounts.
const TURRET_DEPTH = { A: 2.4, B: 2.6 };

// ---- Firing mode ----
let firingModeActive = false;
let firingModeIndicator = null;
const FIRE_TARGET_TOGGLE_RADIUS = 24; // right-clicking within this many world units of the current target cancels it

// Shell art/speed is shared across all ship classes for now (not yet a
// per-class stat) — SHELL_SCALE used to be derived from the old global
// shipDisplayWidth (56); that constant is gone now that display size is
// per-class, so the same numeric baseline (56) is inlined directly here
// instead. Revisit if you want shell size to vary by ship class later.
const SHELL_SCALE = (56 / 960) * 0.5;
const shellDisplayWidth = 75 * SHELL_SCALE;
const shellDisplayHeight = 135 * SHELL_SCALE;
const SHELL_SPEED = 260;
let activeShells = [];

// Naval "bell order" style speed settings, each a fraction of a ship's
// absolute top (flank) speed. Ships steer/cruise capped at whichever order
// is currently in effect; braking to a full stop at a final waypoint always
// goes to zero regardless of the order.
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

  // A second camera, permanently un-zoomed and un-scrolled, dedicated to HUD
  // elements. It ignores everything in worldContainer (the ocean, ships,
  // waypoint markers, path lines, the selection box — anything added to that
  // container, present or future), so it only ever draws the HUD, always at
  // a fixed screen position and size regardless of what the main camera does.
  uiCamera = this.cameras.add(0, 0, config.width, config.height);
  uiCamera.ignore(worldContainer);

  this.input.on("wheel", (pointer, currentlyOver, deltaX, deltaY)  => {
    setCameraZoom(camera, camera.zoom - deltaY * 0.001);
  });

  this.input.keyboard.on("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
      setCameraZoom(camera, camera.zoom + 0.1);
    } else if (event.key === "-" || event.key === "_") {
      setCameraZoom(camera, camera.zoom - 0.1);
    }
  });

  // Every registered ship type gets its own set of WAKE animations, keyed by
  // movingWakeAnimKey(stats)/slowingWakeAnimKey(stats)/acceleratingWakeAnimKey(stats)
  // (see ship-types.js) — the hull itself no longer animates.
  //
  // Pennsylvania-Acceleration.png: frame 0 = full spray, last frame = nearly
  // gone. So "slowing" plays 0 -> last (spray dies away) and "accelerating"
  // plays last -> 0 (spray builds up). If the sheet reads the other way
  // round in game, swap the .reverse() below.
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
  });

  // Create a small starting fleet
  ships = [createShip(this, 6400, 4000, "pennsylvania"),
          createShip(this, 5400, 4000, "pennsylvania")];

  // Speed order shortcuts: 1=Ahead 1/3 ... 5=Ahead Flank
  SPEED_ORDERS.forEach((order, index) => {
    this.input.keyboard.on(`keydown-${order.key}`, () => setSpeedOrder(index));
  });
  createSpeedHud(this);
  updateSpeedHud();
  createFiringHud(this);
  createCannotAimHud(this);
  this.input.keyboard.on("keydown-F", toggleFiringMode);
  this.input.keyboard.on("keydown-X", stopFiring);
  this.input.keyboard.on("keydown-S", stopSelectedShips);

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
      const dist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, ship.sprite.x, ship.sprite.y);
      if (dist < 20 && dist < clickedDist) {
        clickedShip = ship;
        clickedDist = dist;
      }
    });

    if (shiftHeld) {
      // Multi-select: toggle the clicked ship in/out of the existing selection
      if (clickedShip) {
        const idx = selectedShips.indexOf(clickedShip);
        if (idx === -1) {
          clickedShip.selectedRing.setVisible(true);
          selectedShips.push(clickedShip);
        } else {
          clickedShip.selectedRing.setVisible(false);
          selectedShips.splice(idx, 1);
        }
      }
      // Shift-click on empty space: leave current selection untouched
    } else {
      // Single select: clear existing selection, then select the clicked ship (if any)
      selectedShips.forEach((s) => s.selectedRing.setVisible(false));
      selectedShips = [];
      if (clickedShip) {
        clickedShip.selectedRing.setVisible(true);
        selectedShips.push(clickedShip);
      }
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
  const dt = delta / 1000;
  ships.forEach((ship) => updateShip(ship, dt));
  resolveShipCollisions(dt);
  updateShells(dt);
  updateWakes(dt);
}

// ---- Ship creation & behavior ----

// typeId is a key into SHIP_TYPES (see ship-types.js), e.g. "pennsylvania".
function createShip(scene, x, y, typeId) {
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

  const minRangeCircle = drawPixelatedCircleOutline(scene, stats.minFiringDistance)
    .setDepth(1)
    .setVisible(false);

  const healthBar = scene.add.graphics().setDepth(3.5).setVisible(false);

  worldContainer.add([sprite, wakeSprite, selectedRing, minRangeCircle, healthBar]);

  return {
    sprite,
    wakeSprite,
    turrets,
    stats,
    barrelLocalOffsets: computeBarrelLocalOffsets(stats),
    selectedRing,
    minRangeCircle,
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
    braking: false,
    turnRate: stats.turnRate,
    speedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
    collisionRadius: stats.collisionRadius,
    team: "player",
    fireTarget: null,
    dispersionEllipse: null,
    dispersionEllipseRangeAtBuild: null,
    maxHealth: stats.maxHealth,
    health: stats.maxHealth,
    collisionDamageCooldown: 0,
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
      // Fixed offset from the ship's own heading
      rotationOffset: mount.baseRotation,
      reloadTimer: 0,
      onTarget: false,
    };
  });
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

function updateTurrets(ship) {
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);
  const maxTraverse = ship.stats.turretTraverse;

  ship.turrets.forEach((turret) => {
    const worldOffsetX = turret.dx * cos - turret.dy * sin;
    const worldOffsetY = turret.dx * sin + turret.dy * cos;

    turret.sprite.x = ship.sprite.x + worldOffsetX;
    turret.sprite.y = ship.sprite.y + worldOffsetY;

    if (ship.fireTarget) {
      const angleToTarget = Phaser.Math.Angle.Between(
        turret.sprite.x,
        turret.sprite.y,
        ship.fireTarget.x,
        ship.fireTarget.y
      ) - Math.PI / 2;

      const traverseDelta = Phaser.Math.Angle.Wrap(
        angleToTarget - turret.sprite.rotation
      );

      turret.onTarget = Math.abs(traverseDelta) <= maxTraverse;

      turret.sprite.rotation += Phaser.Math.Clamp(
        traverseDelta,
        -maxTraverse,
        maxTraverse
      );
    } else {
      const homeRotation = ship.sprite.rotation + turret.rotationOffset;
      const returnDelta = Phaser.Math.Angle.Wrap(
        homeRotation - turret.sprite.rotation
      );

      turret.sprite.rotation += Phaser.Math.Clamp(
        returnDelta,
        -maxTraverse,
        maxTraverse
      );

      if (Math.abs(returnDelta) <= maxTraverse) {
        turret.sprite.rotation = homeRotation;
      }

      turret.onTarget = false;
    }
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
  // Doesn't touch any ship's fireTarget. Toggling F just switches what
  // right-click does (fire vs move) and shows/hides the targeting HUD —
  // it has no effect on any fire order already in progress. Only
  // stopFiring() (bound to X) cancels an active fire order.
}

function toggleFiringMode() {
  setFiringMode(!firingModeActive);
}

// Cancels the fire order for the currently selected ships and tears down
// each of their dispersion ellipses. This is the ONLY way to stop a ship
// from firing — pressing F just hides/shows the firing-mode UI.
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
    if (distanceFromShip < ship.stats.minFiringDistance) {
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
    spawnShell(scene, muzzleX, muzzleY, targetX + dispersion.x, targetY + dispersion.y);
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
// Draws a pixelated circle OUTLINE (no fill) in LOCAL coordinates centered
// on (0,0) — same blocky quantize-to-grid technique as the dispersion
// ellipse outline (see drawDispersionEllipseGraphics), just with equal
// horizontal/vertical radii. `pixel` controls the chunkiness of the blocks;
// bigger pixel = chunkier/more pixelated, smaller = smoother.
function drawPixelatedCircleOutline(scene, radius, color = 0xff4444, pixel = 2) {
  const graphics = scene.add.graphics();
  const half = pixel / 2;
  const cell = (px, py) => graphics.fillRect(px - half, py - half, pixel, pixel);

  graphics.fillStyle(color, 0.9);
  for (let angle = 0; angle <= Math.PI / 2; angle += 0.01) {
    const px = Math.round((Math.cos(angle) * radius) / pixel) * pixel;
    const py = Math.round((Math.sin(angle) * radius) / pixel) * pixel;
    [1, -1].forEach((sx) => {
      [1, -1].forEach((sy) => {
        cell(sx * px, sy * py);
      });
    });
  }

  return graphics;
}

// Draws a dispersion ellipse (fill + outline + axis ticks) in LOCAL
// coordinates centered on (0,0) — it is NOT positioned or rotated here.
// The caller uses the returned graphics object's own setPosition()/
// setRotation() to place and orient it, which lets it track a turning ship
// every frame via Phaser's transform instead of re-drawing every fillRect
// each time (see updateDispersionEllipseTransform).
function drawDispersionEllipseGraphics(scene, semiMajor, semiMinor) {
  const graphics = scene.add.graphics();
  const pixel = 2;
  const half = pixel / 2;
  graphics.setDepth(1.5);

  const cell = (px, py) => graphics.fillRect(px - half, py - half, pixel, pixel);

  // Semi-transparent fill
  graphics.fillStyle(0xff0000, 0.18);
  for (let py = -semiMinor; py <= semiMinor; py += pixel) {
    const normalizedY = py / semiMinor;
    const halfWidth = semiMajor * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    const halfWidthPixels = Math.round(halfWidth / pixel) * pixel;
    graphics.fillRect(-halfWidthPixels, py - half, halfWidthPixels * 2, pixel);
  }

  // Outline — one quadrant, mirrored into the other three.
  graphics.fillStyle(0xff0000, 0.9);
  for (let angle = 0; angle <= Math.PI / 2; angle += 0.01) {
    const px = Math.round((Math.cos(angle) * semiMajor) / pixel) * pixel;
    const py = Math.round((Math.sin(angle) * semiMinor) / pixel) * pixel;
    [1, -1].forEach((sx) => {
      [1, -1].forEach((sy) => {
        cell(sx * px, sy * py);
      });
    });
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
// target, and immediately positions/orients it. Called when a fire order is
// (re)issued, and again from updateDispersionEllipseTransform whenever the
// ship's range to target has drifted enough to meaningfully change the
// dispersion size (e.g. the ship maneuvering while continuing to fire at a
// fixed point).
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
// the bearing toward the target at all times, and rebuilds its size only
// when the range has drifted past a small threshold — cheap per-frame work
// (setRotation) versus an occasional full redraw, rather than redrawing
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
// selection. Call this any time selectedShips changes — the ellipse itself
// keeps existing/updating for every firing ship regardless of selection,
// only its visibility is selection-dependent.
function updateDispersionEllipseVisibility() {
  ships.forEach((ship) => {
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.setVisible(selectedShips.includes(ship));
    }
  });
}

function spawnShell(scene, x, y, targetX, targetY) {
  const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
  const sprite = scene.add.sprite(x, y, "shell")
    .setDisplaySize(shellDisplayWidth, shellDisplayHeight)
    .setRotation(angle + Math.PI / 2)
    .setDepth(2.8);
  worldContainer.add(sprite);
  activeShells.push({ sprite, vx: Math.cos(angle) * SHELL_SPEED, vy: Math.sin(angle) * SHELL_SPEED, targetX, targetY });
}

function updateShells(dt) {
  for (let i = activeShells.length - 1; i >= 0; i -= 1) {
    const shell = activeShells[i];
    const remaining = Phaser.Math.Distance.Between(shell.sprite.x, shell.sprite.y, shell.targetX, shell.targetY);
    const step = SHELL_SPEED * dt;
    if (step >= remaining) {
      shell.sprite.destroy();
      activeShells.splice(i, 1);
      continue;
    }
    shell.sprite.x += shell.vx * dt;
    shell.sprite.y += shell.vy * dt;
  }
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
    // rectangle — occasionally jumping back near center keeps it compact
    // instead of wandering into a long snake.
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
  const sternDx = Phaser.Math.FloatBetween(-4, 4) * widthScale;
  const sternDy = stats.displayHeight * 0.42 + Phaser.Math.FloatBetween(-3, 3);

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
const COLLISION_RESTITUTION = 0.08; // very small bounce — ships mostly just stop, not rebound
const COLLISION_SPEED_RETENTION = 0.15; // fraction of speed kept after a hard impact
const COLLISION_MIN_IMPACT_SPEED = 5; // ignore light grazes, only "real" hits do damage
const COLLISION_DAMAGE_SCALE = 450; // damage per unit of closing speed at impact
const COLLISION_DAMAGE_COOLDOWN = 0.75; // seconds before a ship can take collision damage again

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
    .setDepth(1);
  worldContainer.add(waypoint.marker);
  waypointMarkers.push(waypoint.marker);
  updateWaypointMarkerScales(scene.cameras.main);

  selectedShips.forEach((ship) => {
    ship.waypoints.push(waypoint);
    if (!ship.target) advanceToNextWaypoint(ship);
    if (!ship.pathLine) {
      ship.pathLine = scene.add.graphics().setDepth(1);
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

function setCameraZoom(camera, zoom) {
  const nextZoom = Phaser.Math.Clamp(zoom, 0.6, 2.5);
  camera.zoom = nextZoom;
  updateWaypointMarkerScales(camera);
  ships.forEach((ship) => {
    if (ship.pathLine) updatePathLine(ship);
  });
}

// ---- Animation frame helpers ----
// The hull is a single static image; only the wake sprite animates.
//
// computeShipFrame returns which WAKE frame the ship should currently be
// showing (or null when the ship is stationary and has no wake). Both
// restoreShipVisual (used after canceling a slowdown mid-order) and
// syncShipAnimationFrame (called every tick) share it, so the frame-index
// math lives in one place. Texture/animation keys and frame counts all come
// from ship.stats, so this works unchanged for any ship type.
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

  // Hull is always the static blank.
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
  const { sprite, stats } = ship;

  if (ship.moving && !ship.accelerating && !ship.slowingDown) {
    ship.movementFrameClock = (ship.movementFrameClock + dt) % (stats.wakeMovingFrames / WAKE_FPS);
  }
  if (ship.accelerating) {
    ship.accelerationFrameClock = (ship.accelerationFrameClock + dt) % (stats.wakeAccelerationFrames / WAKE_FPS);
  }
  if (ship.slowingDown) {
    ship.slowdownFrameClock = (ship.slowdownFrameClock + dt) % (stats.wakeAccelerationFrames / WAKE_FPS);
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

  updateTurrets(ship);
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
  ship.wakeSprite.play(slowingWakeAnimKey(stats));
}

function startAccelerationAnimation(ship) {
  const { stats } = ship;
  ship.accelerationFrameClock = 0;

  ship.wakeSprite.setVisible(true);
  ship.wakeSprite.stop();
  ship.wakeSprite.setTexture(stats.textures.wakeAcceleration, stats.wakeAccelerationFrames - 1);
  ship.wakeSprite.setDisplaySize(stats.displayWidth, stats.displayHeight);
  ship.wakeSprite.play(acceleratingWakeAnimKey(stats));

  // Hand over to the looping "moving" wake once the build-up finishes.
  // (This listener used to live on ship.sprite; the hull no longer animates,
  // so it has to be on the wake sprite or it never fires.)
  ship.wakeSprite.once(`animationcomplete-${acceleratingWakeAnimKey(stats)}`, () => {
    if (!ship.moving || ship.slowingDown) return;
    ship.accelerating = false;
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
    // Deliberately no animation reset here: updateShip() starts the slowdown
    // wake on its own once the ship has no target, and a slowdown that's
    // already playing (e.g. braking into the last waypoint) should just keep
    // playing rather than being cancelled back to the moving wake.
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