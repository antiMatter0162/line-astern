window.CHAPTER_1_LEVELS.push(
  {
    id: "1-2",
    name: "Battleship Encounter",
    description: "A battleship is steaming toward your location. Engage and destroy it.",

    ships: [
      {
        id: "player-battleship-1",
        team: "player",
        shipType: "pennsylvania",
        position: { x: 12800, y: 8000 },
        headingDegrees: 270,
      },
      {
        id: "player-cruiser-1",
        team: "player",
        shipType: "new-orleans",
        position: { x: 12000, y: 8000 },
        headingDegrees: 270,
      },
      {
        id: "enemy-battleship-1",
        team: "enemy",
        shipType: "pennsylvania",
        position: { x: 3000, y: 9000 },
        headingDegrees: 45,
        ai: {
          profile: "default",
          parameters: {
            aggression: 1,
            preferredRange: null,
            battleshipAvoidanceDistance: null,
          },
        },
      },
      
    ],

    // Declarative objectives are included for the future level evaluator.
    // Conditions are not evaluated by gameplay yet.
    winConditions: {
      operator: "all",
      conditions: [{ type: "destroy-all-enemies" }],
    },
    loseConditions: {
      operator: "any",
      conditions: [{ type: "all-friendly-ships-lost" }],
    },
  },
);
