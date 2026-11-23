window.CHAPTER_1_LEVELS.push(
  {
    id: "1-2",
    name: "Battleship Encounter",
    description: "The enemy battleship Arizona is steaming toward your location. Sink Arizona to win.",

    ships: [
      {
        id: "player-battleship-1",
        name: "Pennsylvania",
        team: "player",
        shipType: "pennsylvania",
        position: { x: 12800, y: 8000 },
        headingDegrees: 270,
      },
      {
        id: "player-cruiser-1",
        name: "New Orleans",
        team: "player",
        shipType: "new-orleans",
        position: { x: 12000, y: 8000 },
        headingDegrees: 270,
      },
      {
        id: "enemy-battleship-1",
        name: "Arizona",
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

    winConditions: {
      operator: "all",
      conditions: [{ type: "defeat-enemy-ships", shipIds: ["enemy-battleship-1"] }],
    },
    // Reserved for defeat conditions.
    loseConditions: {
      operator: "any",
      conditions: [{ type: "all-friendly-ships-lost" }],
    },
  },
);
