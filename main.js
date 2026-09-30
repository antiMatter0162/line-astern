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
let oceanWaves = [];
let oceanWaveChunks = new Map();
let oceanWaveChunkWindow = "";
let oceanWaveDirection = 0;
let panStart = null;
let waypointMarkers = [];
let cameraPanKeys = null;
let cameraZoomKeys = null;
let cameraFocusShip = null;
let cameraPanTarget = null;
let tacticalDisplayActive = false;
let tacticalSavedCamera = null;
let tacticalGrid = null;
let tacticalFrame = null;
let oceanBackground = null;
const tacticalHiddenEffects = new Set();
const attachedHitExplosions = new Set();
const TACTICAL_SYMBOL_WIDTH = 55;
const TACTICAL_SYMBOL_HEIGHT = 82.5;
// Measured alpha bounds: ship symbol hulls are 240x720 in 480x720 images;
// the outline mask is 270x750 in a 480x750 image.
const TACTICAL_OUTLINE_WIDTH = (TACTICAL_SYMBOL_WIDTH * (240 / 480) + 2) * (480 / 270);
const TACTICAL_OUTLINE_HEIGHT = TACTICAL_SYMBOL_HEIGHT + 2;
const TACTICAL_MIN_ZOOM = 0.049;
const TACTICAL_MAX_ZOOM = 0.5;
const TACTICAL_SYMBOL_TEXTURES = ["tactical-bb", "tactical-ca", "tactical-cl", "tactical-dd"];
const waypointSize = 48;
const waypointSourceSize = 480;
const waypointReachLeeway = 0;
const turnWindowLeeway = 3;

const WAKE_FPS = 12;
const CAMERA_PAN_SPEED = 450;
const CAMERA_FOCUS_RESPONSE = 14;
const MAP_WIDTH = 25600;
const MAP_HEIGHT = 16000;
const OCEAN_WAVE_FRAME_SIZE = 480;
const OCEAN_WAVE_SPACING = 260;
const OCEAN_WAVE_SIZE = 45;
const OCEAN_WAVE_MIN_DISTANCE = 160;
const OCEAN_WAVE_CHUNK_SIZE = 2048;
const OCEAN_WAVE_CHUNK_BUFFER = 1;
const OCEAN_WAVE_CLEARANCE = 100;
const OCEAN_WAVE_DEPTH = 0.5;
const OCEAN_WAVE_FADE_DURATION = 0.8;
const MAP_EDGE_TURN_INSET = 120;
const MAP_EDGE_TURN_DISTANCE = 500;

// Turret A/B mounts render at different depths
const TURRET_DEPTH = { A: 2.6, B: 2.4 };

const TEAMS = {
  PLAYER: "player",
  ENEMY: "enemy",
};
function getCommandableShips() {
  return selectedShips.filter((ship) => ship.team === TEAMS.PLAYER && !ship.sinking);
}

const SINKING_HULL_DEPTH = 1.2;
const SINKING_TURRET_DEPTH = 1.5;
const SINKING_WATER_OVERLAY_DEPTH = 1.6;
const SINKING_EXPLOSION_DEPTH = 3.0;
const ORDER_MARKER_DEPTH = 1.8;

// ---- Firing mode ----
let firingModeActive = false;
let firingModeIndicator = null;
let firingModeIndicatorBackground = null;
const FIRE_TARGET_TOGGLE_RADIUS = 24; // right-clicking within this many world units of the current target cancels it
let shipContextMenu = null;
let contextMenuConsumedPointer = false;

// Shell art/speed is shared across all ship classes for now
const SHELL_SCALE = (56 / 960) * 0.5;
const shellDisplayWidth = 75 * SHELL_SCALE;
const shellDisplayHeight = 135 * SHELL_SCALE;
const SHELL_SPEED = 450;
const AIM_LEAD_FACTOR = 1;
const DISPERSION_TIGHTENING_PER_SECOND = 0.01;
const MIN_SUSTAINED_AIM_DISPERSION = 0.65;
const AIM_LEAD_RESET_TURN_RADIANS = Phaser.Math.DegToRad(10);
let activeShells = [];
let shellSpritePool = [];
const SHELL_SPRITE_POOL_SIZE = 64;

function createFireTarget(x, y, targetShip) {
  return {
    x,
    y,
    targetShip,
    aimElapsed: 0,
    dispersionFactor: 1,
  };
}

function updateSustainedAim(ship, dt) {
  const fireTarget = ship.fireTarget;
  if (!fireTarget || !fireTarget.targetShip) return;

  fireTarget.aimElapsed = (fireTarget.aimElapsed || 0) + dt;
  fireTarget.dispersionFactor = Math.max(
    MIN_SUSTAINED_AIM_DISPERSION,
    1 - fireTarget.aimElapsed * DISPERSION_TIGHTENING_PER_SECOND,
  );
}

function resetSustainedAimForTurn(ship, targetX, targetY) {
  if (!ship.fireTarget) return;

  const desiredHeading = Phaser.Math.Angle.Between(
    ship.sprite.x, ship.sprite.y, targetX, targetY,
  );
  const currentHeading = ship.sprite.rotation - Math.PI / 2;
  const turn = Math.abs(Phaser.Math.Angle.Wrap(desiredHeading - currentHeading));
  if (turn > AIM_LEAD_RESET_TURN_RADIANS) {
    ship.fireTarget.aimElapsed = 0;
    ship.fireTarget.dispersionFactor = 1;
  }
}

//sinking parameters
const SINK_DURATION = 30; 
const DEATH_DRIFT_SECONDS = 1.25;
const SINK_PIXEL = 1;
const SINK_WATER_OVERLAP = 2;
const SINK_WATER_MARGIN = 4;
const SINK_JITTER = 0.35;
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
const SPEED_ORDER_COOLDOWN_MS = 5000;
const WAYPOINT_SPEED_ORDER_GRACE_MS = 750;

const enemyAI = window.createEnemyAI({
  Phaser,
  getShips: () => ships,
  getSelectedShips: () => selectedShips,
  teams: TEAMS,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  speedOrders: SPEED_ORDERS,
  defaultSpeedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
  setShipSpeedOrder,
  resetSustainedAimForTurn,
  removeWaypointMarker,
  createFireTarget,
  refreshShipDispersionEllipse,
});
let speedHudButtons = null;
let speedHudLabels = null;
let speedHudBackdrop = null;
let speedHudTitle = null;
let speedHudTitleText = null;
let speedHudExpanded = false;

function preload() {
  this.load.image("selection-circle", "assets/Selection-Circle.png");
  this.load.image("selection-circle-enemy", "assets/Selection-Circle-Enemy.png");
  this.load.image("waypoint", "assets/Waypoint.png");
  this.load.image("tactical-bb", "assets/BB-Symbol.png");
  this.load.image("tactical-ca", "assets/CA-Symbol.png");
  this.load.image("tactical-cl", "assets/CL-Symbol.png");
  this.load.image("tactical-dd", "assets/DD-Symbol.png");
  this.load.image("tactical-selection-outline", "assets/Tactical-Selection-Circle.png");
  this.load.image("shell", "assets/Shell.png");
  this.load.spritesheet("ocean-wave", "assets/Wave.png", {
    frameWidth: OCEAN_WAVE_FRAME_SIZE,
    frameHeight: OCEAN_WAVE_FRAME_SIZE,
  });
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
      frameWidth: stats.wakeFrameWidth,
      frameHeight: stats.wakeFrameHeight,
    });
    this.load.spritesheet(stats.textures.wakeAcceleration, stats.assetPaths.wakeAcceleration, {
      frameWidth: stats.wakeFrameWidth,
      frameHeight: stats.wakeFrameHeight,
    });
  });
  Object.values(SHIP_TYPES).forEach((stats) => {
    this.textures.get(stats.textures.turretA).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.turretB).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.hullStationary).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.wakeMoving).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(stats.textures.wakeAcceleration).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get("explosion").setFilter(Phaser.Textures.FilterMode.NEAREST);
  });
}

let gamePaused = true;
let suppressGameplayPointer = false;
let pauseOverlayElements = null;
let startScreenActive = true;
let startScreenMenu = null;

function startGame() {
  if (!startScreenActive) return;
  suppressGameplayPointer = true;
  startScreenActive = false;
  startScreenMenu.hide();
  setPaused(false);
}

function createPauseOverlay(scene) {
  const centerX = config.width / 2;
  const centerY = config.height / 2;
  const backdrop = scene.add.rectangle(centerX, centerY, config.width, config.height, 0x000000, 0.72)
    .setDepth(20).setVisible(false).setInteractive();
  const title = PixelFont.create(scene, "PAUSED", {
    x: centerX, y: centerY - 112, pixelSize: 5, color: 0xffffff, depth: 21, align: "center",
  }).setVisible(false);

  const makeButton = (y, label, fill, onClick) => {
    const button = scene.add.rectangle(centerX, y + 22, 270, 48, fill)
      .setDepth(21).setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", onClick);
    const text = PixelFont.create(scene, label, {
      x: centerX, y: y + 14, pixelSize: 3, color: 0xffffff, depth: 22, align: "center",
    }).setVisible(false);
    return { button, text };
  };

  const resume = makeButton(centerY - 52, "RESUME GAME", 0x245c32, () => {
    suppressGameplayPointer = true;
    setPaused(false);
  });
  const mainMenu = makeButton(centerY + 8, "MAIN MENU", 0x12584f, () => {
    suppressGameplayPointer = true;
    startScreenActive = true;
    startScreenMenu.show();
  });
  const exit = makeButton(centerY + 68, "EXIT GAME", 0x7a1010, () => window.electronAPI?.exitGame());
  const elements = [backdrop, title, resume.button, resume.text,
    mainMenu.button, mainMenu.text, exit.button, exit.text];

  scene.cameras.main.ignore(elements);
  pauseOverlayElements = { scene, elements };
}

function togglePause() {
  setPaused(!gamePaused);
}

function setPaused(paused) {
  gamePaused = paused;
  pauseOverlayElements.elements.forEach((element) => element.setVisible(gamePaused));

  if (gamePaused) {
    panStart = null;
    closeShipContextMenu();
    pauseOverlayElements.scene.anims.pauseAll();
    pauseOverlayElements.scene.time.paused = true;
  } else {
    pauseOverlayElements.scene.anims.resumeAll();
    pauseOverlayElements.scene.time.paused = false;
  }
  updateSpeedOrderCooldownVisuals();
}

let cannotAimMessage = null;
let cannotAimBackground = null;

function createCannotAimHud(scene) {
  cannotAimBackground = scene.add.rectangle(config.width / 2, 82, 270, 38, 0x7a1010)
    .setDepth(9).setVisible(false);
  cannotAimMessage = PixelFont.create(scene, "CANNOT AIM THERE!", {
    x: config.width / 2, y: 73, pixelSize: 2, color: 0xffffff, depth: 10, align: "center",
  }).setVisible(false);
  scene.cameras.main.ignore([cannotAimBackground, cannotAimMessage]);
}

function flashCannotAimMessage(scene) {
  if (!cannotAimMessage) return;
  cannotAimBackground.setVisible(true);
  cannotAimMessage.setVisible(true);
  scene.time.delayedCall(900, () => {
    cannotAimBackground.setVisible(false);
    cannotAimMessage.setVisible(false);
  });
}

function createShipContextMenu(scene) {
  const padding = 8;
  const pixelSize = 1.25;
  const defaultLabel = "IDENTIFY AS HOSTILE";
  const maxLabel = "REMOVE HOSTILE MARKING";
  const labelWidth = Math.max(
    PixelFont.measureLine(defaultLabel, pixelSize),
    PixelFont.measureLine(maxLabel, pixelSize),
  );
  const labelHeight = 7 * pixelSize;
  const optionWidth = labelWidth + padding * 2;
  const optionHeight = labelHeight + padding * 2;
  const panel = scene.add.rectangle(0, 0, optionWidth + padding * 2, optionHeight + padding * 2, 0x102a3a, 0.98)
    .setOrigin(0).setDepth(30).setVisible(false).setInteractive()
    .on("pointerdown", () => {
      contextMenuConsumedPointer = true;
      closeShipContextMenu();
    });
  const option = scene.add.rectangle(padding, padding, optionWidth, optionHeight, 0x7a1010)
    .setOrigin(0).setDepth(31).setVisible(false)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", () => {
      contextMenuConsumedPointer = true;
      const ship = shipContextMenu.ship;
      if (ship && !ship.sinking) {
        ship.hostile = !ship.hostile;
        ship.identified = ship.hostile;
        ship.hostileRing.setVisible(ship.hostile);
      }
      closeShipContextMenu();
    });
  const optionLabel = PixelFont.create(scene, defaultLabel, {
    x: padding + 6, y: padding + 5, pixelSize, color: 0xffffff, depth: 32,
  }).setVisible(false);
  scene.cameras.main.ignore([panel, option, optionLabel]);
  shipContextMenu = { scene, panel, option, optionLabel, ship: null, padding };
}

function openShipContextMenu(ship, screenX, screenY) {
  if (!shipContextMenu) return;
  const { panel, option, optionLabel, padding } = shipContextMenu;
  optionLabel.setPixelText(ship.hostile ? "REMOVE HOSTILE MARKING" : "IDENTIFY AS HOSTILE");
  const clickOffset = 8;
  const x = Phaser.Math.Clamp(screenX + clickOffset, 0, config.width - panel.displayWidth);
  const y = Phaser.Math.Clamp(screenY + clickOffset, 0, config.height - panel.displayHeight);
  shipContextMenu.ship = ship;
  panel.setPosition(x, y).setVisible(true);
  option.setPosition(x + padding, y + padding).setVisible(true);
  optionLabel.setPixelPosition(x + padding + 6, y + padding + 5).setVisible(true);
}

function closeShipContextMenu() {
  if (!shipContextMenu) return;
  shipContextMenu.panel.setVisible(false);
  shipContextMenu.option.setVisible(false);
  shipContextMenu.optionLabel.setVisible(false);
  shipContextMenu.ship = null;
}

function findShipAt(worldX, worldY) {
  return ships
    .filter((ship) => !ship.sinking && !ship.sunk && isWithinShipSelectionCircle(ship, worldX, worldY))
    .sort((a, b) =>
      Phaser.Math.Distance.Between(worldX, worldY, a.sprite.x, a.sprite.y)
      - Phaser.Math.Distance.Between(worldX, worldY, b.sprite.x, b.sprite.y)
    )[0] || null;
}

function isWithinShipSelectionCircle(ship, worldX, worldY) {
  const radius = ship.selectedRing.displayWidth / 2;
  const dx = worldX - ship.sprite.x;
  const dy = worldY - ship.sprite.y;
  return dx * dx + dy * dy <= radius * radius;
}

function create() {
  worldContainer = this.add.layer();
  initializeShellSpritePool(this);

  // Uniform deep-blue ocean background
  oceanBackground = this.add.rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT, 0x06345a);
  worldContainer.add(oceanBackground);

  const camera = this.cameras.main;
  camera.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
  camera.centerOn(MAP_WIDTH / 2, MAP_HEIGHT / 2);

  cameraPanKeys = setupCameraPanKeys(this);
  cameraZoomKeys = setupCameraZoomKeys(this);
  // A second camera, permanently un-zoomed and un-scrolled, dedicated to HUD
  // elements.
  uiCamera = this.cameras.add(0, 0, config.width, config.height);
  uiCamera.ignore(worldContainer);
  uiCamera.setScroll(0, 0);
  uiCamera.setZoom(1);
  createTacticalDisplayUI(this);
  createShipContextMenu(this);

  this.input.on("wheel", (pointer, currentlyOver, deltaX, deltaY)  => {
    if (gamePaused) return;
    if (pointer.event && pointer.event.preventDefault) pointer.event.preventDefault();
    const maintainingFocus = Boolean(cameraFocusShip || cameraPanTarget);
    const previousZoom = camera.zoom;
    const cursorOffsetX = pointer.x - (camera.x + camera.width * camera.originX);
    const cursorOffsetY = pointer.y - (camera.y + camera.height * camera.originY);
    if (tacticalDisplayActive) {
      setCameraZoom(camera, camera.zoom * Math.exp(-deltaY * 0.001));
    } else {
      setCameraZoom(camera, camera.zoom - deltaY * 0.001);
    }
    if (!maintainingFocus) {
      const zoom = camera.zoom;
      camera.scrollX += cursorOffsetX * (1 / previousZoom - 1 / zoom);
      camera.scrollY += cursorOffsetY * (1 / previousZoom - 1 / zoom);
    }
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
  ships = [createShip(this, MAP_WIDTH / 2, MAP_HEIGHT / 2, "pennsylvania", TEAMS.PLAYER, Math.PI / 2),
          createShip(this, MAP_WIDTH / 2 - 800, MAP_HEIGHT / 2, "new-orleans", TEAMS.PLAYER, Math.PI / 2),
          createShip(this, MAP_WIDTH / 2 - 5400, MAP_HEIGHT / 2 + 1000, "new-orleans", TEAMS.ENEMY, Math.PI / 4 * 3)];

  this.anims.create({
    key: "ocean-wave",
    frames: this.anims.generateFrameNumbers("ocean-wave", { start: 0, end: 5 }),
    frameRate: 12,
    repeat: -1,
  });
  this.textures.get("ocean-wave").setFilter(Phaser.Textures.FilterMode.NEAREST);
  TACTICAL_SYMBOL_TEXTURES.forEach((texture) => {
    this.textures.get(texture).setFilter(Phaser.Textures.FilterMode.NEAREST);
  });
  this.textures.get("tactical-selection-outline").setFilter(Phaser.Textures.FilterMode.NEAREST);
  createOceanWaves(this);

  // Speed order shortcuts: 1=Ahead 1/3 ... 5=Ahead Flank
  SPEED_ORDERS.forEach((order, index) => {
    this.input.keyboard.on(`keydown-${order.key}`, () => {
      if (gamePaused) return;
      setSpeedOrder(index);
    });
  });
  createSpeedHud(this);
  updateSpeedHud();
  createFiringHud(this);
  createCannotAimHud(this);
  createPauseOverlay(this);
  startScreenMenu = window.createStartScreen(
    this,
    startGame,
    () => window.electronAPI?.exitGame(),
  );
  this.anims.pauseAll();
  this.time.paused = true;
  this.input.keyboard.on("keydown-ESC", () => {
    if (startScreenActive) return;
    togglePause();
  });
  this.input.keyboard.on("keydown-TAB", (event) => {
    event.preventDefault();
    if (gamePaused || event.repeat) return;
    focusCameraOnTab(this.cameras.main);
  });
  this.input.keyboard.on("keydown-T", (event) => {
    event.preventDefault();
    if (gamePaused || event.repeat) return;
    setTacticalDisplay(this, !tacticalDisplayActive);
  });
  this.input.keyboard.on("keydown-F", () => { if (!gamePaused) toggleFiringMode(); });
  this.input.keyboard.on("keydown-X", () => { if (!gamePaused) stopFiring(); });
  this.input.keyboard.on("keydown-S", () => { if (!gamePaused) stopSelectedShips(); });
  //this.input.keyboard.on("keydown-PERIOD", killSelectedShips); // debug: force-sink selected ships
  this.input.keyboard.on("keydown", (event) => {
    if (gamePaused || event.code !== "AltLeft" || firingArcDebugActive) return;
    event.preventDefault();
    firingArcDebugActive = true;
    drawFiringArcDebug(this);
  });
  this.input.keyboard.on("keyup", (event) => {
    if (gamePaused || event.code !== "AltLeft" || !firingArcDebugActive) return;
    event.preventDefault();
    firingArcDebugActive = false;
    clearFiringArcDebug();
  });

  this.input.on("pointerdown", (pointer) => {
    if (gamePaused || suppressGameplayPointer || contextMenuConsumedPointer) return;
    if (shipContextMenu && shipContextMenu.panel.visible) {
      closeShipContextMenu();
      return;
    }
    if (pointer.middleButtonDown()) {
      cameraFocusShip = null;
      cameraPanTarget = null;
      panStart = { x: pointer.x, y: pointer.y };
      return;
    }
    if (isPointerOverSpeedHud(pointer)) {
      return;
    }
    if (pointer.rightButtonDown()) {
      if (tacticalDisplayActive) {
        issueMoveOrder(pointer.worldX, pointer.worldY, Boolean(pointer.event && pointer.event.shiftKey));
        return;
      }
      if (firingModeActive) {
        issueFireOrder(pointer.worldX, pointer.worldY);
      } else {
        const clickedShip = findShipAt(pointer.worldX, pointer.worldY);
        if (clickedShip) {
          openShipContextMenu(clickedShip, pointer.x, pointer.y);
          return;
        }
        issueMoveOrder(pointer.worldX, pointer.worldY, Boolean(pointer.event && pointer.event.shiftKey));
      }
      return;
    }

    if (tacticalDisplayActive) {
      cameraFocusShip = null;
      cameraPanTarget = null;
      panStart = { x: pointer.x, y: pointer.y };
    }

    const shiftHeld = Boolean(pointer.event && pointer.event.shiftKey);

    // Find the ship under the click, if any (closest one wins if overlapping)
    let clickedShip = null;
    let clickedDist = Infinity;
    ships.forEach((ship) => {
      if (ship.sinking || ship.sunk) return;
      if (tacticalDisplayActive && ship.team !== TEAMS.PLAYER) return;
      const dist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, ship.sprite.x, ship.sprite.y);
      let hit;
      if (tacticalDisplayActive) {
        const iconSize = getTacticalSymbolScreenSize(this.cameras.main.zoom);
        const normalizedX = (pointer.worldX - ship.sprite.x) * this.cameras.main.zoom / (iconSize.width / 2);
        const normalizedY = (pointer.worldY - ship.sprite.y) * this.cameras.main.zoom / (iconSize.height / 2);
        hit = normalizedX * normalizedX + normalizedY * normalizedY <= 1;
      } else {
        hit = isWithinShipSelectionCircle(ship, pointer.worldX, pointer.worldY);
      }
      if (hit && dist < clickedDist) {
        clickedShip = ship;
        clickedDist = dist;
      }
    });

    if (shiftHeld) {
      if (clickedShip) {
        const idx = selectedShips.indexOf(clickedShip);
        if (idx === -1) {
          clickedShip.selectedRing.setVisible(!tacticalDisplayActive);
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
        clickedShip.selectedRing.setVisible(!tacticalDisplayActive);
        selectedShips.push(clickedShip);
      }
      setFiringMode(false);
    }

    if (cameraFocusShip && !selectedShips.includes(cameraFocusShip)) cameraFocusShip = null;

    updateSpeedHud();
    updateDispersionEllipseVisibility();
    updateSelectionOverlayVisibility();
  });

  this.input.on("pointermove", (pointer) => {
    if (gamePaused || suppressGameplayPointer) return;
    if (panStart) {
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - panStart.x) / camera.zoom;
      camera.scrollY -= (pointer.y - panStart.y) / camera.zoom;
      panStart = { x: pointer.x, y: pointer.y };
    }
  });

  const finishSelection = (pointer) => {
    if (contextMenuConsumedPointer) {
      contextMenuConsumedPointer = false;
      return;
    }
    if (suppressGameplayPointer) {
      suppressGameplayPointer = false;
      return;
    }
    if (gamePaused) return;
    if (panStart) {
      panStart = null;
    }
  };

  this.input.on("pointerup", finishSelection);
  this.input.on("pointerupoutside", finishSelection);

  // Disable the browser right-click context menu so right-click can be used for move orders
  this.input.mouse.disableContextMenu();
}

function createOceanWaves(scene) {
  oceanWaves = [];
  oceanWaveChunks = new Map();
  oceanWaveChunkWindow = "";
  oceanWaveDirection = Phaser.Math.FloatBetween(0, Math.PI * 2);
  streamOceanWaves(scene.cameras.main, scene);
}

function isWithinOceanEffectRange(x, y, camera, margin = OCEAN_WAVE_CHUNK_SIZE) {
  const left = camera.scrollX - margin;
  const top = camera.scrollY - margin;
  const right = camera.scrollX + camera.width / camera.zoom + margin;
  const bottom = camera.scrollY + camera.height / camera.zoom + margin;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function streamOceanWaves(camera, scene) {
  if (tacticalDisplayActive) return;
  const left = Math.max(0, camera.scrollX - OCEAN_WAVE_CHUNK_SIZE * OCEAN_WAVE_CHUNK_BUFFER);
  const top = Math.max(0, camera.scrollY - OCEAN_WAVE_CHUNK_SIZE * OCEAN_WAVE_CHUNK_BUFFER);
  const right = Math.min(
    MAP_WIDTH - 1,
    camera.scrollX + camera.width / camera.zoom + OCEAN_WAVE_CHUNK_SIZE * OCEAN_WAVE_CHUNK_BUFFER,
  );
  const bottom = Math.min(
    MAP_HEIGHT - 1,
    camera.scrollY + camera.height / camera.zoom + OCEAN_WAVE_CHUNK_SIZE * OCEAN_WAVE_CHUNK_BUFFER,
  );
  const minChunkX = Math.max(0, Math.floor(left / OCEAN_WAVE_CHUNK_SIZE));
  const minChunkY = Math.max(0, Math.floor(top / OCEAN_WAVE_CHUNK_SIZE));
  const maxChunkX = Math.floor(right / OCEAN_WAVE_CHUNK_SIZE);
  const maxChunkY = Math.floor(bottom / OCEAN_WAVE_CHUNK_SIZE);
  const desiredKeys = [];
  for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      desiredKeys.push(`${chunkX},${chunkY}`);
    }
  }
  const windowKey = desiredKeys.join("|");
  if (windowKey === oceanWaveChunkWindow) return;

  // Create incoming chunks before removing old ones so nearby chunks can
  // preserve the minimum spacing at their shared borders.
  desiredKeys.forEach((key) => {
    if (!oceanWaveChunks.has(key)) {
      const [chunkX, chunkY] = key.split(",").map(Number);
      oceanWaveChunks.set(key, createOceanWaveChunk(scene, chunkX, chunkY));
    }
  });
  oceanWaveChunks.forEach((chunk, key) => {
    if (desiredKeys.includes(key)) return;
    chunk.waves.forEach((wave) => wave.sprite.destroy());
    oceanWaveChunks.delete(key);
  });
  oceanWaves = [];
  oceanWaveChunks.forEach((chunk) => oceanWaves.push(...chunk.waves));
  oceanWaveChunkWindow = windowKey;
}

function createOceanWaveChunk(scene, chunkX, chunkY) {
  const x = chunkX * OCEAN_WAVE_CHUNK_SIZE;
  const y = chunkY * OCEAN_WAVE_CHUNK_SIZE;
  const width = Math.min(OCEAN_WAVE_CHUNK_SIZE, MAP_WIDTH - x);
  const height = Math.min(OCEAN_WAVE_CHUNK_SIZE, MAP_HEIGHT - y);
  const targetCount = Math.max(1, Math.round(width * height / (OCEAN_WAVE_SPACING ** 2)));
  const clusters = Array.from({ length: Math.ceil(targetCount / 14) }, () => ({
    x: x + Math.random() * width,
    y: y + Math.random() * height,
  }));
  const positions = [];
  const minDistanceSquared = OCEAN_WAVE_MIN_DISTANCE * OCEAN_WAVE_MIN_DISTANCE;
  const hasClearance = (x, y) => {
    for (const position of positions) {
      const dx = x - position.x;
      const dy = y - position.y;
      if (dx * dx + dy * dy < minDistanceSquared) return false;
    }
    for (const wave of oceanWaves) {
      const dx = x - wave.sprite.x;
      const dy = y - wave.sprite.y;
      if (dx * dx + dy * dy < minDistanceSquared) return false;
    }
    return true;
  };

  let attempts = 0;
  const maxAttempts = targetCount * 40;
  while (positions.length < targetCount && attempts < maxAttempts) {
    attempts += 1;
    const candidate = {
      x: x + Math.random() * width,
      y: y + Math.random() * height,
    };
    if (hasClearance(candidate.x, candidate.y)) positions.push(candidate);
  }

  const chunk = { x, y, width, height, clusters, waves: [] };
  positions.forEach((position) => {
    const size = Phaser.Math.Between(OCEAN_WAVE_SIZE * 0.8, OCEAN_WAVE_SIZE * 1.2);
    const maxAlpha = getOceanWaveMaxAlphaAt(position.x, position.y, clusters);
    const lifetime = Phaser.Math.FloatBetween(35, 60);
    const age = Phaser.Math.FloatBetween(OCEAN_WAVE_FADE_DURATION, lifetime - OCEAN_WAVE_FADE_DURATION);
    const sprite = scene.add.sprite(position.x, position.y, "ocean-wave")
      .setDisplaySize(size, size)
      .setRotation(oceanWaveDirection + Phaser.Math.FloatBetween(-0.12, 0.12))
      .setTint(randomOceanWaveTint())
      .setAlpha(getOceanWaveAlpha(age, lifetime, maxAlpha))
      .setDepth(OCEAN_WAVE_DEPTH);
    sprite.play("ocean-wave", true, Phaser.Math.Between(0, 5));
    worldContainer.add(sprite);
    const wave = { sprite, age, lifetime, maxAlpha, chunk };
    chunk.waves.push(wave);
    oceanWaves.push(wave);
  });
  return chunk;
}

function getOceanWaveMaxAlphaAt(x, y, clusters) {
  const clusterRadiusSquared = 400 * 400;
  const belongsToCluster = clusters.some((cluster) => {
    const dx = x - cluster.x;
    const dy = y - cluster.y;
    return dx * dx + dy * dy <= clusterRadiusSquared;
  });
  return belongsToCluster
    ? Phaser.Math.FloatBetween(0.28, 0.46)
    : Phaser.Math.FloatBetween(0.12, 0.24);
}

function updateOceanWaves(scene, dt) {
  if (tacticalDisplayActive) return;
  streamOceanWaves(scene.cameras.main, scene);
  oceanWaves.forEach((wave) => {
    const sprite = wave.sprite;
    wave.age += dt;
    if (wave.age >= wave.lifetime) {
      const spawnPosition = findOceanWaveSpawnPosition(wave);
      sprite.setPosition(spawnPosition.x, spawnPosition.y);
      wave.age = 0;
      wave.lifetime = Phaser.Math.FloatBetween(35, 60);
      wave.maxAlpha = getOceanWaveMaxAlphaAt(spawnPosition.x, spawnPosition.y, wave.chunk.clusters);
      sprite.setTint(randomOceanWaveTint());
    }
    sprite.setAlpha(getOceanWaveAlpha(wave.age, wave.lifetime, wave.maxAlpha));

    const nearSinkingShip = ships.some((ship) => {
      if (!ship.sinking || ship.sunk) return false;
      const dx = sprite.x - ship.sprite.x;
      const dy = sprite.y - ship.sprite.y;
      const clearance = OCEAN_WAVE_CLEARANCE + Math.max(ship.stats.displayWidth, ship.stats.displayHeight) / 2;
      return dx * dx + dy * dy < clearance * clearance;
    });
    sprite.setVisible(!tacticalDisplayActive && !nearSinkingShip);
  });

}

function findOceanWaveSpawnPosition(excludedWave) {
  const minDistanceSquared = OCEAN_WAVE_MIN_DISTANCE * OCEAN_WAVE_MIN_DISTANCE;
  const chunk = excludedWave.chunk;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = Phaser.Math.Between(chunk.x, chunk.x + chunk.width);
    const y = Phaser.Math.Between(chunk.y, chunk.y + chunk.height);
    const overlapsWave = oceanWaves.some((wave) => {
      if (wave === excludedWave) return false;
      const dx = x - wave.sprite.x;
      const dy = y - wave.sprite.y;
      return dx * dx + dy * dy < minDistanceSquared;
    });
    if (!overlapsWave) return { x, y };
  }
  return { x: excludedWave.sprite.x, y: excludedWave.sprite.y };
}

function getOceanWaveAlpha(age, lifetime, maxAlpha) {
  const fadeIn = Phaser.Math.Clamp(age / OCEAN_WAVE_FADE_DURATION, 0, 1);
  const fadeOut = Phaser.Math.Clamp((lifetime - age) / OCEAN_WAVE_FADE_DURATION, 0, 1);
  return maxAlpha * Math.min(fadeIn, fadeOut);
}

function randomOceanWaveTint() {
  const lightness = Phaser.Math.Between(210, 255);
  return lightness * 0x010101;
}

function update(time, delta) {
  updateSpeedOrderCooldownVisuals();
  if (gamePaused) return;
  const dt = delta / 1000;
  enemyAI.update(this, dt);
  ships.forEach((ship) => updateShip(ship, dt));
  ships = ships.filter((ship) => !ship.sunk);
  updateCameraFocus(this.cameras.main, dt);
  updateCameraPan(this.cameras.main, cameraPanKeys, dt);
  updateCameraZoom(this.cameras.main, cameraZoomKeys, dt);
  enforceTacticalZoomBounds(this.cameras.main);
  updateOceanWaves(this, dt);
  updateTacticalSymbols(this.cameras.main);
  resolveShipCollisions(dt);
  updateShells(dt);
  updateAttachedHitExplosions();
  updateWakes(dt);
  if (firingArcDebugActive) drawFiringArcDebug(this);
}

// ---- Ship creation & behavior ----

// typeId is a key into SHIP_TYPES (see ship-types.js), e.g. "pennsylvania".
function createShip(scene, x, y, typeId, team = TEAMS.PLAYER, initialRotation = 0) {
  const stats = SHIP_TYPES[typeId];
  if (!stats) {
    throw new Error(`createShip: unknown ship type "${typeId}"`);
  }

  // Hull: one static image, never re-textured while the ship is under way.
  const sprite = scene.add.sprite(x, y, stats.textures.hullStationary)
    .setDisplaySize(stats.displayWidth, stats.displayHeight)
    .setDepth(2)
    .setRotation(initialRotation);

  const symbolTexture = TACTICAL_SYMBOL_TEXTURES[Phaser.Math.Clamp(stats.shipClass, 0, 3)];
  const tacticalSymbol = scene.add.image(x, y, symbolTexture)
    .setDisplaySize(TACTICAL_SYMBOL_WIDTH, TACTICAL_SYMBOL_HEIGHT)
    .setDepth(3)
    .setVisible(false);
  tacticalSymbol.setTint(team === TEAMS.PLAYER ? 0x62f0c8 : 0xff625f);
  const tacticalOutlineGlow = scene.add.image(x, y, "tactical-selection-outline")
    .setDisplaySize(TACTICAL_OUTLINE_WIDTH, TACTICAL_OUTLINE_HEIGHT)
    .setDepth(3.1)
    .setVisible(false);

  // Wake: separate sprite drawn just above the hull, hidden until the ship
  // moves. Owns every animation (moving loop, slowdown, acceleration).
  const wakeSprite = scene.add.sprite(x, y, stats.textures.wakeMoving, 0)
    .setDisplaySize(stats.displayWidth, stats.displayHeight)
    .setDepth(2.05) // above hull (2), below turrets (2.4+)
    .setRotation(initialRotation)
    .setVisible(false);

  const turrets = createTurrets(scene, x, y, stats);
  const cos = Math.cos(initialRotation);
  const sin = Math.sin(initialRotation);
  turrets.forEach((turret) => {
    turret.sprite.setPosition(
      x + turret.dx * cos - turret.dy * sin,
      y + turret.dx * sin + turret.dy * cos,
    );
    turret.sprite.setRotation(initialRotation + turret.rotationOffset);
  });

  const selectionTexture = team === TEAMS.ENEMY ? "selection-circle-enemy" : "selection-circle";
  const selectedRing = scene.add.image(x, y, selectionTexture)
    .setDisplaySize(120, 120)
    .setDepth(3);
  selectedRing.setVisible(false);

  const hostileRing = scene.add.image(x, y, "selection-circle-enemy")
    .setDisplaySize(140, 140)
    .setDepth(2.9)
    .setVisible(false);

  const minRangeCircle = drawPixelatedCircleOutline(scene, stats.minFiringDistance,  0xEBBE4D)
    .setDepth(4)
    .setVisible(false);

  const maxRangeCircle = drawPixelatedCircleOutline(scene, stats.maxFiringDistance, 0xFF0000)
    .setDepth(4)
    .setVisible(false);

  const healthBar = scene.add.graphics().setDepth(3.5).setVisible(false);

  worldContainer.add([
    sprite, wakeSprite, hostileRing, selectedRing, minRangeCircle, maxRangeCircle,
    healthBar, tacticalOutlineGlow, tacticalSymbol,
  ]);

  return {
    sprite,
    tacticalSymbol,
    tacticalOutlineGlow,
    wakeSprite,
    turrets,
    stats,
    shipClass: stats.shipClass,
    barrelLocalOffsets: computeBarrelLocalOffsets(stats),
    selectedRing,
    hostileRing,
    minRangeCircle,
    maxRangeCircle,
    healthBar,
    target: null,
    waypoints: [],
    pathPreviewDirty: true,
    pathPreviewPoints: null,
    pathPreviewStart: null,
    pathPreviewLastRedrawAt: -Infinity,
    pathPreviewLastDrawPosition: null,
    pathPreviewDrawIndex: 0,
    pathPreviewAvoidance: { x: 0, y: 0 },
    pathPreviewAvoidanceCheckAt: -Infinity,
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
    rudderRampTimeSeconds: stats.rudderRampTimeSeconds,
    rudder: 0,
    speedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
    speedOrderCooldownUntil: 0,
    collisionRadius: stats.collisionRadius,
    team,
    identified: team !== TEAMS.ENEMY,
    hostile: false,
    continueStraightAfterWaypoint: false,
    pendingWaypointSpeedOrder: false,
    waypointSpeedOrderDueAt: 0,
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
  const tacticalScale = tacticalDisplayActive ? 1 / sprite.scene.cameras.main.zoom : 1;
  const tacticalIconSize = tacticalDisplayActive
    ? getTacticalSymbolScreenSize(sprite.scene.cameras.main.zoom)
    : null;
  const barX = -HEALTH_BAR_WIDTH / 2;
  const barY = tacticalDisplayActive
    ? -(tacticalIconSize.height / 2 + HEALTH_BAR_HEIGHT + 2)
    : -sprite.displayHeight / 2 + HEALTH_BAR_OFFSET_Y;
  const healthFraction = Phaser.Math.Clamp(health / maxHealth, 0, 1);

  healthBar.setPosition(sprite.x, sprite.y);
  healthBar.setScale(tacticalScale);
  healthBar.setRotation(0);
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
    const aimPoint = getFireAimPoint(ship, turret.sprite.x, turret.sprite.y);

    const currentLocal = Phaser.Math.Clamp(
      Phaser.Math.Angle.Wrap(turret.sprite.rotation - reference),
      -halfArc,
      halfArc,
    );

    let targetLocal;
    let withinArc;

    if (ship.fireTarget) {

      const rawAngleToTarget = Phaser.Math.Angle.Between(
        turret.sprite.x, turret.sprite.y, aimPoint.x, aimPoint.y
      ) - Math.PI / 2;
      const localAngle = Phaser.Math.Angle.Wrap(rawAngleToTarget - reference);
      withinArc = Math.abs(localAngle) <= halfArc;

      if (withinArc) {
        targetLocal = localAngle;
      } else {
        const shipAngleToTarget = Phaser.Math.Angle.Between(
          ship.sprite.x, ship.sprite.y, aimPoint.x, aimPoint.y
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
  const message = "FIRING MODE - RIGHT-CLICK TO AIM, F TO TOGGLE, X TO STOP FIRING";
  const textWidth = PixelFont.measureLine(message, 2);
  firingModeIndicatorBackground = scene.add.rectangle(
    config.width / 2, 28, textWidth + 24, 36, 0x7a1010,
  ).setDepth(9).setVisible(false);
  firingModeIndicator = PixelFont.create(scene, message, {
    x: config.width / 2, y: 21, pixelSize: 2, color: 0xffffff, depth: 10, align: "center",
  }).setVisible(false);
  scene.cameras.main.ignore([firingModeIndicatorBackground, firingModeIndicator]);
}

function setFiringMode(active) {
  if (active && selectedShips.some((ship) => ship.team === TEAMS.ENEMY)) return;
  if (active && getCommandableShips().length === 0) return;
  firingModeActive = active;
  if (firingModeIndicator) firingModeIndicator.setVisible(firingModeActive);
  if (firingModeIndicatorBackground) firingModeIndicatorBackground.setVisible(firingModeActive);
  updateSpeedHud();
}

function toggleFiringMode() {
  setFiringMode(!firingModeActive);
}
function stopFiring() {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return;

  commandableShips.forEach((ship) => {
    ship.fireTarget = null;
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.destroy();
      ship.dispersionEllipse = null;
    }
  });
}

function issueFireOrder(x, y) {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return;

  const targetShip = ships
    .filter((candidate) => candidate.hostile && !candidate.sinking && !candidate.sunk)
    .filter((candidate) => isWithinShipSelectionCircle(candidate, x, y))
    .sort((a, b) =>
      Phaser.Math.Distance.Between(x, y, a.sprite.x, a.sprite.y)
      - Phaser.Math.Distance.Between(x, y, b.sprite.x, b.sprite.y)
    )[0] || null;
  const targetX = targetShip ? targetShip.sprite.x : x;
  const targetY = targetShip ? targetShip.sprite.y : y;

  commandableShips.forEach((ship) => {
    if (targetShip === ship) return;
    const distanceFromShip = Phaser.Math.Distance.Between(ship.sprite.x, ship.sprite.y, targetX, targetY);
    if (distanceFromShip < ship.stats.minFiringDistance || distanceFromShip > ship.stats.maxFiringDistance) {
      flashCannotAimMessage(ship.sprite.scene);
      return; // leaves ship.fireTarget (and its dispersion ellipse) exactly as it was
    }

    const sameTarget = ship.fireTarget && (targetShip
      ? ship.fireTarget.targetShip === targetShip
      : !ship.fireTarget.targetShip && Phaser.Math.Distance.Between(ship.fireTarget.x, ship.fireTarget.y, targetX, targetY) <= FIRE_TARGET_TOGGLE_RADIUS);
    if (sameTarget) {
      ship.fireTarget = null;
      if (ship.dispersionEllipse) {
        ship.dispersionEllipse.destroy();
        ship.dispersionEllipse = null;
      }
    } else {
      ship.fireTarget = createFireTarget(targetX, targetY, targetShip);
      refreshShipDispersionEllipse(ship);
    }
  });
}

function syncFireTarget(ship) {
  const targetShip = ship.fireTarget && ship.fireTarget.targetShip;
  if (!targetShip) return;
  if (targetShip.sinking || targetShip.sunk) {
    ship.fireTarget = null;
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.destroy();
      ship.dispersionEllipse = null;
    }
    return;
  }
  ship.fireTarget.x = targetShip.sprite.x;
  ship.fireTarget.y = targetShip.sprite.y;
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
  const cos = Math.cos(turret.sprite.rotation);
  const sin = Math.sin(turret.sprite.rotation);
  ship.barrelLocalOffsets.forEach((barrel) => {
    const muzzleX = turret.sprite.x + barrel.dx * cos - barrel.dy * sin;
    const muzzleY = turret.sprite.y + barrel.dx * sin + barrel.dy * cos;
    const aimPoint = getFireAimPoint(ship, muzzleX, muzzleY);
    const targetX = aimPoint.x;
    const targetY = aimPoint.y;
    const distance = Phaser.Math.Distance.Between(muzzleX, muzzleY, targetX, targetY);
    const dispersion = getDispersionOffset(
      distance,
      Phaser.Math.Angle.Between(muzzleX, muzzleY, targetX, targetY),
      ship.stats.dispersionCurve,
      ship.stats.dispersionSigma,
      ship.fireTarget.dispersionFactor ?? 1,
    );
    spawnShell(scene, muzzleX, muzzleY, targetX + dispersion.x, targetY + dispersion.y, ship.stats.shellAlpha);
  });
}

function getFireAimPoint(ship, originX, originY) {
  const fireTarget = ship.fireTarget;
  if (!fireTarget) return null;

  const targetShip = fireTarget.targetShip;
  if (!targetShip || targetShip.speed <= 0) {
    return { x: fireTarget.x, y: fireTarget.y };
  }

  const targetX = targetShip.sprite.x;
  const targetY = targetShip.sprite.y;
  const { vx, vy } = getShipVelocity(targetShip);
  const relativeX = targetX - originX;
  const relativeY = targetY - originY;
  const a = vx * vx + vy * vy - SHELL_SPEED * SHELL_SPEED;
  const b = 2 * (relativeX * vx + relativeY * vy);
  const c = relativeX * relativeX + relativeY * relativeY;
  const discriminant = b * b - 4 * a * c;
  const interceptTimes = [];

  if (Math.abs(a) < 0.000001) {
    if (Math.abs(b) > 0.000001) interceptTimes.push(-c / b);
  } else if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    interceptTimes.push((-b - root) / (2 * a), (-b + root) / (2 * a));
  }

  const interceptTime = interceptTimes.filter((time) => time > 0).sort((x, y) => x - y)[0]
    || Math.sqrt(c) / SHELL_SPEED;
  const leadTime = interceptTime * AIM_LEAD_FACTOR;
  return {
    x: targetX + vx * leadTime,
    y: targetY + vy * leadTime,
  };
}

function getShipTargetBearing(ship) {
  if (!ship.fireTarget) return ship.sprite.rotation;
  const aimPoint = getFireAimPoint(ship, ship.sprite.x, ship.sprite.y);
  return Phaser.Math.Angle.Between(
    ship.sprite.x, ship.sprite.y, aimPoint.x, aimPoint.y
  );
}

// Returns the dispersion ellipse's semi-axes (world units) for a shot at
// the given range, using the given ship type's dispersion curve.
function getDispersionForRange(distance, curve, dispersionFactor = 1) {
  const applyCurve = ({ base, coefficient, exponent }) =>
    base + coefficient * Math.pow(distance, exponent);
  return {
    vertical: applyCurve(curve.vertical) * dispersionFactor,
    horizontal: applyCurve(curve.horizontal) * dispersionFactor,
  };
}

// Samples one random point-of-impact offset, in WORLD space, for a shot at
// the given range fired from a ship with the given heading, using the given
// ship type's dispersion curve and sigma (central-tendency shaping).
function getDispersionOffset(distance, shipRotation, curve, sigma, dispersionFactor = 1) {
  const { vertical, horizontal } = getDispersionForRange(distance, curve, dispersionFactor);
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
  const aimPoint = getFireAimPoint(ship, ship.sprite.x, ship.sprite.y);
  const distance = Phaser.Math.Distance.Between(
    ship.sprite.x, ship.sprite.y, aimPoint.x, aimPoint.y
  );
  const dispersionFactor = ship.fireTarget.dispersionFactor ?? 1;
  const { vertical, horizontal } = getDispersionForRange(
    distance, ship.stats.dispersionCurve, dispersionFactor,
  );

  if (ship.dispersionEllipse) {
    ship.dispersionEllipse.destroy();
  }

  ship.dispersionEllipse = drawDispersionEllipseGraphics(scene, vertical, horizontal);
  ship.dispersionEllipse.setPosition(aimPoint.x, aimPoint.y);
  ship.dispersionEllipse.setRotation(getShipTargetBearing(ship));
  ship.dispersionEllipse.setVisible(selectedShips.includes(ship));
  worldContainer.add(ship.dispersionEllipse);
  ship.dispersionEllipseRangeAtBuild = distance;
  ship.dispersionEllipseFactorAtBuild = dispersionFactor;
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

  const aimPoint = getFireAimPoint(ship, ship.sprite.x, ship.sprite.y);
  ship.dispersionEllipse.setPosition(aimPoint.x, aimPoint.y);
  ship.dispersionEllipse.setRotation(getShipTargetBearing(ship));

  const distance = Phaser.Math.Distance.Between(
    ship.sprite.x, ship.sprite.y, aimPoint.x, aimPoint.y
  );
  const dispersionFactor = ship.fireTarget.dispersionFactor ?? 1;
  if (Math.abs(distance - ship.dispersionEllipseRangeAtBuild) > 5
      || Math.abs(dispersionFactor - (ship.dispersionEllipseFactorAtBuild ?? 1)) >= 0.025) {
    refreshShipDispersionEllipse(ship);
  }
}

// Syncs every ship's dispersion ellipse visibility to the current
// selection.
function updateDispersionEllipseVisibility() {
  ships.forEach((ship) => {
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.setVisible(!tacticalDisplayActive && selectedShips.includes(ship));
    }
  });
}

function spawnShell(scene, x, y, targetX, targetY, damage) {
  const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
  const sprite = shellSpritePool.pop() || scene.add.sprite(0, 0, "shell");
  sprite.setPosition(x, y)
    .setDisplaySize(shellDisplayWidth, shellDisplayHeight)
    .setRotation(angle + Math.PI / 2)
    .setDepth(2.8)
    .setAlpha(1)
    .setVisible(true);
  if (!sprite.parentContainer && !worldContainer.list.includes(sprite)) worldContainer.add(sprite);
  activeShells.push({
    sprite,
    vx: Math.cos(angle) * SHELL_SPEED,
    vy: Math.sin(angle) * SHELL_SPEED,
    targetX,
    targetY,
    damage,
  });
}

function initializeShellSpritePool(scene) {
  shellSpritePool = [];
  for (let index = 0; index < SHELL_SPRITE_POOL_SIZE; index += 1) {
    const sprite = scene.add.sprite(0, 0, "shell").setVisible(false).setDepth(2.8);
    worldContainer.add(sprite);
    shellSpritePool.push(sprite);
  }
}

function updateShells(dt) {
  for (let i = activeShells.length - 1; i >= 0; i -= 1) {
    const shell = activeShells[i];
    const step = SHELL_SPEED * dt;
    const dx = shell.targetX - shell.sprite.x;
    const dy = shell.targetY - shell.sprite.y;
    if (step * step >= dx * dx + dy * dy) {
      resolveShellSplash(shell);
      shell.sprite.setVisible(false);
      shellSpritePool.push(shell.sprite);
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
const hullPixelMaskCache = {};

function buildHullRowProfile(scene, stats) {
  const texKey = stats.textures.hullStationary;
  if (hullRowProfileCache[texKey]) return hullRowProfileCache[texKey];

  const halfHeight = stats.displayHeight / 2;
  const halfWidth = stats.displayWidth / 2;
  const columns = Math.floor(stats.displayWidth / SINK_PIXEL) + 1;
  const profile = [];
  const pixelMask = {
    originX: -halfWidth,
    originY: -halfHeight,
    columns,
    rows: [],
  };
  hullPixelMaskCache[texKey] = pixelMask;
  for (let localY = -halfHeight; localY <= halfHeight; localY += SINK_PIXEL) {
    const maskRow = new Uint8Array(columns);
    let left = null;
    let right = null;
    for (let column = 0; column < columns; column += 1) {
      const localX = -halfWidth + column * SINK_PIXEL;
      if (!isHullTextureHitAtLocal(scene, stats, localX, localY)) continue;
      maskRow[column] = 1;
      if (left === null) left = localX;
      right = localX;
    }
    pixelMask.rows.push(maskRow);
    if (left !== null) {
      profile.push({ localY, left, right });
    }
  }

  hullRowProfileCache[texKey] = profile;
  return profile;
}

function isHullPixelMaskHitAtLocal(stats, localX, localY) {
  const mask = hullPixelMaskCache[stats.textures.hullStationary];
  if (!mask) return false;
  const column = Math.round((localX - mask.originX) / SINK_PIXEL);
  const row = Math.round((localY - mask.originY) / SINK_PIXEL);
  return row >= 0 && row < mask.rows.length
    && column >= 0 && column < mask.columns
    && mask.rows[row][column] === 1;
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

  const rawEdgeX = ship.listSide === 1 ? row.right - depth : row.left + depth;
  const edgeX = rawEdgeX - ship.listSide * SINK_WATER_OVERLAP;
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
        spawnHitExplosion(scene, shell.targetX, shell.targetY, ship);
      }
    } else {
      ship.health = Math.max(0, ship.health - shell.damage);
      spawnHitExplosion(scene, shell.targetX, shell.targetY, ship);
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
  registerTacticalHiddenEffect(sprite);
  sprite.play("splash");
  sprite.once("animationcomplete", () => destroyTacticalHiddenEffect(sprite));
}

function spawnHitExplosion(scene, x, y, ship) {
  const sprite = scene.add.sprite(x, y, "hit-explosion")
    .setDisplaySize(HIT_EXPLOSION_DISPLAY_SIZE, HIT_EXPLOSION_DISPLAY_SIZE)
    .setDepth(2.9); // above hulls (2) and shells (2.8), below turrets (2.4+ already covers this ship's own turrets since it's higher — see note below)
  worldContainer.add(sprite);
  registerTacticalHiddenEffect(sprite);
  sprite.play("hit-explosion");
  const impactOffset = toShipLocal(ship, x, y);
  const attachment = { sprite, ship, localX: impactOffset.x, localY: impactOffset.y };
  attachedHitExplosions.add(attachment);
  sprite.once("animationcomplete", () => {
    attachedHitExplosions.delete(attachment);
    destroyTacticalHiddenEffect(sprite);
  });
}

function updateAttachedHitExplosions() {
  attachedHitExplosions.forEach((attachment) => {
    const { ship, sprite, localX, localY } = attachment;
    if (ship.sunk || !ship.sprite.active) {
      attachedHitExplosions.delete(attachment);
      destroyTacticalHiddenEffect(sprite);
      return;
    }
    const cos = Math.cos(ship.sprite.rotation);
    const sin = Math.sin(ship.sprite.rotation);
    sprite.setPosition(
      ship.sprite.x + localX * cos - localY * sin,
      ship.sprite.y + localX * sin + localY * cos,
    );
  });
}

function registerTacticalHiddenEffect(sprite) {
  tacticalHiddenEffects.add(sprite);
  sprite.setVisible(!tacticalDisplayActive);
}

function destroyTacticalHiddenEffect(sprite) {
  tacticalHiddenEffects.delete(sprite);
  sprite.destroy();
}

// ---- Wake trail ----
// (Procedural foam trail left behind the stern. Separate from the animated
// wake sprite that rides on each ship — see ship.wakeSprite.)
let activeWakes = [];
const WAKE_LIFETIME = 10; // seconds until a wake segment fully fades
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

  const wakeDriftAngle = ship.sprite.rotation + Math.PI / 2
    + Phaser.Math.FloatBetween(-0.45, 0.45);
  const wakeDriftSpeed = Phaser.Math.FloatBetween(1, 2) * widthScale;

  activeWakes.push({
    graphics,
    age: 0,
    maxAlpha: Phaser.Math.Linear(0.25, 0.6, speedFraction),
    driftX: Math.cos(wakeDriftAngle) * wakeDriftSpeed,
    driftY: Math.sin(wakeDriftAngle) * wakeDriftSpeed,
  });
  graphics.setVisible(!tacticalDisplayActive
    && isWithinOceanEffectRange(x, y, scene.cameras.main));
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
    const shouldGenerateWake = ship.team === TEAMS.ENEMY
      || isWithinOceanEffectRange(ship.sprite.x, ship.sprite.y, ship.sprite.scene.cameras.main);
    if (!tacticalDisplayActive && shouldGenerateWake) {
      spawnWake(ship);
    }
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

    const camera = wake.graphics.scene.cameras.main;
    const nearCamera = !tacticalDisplayActive
      && isWithinOceanEffectRange(wake.graphics.x, wake.graphics.y, camera);
    wake.graphics.setVisible(nearCamera);
    if (!nearCamera) continue;

    // Drift back and outward from the stern while fading and expanding.
    wake.graphics.x += wake.driftX * dt;
    wake.graphics.y += wake.driftY * dt;
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
  ship.sinking = true;
  ship.deathDriftSpeed = ship.speed;
  ship.deathDriftHeading = ship.sprite.rotation - Math.PI / 2;
  ship.deathDriftElapsed = 0;
  ship.deathDriftRemaining = ship.deathDriftSpeed * DEATH_DRIFT_SECONDS / 2;
  const explosionSize = Math.max(ship.stats.displayWidth, ship.stats.displayHeight) * 0.6;
  const explosionSprite = scene.add.sprite(ship.sprite.x, ship.sprite.y, "explosion")
    .setDisplaySize(explosionSize, explosionSize)
    .setDepth(SINKING_EXPLOSION_DEPTH);
  worldContainer.add(explosionSprite);
  registerTacticalHiddenEffect(explosionSprite);
  explosionSprite.play("explosion");
  explosionSprite.once("animationcomplete", () => destroyTacticalHiddenEffect(explosionSprite));

  ship.listSide = Math.random() < 0.5 ? 1 : -1;
  ship.waterlineSeed = {
    a: Phaser.Math.FloatBetween(0, Math.PI * 2),
    b: Phaser.Math.FloatBetween(0, Math.PI * 2),
    c: Phaser.Math.FloatBetween(0, Math.PI * 2),
  };
  ship.continueStraightAfterWaypoint = false;
  ship.hostileRing.setVisible(false);
  ship.sinkElapsed = 0;
  ship.sinkProgress = 0;

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
  if (ship.deathDriftRemaining <= 0) startSinkingAnimation(ship, scene);
}

function startSinkingAnimation(ship, scene) {
  ship.sprite.setDepth(SINKING_HULL_DEPTH);
  ship.turrets.forEach((turret) => turret.sprite.setDepth(SINKING_TURRET_DEPTH));
  ship.wakeSprite.setVisible(false);
  ship.deathRotation = ship.sprite.rotation;

  ensureWaterOverlay(ship, scene);
}

function ensureWaterOverlay(ship, scene) {
  if (ship.waterOverlay && ship.waterOverlay.scene === scene) return ship.waterOverlay;
  ship.waterOverlay = scene.add.graphics().setDepth(SINKING_WATER_OVERLAY_DEPTH);
  ship.waterOverlay.setVisible(!tacticalDisplayActive);
  worldContainer.add(ship.waterOverlay);
  return ship.waterOverlay;
}

function waterlineOffset(seed, normalizedY, time) {
  const swell = Math.sin(normalizedY * 5 + seed.a + time * 0.5) * 0.5;
  const chop = Math.sin(normalizedY * 12 + seed.b - time * 1.1) * 0.3;
  const ripple = Math.sin(normalizedY * 23 + seed.c + time * 1.8) * 0.2;
  return swell + chop + ripple; // roughly in [-1, 1]
}

function redrawWaterOverlay(ship) {
  const { stats, waterOverlay, listSide, waterlineSeed, sinkProgress } = ship;
  if (!waterOverlay) return;
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
    const rawEdgeX = listSide === 1 ? right - depth : left + depth;
    const edgeX = rawEdgeX - listSide * SINK_WATER_OVERLAP;
    rows.push({ localY, edgeX, outerX, rowWidth });
  });


  // Build one continuous polygon from the outer hull edge to the waterline.
  // A small margin beyond the cached hull silhouette closes gaps at the bow,
  // stern, and far side while keeping this a single generated fill shape.
  waterOverlay.fillStyle(0x06345a, 1);
  waterOverlay.beginPath();
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const outerEdgeX = (row) => row.outerX + listSide * SINK_WATER_MARGIN;
  const topY = firstRow.localY - half - SINK_WATER_MARGIN;
  const bottomY = lastRow.localY + half + SINK_WATER_MARGIN;
  waterOverlay.moveTo(outerEdgeX(firstRow), topY);
  rows.forEach((row, index) => {
    const y = index === rows.length - 1 ? bottomY : row.localY;
    waterOverlay.lineTo(outerEdgeX(row), y);
  });
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const y = index === 0 ? topY : row.localY;
    waterOverlay.lineTo(row.edgeX, y);
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
      if (!isHullPixelMaskHitAtLocal(stats, crestX, localY)) continue;
      waterOverlay.fillStyle(0xdff3ff, Phaser.Math.FloatBetween(0.5, 0.85) * foamFade * edgeBlend);
      cell(crestX, localY);
    }
  });
}

// Advances the death sequence
function updateSinking(ship, dt) {
  if (ship.deathDriftRemaining > 0) {
    const elapsedBefore = ship.deathDriftElapsed;
    const driftDt = Math.min(dt, DEATH_DRIFT_SECONDS - elapsedBefore);
    const elapsedAfter = elapsedBefore + driftDt;
    // Linearly ease the ship's saved speed down to zero over the drift.
    const step = ship.deathDriftSpeed * (
      driftDt - (elapsedAfter * elapsedAfter - elapsedBefore * elapsedBefore)
        / (2 * DEATH_DRIFT_SECONDS)
    );
    ship.deathDriftElapsed = elapsedAfter;
    ship.speed = ship.deathDriftSpeed * (1 - elapsedAfter / DEATH_DRIFT_SECONDS);
    ship.moving = ship.speed > 0;
    updateShipWake(ship, driftDt);
    const radius = ship.collisionRadius;
    const previousX = ship.sprite.x;
    const previousY = ship.sprite.y;
    ship.sprite.x = Phaser.Math.Clamp(
      previousX + Math.cos(ship.deathDriftHeading) * step,
      radius,
      MAP_WIDTH - radius,
    );
    ship.sprite.y = Phaser.Math.Clamp(
      previousY + Math.sin(ship.deathDriftHeading) * step,
      radius,
      MAP_HEIGHT - radius,
    );
    const driftX = ship.sprite.x - previousX;
    const driftY = ship.sprite.y - previousY;
    ship.turrets.forEach((turret) => {
      turret.sprite.x += driftX;
      turret.sprite.y += driftY;
    });
    ship.deathDriftRemaining = Math.max(0, ship.deathDriftRemaining - step);
    if (elapsedAfter >= DEATH_DRIFT_SECONDS) {
      ship.deathDriftRemaining = 0;
      startSinkingAnimation(ship, ship.sprite.scene);
    }
    return;
  }

  ship.sinkElapsed += dt;
  ship.sinkProgress = Phaser.Math.Clamp(ship.sinkElapsed / SINK_DURATION, 0, 1);
  const scene = ship.sprite.scene;
  const camera = scene.cameras.main;
  const nearCamera = !tacticalDisplayActive
    && isWithinOceanEffectRange(ship.sprite.x, ship.sprite.y, camera);
  if (nearCamera) {
    ensureWaterOverlay(ship, scene);
    ship.waterOverlay.setVisible(true);
    const now = scene.time.now;
    if (now - ship.waterOverlayLastUpdate >= 50) {
      ship.waterOverlayLastUpdate = now;
      redrawWaterOverlay(ship);
    }
  } else if (ship.waterOverlay) {
    ship.waterOverlay.setVisible(false);
  }

  if (ship.sinkProgress >= 1) finishSinking(ship);
}

function finishSinking(ship) {
  ship.sprite.destroy();
  ship.tacticalSymbol.destroy();
  ship.tacticalOutlineGlow.destroy();
  ship.wakeSprite.destroy();
  ship.turrets.forEach((turret) => turret.sprite.destroy());
  ship.selectedRing.destroy();
  ship.hostileRing.destroy();
  ship.minRangeCircle.destroy();
  ship.maxRangeCircle.destroy();
  ship.healthBar.destroy();
  if (ship.waterOverlay) {
    ship.waterOverlay.destroy();
    ship.waterOverlay = null;
  }
  if (ship.pathLine) ship.pathLine.destroy();
  if (ship.dispersionEllipse) ship.dispersionEllipse.destroy();

  ship.sunk = true;
}

function isPointerOverSpeedHud(pointer) {
  const overButton = speedHudButtons && speedHudButtons.some(
    (button) => button.visible && button.getBounds().contains(pointer.x, pointer.y),
  );
  const overTitle = speedHudTitle?.visible
    && speedHudTitle.getBounds().contains(pointer.x, pointer.y);
  const overPopup = speedHudBackdrop?.visible
    && speedHudBackdrop.getBounds().contains(pointer.x, pointer.y);
  return Boolean(overButton || overTitle || overPopup);
}

// The speed a ship should currently be cruising at, based on its speed order.
function getCommandedSpeed(ship) {
  return ship.maxSpeed * SPEED_ORDERS[ship.speedOrderIndex].fraction;
}

function setShipSpeedOrder(ship, orderIndex) {
  if (ship.speedOrderIndex === orderIndex) return false;
  ship.speedOrderIndex = orderIndex;
  ship.pathPreviewDirty = true;
  if (ship.pathLine && ship.target) updatePathLine(ship);
  return true;
}

function setSpeedOrder(orderIndex) {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return;
  const eligibleShips = commandableShips.filter((ship) =>
    ship.sprite.scene.time.now >= ship.speedOrderCooldownUntil
      && ship.speedOrderIndex !== orderIndex,
  );
  if (eligibleShips.length === 0) return;

  eligibleShips.forEach((ship) => {
    setShipSpeedOrder(ship, orderIndex);
    ship.pendingWaypointSpeedOrder = false;
    ship.waypointSpeedOrderDueAt = 0;
    beginSpeedOrderCooldown(ship);
  });
}

function beginSpeedOrderCooldown(ship) {
  const scene = ship.sprite.scene;
  ship.speedOrderCooldownUntil = scene.time.now + SPEED_ORDER_COOLDOWN_MS;
  updateSpeedHud();
  scene.time.delayedCall(SPEED_ORDER_COOLDOWN_MS, updateSpeedHud);
}

function requestWaypointCruiseSpeed(ship) {
  if (ship.team !== TEAMS.PLAYER) return;
  const scene = ship.sprite.scene;
  if (ship.speedOrderIndex === 0) return;
  ship.pendingWaypointSpeedOrder = true;
  ship.waypointSpeedOrderDueAt = scene.time.now + WAYPOINT_SPEED_ORDER_GRACE_MS;
}

function applyPendingWaypointSpeedOrder(ship) {
  if (!ship.pendingWaypointSpeedOrder) return;
  const scene = ship.sprite.scene;
  if (scene.time.now < ship.waypointSpeedOrderDueAt
    || scene.time.now < ship.speedOrderCooldownUntil) return;
  ship.pendingWaypointSpeedOrder = false;
  ship.waypointSpeedOrderDueAt = 0;
  if (!setShipSpeedOrder(ship, 0)) return;
  beginSpeedOrderCooldown(ship);
}

function createSpeedHud(scene) {
  const startX = 45;
  const spacing = 40;
  const panelX = startX - 15;
  const buttonHeight = 32;
  const titleHeight = 30;
  const panelHeight = SPEED_ORDERS.length * spacing + 16;
  const titleY = config.height - 30 - titleHeight;
  const listY = titleY - panelHeight - 8;
  const labelPixelSize = 2;
  const horizontalPadding = 12;
  const buttonWidth = Math.max(
    ...SPEED_ORDERS.map((order) => PixelFont.measureLine(order.label, labelPixelSize)),
  ) + horizontalPadding * 2;
  const panelWidth = buttonWidth + 24;
  const buttonLeft = panelX + 12;

  // The bottom tab stays visible while the speed choices pop upward on demand.
  speedHudTitle = scene.add.rectangle(
    panelX,
    titleY,
    panelWidth,
    titleHeight,
    0x0A625B,
    0.85,
  ).setOrigin(0, 0).setDepth(9).setVisible(false)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", () => {
      if (!firingModeActive && getCommandableShips().length > 0) {
        speedHudExpanded = !speedHudExpanded;
        updateSpeedHud();
      }
    });

  speedHudTitleText = PixelFont.create(scene, "SPEED ORDERS", {
    x: panelX + panelWidth / 2,
    y: titleY + (titleHeight - 7 * 2) / 2,
    pixelSize: 2,
    color: 0xffffff,
    depth: 10,
    align: "center",
  }).setVisible(false);

  speedHudBackdrop = scene.add.rectangle(
    panelX,
    listY,
    panelWidth,
    panelHeight,
    0x000000,
    0.55,
  ).setOrigin(0, 0).setDepth(9).setVisible(false);

  speedHudButtons = SPEED_ORDERS.map((order, index) => {
    const button = scene.add.rectangle(
      buttonLeft + buttonWidth / 2,
      listY + 8 + index * spacing + buttonHeight / 2,
      buttonWidth,
      buttonHeight,
      0x0a3d62,
    )
      .setDepth(10)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", (pointer, localX, localY, event) => {
        event.stopPropagation();
        setSpeedOrder(index);
        speedHudExpanded = false;
        updateSpeedHud();
      });
    return button;
  });
  speedHudLabels = SPEED_ORDERS.map((order, index) => PixelFont.create(scene, order.label, {
    x: buttonLeft + horizontalPadding,
    y: listY + 8 + index * spacing + (buttonHeight - 7 * labelPixelSize) / 2,
    pixelSize: labelPixelSize,
    color: 0xffffff,
    depth: 11,
  }).setVisible(false));
  scene.cameras.main.ignore(speedHudTitle);
  scene.cameras.main.ignore(speedHudTitleText);
  scene.cameras.main.ignore(speedHudBackdrop);
  scene.cameras.main.ignore([...speedHudButtons, ...speedHudLabels]);
}

function updateSpeedHud() {
  if (!speedHudButtons) return;

  const commandableShips = getCommandableShips();
  const hasSelection = commandableShips.length > 0;
  const speedHudAlpha = firingModeActive ? 0.2 : speedOrderCooldownVisualAlpha();
  const canChangeSpeed = hasSelection && !firingModeActive;

  let activeIndex = null;
  if (hasSelection) {
    const first = commandableShips[0].speedOrderIndex;
    activeIndex = commandableShips.every((ship) => ship.speedOrderIndex === first) ? first : null;
  }

  if (speedHudTitle) speedHudTitle.setVisible(hasSelection);
  if (speedHudTitleText) speedHudTitleText.setVisible(hasSelection);
  if (!hasSelection) speedHudExpanded = false;
  if (speedHudBackdrop) speedHudBackdrop.setVisible(hasSelection && speedHudExpanded);
  if (speedHudBackdrop) speedHudBackdrop.setAlpha(firingModeActive ? 0.2 : 1);
  if (speedHudTitle) speedHudTitle.setAlpha(firingModeActive ? 0.2 : 1);
  if (speedHudTitleText) speedHudTitleText.setAlpha(speedHudAlpha);
  if (firingModeActive) speedHudTitle.disableInteractive();
  else speedHudTitle.setInteractive({ useHandCursor: true });


  speedHudButtons.forEach((button, index) => {
    button.setVisible(hasSelection && speedHudExpanded);
    speedHudLabels[index].setVisible(hasSelection && speedHudExpanded);
    if (canChangeSpeed) {
      button.setInteractive({ useHandCursor: true });
    } else {
      button.disableInteractive();
    }
    button.setFillStyle(index === activeIndex ? 0x1abc9c : 0x0a3d62);
    button.setAlpha(speedHudAlpha);
    speedHudLabels[index].setAlpha(speedHudAlpha);
  });
}

function speedOrderCooldownVisualAlpha() {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return 1;
  const allCoolingDown = commandableShips.every((ship) =>
    ship.sprite.scene.time.now < ship.speedOrderCooldownUntil,
  );
  return allCoolingDown ? 0.55 : 1;
}

function updateSpeedOrderCooldownVisuals() {
  if (!speedHudButtons) return;
  const alpha = firingModeActive ? 0.2 : speedOrderCooldownVisualAlpha();
  speedHudButtons.forEach((button) => button.setAlpha(alpha));
  speedHudLabels.forEach((label) => label.setAlpha(alpha));
  if (speedHudTitleText) speedHudTitleText.setAlpha(alpha);
  if (speedHudTitle) speedHudTitle.setAlpha(firingModeActive ? 0.2 : 1);
  if (speedHudBackdrop) speedHudBackdrop.setAlpha(firingModeActive ? 0.2 : 1);
}

function issueMoveOrder(x, y, append) {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return;

  const scene = commandableShips[0].sprite.scene;
  commandableShips.forEach((ship) => {
    ship.continueStraightAfterWaypoint = true;
    ship.braking = false;
    ship.pendingWaypointSpeedOrder = false;
    ship.waypointSpeedOrderDueAt = 0;
  });

  if (!append) {
    // Only clear the waypoints/markers belonging to the ships that are actually
    // getting a new order — clearing the shared marker list unconditionally
    // would erase other, untouched ships' still-active waypoint markers too.
    commandableShips.forEach((ship) => {
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
  waypoint.marker.waypoint = waypoint;

  worldContainer.add(waypoint.marker);
  waypointMarkers.push(waypoint.marker);
  updateWaypointMarkerScales(scene.cameras.main);

  commandableShips.forEach((ship) => {
    ship.waypoints.push(waypoint);
    ship.pathPreviewDirty = true;
    if (!ship.target) {
      advanceToNextWaypoint(ship);
      resetSustainedAimForTurn(ship, x, y);
    }
    if (!ship.pathLine) {
      ship.pathLine = scene.add.graphics().setDepth(ORDER_MARKER_DEPTH);
      worldContainer.add(ship.pathLine);
    }
    updatePathLine(ship);
  });
  updateSelectionOverlayVisibility();
}

function advanceToNextWaypoint(ship) {
  ship.target = ship.waypoints.shift() || null;
}

function getTurnRadius(ship) {
  return ship.speed > 0 ? ship.speed / ship.turnRate : 0;
}

function isCloseWaypointBehindShip(ship, distance) {
  if (!ship.target || ship.waypoints.length > 0 || ship.speed <= 0) return false;
  const turnRadius = getTurnRadius(ship);
  if (turnRadius <= 0 || distance > Math.max(24, turnRadius * 0.5)) return false;

  const targetHeading = Phaser.Math.Angle.Between(
    ship.sprite.x, ship.sprite.y, ship.target.x, ship.target.y,
  );
  const currentHeading = ship.sprite.rotation - Math.PI / 2;
  const headingDelta = Math.abs(Phaser.Math.Angle.Wrap(targetHeading - currentHeading));
  return headingDelta >= Phaser.Math.DegToRad(120);
}

function updateShipRudder(ship, angleDelta, dt) {
  const rampTime = Math.max(0.01, ship.rudderRampTimeSeconds || 2);
  const rudder = ship.rudder || 0;
  const desiredDirection = Math.abs(angleDelta) > 0.001 ? Math.sign(angleDelta) : 0;
  let targetRudder = 0;

  if (desiredDirection && (!rudder || Math.sign(rudder) === desiredDirection)) {
    const stoppingAngle = ship.turnRate * rampTime * rudder * rudder / 2;
    if (Math.abs(angleDelta) > stoppingAngle + 0.001) targetRudder = desiredDirection;
  }

  const maxRudderChange = dt / rampTime;
  ship.rudder = Phaser.Math.Clamp(
    targetRudder,
    rudder - maxRudderChange,
    rudder + maxRudderChange,
  );

  let rotationChange = ship.turnRate * ship.rudder * dt;
  if (desiredDirection && Math.sign(rotationChange) === desiredDirection
    && Math.abs(rotationChange) > Math.abs(angleDelta)) {
    rotationChange = angleDelta;
  }
  ship.sprite.rotation += rotationChange;
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
    setCameraZoom(camera, tacticalDisplayActive
      ? camera.zoom * Math.exp(CAMERA_ZOOM_SPEED * dt)
      : camera.zoom + CAMERA_ZOOM_SPEED * dt);
  } else if (keys.zoomOut.isDown || keys.zoomOutNumpad.isDown) {
    setCameraZoom(camera, tacticalDisplayActive
      ? camera.zoom * Math.exp(-CAMERA_ZOOM_SPEED * dt)
      : camera.zoom - CAMERA_ZOOM_SPEED * dt);
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

function focusCameraOnTab(camera) {
  const selectedFriendly = selectedShips.find((ship) =>
    ship.team === TEAMS.PLAYER && !ship.sinking && !ship.sunk,
  );

  if (selectedFriendly) {
    cameraPanTarget = null;
    cameraFocusShip = cameraFocusShip === selectedFriendly ? null : selectedFriendly;
    return;
  }

  const centerX = camera.scrollX + camera.width / 2;
  const centerY = camera.scrollY + camera.height / 2;
  const nearestFriendly = ships
    .filter((ship) => ship.team === TEAMS.PLAYER && !ship.sinking && !ship.sunk)
    .sort((a, b) =>
      Phaser.Math.Distance.Between(centerX, centerY, a.sprite.x, a.sprite.y)
      - Phaser.Math.Distance.Between(centerX, centerY, b.sprite.x, b.sprite.y)
    )[0];

  if (!nearestFriendly) return;
  cameraFocusShip = null;
  cameraPanTarget = { x: nearestFriendly.sprite.x, y: nearestFriendly.sprite.y };
}

function updateCameraFocus(camera, dt) {
  if (cameraFocusShip && (cameraFocusShip.sinking || cameraFocusShip.sunk)) {
    cameraFocusShip = null;
  }
  const target = cameraFocusShip
    ? { x: cameraFocusShip.sprite.x, y: cameraFocusShip.sprite.y }
    : cameraPanTarget;
  if (!target) return;

  const targetScrollX = target.x - camera.width / 2;
  const targetScrollY = target.y - camera.height / 2;
  const blend = 1 - Math.exp(-CAMERA_FOCUS_RESPONSE * dt);
  camera.scrollX += (targetScrollX - camera.scrollX) * blend;
  camera.scrollY += (targetScrollY - camera.scrollY) * blend;

  if (!cameraFocusShip
    && Math.abs(targetScrollX - camera.scrollX) < 0.5
    && Math.abs(targetScrollY - camera.scrollY) < 0.5) {
    camera.scrollX = targetScrollX;
    camera.scrollY = targetScrollY;
    cameraPanTarget = null;
  }
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

  cameraFocusShip = null;
  cameraPanTarget = null;

  // Normalize so diagonal panning isn't faster than cardinal panning
  const length = Math.sqrt(dx * dx + dy * dy);
  dx /= length;
  dy /= length;

  // Divide by zoom so panning feels the same screen-speed
  camera.scrollX += (dx * CAMERA_PAN_SPEED * dt) / camera.zoom;
  camera.scrollY += (dy * CAMERA_PAN_SPEED * dt) / camera.zoom;
}

function setCameraZoom(camera, zoom) {
  const nextZoom = tacticalDisplayActive
    ? Phaser.Math.Clamp(zoom, TACTICAL_MIN_ZOOM, TACTICAL_MAX_ZOOM)
    : Phaser.Math.Clamp(zoom, 0.5, 1.5);
  camera.setZoom(nextZoom);
  updateWaypointMarkerScales(camera);
  ships.forEach((ship) => {
    if (ship.pathLine) updatePathLine(ship);
  });
}

function enforceTacticalZoomBounds(camera) {
  if (!tacticalDisplayActive) return;
  const boundedZoom = Phaser.Math.Clamp(camera.zoom, TACTICAL_MIN_ZOOM, TACTICAL_MAX_ZOOM);
  if (camera.zoom === boundedZoom) return;
  camera.setZoom(boundedZoom);
  updateWaypointMarkerScales(camera);
  ships.forEach((ship) => {
    if (ship.pathLine) updatePathLine(ship, true);
  });
}

function createTacticalDisplayUI(scene) {
  tacticalGrid = scene.add.graphics().setDepth(0.5).setVisible(false);
  tacticalGrid.lineStyle(2, 0x287b91, 0.5);
  const gridSpacing = 500;
  for (let x = 0; x <= MAP_WIDTH; x += gridSpacing) {
    tacticalGrid.lineBetween(x, 0, x, MAP_HEIGHT);
  }
  for (let y = 0; y <= MAP_HEIGHT; y += gridSpacing) {
    tacticalGrid.lineBetween(0, y, MAP_WIDTH, y);
  }
  worldContainer.add(tacticalGrid);

  const frame = scene.add.graphics().setDepth(50);
  frame.fillStyle(0x0a2534, 1);
  frame.fillRect(0, 0, config.width, 5);
  frame.fillRect(0, config.height - 5, config.width, 5);
  frame.fillRect(0, 0, 5, config.height);
  frame.fillRect(config.width - 5, 0, 5, config.height);

  const labelBackground = scene.add.rectangle(
    config.width - 16,
    16,
    210,
    30,
    0x0a2534,
    1,
  ).setOrigin(1, 0).setDepth(51);
  const label = PixelFont.create(scene, "TACTICAL DISPLAY", {
    x: config.width - 26, y: 21, pixelSize: 2, color: 0x9ef2db, depth: 52, align: "right",
  });
  tacticalFrame = [frame, labelBackground, label];
  scene.cameras.main.ignore(tacticalFrame);
  tacticalFrame.forEach((element) => element.setVisible(false));
}

function setTacticalDisplay(scene, active) {
  if (tacticalDisplayActive === active) return;
  const camera = scene.cameras.main;
  if (active) {
    tacticalSavedCamera = {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: camera.zoom,
    };
    const centerX = camera.scrollX + camera.width / 2;
    const centerY = camera.scrollY + camera.height / 2;
    tacticalDisplayActive = true;
    setCameraZoom(camera, 0.1);
    camera.scrollX = centerX - camera.width / 2;
    camera.scrollY = centerY - camera.height / 2;
    ships.forEach((ship) => {
      if (ship.pathLine) updatePathLine(ship, true);
    });
    oceanBackground.setFillStyle(0x071b2b, 1);
    tacticalGrid.setVisible(true);
    tacticalHiddenEffects.forEach((effect) => effect.setVisible(false));
    oceanWaves.forEach(({ sprite }) => sprite.setVisible(false));
    activeWakes.forEach(({ graphics }) => graphics.setVisible(false));
    ships.forEach((ship) => {
      ship.sprite.setVisible(false);
      ship.wakeSprite.setVisible(false);
      ship.turrets.forEach(({ sprite }) => sprite.setVisible(false));
      ship.selectedRing.setVisible(false);
      ship.hostileRing.setVisible(false);
      ship.minRangeCircle.setVisible(false);
      ship.maxRangeCircle.setVisible(false);
      ship.healthBar.setVisible(false);
      if (ship.dispersionEllipse) ship.dispersionEllipse.setVisible(false);
      if (ship.waterOverlay) ship.waterOverlay.setVisible(false);
    });
    tacticalFrame.forEach((element) => element.setVisible(true));
  } else {
    tacticalDisplayActive = false;
    oceanBackground.setFillStyle(0x06345a, 1);
    tacticalGrid.setVisible(false);
    tacticalHiddenEffects.forEach((effect) => effect.setVisible(true));
    streamOceanWaves(camera, scene);
    oceanWaves.forEach(({ sprite }) => sprite.setVisible(true));
    activeWakes.forEach(({ graphics }) => graphics.setVisible(
      isWithinOceanEffectRange(graphics.x, graphics.y, camera),
    ));
    ships.forEach((ship) => {
      ship.tacticalSymbol.setVisible(false);
      ship.sprite.setVisible(true);
      ship.turrets.forEach(({ sprite }) => sprite.setVisible(true));
      ship.hostileRing.setVisible(ship.hostile);
      ship.selectedRing.setVisible(selectedShips.includes(ship));
      if (!ship.sinking) restoreShipVisual(ship);
      if (ship.waterOverlay) ship.waterOverlay.setVisible(true);
      ship.minRangeCircle.setVisible(
        firingModeActive && ship.team === TEAMS.PLAYER && selectedShips.includes(ship),
      );
      ship.maxRangeCircle.setVisible(
        firingModeActive && ship.team === TEAMS.PLAYER && selectedShips.includes(ship),
      );
      if (ship.dispersionEllipse) ship.dispersionEllipse.setVisible(selectedShips.includes(ship));
    });
    tacticalFrame.forEach((element) => element.setVisible(false));
    if (tacticalSavedCamera) {
      camera.zoom = tacticalSavedCamera.zoom;
      camera.scrollX = tacticalSavedCamera.scrollX;
      camera.scrollY = tacticalSavedCamera.scrollY;
      updateWaypointMarkerScales(camera);
      ships.forEach((ship) => {
        if (ship.pathLine) updatePathLine(ship, true);
      });
    }
    tacticalSavedCamera = null;
  }
  updateTacticalSymbols(camera);
  updateSelectionOverlayVisibility();
}

function updateTacticalSymbols(camera) {
  ships.forEach((ship) => {
    const symbol = ship.tacticalSymbol;
    if (!symbol) return;
    const visible = tacticalDisplayActive
      && !ship.sunk
      && (ship.team === TEAMS.PLAYER || ship.identified);
    symbol.setVisible(visible);
    if (!visible) {
      ship.tacticalOutlineGlow?.setVisible(false);
      return;
    }

    symbol.setPosition(ship.sprite.x, ship.sprite.y);
    symbol.setRotation(ship.sprite.rotation);
    const iconSize = getTacticalSymbolScreenSize(camera.zoom);
    symbol.setDisplaySize(iconSize.width / camera.zoom, iconSize.height / camera.zoom);
    symbol.setTint(selectedShips.includes(ship)
      ? 0xffe778
      : ship.team === TEAMS.PLAYER ? 0x62f0c8 : 0xff625f);

    const glow = ship.tacticalOutlineGlow;
    const isSelected = selectedShips.includes(ship);
    glow.setVisible(isSelected);
    if (isSelected) {
      glow.setPosition(ship.sprite.x, ship.sprite.y);
      glow.setRotation(ship.sprite.rotation);
      glow.setDisplaySize(
        TACTICAL_OUTLINE_WIDTH / camera.zoom,
        TACTICAL_OUTLINE_HEIGHT / camera.zoom,
      );
      glow.setAlpha(0.78 + Math.sin(ship.sprite.scene.time.now * 0.006) * 0.16);
    }
  });
}

function getTacticalSymbolScreenSize() {
  return {
    width: TACTICAL_SYMBOL_WIDTH,
    height: TACTICAL_SYMBOL_HEIGHT,
  };
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

  ship.wakeSprite.setVisible(!tacticalDisplayActive
    && isWithinOceanEffectRange(ship.sprite.x, ship.sprite.y, ship.sprite.scene.cameras.main));
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

  ship.wakeSprite.setVisible(!tacticalDisplayActive
    && isWithinOceanEffectRange(ship.sprite.x, ship.sprite.y, ship.sprite.scene.cameras.main));
  ship.wakeSprite.setTexture(wake.wakeKey, wake.wakeFrame);
  ship.wakeSprite.setDisplaySize(ship.stats.displayWidth, ship.stats.displayHeight);
}

function handleMapBorderTurn(ship) {
  if (ship.target && ship.target.isBoundaryTurn) return;

  const { x, y } = ship.sprite;
  const outsideLeft = x < 0;
  const outsideRight = x > MAP_WIDTH;
  const outsideTop = y < 0;
  const outsideBottom = y > MAP_HEIGHT;
  if (!outsideLeft && !outsideRight && !outsideTop && !outsideBottom) return;

  const heading = ship.sprite.rotation - Math.PI / 2;
  let directionX = Math.cos(heading);
  let directionY = Math.sin(heading);
  if (outsideLeft) directionX = Math.abs(directionX);
  if (outsideRight) directionX = -Math.abs(directionX);
  if (outsideTop) directionY = Math.abs(directionY);
  if (outsideBottom) directionY = -Math.abs(directionY);

  if (ship.target) removeWaypointMarker(ship.target);
  ship.waypoints.forEach(removeWaypointMarker);
  ship.waypoints = [];
  ship.target = {
    x: Phaser.Math.Clamp(x + directionX * MAP_EDGE_TURN_DISTANCE, MAP_EDGE_TURN_INSET, MAP_WIDTH - MAP_EDGE_TURN_INSET),
    y: Phaser.Math.Clamp(y + directionY * MAP_EDGE_TURN_DISTANCE, MAP_EDGE_TURN_INSET, MAP_HEIGHT - MAP_EDGE_TURN_INSET),
    isBoundaryTurn: true,
  };
  ship.continueStraightAfterWaypoint = true;
  ship.braking = false;
  resetSustainedAimForTurn(ship, ship.target.x, ship.target.y);
  if (ship.pathLine) {
    ship.pathLine.destroy();
    ship.pathLine = null;
  }
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

  updateSustainedAim(ship, dt);
  applyPendingWaypointSpeedOrder(ship);
  handleMapBorderTurn(ship);

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

    if (isCloseWaypointBehindShip(ship, dist)) {
      // Move this ship's copy of the close, unreachable point to its current
      // position and consume it without moving the ship there. This avoids a
      // full-radius loop while keeping waypoint arrival non-teleporting.
      ship.target = { ...ship.target, x: sprite.x, y: sprite.y };
      completeWaypoint(ship, false);
    }

    if (ship.target && !finalWaypoint && dist >= waypointReachLeeway && shouldAdvanceForTurn(ship)) {
      advanceWaypointForTurn(ship);
    }

    const commandedSpeed = getCommandedSpeed(ship);

    // Latch: once triggered, braking stays true for the rest of this approach,
    // even if distance/stoppingDistance would momentarily say otherwise.
    if (finalWaypoint && !ship.continueStraightAfterWaypoint && dist <= stoppingDistance) {
      ship.braking = true;
    }

    if (!ship.target) {
      // The waypoint was consumed by the close-turn capture above.
    } else if (dist <= waypointReachLeeway) {
      updateShipRudder(ship, 0, dt);
      completeWaypoint(ship);
    } else if (ship.braking) {
        updateShipRudder(ship, 0, dt);
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
      updateShipRudder(ship, angleDelta, dt);

      if (ship.speed < commandedSpeed) {
        ship.speed = Math.min(commandedSpeed, ship.speed + ship.acceleration * dt);
        if (!ship.moving || ship.slowingDown) {
          ship.moving = true;
          ship.slowingDown = false;
          ship.accelerating = true;
          startAccelerationAnimation(ship);
        }
       } else if (ship.speed > commandedSpeed) {
        ship.speed = Math.max(commandedSpeed, ship.speed - ship.deceleration * dt);
        if (ship.speed <= commandedSpeed && ship.slowingDown) {
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
    updateShipRudder(ship, 0, dt);
    if (ship.continueStraightAfterWaypoint) {
      const commandedSpeed = getCommandedSpeed(ship);
      if (ship.speed < commandedSpeed) {
        ship.speed = Math.min(commandedSpeed, ship.speed + ship.acceleration * dt);
        if (!ship.moving || ship.slowingDown) {
          ship.moving = true;
          ship.slowingDown = false;
          ship.accelerating = true;
          startAccelerationAnimation(ship);
        }
      } else if (ship.speed > commandedSpeed) {
        ship.speed = Math.max(commandedSpeed, ship.speed - ship.deceleration * dt);
        if (ship.speed <= commandedSpeed && ship.slowingDown) {
          ship.slowingDown = false;
          ship.wakeSprite.stop();
          ship.wakeSprite.anims.timeScale = 1;
          ship.wakeSprite.play(movingWakeAnimKey(stats));
        }
      }
    } else {
      // An explicit stop order still brakes to zero with the slowdown wake.
      if (ship.speed > 0 && !ship.slowingDown) startSlowdownAnimation(ship);
      ship.speed = Math.max(0, ship.speed - ship.deceleration * dt);
    }
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
  ship.hostileRing.setPosition(sprite.x, sprite.y);

  // Keep the wake sprite glued to the hull's position and heading.
  ship.wakeSprite.x = sprite.x;
  ship.wakeSprite.y = sprite.y;
  ship.wakeSprite.rotation = sprite.rotation;

  ship.minRangeCircle.setPosition(sprite.x, sprite.y);
  const isCommandableSelection = ship.team === TEAMS.PLAYER && selectedShips.includes(ship);
  ship.minRangeCircle.setVisible(firingModeActive && isCommandableSelection);

  ship.maxRangeCircle.setPosition(sprite.x, sprite.y);
  ship.maxRangeCircle.setVisible(firingModeActive && isCommandableSelection);

  syncFireTarget(ship);
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
  if (ship.target) resetSustainedAimForTurn(ship, ship.target.x, ship.target.y);
  ship.pathPreviewDirty = Boolean(ship.target);
  ship.braking = false;

  if (ship.target) updatePathLine(ship);
  removeWaypointMarker(completedWaypoint);

  if (!ship.target && !completedWaypoint.isAiWaypoint && !completedWaypoint.isBoundaryTurn) {
    requestWaypointCruiseSpeed(ship);
  }

  if (!ship.target && !ship.continueStraightAfterWaypoint) {
    ship.speed = 0;
    stopShipAnimation(ship);
  }
}

function advanceWaypointForTurn(ship) {
  const completedWaypoint = ship.target;
  removeWaypointMarker(completedWaypoint);
  advanceToNextWaypoint(ship);
  ship.pathPreviewDirty = Boolean(ship.target);
  if (ship.target) resetSustainedAimForTurn(ship, ship.target.x, ship.target.y);
  if (!ship.target && completedWaypoint && !completedWaypoint.isAiWaypoint && !completedWaypoint.isBoundaryTurn) {
    requestWaypointCruiseSpeed(ship);
  }
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

function updatePathLine(ship, forceRedraw = false) {
  if (!ship.pathLine || !ship.target) return;
  const scene = ship.sprite.scene;
  const zoom = scene.cameras.main.zoom;

  // Keep the planned line stable during ordinary movement, but rebuild it if
  // collision avoidance changes the ship's steering by a meaningful amount.
  if (scene.time.now - ship.pathPreviewAvoidanceCheckAt >= 250) {
    ship.pathPreviewAvoidanceCheckAt = scene.time.now;
    const avoidance = computeAvoidanceSteering(ship);
    const avoidanceMagnitude = Math.hypot(avoidance.x, avoidance.y);
    const previousMagnitude = Math.hypot(
      ship.pathPreviewAvoidance.x, ship.pathPreviewAvoidance.y,
    );
    const changeMagnitude = Math.hypot(
      avoidance.x - ship.pathPreviewAvoidance.x,
      avoidance.y - ship.pathPreviewAvoidance.y,
    );
    const avoidanceBecameSignificant = avoidanceMagnitude >= 0.25
      && changeMagnitude >= 0.6;
    const avoidanceEnded = previousMagnitude >= 0.5 && avoidanceMagnitude < 0.15;

    if (ship.pathPreviewPoints && (avoidanceBecameSignificant || avoidanceEnded)) {
      ship.pathPreviewDirty = true;
    }
    ship.pathPreviewCurrentAvoidance = avoidance;
  }

  const pathRecalculationDue = scene.time.now - ship.pathPreviewLastRedrawAt >= 250;
  const routeChanged = ship.pathPreviewDirty || !ship.pathPreviewPoints || pathRecalculationDue;
  if (!forceRedraw && !routeChanged
    && scene.time.now - ship.pathPreviewLastRedrawAt < 250) return;

  if (routeChanged) {
    ship.pathPreviewStart = { x: ship.sprite.x, y: ship.sprite.y };
    ship.pathPreviewDrawIndex = 0;
    ship.pathPreviewAvoidance = ship.pathPreviewCurrentAvoidance
      || computeAvoidanceSteering(ship);
    const commandedSpeed = Math.max(getCommandedSpeed(ship), 1);
    const predictionStep = Phaser.Math.Clamp(4 / (commandedSpeed * zoom), 1 / 12, 0.5);
    ship.pathPreviewPoints = calculatePredictedPath(ship, predictionStep);
    ship.pathPreviewDirty = false;
  }

  // Redraw the cached route from its nearest point so the ship leaves no
  // visible trail behind it. The expensive path forecast remains cached.
  while (ship.pathPreviewDrawIndex + 1 < ship.pathPreviewPoints.length) {
    const currentPoint = ship.pathPreviewPoints[ship.pathPreviewDrawIndex];
    const nextPoint = ship.pathPreviewPoints[ship.pathPreviewDrawIndex + 1];
    const currentDistance = Phaser.Math.Distance.Between(
      ship.sprite.x, ship.sprite.y, currentPoint.x, currentPoint.y,
    );
    const nextDistance = Phaser.Math.Distance.Between(
      ship.sprite.x, ship.sprite.y, nextPoint.x, nextPoint.y,
    );
    if (nextDistance > currentDistance) break;
    ship.pathPreviewDrawIndex += 1;
  }
  ship.pathPreviewLastDrawPosition = { x: ship.sprite.x, y: ship.sprite.y };
  ship.pathLine.clear();
  ship.pathLine.lineStyle(3 / zoom, 0xffffff, 0.55);
  ship.pathLine.beginPath();
  ship.pathLine.moveTo(ship.sprite.x, ship.sprite.y);
  const renderStride = Math.max(1, Math.ceil(ship.pathPreviewPoints.length / 1200));
  for (let index = ship.pathPreviewDrawIndex; index < ship.pathPreviewPoints.length; index += renderStride) {
    const point = ship.pathPreviewPoints[index];
    ship.pathLine.lineTo(point.x, point.y);
  }
  const lastPoint = ship.pathPreviewPoints[ship.pathPreviewPoints.length - 1];
  if (lastPoint && ship.pathPreviewPoints.length > 1) {
    ship.pathLine.lineTo(lastPoint.x, lastPoint.y);
  }
  ship.pathLine.strokePath();
  ship.pathPreviewLastRedrawAt = scene.time.now;
}

function updateSelectionOverlayVisibility() {
  ships.forEach((ship) => {
    if (ship.pathLine) {
      const visibleInCurrentView = tacticalDisplayActive
        ? ship.team === TEAMS.PLAYER
        : selectedShips.includes(ship);
      ship.pathLine.setVisible(visibleInCurrentView && Boolean(ship.target));
    }
  });

  waypointMarkers.forEach((marker) => {
    const waypoint = marker.waypoint;
    const belongsToVisibleShip = waypoint && ships.some((ship) => (
      (tacticalDisplayActive
        ? ship.team === TEAMS.PLAYER
        : selectedShips.includes(ship))
      && (ship.target === waypoint || ship.waypoints.includes(waypoint))
    ));
    marker.setVisible(Boolean(belongsToVisibleShip));
  });
}

function stopSelectedShips() {
  const commandableShips = getCommandableShips();
  if (commandableShips.length === 0) return;

  commandableShips.forEach((ship) => {
    ship.continueStraightAfterWaypoint = false;
    ship.pendingWaypointSpeedOrder = false;
    if (ship.target) removeWaypointMarker(ship.target);
    ship.waypoints.forEach(removeWaypointMarker);
    ship.waypoints = [];
    ship.target = null;
    ship.braking = false;
  });
}

function calculatePredictedPath(ship, predictionStep = 1 / 12) {
  const state = {
    sprite: { x: ship.sprite.x, y: ship.sprite.y, rotation: ship.sprite.rotation },
    target: ship.target ? { ...ship.target } : null,
    waypoints: ship.waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y })),
    speed: ship.speed,
    maxSpeed: getCommandedSpeed(ship),
    acceleration: ship.acceleration,
    deceleration: ship.deceleration,
    turnRate: ship.turnRate,
    rudderRampTimeSeconds: ship.rudderRampTimeSeconds,
    rudder: ship.rudder,
    avoidance: ship.pathPreviewAvoidance || { x: 0, y: 0 },
  };
  const points = [];
  // Keep the same maximum prediction horizon while using fewer simulation
  // steps when zoomed out, where dense path points are not visible anyway.
  const maxPredictionSteps = Math.min(12000, Math.ceil(1000 / predictionStep));
  for (let index = 0; state.target && index < maxPredictionSteps; index += 1) {
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
    // Match live collision avoidance for the newly refreshed segment. Keeping
    // the sampled vector fixed during this forecast avoids preview jitter.
    let dirX = steeringTarget.x - state.sprite.x;
    let dirY = steeringTarget.y - state.sprite.y;
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX = dirX / dirLength + state.avoidance.x * 1.5;
    dirY = dirY / dirLength + state.avoidance.y * 1.5;
    const desiredAngle = Math.atan2(dirY, dirX) + Math.PI / 2;
    const angleDelta = Phaser.Math.Angle.Wrap(desiredAngle - state.sprite.rotation);
    updateShipRudder(state, angleDelta, predictionStep);

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
    if (ship.team !== TEAMS.PLAYER || ship.sinking || ship.sunk) return;
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
