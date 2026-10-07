Welcome to Line Astern, a work-in-progress naval combat RTS game featuring big-gun ships. The current plan is to implement battleships, cruisers, destroyers, and small craft. There will be naval artillery and torpedo attack implementation. Aircraft carriers may be implemented depending on time and feasibility.

Controls:

Left click to select ship

Right click to issue waypoint order/classify hostile

F to toggle firing mode

Right click during firng mode to set firing orders

X to disable fire order

AI tuning:

Ship type files can supply `aiParameters` to override the defaults in
`ship-types.js`. A level's `ai.parameters` overrides those settings for that
individual ship. Current default values preserve the existing tactics.

Supported settings include `avoidBattleships`, `battleshipAvoidanceTrigger`,
`battleshipAvoidanceDistance` (retreat goal), `targetSwitchRangeFactor`,
`preferredRange`, `engagementRangeFactor`, `engagementRangeCap`,
`minimumRangeMargin`, `maximumRangeMargin`, `flankDistance`, `fullDistance`,
`matchSpeedDistance`, `fullSpeedOrderId`, `waypointIntervalMs`, and
`avoidanceWaypointIntervalMs`. Distances use world units; waypoint intervals
use milliseconds. A null `preferredRange` uses the firing-range formula;
preferred ranges are bounded by the configured range margins and cap.
Heavy and light cruisers avoid battleships by default; other classes do not.
An individual ship's configured avoidance distance also sets its trigger 100
units closer, unless `battleshipAvoidanceTrigger` is explicitly supplied.
A null avoidance distance keeps the ship-type default.
`profile` and `aggression` remain reserved for future behavior.
