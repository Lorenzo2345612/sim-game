---
name: physics-lab
description: Run planner-side Rapier experiments to calibrate or verify vehicle physics constants and API behaviour before writing specs. Use when designing or tuning car physics, checking a Rapier API sign/axis, or when a physics spec keeps failing.
---

# physics-lab (planner only)

Verify physics facts by experiment, never by guessing. Results feed `ai/guides/architecture.md`.

1. Requires repo `npm install` done (Rapier resolved from repo `node_modules`). If not available yet: `mkdir -p /tmp/physics-lab && cd /tmp/physics-lab && npm init -y && npm i @dimforge/rapier3d-compat@0.21.0`, copy the script there and run it there.
2. Edit the `CAR` constants in `ai/lab/vehicle-calibration.mjs` (or add a new `ai/lab/<topic>.mjs` for a new question; keep one question per script).
3. `node ai/lab/vehicle-calibration.mjs` — prints 0-100, top speed, braking decel, high-speed steering stability.
4. Targets for the placeholder car: 0-100 in 3–4 s, top 210–240 km/h, braking 12–20 m/s², no flip at full steer.
5. Copy verified values/facts into `ai/guides/architecture.md` ("Placeholder car", "Rapier: verified facts") and update affected specs.

Brevity: report to the user only the numbers that changed.
