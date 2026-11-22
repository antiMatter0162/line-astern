window.CHAPTER_1_LEVELS = [
  {
    id: "1-1",
    name: "Open Water Skirmish",
    description: "An enemy cruiser has been caught out of position. Now is the perfect opportunity to strike.",

    ships: [
      {
        id: "player-battleship-1",
        name: "Pennsylvania",
        team: "player",
        shipType: "pennsylvania",
        position: { x: 12800, y: 8000 },
        headingDegrees: 90,
      },
      {
        id: "player-cruiser-1",
        name: "New Orleans",
        team: "player",
        shipType: "new-orleans",
        position: { x: 12000, y: 8000 },
        headingDegrees: 90,
      },
      {
        id: "enemy-cruiser-1",
        name: "Astoria",
        team: "enemy",
        shipType: "new-orleans",
        position: { x: 7400, y: 9000 },
        headingDegrees: 135,
        ai: {
          profile: "default",
          parameters: {
            aggression: 1,
            preferredRange: null,
            battleshipAvoidanceDistance: 2250,
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
];
