# client/src/world/cars: the valet's cars and your garage

Everything the cars slice draws on the ground floor. The city (`../city/`) lays the floor out: the
drive, the podium, the stalls, the street. This folder fills it with cars.

```ts
import { Cars, lotCars } from './world/cars/index.ts';

const cars = new Cars({ engine, world, now: serverNow, me: () => link.you?.id ?? null, onValet, onKeys });
engine.onFrame((dt) => cars.update(dt));  // hidden unless the camera is in ZONES.ground
link.subscribe((m) => cars.hear(m));      // the floor's `car` / `cars` messages
cars.setOwned(profile.owned, profile.name); // the garage shows what you own

// the city's parked cars: real models, one merged mesh per material (5-6 draw calls in all)
const lot = lotCars(stalls, cars.mats, { seed, collider });
```

| File | What |
|---|---|
| `specs.ts` | The twelve cars' shapes as data: a side silhouette, the glasshouse's, wheels, lamps, extras. Invented models only. |
| `models.ts` | The body builder (`carKit(id)`), and `MatBatch`: cars and fittings merged per material, the paint in the vertices. |
| `materials.ts` | One material per kind for every car: paint (clear coat on High), trim, metal, glass, lenses, lit lamps (`glow`), gold leaf. |
| `valet.ts` | The attendant at the podium, and the cars called round: out of the stacks, down the far lane into a curb space on the server's clock, a runner hands over the keys, off down the street when sent back. |
| `garage.ts` | The showroom across the street, drawn for the viewer from what they own: the dearest car on the turntable, plinths and plaques, "Buy at the valet" for the rest. |
| `studio.ts` | The valet panel's turntable room (60 m below the floor, the camera borrowed while it's open). |
| `layout.ts` | Stalls, the curb's paths, the garage's bays and collection order (pure; `client/test/cars.test.ts`). |
| `lot.ts` | `lotCars()`: parked cars for any stalls. |
| `dev.html` | `?view=lineup`, `?car=<id>&yaw=`, `?view=ground&at=stand\|lot\|garage\|street\|inside&owned=...` (window.dev.call(id), dev.back()). |

The server side: cars are bought with POST /shop/buy (a `casino_items` row, like any purchase), and
POST /shop/valet brings one you own round from the stand (server/src/cars.ts, floor/valet.ts,
shared/src/valet.ts). The panel is `client/src/ui/cars/valet.ts`.
