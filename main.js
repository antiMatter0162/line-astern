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
  ships = [createShip(this, 6400, 4000)];
 
  // Speed order shortcuts: 1=Ahead 1/3 ... 5=Ahead Flank
  SPEED_ORDERS.forEach((order, index) => {
    this.input.keyboard.on(`keydown-${order.key}`, () => setSpeedOrder(index));
  });
  createSpeedHud(this);
  updateSpeedHud();
 
  // Drag-select box
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
    selectStart = { x: pointer.worldX, y: pointer.worldY };
    selectionBox = this.add.rectangle(selectStart.x, selectStart.y, 1, 1, 0x00ff00, 0.15)
      .setStrokeStyle(1, 0x00ff00)
      .setOrigin(0, 0);
    worldContainer.add(selectionBox);
  });
 
  this.input.on("pointermove", (pointer) => {
    if (panStart) {
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - panStart.x) / camera.zoom;
      camera.scrollY -= (pointer.y - panStart.y) / camera.zoom;
      panStart = { x: pointer.x, y: pointer.y };
      return;
    }
    if (!selectionBox || !selectStart) return;
    const w = pointer.worldX - selectStart.x;
    const h = pointer.worldY - selectStart.y;
    selectionBox.setSize(Math.abs(w), Math.abs(h));
    selectionBox.x = w < 0 ? pointer.worldX : selectStart.x;
    selectionBox.y = h < 0 ? pointer.worldY : selectStart.y;
  });
 
  // Finalize the drag-select box on pointerup, or pointerupoutside if the mouse
  // is released outside the canvas — without this, releasing off-canvas would
  // leave selectionBox/selectStart dangling and break the next drag.
  const finishSelection = (pointer) => {
    if (panStart) {
      panStart = null;
      return;
    }
    if (!selectionBox) return;
 
    const bounds = selectionBox.getBounds();
    const clickedOnly = bounds.width < 4 && bounds.height < 4;
 
    selectedShips.forEach((s) => s.selectedRing.setVisible(false));
    selectedShips = [];
 
    ships.forEach((ship) => {
      const inBox = bounds.contains(ship.sprite.x, ship.sprite.y);
      const clickedOnShip =
        clickedOnly &&
        Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, ship.sprite.x, ship.sprite.y) < 20;
 
      if (inBox || clickedOnShip) {
        ship.selectedRing.setVisible(true);
        selectedShips.push(ship);
      }
    });
 
    selectionBox.destroy();
    selectionBox = null;
    selectStart = null;
    updateSpeedHud();
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
 
  const selectedRing = scene.add.image(x, y, "selection-circle")
    .setDisplaySize(104, 104)
    .setDepth(3);
  selectedRing.setVisible(false);
 
  worldContainer.add([sprite, selectedRing]);
 
  return {
    sprite,
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
    maxSpeed: 90, // px/sec at Ahead Flank (100%) — the ship's absolute top speed
    acceleration: 108, // px/sec^2; matches ten reverse slowdown frames at 12 FPS
    deceleration: 108, // px/sec^2; matches ten slowdown frames at 12 FPS from max speed
    turnRate: Phaser.Math.DegToRad(20), // radians/sec
    speedOrderIndex: DEFAULT_SPEED_ORDER_INDEX,
  };
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
 
    // Once within braking distance of the final waypoint, the ship commits to
    // stopping there regardless of its current speed order — stopping is
    // stopping, not just "slow down to 1/3".
    const mustBrakeToStop = finalWaypoint && dist <= stoppingDistance;
    const commandedSpeed = getCommandedSpeed(ship);
 
    if (dist <= waypointReachLeeway) {
      completeWaypoint(ship);
    } else if (mustBrakeToStop) {
      if (!ship.slowingDown) startSlowdownAnimation(ship);
      ship.speed = Math.max(0, ship.speed - ship.deceleration * dt);
 
      // Discrete-time deceleration can zero out speed a few pixels short of
      // the exact waypoint position (waypointReachLeeway is 0), which would
      // otherwise leave the ship stalled forever with a target it can never
      // technically "reach". Treat hitting zero speed during final approach
      // as arrival and snap/complete instead of waiting for dist === 0.
      if (ship.speed <= 0) {
        completeWaypoint(ship);
      }
    } else {
      // Still under way toward the waypoint: steer as normal, and throttle
      // speed up or down toward whatever the current speed order calls for.
      const steeringTarget = getSteeringTarget(ship);
      const desiredAngle = Phaser.Math.Angle.Between(sprite.x, sprite.y, steeringTarget.x, steeringTarget.y) + Math.PI / 2;
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
          // Reached the newly-commanded cruise speed — resume steady cruising visuals.
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
 
function completeWaypoint(ship) {
  const completedWaypoint = ship.target;
  ship.sprite.setPosition(completedWaypoint.x, completedWaypoint.y);
  advanceToNextWaypoint(ship);
 
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
 
  for (let index = 0; state.target; index += 1) {
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