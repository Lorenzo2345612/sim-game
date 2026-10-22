# Neuro-evolution trainer: profile and rewrite assessment (2026-10-21)

Question: would rewriting the trainer (Rust native, C++, Python+JAX) make training materially faster?
Short answer: not worth it now. Use all cores first (~1.9x), then a few JS fixes (~10-15%). A native port is at most ~2x (bit-exact) to ~2.8x (not bit-exact) for weeks of work and a permanent dual-maintenance cost.

## Method

- Harness: `scripts/dev/trainer-prof.mts` spawns the real `scripts/evolve/worker.mts` (1 worker, Cleveland, F4, mintime line, residual + racecraft, same flags as the live run), sends one eval of a single episode (aggr11 genomes + 6 zero-weight opponents), `nice -n 19`, `--cpu-prof` on the worker thread (0.5 ms sampling).
- `scripts/dev/trainer-micro.mts`: 11 cars coasting on the grid, times `prePhysicsStep`, `world.step` and raw ray casts separately.
- Summaries: `scripts/dev/prof-sum.mjs`, `prof-incl.mjs`, `prof-sub.mjs` (self time, inclusive time, subtree by category).
- Machine was loaded (load avg 7-12 on 11 cores, live 4-worker run at nice 19), so absolute numbers are +-30 %; ratios are stable. Rapier 0.21.0 (WASM, f32, no SIMD).

## Throughput (one worker, one core)

| World | Wall per sim second | Per car-step (1/120 s) |
|---|---|---|
| 11 cars (5 trainees + 6 opponents) | 0.058-0.108 s | 44-60 us |
| 31 cars (25 + 6, the live run's world) | 0.157 s | 42 us |

- Cost is linear in cars (no contact blow-up): ~5-7 ms CPU per car-sim-second, i.e. ~150-200 car-sim-seconds per core-second (~190x real time per car).
- Live run: 4 workers x 31 cars, gen time 80-290 s (grid episode up to 6 laps + 2 short episodes, x2 evals). Per-thread CPU over 20 s was 0.7, 0.8, 1.03, 1.03 cores: two workers are starved by the other jobs on the box, and the generation barrier makes everyone wait for the slowest.

## Breakdown (percent of episode CPU, worker thread, steady state)

Raw profile percentages are of the whole 7.6 s run, which includes ~12 % module load and world build (amortised away in a long run). Normalised to the episode loop (87.7 % of the profile):

| Component | % | Notes |
|---|---|---|
| `world.step()` (Rapier WASM) | 39 | 11 bodies, 2-6 colliders each; 13 us/car-step even with all car colliders removed (fixed per-body cost), colliders add ~30 % |
| Wheel ray casts (`castRayAndGetNormal`, 4 per car-step) | 25 | ~15 wasm (BVH vs trimesh/heightfield) + ~8 JS glue (hit object, normal, collider lookup) |
| `applyImpulseAtPoint` (4-5 per car-step) | 5 | almost all wasm-bindgen glue |
| Other Rapier getters (`linvel`, `angvel`, `translation`, `rotation`) | 2 | glue |
| **Rapier total (wasm + glue)** | **~70** | wasm ~49, JS glue ~18, wasm-to-js ~3 |
| Vehicle model JS (`wheelSolver`, `tyre`, `vehicleModel`, `powertrain`) | 15 | `tyre.magic` 5, `solveSlip`/`fxAt` 6 |
| `TrackProgress.update` (nearest segment) | 4 | scans 201 segments with modulo per call |
| Worker bookkeeping (fitness, others list, limits, telemetry copy) + racecraft | 5 | |
| `AiDriver` (classic) | 2.5 | |
| Net inference + `NeuralFeatures.fill` | 2 | negligible: the net is tiny, called every 4th step |
| GC | 3 | few per-tick allocations left (`linvel()` objects, ray hit objects inside Rapier JS) |

Conclusions:

- ~70 % of the time is Rapier, of which a quarter is JS/WASM glue rather than physics.
- Our own JS (vehicle + AI + net + reward) is ~27 %. Net, reward and AI are not the bottleneck.
- No JSON copies or per-tick allocation problems in the hot loop; GC is 3 %.
- Rays: `getTelemetry` rays are already cached for the following `prePhysicsStep` (same pose), so no duplicate casting.

## Obvious waste found (small)

1. `progress[k].update()` is called before the decision at `step % 4 == 0` with the same position as the post-step update of the previous step: duplicate work (~1 %).
2. `TrackProgress.search` scans a +-100 segment window with `%` on every call; +-10 plus edge fallback would cut it ~10x (~3-4 %).
3. Four `applyImpulseAtPoint` calls per car-step could be one summed impulse/torque call (~3-4 %); rounding differs at the last bit but game and trainer would change together since they share `src/physics`.
4. `castRayAndGetNormal` allocates a hit object per ray; the surface and normal could be read from a lighter path if Rapier exposes one (~2-4 %).
5. Redundant opponents: each world re-simulates the same 6 frozen opponents (19 % of cars at 4 workers, 37 % at 10).

## Options ranked (speed-up vs effort/risk)

| # | Option | Expected speed-up | Effort | Risk |
|---|---|---|---|---|
| 1 | Run more workers (`--workers 10` on 11 cores, when the box is free) | ~1.9x per generation (per-worker world 31 -> 16 cars; opponents overhead rises 24 % -> 37 %, so not 2.5x) | none | none; fewer cars per world also shortens the barrier tail |
| 2 | Cut opponents per world 6 -> 4, or `--evals 1` for exploratory runs | 1.1x / up to 2x on wall per gen (statistical cost: noisier fitness) | none | training quality, not physics |
| 3 | JS hotspot fixes (items 1-4 above) | 1.10-1.15x | 1-2 days | low (bit-level changes shared by game and trainer; re-run physics tests and a bench lap) |
| 4 | Dynamic scheduling: split each generation into many small tasks instead of one fixed batch per worker | 1.1-1.3x when workers are unevenly loaded (as now) | 1 day in `evolve.mts` | low |
| 5 | `worker_threads` tuning (pinning, `--max-semi-space-size`) | <=1.03x | hours | none; GC is already 3 % |
| 6 | Fewer physics substeps (60 Hz) | up to 2x | small code | rejected: changes the vehicle behaviour, trainer would no longer equal the game (game runs 120 Hz) |
| 7 | Native Rapier (Rust, same crate version, `enhanced-determinism`, no SIMD) + port of vehicle model, AiDriver, features, surfaces, track colliders | ~2x upper bound (Rapier 70 % -> ~47 % at 1.5x native vs WASM; JS 27 % -> 9 % at 3x) | 3-6 weeks | high: f32 bit-exactness only holds with identical Rapier version and no SIMD/FMA; our JS f64 `sin/cos/atan2/pow` must match V8 (fdlibm) exactly or be validated statistically; permanent dual maintenance of every physics/AI change |
| 8 | Same with SIMD / parallel features | ~2.8x upper bound | 3-6 weeks | as above and no longer bit-exact: only statistically equivalent to the game |
| 9 | Python + JAX / GPU | not applicable | months | Rapier trimesh/heightfield contacts and ray casts do not map to JAX; a different physics engine breaks "trainer = game" and the sim-to-game gap would dominate |

## Recommendation

1. Do not rewrite. The ceiling is ~2x for weeks of work, and every physics change would need to be mirrored in two codebases.
2. Take the free gain: 8-10 workers when the box is idle (~1.9x), and item 4 (task queue) to remove the generation barrier tail.
3. Queue a small spec for the JS hotspot fixes (10-15 %), after the milestone freeze on pipeline/physics code lifts.
4. Spend further effort on the training algorithm (evals per genome, grid-episode length, opponent count) rather than the engine: that is where multi-x wall-clock savings still are.

Reproduce: `nice -n 19 npx tsx scripts/dev/trainer-prof.mts 120 /tmp/prof && node scripts/dev/prof-sum.mjs /tmp/prof/*.cpuprofile` (`NT=25` for the 31-car world); `npx tsx scripts/dev/trainer-micro.mts 11`.

## Update 2026-10-21: trainer changes (scripts/evolve)

- Work queue: workers pull chunks one at a time; default chunk = ceil(pop/workers), so fitness is identical (checked: pop 10, 2 gens, 2 workers, fixed seed, old vs new fitness arrays byte-identical). `--chunk N` makes more tasks than workers; it only pays off with uneven worker load, since every world re-simulates the opponents (measured on a loaded box: `--chunk 2` was slower, 62-80 s vs 24 s per gen).
- New opt-in flags: `--seed N` (deterministic trainer and per-batch worker rng), `--chunk N`, `--fault-split` (fault rule documented in `racecraft.mts`), `--league K` (snapshot of the best genome every 25 gens, opponents drawn from hall of fame, current elite and the last K snapshots; snapshots are not restored on `--resume`).
- Done in the trainer: duplicate `progress.update()` at decision time removed (uses `current`).
- For later (src/, frozen): `TrackProgress.WINDOW = 100` scans 201 segments per call with `%`; +-10 plus the existing full-search fallback would cut ~3-4 %. Also merge the 4-5 `applyImpulseAtPoint` calls per car-step into one (~3-4 %), and avoid the per-ray hit allocation.
