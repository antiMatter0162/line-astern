// Controls:
//   Left-click a ship (or drag a box over ships) to select them
//   Right-click on the ocean to move selected ships there
//   Ships turn and accelerate like real vessels (no instant snapping)

const config = {
  type: Phaser.AUTO,

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
let selectionBox = null;
let selectStart = null;
let selectedShips = [];
let panStart = null;
let waypointMarkers = [];
const waypointSize = 48;
const waypointSourceSize = 480;
const waypointReachLeeway = 0;
const turnWindowLeeway = 3;
const shipDisplayWidth = 56;
const shipDisplayHeight = 130;

// ---- Turret mounts ----
// Local offsets are in "unrotated ship space" (same axes as the hull texture:
// +y toward the stern, matching ship.sprite.rotation === 0, i.e. bow facing
// up). Derived from the anchor-point reference image: the bow pair (A, B)
// have their barrels pointing toward the bow, so their sprites start rotated
// 180° from the native art (which has barrels pointing "down"); the stern
// pair (B, A) keep the native 0° rotation since their barrels already point
// the right way (toward the stern).
//
// Order is bow -> stern: A, B, B, A. B mounts get a higher depth than A
// mounts so the (inner, superfiring) B turrets always render on top of the
// (outer) A turrets they overlap.
const TURRET_MOUNTS = [
  { type: "A", dx: 0, dy: -38, baseRotation: Math.PI }, // bow-most
  { type: "B", dx: 0, dy: -22, baseRotation: Math.PI }, // bow, superfiring
  { type: "B", dx: 0, dy: 28, baseRotation: 0 }, // stern, superfiring
  { type: "A", dx: 0, dy: 43, baseRotation: 0 }, // stern-most
];
const turretDisplaySize = 21;
const TURRET_DEPTH = { A: 2.4, B: 2.6 };
const TURRET_TEXTURE_KEY = { A: "turret-a", B: "turret-b" };

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
  this.load.image("ship-stationary", "assets/Pennyslvania-Class Blank.png");
  this.load.image("selection-circle", "assets/Selection-Circle.png");
  this.load.image("waypoint", "assets/Waypoint.png");
  this.load.image("turret-a", "assets/Pennsylvania Turret A.png");
  this.load.image("turret-b", "assets/Pennsylvania Turret B.png");
  this.load.spritesheet("ship", "assets/Pennyslvania-Class.png", {
    frameWidth: 960,
    frameHeight: 2220,
  });
  this.load.spritesheet("ship-slowdown", "assets/Pennyslvania-Class Slowdown.png", {
    frameWidth: 960,
    frameHeight: 2220,
  });
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
 
  this.input.on("wheel", (pointer, currentlyOver, deltaX, deltaY) => {
    setCameraZoom(camera, camera.zoom - deltaY * 0.001);
  });
 
  this.input.keyboard.on("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
      setCameraZoom(camera, camera.zoom + 0.1);
    } else if (event.key === "-" || event.key === "_") {
      setCameraZoom(camera, camera.zoom - 0.1);
    }
  });
 
  this.anims.create({
    key: "ship-moving",
    frames: [0, 1, 2, 3, 4, 5].map((frame) => ({ key: "ship", frame })),
    frameRate: 12,
    repeat: -1,
  });
 
  this.anims.create({
    key: "ship-slowing-down",
    frames: Array.from({ length: 10 }, (_, frame) => ({ key: "ship-slowdown", frame })),
    frameRate: 12,
    repeat: 0,
  });
 
  this.anims.create({
    key: "ship-accelerating",
    frames: Array.from({ length: 10 }, (_, index) => ({ key: "ship-slowdown", frame: 9 - index })),
    frameRate: 12,
    repeat: 0,
  });
 
  // Create a small starting fleet
  ships = [createShip(this, 6400, 4000),
          createShip(this,5400, 4000)];
 
  // Speed order shortcuts: 1=Ahead 1/3 ... 5=Ahead Flank
  SPEED_ORDERS.forEach((order, index) => {
    this.input.keyboard.on(`keydown-${order.key}`, () => setSpeedOrder(index));
  });
  createSpeedHud(this);
  updateSpeedHud();
  
  this.input.on("pointerdown", (pointer) => {
    if (pointer.middleButtonDown()) {
      panStart = { x: pointer.x, y: pointer.y };
      return;
    }
    if (isPointerOverSpeedHud(pointer)) {
      return;
    }
    if (pointer.rightButtonDown()) {
      issueMoveOrder(pointer.worldX, pointer.worldY, Boolean(pointer.event && pointer.event.shiftKey));
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
}
 
// ---- Ship creation & behavior ----
 
function createShip(scene, x, y) {
  const sprite = scene.add.sprite(x, y, "ship-stationary")
    .setDisplaySize(shipDisplayWidth, shipDisplayHeight)
    .setDepth(2);

  const turrets = createTurrets(scene, x, y);
 
  const selectedRing = scene.add.image(x, y, "selection-circle")
    .setDisplaySize(120, 120)
    .setDepth(3);
  selectedRing.setVisible(false);
 
  worldContainer.add([sprite, selectedRing]);
 
  return {
    sprite,
    turrets,
    selectedRing,
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
    maxSpeed: 90,
    acceleration: 108,
    deceleration: 108,
    braking: false, //handles cases where the ship almost stops, but decides to move again in a circle to re-reach the waypoint
    turnRate: Phaser.Math.DegToRad(20),
    speedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
    collisionRadius: 28,
    team: "player", // future: "enemy" ships won't be avoided, only rammed
  };
}

// Builds the four turret sprites for a ship, anchored per TURRET_MOUNTS.
// Each turret tracks its own local offset and a fixed base rotation; see
// updateTurrets() for how those are combined with the hull's rotation every
// frame.
function createTurrets(scene, shipX, shipY) {
  return TURRET_MOUNTS.map((mount) => {
    const sprite = scene.add.sprite(shipX, shipY, TURRET_TEXTURE_KEY[mount.type])
      .setDisplaySize(turretDisplaySize, turretDisplaySize)
      .setDepth(TURRET_DEPTH[mount.type])
      .setRotation(mount.baseRotation);
    worldContainer.add(sprite);
    return {
      sprite,
      dx: mount.dx,
      dy: mount.dy,
      // Fixed offset from the ship's own heading — NOT an absolute world
      // angle. Every frame this gets added to the ship's current rotation,
      // which is what makes the turret preserve its orientation relative to
      // the ship (rigidly attached, like it's welded to the deck) as the
      // hull turns. Once turrets become independently aimable, this is the
      // field a future aiming system would add an extra offset on top of.
      rotationOffset: mount.baseRotation,
    };
  });
}

// Repositions and reorients a ship's turrets to follow the hull: each
// turret's fixed local offset is rotated by the ship's current heading to
// get a world-space offset, which is added to the ship's position, and the
// turret sprite's own rotation is set to the ship's rotation plus the
// turret's fixed rotationOffset — so the turret stays rigidly attached to
// the ship (constant bearing relative to the hull) rather than holding a
// fixed absolute world angle.
function updateTurrets(ship) {
  const cos = Math.cos(ship.sprite.rotation);
  const sin = Math.sin(ship.sprite.rotation);
  ship.turrets.forEach((turret) => {
    const worldOffsetX = turret.dx * cos - turret.dy * sin;
    const worldOffsetY = turret.dx * sin + turret.dy * cos;
    turret.sprite.x = ship.sprite.x + worldOffsetX;
    turret.sprite.y = ship.sprite.y + worldOffsetY;
    turret.sprite.rotation = ship.sprite.rotation + turret.rotationOffset;
  });
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
        ship.sprite.stop();
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
// Both restoreShipVisual (used after canceling a slowdown mid-order) and
// syncShipAnimationFrame (called every tick) need to know which texture/frame
// a ship should currently show. This shared helper avoids duplicating that
// frame-index math in two places.
function computeShipFrame(ship) {
  if (!ship.moving) {
    return { key: "ship-stationary", frame: undefined };
  }
  if (ship.slowingDown) {
    return { key: "ship-slowdown", frame: Math.floor(ship.slowdownFrameClock * 12) % 10 };
  }
  if (ship.accelerating) {
    const frameIndex = Math.floor(ship.accelerationFrameClock * 12) % 10;
    return { key: "ship-slowdown", frame: 9 - frameIndex, animProgress: frameIndex / 10, animKey: "ship-accelerating" };
  }
  return { key: "ship", frame: Math.floor(ship.movementFrameClock * 12) % 6 };
}
 
function restoreShipVisual(ship) {
  const { key, frame, animKey, animProgress } = computeShipFrame(ship);
  ship.sprite.setTexture(key, frame);
  ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
 
  if (!ship.moving) return;
 
  if (ship.slowingDown) {
    ship.sprite.play("ship-slowing-down");
    ship.sprite.setFrame(frame);
    ship.sprite.anims.setProgress(frame / 10);
  } else if (ship.accelerating) {
    ship.sprite.play(animKey);
    ship.sprite.setFrame(frame);
    ship.sprite.anims.setProgress(animProgress);
  } else {
    ship.sprite.play("ship-moving");
    ship.sprite.setFrame(frame);
    ship.sprite.anims.setProgress(frame / 6);
  }
}
 
function syncShipAnimationFrame(ship) {
  if (!ship.moving) return;
  const { key, frame } = computeShipFrame(ship);
  ship.sprite.setTexture(key, frame);
  ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
}
 
function updateShip(ship, dt) {
  const { sprite } = ship;
 
  if (ship.moving && !ship.accelerating && !ship.slowingDown) {
    ship.movementFrameClock = (ship.movementFrameClock + dt) % 0.5;
  }
  if (ship.accelerating) {
    ship.accelerationFrameClock = (ship.accelerationFrameClock + dt) % (10 / 12);
  }
  if (ship.slowingDown) {
    ship.slowdownFrameClock = (ship.slowdownFrameClock + dt) % (10 / 12);
  }
  syncShipAnimationFrame(ship);
 
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
          ship.sprite.stop();
          ship.sprite.play("ship-moving");
        }
      } else if (!ship.moving) {
        ship.moving = true;
        ship.accelerating = true;
        startAccelerationAnimation(ship);
      }
    }
  } else {
    // Decelerate to a stop when no target
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

  updateTurrets(ship);
}
 
function stopShipAnimation(ship) {
  if (!ship.moving) return;
  ship.moving = false;
  ship.accelerating = false;
  ship.slowingDown = false;
  ship.sprite.stop();
  ship.sprite.setTexture("ship-stationary");
  ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
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
  ship.slowingDown = true;
  ship.slowdownFrameClock = 0;
  ship.sprite.stop();
  ship.sprite.setTexture("ship-slowdown");
  ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
  ship.sprite.play("ship-slowing-down");
}
 
function startAccelerationAnimation(ship) {
  ship.accelerationFrameClock = 0;
  ship.sprite.stop();
  ship.sprite.setTexture("ship-slowdown", 9);
  ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
  ship.sprite.play("ship-accelerating");
  ship.sprite.once("animationcomplete-ship-accelerating", () => {
    if (!ship.moving || ship.slowingDown) return;
    ship.accelerating = false;
    ship.sprite.setTexture("ship");
    ship.sprite.setDisplaySize(shipDisplayWidth, shipDisplayHeight);
    ship.sprite.play("ship-moving");
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