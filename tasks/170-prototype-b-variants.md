# 170 — Prototype B variants (LMP2 B, Hypercar B)

Status: pending
Phase: 2
Depends on: 112, 113, 114
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Add `lmp2-b` (`assets/vendor/cars/ligier-js-px/ligier_js_px.glb`) and `hyper-b` (`assets/vendor/cars/ferrari-499p/2023_-_2026_ferrari_499p.glb`) as models, car specs and picker entries, following 112/113/114.

## Context

Cut from 112 on 2026-10-14 after 4 fix rounds: lmp2-b has one material and wheels mixed into `Object_2..7`; hyper-b wheels sit inside `Vehicle_Exterior_mm_misc`. Quadrant assignment of whole primitives cannot isolate them (hub heights/radius off). Needs a planner design (e.g. per-triangle connected-component split near the hubs) before specifying. Not ready to dispatch: the planner completes Steps and the acceptance table first.

## Steps

TBD by the planner (design required).

## Acceptance tests (defined by the planner with Opus, before coding)

TBD.
