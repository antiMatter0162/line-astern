// Formation state and commands are independent of the editor's layout/inputs.
window.createFormationSystem = function createFormationSystem({ getShips, playerTeam, clearOrders }) {
  const formations = new Map();
  const memberships = new Map();
  let nextId = 1;
  const alive = (ship) => ship && !ship.sinking && !ship.sunk && ship.health > 0;
  const STATION_ENTER_DISTANCE = 20;
  const STATION_LEAVE_DISTANCE = 60;
  const STATION_HEADING_TOLERANCE = Math.PI / 36;

  function getMembership(ship) {
    return memberships.get(ship) || null;
  }

  function getWorldSlot(formation, ship) {
    const slot = formation.slots.get(ship);
    const leader = formation.leader.sprite;
    const offset = rotateSlot(slot, leader.rotation);
    return {
      x: leader.x + offset.x,
      y: leader.y + offset.y,
    };
  }

  function rotateSlot(slot, rotation) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { x: slot.right * cos + slot.forward * sin,
      y: slot.right * sin - slot.forward * cos };
  }

  function captureSlot(leader, position) {
    const dx = position.x - leader.sprite.x;
    const dy = position.y - leader.sprite.y;
    const cos = Math.cos(leader.sprite.rotation);
    const sin = Math.sin(leader.sprite.rotation);
    return { right: dx * cos + dy * sin, forward: dx * sin - dy * cos };
  }

  function stopFollowing(ship) {
    if (ship.target?.isFormationWaypoint) {
      ship.target = null;
      ship.continueStraightAfterWaypoint = false;
      ship.pathPreviewDirty = true;
    }
  }

  function disband(formation) {
    if (!formation || !formations.has(formation.id)) return;
    for (const ship of formation.slots.keys()) {
      memberships.delete(ship);
      stopFollowing(ship);
    }
    formations.delete(formation.id);
  }

  function setLeader(formation, leader) {
    if (!formation || !alive(leader) || !formation.slots.has(leader)) return false;
    const previousLeader = formation.leader;
    const continueCruising = !previousLeader.movementStopped
      && Boolean(previousLeader.target || previousLeader.continueStraightAfterWaypoint);
    const route = previousLeader === leader ? null : {
      target: previousLeader.target ? { ...previousLeader.target, marker: undefined } : null,
      waypoints: (previousLeader.waypoints || []).map(({ x, y }) => ({ x, y })),
    };
    const positions = new Map([...formation.slots.keys()].map((ship) => [ship, getWorldSlot(formation, ship)]));
    formation.leader = leader;
    formation.phase = "assembling";
    for (const [ship, position] of positions) {
      formation.slots.set(ship, ship === leader ? { right: 0, forward: 0 } : captureSlot(leader, position));
    }
    const membership = memberships.get(leader);
    membership.detached = false;
    membership.inStation = false;
    stopFollowing(leader);
    if (route) {
      leader.target = route.target;
      leader.waypoints = route.waypoints;
      leader.speedOrderIndex = previousLeader.speedOrderIndex;
      leader.movementStopped = previousLeader.movementStopped;
    }
    leader.continueStraightAfterWaypoint = continueCruising;
    for (const ship of formation.slots.keys()) {
      memberships.get(ship).inStation = false;
      if (ship !== leader && !memberships.get(ship).detached) clearOrders(ship);
    }
    return true;
  }

  function create(ships, leader = ships[0]) {
    const members = [...new Set(ships)].filter((ship) => alive(ship) && ship.team === playerTeam);
    if (members.length < 2 || !members.includes(leader)) return null;
    for (const ship of members) {
      const previous = memberships.get(ship);
      if (previous) {
        previous.formation.slots.delete(ship);
        memberships.delete(ship);
        stopFollowing(ship);
      }
    }
    const formation = {
      id: nextId++, leader, slots: new Map(), phase: "assembling",
    };
    for (const ship of members) {
      formation.slots.set(ship, captureSlot(leader, ship.sprite));
      memberships.set(ship, { formation, detached: false, inStation: false, returning: false });
      if (ship !== leader) clearOrders(ship);
    }
    formations.set(formation.id, formation);
    // Keep the leader's existing orders. Formation creation is not a move order.
    update(0);
    return formation;
  }

  function setSlot(ship, right, forward) {
    const membership = memberships.get(ship);
    if (!membership || ship === membership.formation.leader
      || !Number.isFinite(right) || !Number.isFinite(forward)) return false;
    membership.formation.slots.set(ship, { right, forward });
    membership.inStation = false;
    membership.formation.phase = "assembling";
    return true;
  }

  function returnToFormation(ships) {
    for (const ship of ships) {
      const membership = memberships.get(ship);
      if (!membership || !alive(ship) || ship === membership.formation.leader) continue;
      clearOrders(ship);
      membership.detached = false;
      membership.inStation = false;
      membership.returning = true;
      membership.formation.phase = "assembling";
    }
  }

  // A selected leader receives the group order; selected followers stay attached.
  // Without their leader selected, followers receive individual orders and detach.
  function routeOrder(ships, selectedShips = ships) {
    const selected = new Set(selectedShips);
    return ships.filter((ship) => {
      const membership = memberships.get(ship);
      if (!membership || ship === membership.formation.leader || membership.detached) return true;
      if (selected.has(membership.formation.leader)) return false;
      membership.detached = true;
      stopFollowing(ship);
      return true;
    });
  }

  function update() {
    const liveShips = new Set(getShips().filter(alive));
    for (const formation of formations.values()) {
      for (const ship of formation.slots.keys()) {
        if (liveShips.has(ship)) continue;
        formation.slots.delete(ship);
        memberships.delete(ship);
      }
      if (formation.slots.size < 2) {
        disband(formation);
        continue;
      }
      if (!formation.slots.has(formation.leader)) {
        const successor = [...formation.slots.keys()].find((ship) => !memberships.get(ship).detached);
        if (!successor) { disband(formation); continue; }
        setLeader(formation, successor);
      }
      const followers = [...formation.slots.keys()].filter((ship) =>
        ship !== formation.leader && !memberships.get(ship).detached);
      // Phase reports readiness; it never orders a stop.
      formation.phase = followers.every((ship) => {
        const slot = getWorldSlot(formation, ship);
        return memberships.get(ship).inStation
          && Math.hypot(slot.x - ship.sprite.x, slot.y - ship.sprite.y) <= STATION_LEAVE_DISTANCE;
      }) ? "sailing" : "assembling";
    }
  }

  function getCommandedSpeed(ship, requestedSpeed) {
    const membership = memberships.get(ship);
    if (!membership || membership.formation.leader !== ship) return requestedSpeed;
    const attached = [...membership.formation.slots.keys()]
      .filter((member) => member !== ship && alive(member) && !memberships.get(member).detached);
    let recovering = false;
    let greatestError = 0;
    for (const member of attached) {
      const slot = getWorldSlot(membership.formation, member);
      const distance = Math.hypot(slot.x - member.sprite.x, slot.y - member.sprite.y);
      greatestError = Math.max(greatestError, distance);
      recovering ||= !memberships.get(member).inStation || distance > STATION_LEAVE_DISTANCE;
    }
    // Slow the moving anchor enough for distant ships to gain ground. The
    // strictly positive floor prevents creation/edit/return commands from
    // becoming implicit stop orders, even when a slot is a long way away.
    const recoveryFraction = recovering ? Math.max(0.25, Math.min(0.85, 1 - greatestError / 800)) : 1;
    let turning = Math.abs(ship.rudder || 0) > 0.01 || Math.abs(ship.angularVelocity || 0) > 0.001;
    if (ship.target) {
      const desiredHeading = Math.atan2(ship.target.y - ship.sprite.y, ship.target.x - ship.sprite.x);
      const delta = desiredHeading - (ship.sprite.rotation - Math.PI / 2);
      turning ||= Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > Math.PI / 36;
    }
    // Outside stations travel farther during a turn and need speed in reserve.
    const fraction = Math.min(recoveryFraction, turning ? 0.75 : 1);
    return Math.min(requestedSpeed, ...attached.map((member) => member.maxSpeed * fraction));
  }

  function getSpeedOrderShips(ship) {
    const membership = memberships.get(ship);
    if (!membership || membership.formation.leader !== ship) return [ship];
    return [...membership.formation.slots.keys()].filter((member) =>
      alive(member) && !memberships.get(member).detached);
  }

  function limitRotationChange(ship, rotationChange, dt, limitAcceleration = true) {
    const original = ship.formationSource || ship;
    const member = memberships.get(original);
    if (!member || member.formation.leader !== original || dt <= 0 || !rotationChange) return rotationChange;
    const direction = Math.sign(rotationChange);
    const heading = ship.sprite.rotation - Math.PI / 2;
    const vx = Math.cos(heading) * ship.speed;
    const vy = Math.sin(heading) * ship.speed;
    let rate = Math.abs(rotationChange) / dt;
    let angularAcceleration = Infinity;
    const previousRate = ship.angularVelocity || 0;
    for (const [follower, slot] of member.formation.slots) {
      if (follower === original || !alive(follower) || memberships.get(follower).detached) continue;
      const offset = rotateSlot(slot, ship.sprite.rotation);
      const a = offset.x * offset.x + offset.y * offset.y;
      rate = Math.min(rate, follower.turnRate);
      const insideDistance = direction * slot.right;
      if (insideDistance > 0 && ship.speed > 0.01) {
        // Keep the turn center beyond the innermost station. Otherwise an
        // inside follower's required velocity crosses zero on a new course.
        rate = Math.min(rate, ship.speed * 0.65 / insideDistance);
      }
      if (a < 1) continue;
      const slotVx = vx - previousRate * offset.y;
      const slotVy = vy + previousRate * offset.x;
      const sensitivity = Math.abs(vx * offset.x + vy * offset.y)
        / Math.max(1, slotVx * slotVx + slotVy * slotVy);
      angularAcceleration = Math.min(angularAcceleration,
        follower.turnRate * 0.5 / Math.max(0.1, sensitivity),
        Math.min(follower.acceleration, follower.deceleration) / Math.sqrt(a));
      // Solve |leader velocity + angular velocity x offset| <= follower max speed.
      // This limits the group's turn before an outside ship is asked to outrun
      // its engines, rather than making it chase an unreachable rotating slot.
      const b = 2 * direction * (-vx * offset.y + vy * offset.x);
      const c = ship.speed * ship.speed - follower.maxSpeed * follower.maxSpeed;
      const discriminant = b * b - 4 * a * c;
      const availableRate = c > 0 || discriminant < 0 ? 0 : Math.max(0, (-b + Math.sqrt(discriminant)) / (2 * a));
      rate = Math.min(rate, availableRate);
    }
    // Ease into rotation so long columns have time to steer onto their arcs.
    // Speed limits alone allow a sudden sideways station velocity far astern.
    if (limitAcceleration && (Math.sign(previousRate) === direction || previousRate === 0)) {
      rate = Math.min(rate, Math.abs(previousRate) + angularAcceleration * dt);
    }
    return direction * rate * dt;
  }

  function getTurnRateLimit(ship, direction = 1) {
    return Math.abs(limitRotationChange(ship, (Math.sign(direction) || 1) * ship.turnRate, 1, false));
  }

  function getFollowerOrder(ship) {
    const membership = memberships.get(ship);
    if (!membership || membership.detached || membership.formation.leader === ship) return null;
    return predictFollowerOrder(ship, membership.formation.leader,
      membership.formation.slots.get(ship), membership);
  }

  // The short-horizon preview passes shadow ships and its own station state.
  function predictFollowerOrder(ship, leader, offset, membership) {
    const rotated = rotateSlot(offset, leader.sprite.rotation);
    const slot = { x: leader.sprite.x + rotated.x, y: leader.sprite.y + rotated.y };
    const heading = leader.sprite.rotation - Math.PI / 2;
    const angularVelocity = leader.angularVelocity || 0;
    const vx = Math.cos(heading) * leader.speed - angularVelocity * rotated.y;
    const vy = Math.sin(heading) * leader.speed + angularVelocity * rotated.x;
    const stationSpeed = Math.hypot(vx, vy);
    const stationRotation = stationSpeed > 0.01 ? Math.atan2(vy, vx) + Math.PI / 2 : leader.sprite.rotation;
    const stationHeading = stationRotation - Math.PI / 2;
    const forwardX = Math.cos(stationHeading);
    const forwardY = Math.sin(stationHeading);
    const dx = slot.x - ship.sprite.x;
    const dy = slot.y - ship.sprite.y;
    const distance = Math.hypot(dx, dy);
    const forwardError = dx * forwardX + dy * forwardY;
    const lateralError = -dx * forwardY + dy * forwardX;
    const shipHeading = ship.sprite.rotation - Math.PI / 2;
    const relativeSpeed = Math.hypot(
      Math.cos(shipHeading) * ship.speed - vx,
      Math.sin(shipHeading) * ship.speed - vy,
    );
    const headingError = Math.abs(Math.atan2(
      Math.sin(stationRotation - ship.sprite.rotation),
      Math.cos(stationRotation - ship.sprite.rotation),
    ));
    // A deadband prevents constant throttle corrections once a ship has formed up.
    // A larger exit distance lets matched ships keep station through small errors.
    if (distance > STATION_LEAVE_DISTANCE || headingError > Math.PI / 9) membership.inStation = false;
    else if (distance <= STATION_ENTER_DISTANCE && relativeSpeed <= 2
      && headingError <= STATION_HEADING_TOLERANCE) membership.inStation = true;
    if (membership.inStation) membership.returning = false;
    if (!membership.inStation && distance <= STATION_ENTER_DISTANCE && stationSpeed < 1) {
      // Finish braking and align before departure. Otherwise a ship at its slot
      // but facing away would repeatedly start behind and force another regroup.
      return { x: slot.x, y: slot.y, speed: 0,
        rotation: stationRotation, matchingSpeed: false,
        alignBeforeMoving: Boolean(membership.returning) };
    }
    // Correct along the station's course and across it independently. Clamp
    // forward speed at zero so an astern station can catch up without a U-turn.
    const deceleration = Math.max(0.01, ship.deceleration);
    const steeringTime = Math.max(2, (ship.rudderRampTimeSeconds || 2) / 2 + 1);
    const closingSpeed = membership.inStation
      ? (distance > 3 ? distance / 6 : 0)
      : Math.min(distance / steeringTime, Math.sqrt(2 * deceleration * distance));
    const correction = distance > 0 ? closingSpeed / distance : 0;
    const forwardSpeed = Math.max(0, stationSpeed + forwardError * correction);
    const lateralSpeed = lateralError * correction;
    const desiredSpeed = Math.hypot(forwardSpeed, lateralSpeed);
    const rotation = desiredSpeed > 0.01
      ? stationRotation + Math.atan2(lateralSpeed, forwardSpeed)
      : stationRotation;
    const turn = Math.abs(Math.atan2(Math.sin(rotation - ship.sprite.rotation), Math.cos(rotation - ship.sprite.rotation)));
    // Slow only when a tight turn requires it; long approaches retain full speed.
    const turnTime = turn / Math.max(0.01, ship.turnRate)
      + (ship.rudderRampTimeSeconds || 2) / 2;
    const turnSpeed = !membership.inStation && turn > Math.PI / 3
      ? Math.max(8, distance / turnTime) : ship.maxSpeed;
    return {
      x: slot.x + vx * 2, y: slot.y + vy * 2,
      speed: desiredSpeed > 0.01 ? Math.min(ship.maxSpeed, desiredSpeed, turnSpeed) : 0,
      rotation,
      matchingSpeed: membership.inStation,
      alignBeforeMoving: Boolean(membership.returning),
    };
  }

  function areStationMates(ship, other) {
    const a = memberships.get(ship);
    const b = memberships.get(other);
    return Boolean(a && b && !a.detached && !b.detached && a.formation === b.formation);
  }

  function clear() {
    for (const formation of formations.values()) disband(formation);
  }

  return { create, disband, setLeader, setSlot, returnToFormation, routeOrder,
    update, getMembership, getFollowerOrder, predictFollowerOrder, getCommandedSpeed, getSpeedOrderShips,
    limitRotationChange, getTurnRateLimit, areStationMates, clear };
};
