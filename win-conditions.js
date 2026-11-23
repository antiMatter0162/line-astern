window.createWinConditionEvaluator = function createWinConditionEvaluator(level, ships) {
  const group = level.winConditions;
  if (!group) return () => false;
  const shipsById = new Map(ships.map((ship) => [ship.levelShipId, ship]));

  // Each condition type resolves its level data once and returns a runtime check.
  const conditionTypes = new Map([
    ["defeat-enemy-ships", ({ shipIds }) => {
      if (!Array.isArray(shipIds) || shipIds.length === 0) {
        throw new Error(`Level ${level.id}: defeat-enemy-ships requires enemy ship IDs.`);
      }
      const targets = shipIds.map((id) => {
        const definition = level.ships.find((ship) => ship.id === id);
        const ship = shipsById.get(id);
        if (definition?.team !== "enemy" || !definition.name?.trim() || ship?.team !== "enemy") {
          throw new Error(`Level ${level.id}: victory target "${id}" must be a named enemy ship.`);
        }
        return ship;
      });
      // Keep the original ship references after sunk ships leave the active fleet.
      return () => targets.every((ship) => ship.sunk);
    }],
  ]);

  if (!["all", "any"].includes(group.operator) || !Array.isArray(group.conditions) || !group.conditions.length) {
    throw new Error(`Level ${level.id}: winConditions requires an all/any operator and at least one condition.`);
  }
  const checks = group.conditions.map((condition) => {
    const createCheck = conditionTypes.get(condition.type);
    if (!createCheck) throw new Error(`Level ${level.id}: unknown win condition "${condition.type}".`);
    return createCheck(condition);
  });
  return group.operator === "all"
    ? () => checks.every((check) => check())
    : () => checks.some((check) => check());
};
