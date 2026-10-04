// Enemy ship decision making. Dependencies are injected by main.js so the AI
// can stay in its own file without owning the simulation state.
window.createEnemyAI = function createEnemyAI(deps) {
  const {
    Phaser,
    getShips,
    getSelectedShips,
    teams,
    mapWidth,
    mapHeight,
    speedOrders,
    defaultSpeedOrderIndex,
    setShipSpeedOrder,
    resetSustainedAimForTurn,
    removeWaypointMarker,
    createFireTarget,
    refreshShipDispersionEllipse,
  } = deps;

  const DECISION_INTERVAL = 0.75;
  const WAYPOINT_INTERVAL_MS = 20000;
  const AVOIDANCE_WAYPOINT_INTERVAL_MS = 1500;
  const TARGET_SWITCH_RANGE_FACTOR = 0.85;
  const BATTLESHIP_CLASS = 0;
  const CRUISER_CLASSES = new Set([1, 2]);
  const BATTLESHIP_AVOIDANCE_TRIGGER = 2150;
  const BATTLESHIP_AVOIDANCE_GOAL = 2250;
  const shipStates = new WeakMap();
  let decisionClock = 0;

  function getShipState(ship) {
    if (!shipStates.has(ship)) {
      shipStates.set(ship, {
        targetShip: null,
        formationSide: null,
        lastWaypointChange: -Infinity,
        lastAvoidanceWaypointChange: -Infinity,
      });
    }
    return shipStates.get(ship);
  }

  // Reads the per-level battleshipAvoidanceDistance from the ship's AI settings.
  // null/missing falls back to the built-in defaults (2150 trigger, 2250 goal).
  function getAvoidanceDistances(ship) {
    const configured = ship.aiSettings?.parameters?.battleshipAvoidanceDistance;
    if (configured == null) {
      return { goal: BATTLESHIP_AVOIDANCE_GOAL, trigger: BATTLESHIP_AVOIDANCE_TRIGGER };
    }
    return { goal: configured, trigger: configured - 100 };
  }

  function update(scene, dt) {
    decisionClock += dt;
    if (decisionClock < DECISION_INTERVAL) return;
    decisionClock %= DECISION_INTERVAL;

    const ships = getShips();
    const playerShips = ships.filter(
      (ship) => ship.team === teams.PLAYER && !ship.sinking && !ship.sunk,
    );
    ships.forEach((enemy) => {
      if (enemy.team !== teams.ENEMY || enemy.sinking || enemy.sunk) return;
      const isCruiser = CRUISER_CLASSES.has(enemy.shipClass);
      const battleships = isCruiser
        ? playerShips.filter((ship) => ship.shipClass === BATTLESHIP_CLASS)
        : [];
      const nearestBattleship = battleships
        .map((ship) => ({
          ship,
          distance: Phaser.Math.Distance.Between(
            enemy.sprite.x, enemy.sprite.y, ship.sprite.x, ship.sprite.y,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      const eligibleTargets = isCruiser
        ? playerShips.filter((ship) => ship.shipClass !== BATTLESHIP_CLASS)
        : playerShips;
      const nearestPlayer = eligibleTargets
        .map((target) => ({
          target,
          distance: Phaser.Math.Distance.Between(
            enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      const shouldAvoidBattleship = nearestBattleship
        && (nearestBattleship.distance < getAvoidanceDistances(enemy).trigger || !nearestPlayer);

      if (!nearestPlayer && !shouldAvoidBattleship) {
        clearEnemyAiTarget(enemy);
        clearEnemyAiDestination(enemy);
        return;
      }

      const state = getShipState(enemy);
      if (shouldAvoidBattleship) {
        const retreatDestination = getBattleshipRetreatDestination(enemy, battleships);
        const distanceToSafetyPosition = Phaser.Math.Distance.Between(
          enemy.sprite.x, enemy.sprite.y, retreatDestination.x, retreatDestination.y,
        );
        setAiSpeed(enemy, nearestBattleship.ship, distanceToSafetyPosition);
        setAiDestination(scene, enemy, retreatDestination, true);
        const preferredTarget = nearestPlayer?.target;
        const preferredDistance = nearestPlayer?.distance ?? Infinity;
        const battleshipDistance = nearestBattleship.distance;
        const preferredCanFire = preferredTarget
          && isWithinFiringRange(enemy, preferredDistance);
        const battleshipCanFire = isWithinFiringRange(enemy, battleshipDistance);
        const firingTarget = preferredCanFire
          ? preferredTarget
          : battleshipCanFire ? nearestBattleship.ship : null;
        const firingDistance = preferredCanFire ? preferredDistance : battleshipDistance;
        if (firingTarget) {
          state.targetShip = firingTarget;
          if (firingTarget === preferredTarget
            && state.formationSide == null) {
            state.formationSide = chooseFormationSide(enemy, firingTarget);
          }
          updateFireOrder(enemy, firingTarget, firingDistance);
        } else {
          state.targetShip = null;
          state.formationSide = null;
          clearEnemyAiTarget(enemy);
        }
        return;
      }

      if (!nearestPlayer) {
        clearEnemyAiTarget(enemy);
        clearEnemyAiDestination(enemy);
        return;
      }

      const currentTarget = eligibleTargets.find((candidate) => candidate === state.targetShip);
      const currentTargetDistance = currentTarget
        ? Phaser.Math.Distance.Between(
          enemy.sprite.x, enemy.sprite.y, currentTarget.sprite.x, currentTarget.sprite.y,
        )
        : Infinity;
      const canSwitchTarget = !currentTarget
        || currentTargetDistance
          >= enemy.stats.maxFiringDistance * TARGET_SWITCH_RANGE_FACTOR;
      const target = currentTarget && !canSwitchTarget ? currentTarget : nearestPlayer.target;
      const targetDistance = target === currentTarget
        ? currentTargetDistance
        : Phaser.Math.Distance.Between(
          enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y,
        );
      if (state.targetShip !== target) {
        state.targetShip = target;
        state.formationSide = chooseFormationSide(enemy, target);
      }

      const desiredRange = getEngagementRange(enemy);
      const targetHeading = target.sprite.rotation - Math.PI / 2;
      const beamAngle = targetHeading + Math.PI / 2;
      const side = state.formationSide || 1;
      const destination = {
        x: Phaser.Math.Clamp(
          target.sprite.x + Math.cos(beamAngle) * desiredRange * side,
          0, mapWidth,
        ),
        y: Phaser.Math.Clamp(
          target.sprite.y + Math.sin(beamAngle) * desiredRange * side,
          0, mapHeight,
        ),
      };
      const distanceToFormation = Phaser.Math.Distance.Between(
        enemy.sprite.x, enemy.sprite.y, destination.x, destination.y,
      );
      setAiSpeed(enemy, target, distanceToFormation);
      setAiDestination(scene, enemy, destination);
      updateFireOrder(enemy, target, targetDistance);
    });
  }

  function chooseFormationSide(enemy, target) {
    const beamAngle = target.sprite.rotation;
    const dx = enemy.sprite.x - target.sprite.x;
    const dy = enemy.sprite.y - target.sprite.y;
    return dx * Math.cos(beamAngle) + dy * Math.sin(beamAngle) >= 0 ? 1 : -1;
  }

  function getBattleshipRetreatDestination(ship, battleships) {
    const goal = getAvoidanceDistances(ship).goal;
    const nearest = battleships.reduce((closest, candidate) => {
      const distance = Phaser.Math.Distance.Between(
        ship.sprite.x, ship.sprite.y, candidate.sprite.x, candidate.sprite.y,
      );
      return !closest || distance < closest.distance ? { ship: candidate, distance } : closest;
    }, null);
    if (!nearest) return { x: ship.sprite.x, y: ship.sprite.y };

    const dx = ship.sprite.x - nearest.ship.sprite.x;
    const dy = ship.sprite.y - nearest.ship.sprite.y;
    const angle = Math.hypot(dx, dy) > 0
      ? Math.atan2(dy, dx)
      : ship.sprite.rotation - Math.PI / 2;
    return {
      x: Phaser.Math.Clamp(
        nearest.ship.sprite.x + Math.cos(angle) * goal,
        0, mapWidth,
      ),
      y: Phaser.Math.Clamp(
        nearest.ship.sprite.y + Math.sin(angle) * goal,
        0, mapHeight,
      ),
    };
  }

  function getEngagementRange(ship) {
    const { minFiringDistance, maxFiringDistance } = ship.stats;
    const upperBound = Math.min(1300, maxFiringDistance - 100);
    return Phaser.Math.Clamp(maxFiringDistance * 0.45, minFiringDistance + 200, upperBound);
  }

  function setAiSpeed(ship, target, distanceToFormation) {
    let desiredOrderIndex;
    if (distanceToFormation > 700) {
      desiredOrderIndex = speedOrders.length - 1;
    } else if (distanceToFormation > 300) {
      desiredOrderIndex = 3;
    } else if (distanceToFormation > 120) {
      desiredOrderIndex = defaultSpeedOrderIndex;
    } else {
      const targetSpeedFraction = target.speed / ship.maxSpeed;
      desiredOrderIndex = speedOrders.reduce((bestIndex, order, index) => {
        const bestDelta = Math.abs(speedOrders[bestIndex].fraction - targetSpeedFraction);
        return Math.abs(order.fraction - targetSpeedFraction) < bestDelta ? index : bestIndex;
      }, 0);
    }
    setShipSpeedOrder(ship, desiredOrderIndex);
  }

  function setAiDestination(scene, ship, destination, isAvoidance = false) {
    const state = getShipState(ship);
    if (!isAvoidance && ship.target && ship.target.isBoundaryTurn) return;
    const now = scene.time.now;
    const lastChange = isAvoidance
      ? state.lastAvoidanceWaypointChange
      : state.lastWaypointChange;
    const changeInterval = isAvoidance
      ? AVOIDANCE_WAYPOINT_INTERVAL_MS
      : WAYPOINT_INTERVAL_MS;
    if (now - lastChange < changeInterval) return;

    resetSustainedAimForTurn(ship, destination.x, destination.y);
    ship.target = { ...destination, isAiWaypoint: true, isAiAvoidanceWaypoint: isAvoidance };
    ship.waypoints = [];
    ship.braking = false;
    ship.continueStraightAfterWaypoint = true;
    if (isAvoidance) {
      state.lastAvoidanceWaypointChange = now;
      state.lastWaypointChange = -Infinity;
    } else {
      state.lastWaypointChange = now;
    }
    if (ship.pathLine) {
      ship.pathLine.destroy();
      ship.pathLine = null;
    }
  }

  function clearEnemyAiDestination(ship) {
    if (ship.target && ship.target.isAiWaypoint) ship.target = null;
    const state = getShipState(ship);
    state.targetShip = null;
    state.formationSide = null;
    ship.waypoints.forEach(removeWaypointMarker);
    ship.waypoints = [];
    if (ship.pathLine) {
      ship.pathLine.destroy();
      ship.pathLine = null;
    }
  }

  function updateFireOrder(ship, target, distance) {
    if (!isWithinFiringRange(ship, distance)) {
      clearEnemyAiTarget(ship);
      return;
    }

    if (ship.fireTarget && ship.fireTarget.targetShip === target) return;
    ship.fireTarget = createFireTarget(target.sprite.x, target.sprite.y, target);
    if (getSelectedShips().includes(ship)) refreshShipDispersionEllipse(ship);
    else if (ship.dispersionEllipse) {
      ship.dispersionEllipse.destroy();
      ship.dispersionEllipse = null;
    }
  }

  function isWithinFiringRange(ship, distance) {
    return distance >= ship.stats.minFiringDistance
      && distance <= ship.stats.maxFiringDistance;
  }

  function clearEnemyAiTarget(ship) {
    ship.fireTarget = null;
    if (ship.dispersionEllipse) {
      ship.dispersionEllipse.destroy();
      ship.dispersionEllipse = null;
    }
  }

  return { update };
};