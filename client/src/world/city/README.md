# client/src/world/city: the elevators, the ground floor and the roof

The casino's lobby has an elevator. It goes down to the ground floor (a valet lobby, the valet's
parking, the street, and across it the jail and the garage) and up to a terrace on the roof over
the city at sunset. `createWorld` builds a `City` (`world.city`) and hands it the floor socket
through `world.useFloor(link)` (app/boot.ts).

## Zones

`shared/src/zones.ts` puts the casino, the ground floor and the roof in one scene, far apart
(`ZONES`, centimetres). `world.zone` is the zone the walker stands in; only it is drawn:

- In the casino nothing of the city exists until you first go there. `city.prepare(zone)` builds a
  zone (ground.ts, roof.ts) and compiles its shaders; the ride does it behind the dark.
- Out of the casino its own pieces (the building's batch and glows, signs, directories, furniture,
  props, stations, staff, mannequins, the floor's crew) are hidden, its doorway culling and its
  rooms' lights stand still, and the zone's light replaces the rooms' (`City.light`: the lobby's
  warm light inside the valet lobby, the night outside, the low sun on the roof). The camera's far
  plane goes out to 700 m for the skyline and comes back to the engine's 200 in the casino.
- Other players in another zone aren't drawn (`world.canSee` asks `city.sees`), and tall
  neighbouring towers stand between each zone and the casino, so nothing of one shows in another.
- The map (N, or the HUD's button) shows the zone you're in (map.ts through wayfinding.ts's
  `elsewhere`).

## The elevators

`shared/src/lifts.ts` says where each zone's bank is (`LIFTS`: the middle of its front, the way
its doors face, how many cars) and where a ride arrives (the middle of the bank's first car,
facing the doors). Moving the casino's elevator is that one line.

bank.ts builds a bank: black marble (granite on the roof) with a bronze portal round each door,
an indicator over each door, a call plate, and cars panelled in the wainscot with a mirror, a
rail and a lit ceiling. The static pieces go into the zone's batch (the casino's into the lobby's,
so they're drawn and hidden with the lobby). The doors are one instanced mesh: each car's pair opens
for anyone at its doorway or in the car (a sensor), stays open a moment after, and closes when
nobody's there, or at once when that car is taking someone.

- In front of a closed car: `E · Call the elevator` opens it. Walk in: `E · Choose a floor`
  opens the car's panel (ride.ts): the floors top to bottom, this one lit; R, C or G (or 1-3, the
  arrows and Enter), Esc keeps the doors open. Touch: the action button, then tap a floor.
- The ride: the walker stands in the middle of the car facing the doors, the camera goes to the
  car's back corner, the doors close, the floor socket is asked (`lift`), and the view goes dark
  with the indicator counting the floors (DSEG7, the arrow the way you go). The server's `tp` puts
  you in the other bank's car; when the count ends the dark lifts, the chime rings, the doors open
  and you walk out. `lift.no` (not at the doors, at a table, held by security) reopens the doors
  with the floor's words in a toast.
- `tp` outside a ride (security taking you to the jail, letting you go) moves you at once: off
  any seat, the camera behind you, the zone switched.
- Sounds (sound.ts) are made on the game's audio context: the chime, the doors, the ride's hum.

## The ground floor (ground.ts, plan.ts)

A hall of honey limestone and black marble: the elevators in its back wall, a concierge desk,
columns, two chandeliers, sofas on rugs, a round table of flowers, downlights and a lit cove. Glass
doors slide open onto the porte-cochere: the valet stand (`VALET_STAND`), the drive with its pickup
spot (`PICKUP`), a plaza with palms and the name in stone, the valet's stacked rows and two surface
lots (`stalls()`: 112 stalls, most with a car in them). The street has four lanes, a crosswalk,
lamps and signals, and traffic (parking.ts `Traffic`) that stops for anyone on the road ahead of
it. Across the street the jail's and the garage's lots (`LOTS`) are theirs to build; their front
doors meet the sidewalk at `ENTRANCES`. Around it all: near towers with lit windows, three rings of
skyline, a night sky with stars, red beacons on the tallest towers (steady when calm).

`parkedCars()` is the one place parked cars are made (stand-ins until the cars slice's models).

## The roof (roof.ts)

A teak deck behind a glass rail, the elevators in a granite pavilion under a flat roof at its
east end. Loungers along the west rail, a coin telescope on the prow, two sofa groups round fire
tables under strings of bulbs, a bar with stools on the north side, planters along the south. The
sun sits low in the west-south-west (`SUN_DIR`); the sky dome paints its glow and streaks of cloud,
the towers catch it on their west faces, the skyline fades into haze in three rings, and the streets
are a lit grid far below. The loungers, sofas and stools are sit-anywhere seats (`roof.*` ids),
added to the floor's seating when the roof is first built.

## Cost

Each zone is a batch per material, one glow mesh, one pool mesh, instanced props, two instanced
meshes of parked cars, three for the traffic, one mesh of towers, a ring per skyline layer, the sky
dome and the beacons. `node scripts/e2e/city6.mjs <port> <dir> dev` measures the busiest views:
the ground floor under 70 draw calls on High, the roof under 65 (Low: about 50). Textures are drawn
on canvases (4096 wide for a skyline ring on High, 2048 on Low); Low also drops the far ring and a
car per lane.

## Checks

- `shared/test/lifts.test.ts`: the banks, cars and arrivals, the reach, the refusals, the floors.
- `server/test/lift.test.ts`: rides through the real floor object (casino, ground, roof and back,
  everyone hearing where you are), refusals (far, same floor, a made-up floor, at a table, held),
  a stale move after a ride, a reconnect in another zone.
- `client/test/city.test.ts`: the casino's elevator clear of the lobby's furniture and reachable
  from the doors; the stalls, the valet stand, the pickup and the lots' doors; the roof's deck.
- `node scripts/e2e/city6.mjs <port> <dir> [dev] [game]`: every view of both zones on High and
  Low with draw calls, a ride on the dev floor; logged in with two players, the whole trip down,
  across the street, up to the roof, a lounger, and back, with the other player's view.
