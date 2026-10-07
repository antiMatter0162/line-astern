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
    clearShipFireTarget,
  } = deps;

  const DECISION_INTERVAL = 0.75;
  const BATTLESHIP_CLASS = 0;
  const shipStates = new WeakMap();
  let decisionClock = 0;

  function getParameters(ship) {
    const defaults = ship.stats.aiParameters;
    const overrides = ship.aiSettings?.parameters;
    const parameters = { ...defaults, ...overrides };
    // Preserve the latest level behavior: a configured retreat goal also moves
    // the trigger 100 units inward unless an explicit trigger is supplied.
    parameters.battleshipAvoidanceDistance = overrides?.battleshipAvoidanceDistance
      ?? defaults.battleshipAvoidanceDistance;
    parameters.battleshipAvoidanceTrigger = overrides?.battleshipAvoidanceTrigger
      ?? (overrides?.battleshipAvoidanceDistance != null
        ? parameters.battleshipAvoidanceDistance - 100
        : defaults.battleshipAvoidanceTrigger);
    return parameters;
  }

  // A linear scan preserves first-in-list tie breaking without sorting a fleet.
  function findNearestShip(origin, candidates) {
    let nearest = null;
    for (const ship of candidates) {
      const distance = Phaser.Math.Distance.Between(
        origin.sprite.x, origin.sprite.y, ship.sprite.x, ship.sprite.y,
      );
      if (!nearest || distance < nearest.distance) nearest = { ship, distance };
    }
    return nearest;
  }

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
      const parameters = getParameters(enemy);
      const battleships = parameters.avoidBattleships
        ? playerShips.filter((ship) => ship.shipClass === BATTLESHIP_CLASS)
        : [];
      const nearestBattleship = findNearestShip(enemy, battleships);
      const eligibleTargets = parameters.avoidBattleships
        ? playerShips.filter((ship) => ship.shipClass !== BATTLESHIP_CLASS)
        : playerShips;
      const nearestPlayer = findNearestShip(enemy, eligibleTargets);
      const shouldAvoidBattleship = nearestBattleship
        && (nearestBattleship.distance < parameters.battleshipAvoidanceTrigger || !nearestPlayer);

      if (!nearestPlayer && !shouldAvoidBattleship) {
        clearEnemyAiTarget(enemy);
        clearEnemyAiDestination(enemy);
        return;
      }

      const state = getShipState(enemy);
      if (shouldAvoidBattleship) {
        const retreatDestination = getBattleshipRetreatDestination(enemy, nearestBattleship, parameters);
        const distanceToSafetyPosition = Phaser.Math.Distance.Between(
          enemy.sprite.x, enemy.sprite.y, retreatDestination.x, retreatDestination.y,
        );
        setAiSpeed(enemy, nearestBattleship.ship, distanceToSafetyPosition);
        setAiDestination(scene, enemy, retreatDestination, true);
        const preferredTarget = nearestPlayer?.ship;
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

      const currentTarget = eligibleTargets.find((candidate) => candidate === state.targetShip);
      const currentTargetDistance = currentTarget
        ? Phaser.Math.Distance.Between(
          enemy.sprite.x, enemy.sprite.y, currentTarget.sprite.x, currentTarget.sprite.y,
        )
        : Infinity;
      const canSwitchTarget = !currentTarget
        || currentTargetDistance
          >= enemy.stats.maxFiringDistance * parameters.targetSwitchRangeFactor;
      const target = currentTarget && !canSwitchTarget ? currentTarget : nearestPlayer.ship;
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

  function getBattleshipRetreatDestination(ship, nearest, parameters) {
    const dx = ship.sprite.x - nearest.ship.sprite.x;
    const dy = ship.sprite.y - nearest.ship.sprite.y;
    const angle = Math.hypot(dx, dy) > 0
      ? Math.atan2(dy, dx)
      : ship.sprite.rotation - Math.PI / 2;
    return {
      x: Phaser.Math.Clamp(
        nearest.ship.sprite.x + Math.cos(angle) * parameters.battleshipAvoidanceDistance,
        0, mapWidth,
      ),
      y: Phaser.Math.Clamp(
        nearest.ship.sprite.y + Math.sin(angle) * parameters.battleshipAvoidanceDistance,
        0, mapHeight,
      ),
    };
  }

  function getEngagementRange(ship) {
    const { minFiringDistance, maxFiringDistance } = ship.stats;
    const parameters = getParameters(ship);
    const upperBound = Math.min(parameters.engagementRangeCap, maxFiringDistance - parameters.maximumRangeMargin);
    return Phaser.Math.Clamp(
      parameters.preferredRange ?? maxFiringDistance * parameters.engagementRangeFactor,
      minFiringDistance + parameters.minimumRangeMargin,
      upperBound,
    );
  }

  function setAiSpeed(ship, target, distanceToFormation) {
    const parameters = getParameters(ship);
    let desiredOrderIndex;
    if (distanceToFormation > parameters.flankDistance) {
      desiredOrderIndex = speedOrders.length - 1;
    } else if (distanceToFormation > parameters.fullDistance) {
      const fullOrderIndex = speedOrders.findIndex((order) => order.id === parameters.fullSpeedOrderId);
      desiredOrderIndex = fullOrderIndex < 0 ? defaultSpeedOrderIndex : fullOrderIndex;
    } else if (distanceToFormation > parameters.matchSpeedDistance) {
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
    const parameters = getParameters(ship);
    const now = scene.time.now;
    const lastChange = isAvoidance
      ? state.lastAvoidanceWaypointChange
      : state.lastWaypointChange;
    const changeInterval = isAvoidance
      ? parameters.avoidanceWaypointIntervalMs
      : parameters.waypointIntervalMs;
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
    clearShipFireTarget(ship);
  }

  return { update };
};
