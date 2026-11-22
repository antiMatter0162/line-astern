Welcome to Line Astern, a work-in-progress naval combat RTS game featuring big-gun ships. The current plan is to implement battleships, cruisers, destroyers, and small craft. There will be naval artillery and torpedo attack implementation. Aircraft carriers may be implemented depending on time and feasibility.

Controls:

Left click to select ship

Right click to issue waypoint order/classify hostile

F to toggle firing mode

Right click during firng mode to set firing orders

X to disable fire order

Formations:

Press G during gameplay to open the movable formation editor. Select two or
more friendly ships and choose "Create from selection" to capture their current
positions. The first selected ship leads. Drag followers on the simulated grid
to edit their stations in 50-unit increments; up is forward along the leader's
heading and right is to the leader's right.
The leader stays anchored at the center. Use zoom/fit to work with larger
layouts. Select a ship in the grid or roster and choose "Make selected ship
leader" to change the leader. Arrow keys on the focused grid also move the
selected follower by 50 units. Positions rotate with the leader, preserving the
formation's layout through turns. Outside ships speed up and inside ships slow
down as needed; the leader limits its turn so the other ships can keep up. Drag the
editor's heading to move its controls. Controls and labels use rectangular
buttons and the game's pixel font.

Ship names are predetermined by each level ship's `name` field and cannot be
edited in-game. Class name lists and numbered fallbacks cover definitions that
omit a name. The home screen's "Levels" menu opens the authored scenarios;
fleet-building dynamic campaigns are planned separately.

Move, stop, and speed orders given to a selected leader control the formation.
Followers selected alongside their leader remain attached. Giving a follower
one of these orders without selecting its leader detaches it while remembering
its assigned position. Select detached ships and press R or choose "Return to
formation" to rejoin. Firing remains independent of formation movement.
The leader keeps moving while followers form up, slowing to give them room to
catch up. Larger position errors reduce its speed further, with a positive
minimum so forming up, editing slots, and returning ships never order a stop.
Once ready, the group cruises at a speed the slowest attached ship can maintain.
Creating a formation preserves the leader's current movement orders: an idle
leader stays idle until given a move order, and an underway leader continues
its existing route. Changing leaders preserves the previous
leader's route and cruise/stop order. The editor shows "Forming up", "Under way",
or "Stopped" so this is visible.
Followers close at full available speed, braking for arrival and tight turns.
They match the leader's speed only after reaching their slot, aligning their
heading, and settling their relative speed. Displaced ships resume catch-up.
Returning ships brake while facing away from their approach, turn their bow
onto course, and only count as in position once within five degrees of the
required heading. During turns, that heading follows the ship's formation arc.
Normal waypoint changes do not apply this return-only alignment brake. Group
turns also keep their pivot beyond inside ships so those ships keep advancing.
Followers steer and accelerate normally; formations are approximate during
turns and collision avoidance. A surviving attached member takes over if the
leader sinks. Formations clear when changing levels.

Selecting any member shows a continuously updated three-second movement preview
for attached followers only, using the regular white path and one waypoint icon
at the end of each preview. The leader keeps its normal route display. Tactical view
shows follower previews for friendly formations.
Forecasts use the current orders and motion; collision steering and
formation speed corrections can change during that horizon as the preview updates.

Input placement is separate from the formation logic. Future HUD controls can
use `window.formationControls.create()`, `.returnToFormation()`, `.openEditor()`,
and `.closeEditor()`. Call `.setEditorPosition(x, y)` to reposition the editor or
`.mountEditor(element)` to move it to another DOM parent. The underlying
`.system` exposes `getMembership(ship)`, `setLeader(formation, ship)`,
`setSlot(ship, right, forward)`, and `disband(formation)` for custom controls.
In `setSlot`, `right` and `forward` are relative to the leader's heading.

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
