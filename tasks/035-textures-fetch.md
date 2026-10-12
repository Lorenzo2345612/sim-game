# 035 — Fetch CC0 track textures

Status: pending
Phase: 1
Depends on: 024
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`npm run fetch:textures` downloads five CC0 PBR texture sets into `public/textures/`.

## Context

Picks, ids and zip URLs: `docs/research/track-textures.md` (ambientCG 1K JPG; use `_Color`, `_NormalGL`, `_Roughness`). Mapping: asphalt→Asphalt010, grass→Grass005, gravel→Gravel041, concrete→Concrete030, metal→Metal032. Zips download via redirect (follow it). Extract with the system `unzip` CLI (`child_process.execFileSync`, in a temp dir under `os.tmpdir()`), no new npm dependency. Never execute zip contents.

## Files

- `tools/assets/fetchTextures.ts` — create
- `package.json` — modify — script `"fetch:textures": "tsx tools/assets/fetchTextures.ts"`
- `public/textures/<surface>/{color,normal,roughness}.jpg` — create by running (commit)
- `ASSETS_LICENSES.md` — modify — one line per set, same columns as existing rows: name `<Surface> <Id>`, path `public/textures/<surface>/`, author `ambientCG`, license `CC0 1.0`, URL `https://ambientcg.com/a/<Id>`, third column flag as in other rows
- `tests/unit/acceptance/035-textures-fetch.test.ts` — create by the acceptance role

## Steps

1. For each set: if all three target files exist, skip with a log line; else download the zip, extract the three files, rename to `color.jpg`, `normal.jpg`, `roughness.jpg`.
2. Non-200 response or missing file in the zip → throw with the id; exit code 1.
3. The script does not edit `ASSETS_LICENSES.md`; the coder adds the five lines manually, once.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run fetch:textures` (network) | files | `public/textures/{asphalt,grass,gravel,concrete,metal}/{color,normal,roughness}.jpg` exist, each > 20 KB |
| AT2 | ASSETS_LICENSES.md | read | one line per texture set with ambientCG id, CC0, URL |
| AT3 | second run | `fetch:textures` | skips existing files (no download, exit 0) |

## Acceptance criteria

- [ ] 15 JPG files exist, each > 20 KB; second run downloads nothing.
- [ ] Five new lines in `ASSETS_LICENSES.md`.

## Verification

```
npm run typecheck
npm run lint
npm test
```
npm run fetch:textures

## Out of scope

- Using textures in render, mipmaps/resizing, alternative textures, displacement/AO maps.
