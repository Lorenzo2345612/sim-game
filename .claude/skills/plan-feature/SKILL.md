---
name: plan-feature
description: Break a feature or PRD phase of the racing sim into small task specs in tasks/ that cheap worker models (GLM/Kimi/Qwen flash) can implement without asking questions. Use when the user asks to plan, design, break down or start a feature, phase or milestone.
---

# plan-feature (Claude only, the planner)

Claude plans; it does not write production code. Tasks are executed by cheap flash models, which follow instructions literally, have little design judgment and get lost with large or ambiguous tasks. Each spec must compensate for that.

## Process

1. Read `PRD.md` (relevant sections), `CLAUDE.md` and whatever already exists in `src/` and `tasks/`.
2. If open product decisions change the design, ask the user before writing tasks.
3. Design the solution yourself: modules, public types, data flow, physics formulas with units. Architecture decisions are made here, not by the worker.
4. Split into tasks following the size rules. Decisions and experiments are done by you (or a `model: sonnet` subagent); spec writing is split among Agent subagents with `model: "sonnet"` in parallel (groups of non-overlapping tasks), never Opus. Give them the closed design and review their specs. Number with the next free number in `tasks/` (`001-`, `002-`…).
5. Write each task by copying `tasks/_TEMPLATE.md`.
6. If a task needs reusable knowledge (Three.js conventions, how to use Rapier, `track.json` format), write it once in `ai/guides/<topic>.md` and cite it from the tasks.
7. Update `tasks/README.md` (table: #, title, status, depends on, parallel with).
8. Summarize the plan to the user: task list, order and what will be viewable/testable at the end.

## Size rules for flash models

- One task = one verifiable behavior. At most ~3 `src/` files and ~300 new lines.
- If you need the word "and" to describe the goal, it is probably two tasks.
- Shared types and interfaces go in their own earlier task, so later ones import them instead of inventing them.
- Give exact signatures (`export function stepVehicle(state: VehicleState, input: DriverInput, dt: number): VehicleState`), constants with units and formulas. Not "implement a reasonable tire model".
- Acceptance criteria checkable with Vitest or a command. If a criterion is visual, define how to check it (Playwright screenshot, value in the HUD, etc.).
- Explicit "Out of scope" list: flash models tend to add things.
- Tasks with no dependencies between them and no shared files can run in parallel; mark it in `tasks/README.md`.

## Brevity (mandatory)

- Specs, guides and messages to the user: concise and to the point. No introductions, no repeating what is already in `ai/guides/`, no justifying the obvious.
- To the user: result in a few lines (what was done, what fails, what is next). No long summaries.
- When requesting work from workers or subagents: require minimal output (the report block, no extra text).
