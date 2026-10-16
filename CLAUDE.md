# sim-game

New session? Read `docs/STATUS.md` first, then use skill `pipeline-ops` and follow its "Short orchestration session" routine. Pipeline code is frozen while a milestone is open (`docs/pipeline-backlog.md`).

Web simulator of single-seaters on real circuits. Requirements and decisions in `PRD.md` (the decisions table is in section 14).

## Model roles

| Who | Model | Does | Does not |
|---|---|---|---|
| Planner | Claude Opus (main session) | Complex feature analysis and the acceptance tests table of every spec; nothing else | Write code in `src/`, `tests/`, `tools/` (blocked by hook) |
| Planning subagents | Claude Sonnet | Simple feature analysis, spec writing/review, dispatch orchestration, research | Edit acceptance tables |
| acceptance | MiMo `mimo-v2.6-flash` (Qwen plan ended 2026-10-16) | Turns the acceptance table into failing tests in `tests/unit/acceptance/` before coding | Edit `src/` |
| coder | GLM `glm-5.3-flash` (heavy: `glm-5.3`) | Implements a spec | Design or expand scope |
| tester-pre / tester | MiMo `mimo-v2.6-flash` (heavy: `mimo-v2.6-pro`) | Complex tasks only: edge tests before coding, gap tests after | Edit `src/` or acceptance tests |
| reviewer | Kimi `k3-256k` (heavy: `k3`, 1M ctx, ~2× quota) | Validates against the spec, runs checks | Edit files |
| fixer | MiMo `mimo-v2.6-pro` | Second opinion when the coder gets stuck | — |
| Sonnet lane | Claude `claude-sonnet-5-5` (subscription) | Coder for tasks listed under `claude` in `ai/experiments.json`; stops at 85 % of the 5 h window | — |
| fallback | Xiaomi MiMo `mimo-v2.6-flash` (heavy: `mimo-v2.6-pro`) | Replaces any role when its provider runs out of quota (automatic) | — |

To move all roles to MiMo: `SIMGAME_PROVIDER=mimo`. For a single run: `--provider mimo`.

Configuration in `ai/providers.json`; launcher in `scripts/ai/worker.py`; coder A/B (GLM vs MiMo) in `ai/experiments.json`; token metrics: `python3 scripts/ai/metrics.py`. Flow: skill `plan-feature` → skill `dispatch`.

## Stack

Strict TypeScript, Vite, Three.js, Rapier (`@dimforge/rapier3d-compat`), Vitest, Playwright. UI in HTML/CSS without React. Package manager: npm.

## Commands

```
npm run dev         # dev server
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run test:e2e    # playwright
```

## Structure

```
src/core      fixed-step game loop, events, state
src/physics   Rapier, vehicle model, tires, aero
src/render    scene, cameras, materials, post-processing, LOD
src/track     track.json + .glb loading, checkpoints, surfaces
src/input     keyboard, gamepad
src/audio     engine and effects
src/ui        HUD and menus (DOM)
tools/        offline pipelines (track-builder, asset-optimize)
tests/unit    Vitest
tests/e2e     Playwright
assets/       models and textures; each one's license in ASSETS_LICENSES.md
tasks/        task specs for workers
ai/           worker configuration, role prompts and guides
```

## Conventions

- SI units everywhere in the code: meters, seconds, kilograms, radians, newtons. Conversion to km/h only in the UI.
- Coordinate system: Y up, the car faces -Z in its local space.
- The simulation advances with a fixed step (`FIXED_DT = 1/120` s) and does not depend on framerate. Render interpolates.
- Simulation logic imports nothing from `three` (it must run in tests without WebGL).
- Release discarded geometries, materials and textures with `dispose()`. Do not create objects (`new Vector3`, arrays) inside the per-frame loop: reuse temporaries.
- No asset enters `assets/` without its line in `ASSETS_LICENSES.md`.

## Language

All files, code, comments, specs, docs, commits and prompts to subagents/workers in English. Only messages to the user are in Spanish.

## Brevity

No verbose output; minimal comments; reports and replies short and to the point.

## Reuse

Anything done more than once becomes a skill (`.claude/skills/`) or an agent (`.claude/agents/`) instead of being rediscovered. Current ones: skills `plan-feature`, `pipeline-ops`, `dispatch`, `physics-lab`, `render-preview`, `milestone-review`, `track-data`; agents `spec-writer`, `spec-reviewer`, `asset-scout` (all sonnet); workers via `scripts/ai/worker.py`, unattended runs via `scripts/ai/orchestrator.py`, dashboard `scripts/ai/dashboard.py`.

## Planning subagents

Planning subagents run on Sonnet (`model: sonnet`), never Opus. Opus is reserved for acceptance tests and complex feature analysis.

## Memory

Save only non-derivable facts, one or two lines each; never read or rely on other projects' memory.
