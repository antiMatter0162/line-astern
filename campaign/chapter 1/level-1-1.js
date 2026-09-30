// Chapter 1, Level 1-1: Open Water Skirmish
// Ship positions use world units in the 25,600 x 16,000 playable area.
window.CHAPTER_1_LEVELS = [
  {
    id: "1-1",
    name: "Open Water Skirmish",
    description: "A small fleet engagement in open water.",

    ships: [
      {
        id: "player-battleship-1",
        team: "player",
        shipType: "pennsylvania",
        position: { x: 12800, y: 8000 },
        headingDegrees: 90,
      },
      {
        id: "player-cruiser-1",
        team: "player",
        shipType: "new-orleans",
        position: { x: 12000, y: 8000 },
        headingDegrees: 90,
      },
      {
        id: "enemy-cruiser-1",
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
