# Track style (per-circuit visual fidelity)

Planner design, 2026-10-15. Source material: `docs/research/tracks/<id>-visual.md` (one per circuit, with photo references in `.ai/refs/<id>/`, git-ignored).

Today every track shares one look: grey pit building `#b8bcc0`, the same grandstands, red/white kerbs, the same barrier colours, a 3 m fence only behind armco, and no floodlights or trackside props. Only the HDRI, the satellite ground texture and fog density vary. This design makes those per-track data, then fills the data one circuit at a time.

Out of scope (owned elsewhere): vegetation and ground palette by environment type (156), city buildings and water (157/158), street trackside walls/lamps/billboards (159), named landmarks such as the Sphere, Maiden Tower or Marina Bay Sands (160), banking (174/175), night lighting and HDRIs (M2.2b). Floodlights here are geometry only (poles and heads), lit look comes with night mode.

## File

`public/tracks/<id>.style.json`, optional. Missing file or missing key = today's look (defaults reproduce the current renderer exactly). Colours are sRGB hex strings `#rrggbb`. Indices are centerline indices of `public/tracks/<id>.json`; a range `{start, end}` wraps past the last index like `pit`, `kerbs` and `barriers` already do. `side` is `left | right` (omitted = both). Range overrides on kerbs, run-offs and barriers apply per track segment: a segment takes the last matching range whose span contains the segment's `start` index and whose side matches.

```jsonc
{
  "version": 1,
  "palette": { "asphalt": "#hex", "grass": "#hex", "gravel": "#hex" },      // tints multiplied onto existing PBR albedo
  "edgeLines": { "color": "#hex" },
  "kerbs": {
    "colors": ["#hex", "#hex"],                                               // alternating blocks
    "outerStrip": "#hex",                                                     // optional painted strip outside the kerb
    "ranges": [{ "start": 0, "end": 0, "side": "left", "colors": ["#hex", "#hex"], "outerStrip": "#hex" }]
  },
  "runoffPaint": {
    // colors must come from public/flags/palettes.json for the track's country (new tracks add their country there); main field colours only, no black, no emblem colours
    "pattern": "none | solid | stripes | bands",                              // stripes: across the run-off; bands: parallel to track; both cycle through colors in order (1-4); solid uses colors[0]
    "colors": ["#hex"],
    "stripeMeters": 2,
    "ranges": [{ "start": 0, "end": 0, "side": "left", "pattern": "stripes", "colors": ["#hex"], "stripeMeters": 2 }]
  },
  "barriers": {
    "concrete": { "color": "#hex", "bandColor": "#hex" },                     // bandColor optional: horizontal band
    "armco": { "color": "#hex" },
    "tyres": { "beltColor": "#hex" },
    "foam": { "colors": ["#hex", "#hex"] },
    "fence": { "heightMeters": 3, "types": ["armco"], "color": "#hex" },   // types ⊂ armco|tyres|wall|foam (BarrierSegment.type); 0 = none
    "ranges": [{ "start": 0, "end": 0, "side": "left", "fenceHeightMeters": 4 }]  // per barrier segment, any type
  },
  "pitBuilding": {
    "storeys": 2, "heightMeters": 9, "depthMeters": 15,
    "facade": "#hex", "roof": "#hex", "doors": "#hex", "accent": "#hex",
    "roofStyle": "flat | canopy | folded | sail | curved",
    "glazing": 0.3                                                            // 0..1 share of the upper facade that is glass
  },
  "grandstands": { "structure": "#hex", "roof": "#hex", "seats": ["#hex"], "roofStyle": "flat | sail | truss" },
  "extraGrandstands": [{ "start": 0, "end": 0, "side": "left", "offsetMeters": 15, "rows": 12, "roof": true }],
  "floodlights": {
    "style": "arm | mast", "heightMeters": 8, "heads": 1, "spacingMeters": 20, "offsetMeters": 6,
    "side": "both | left | right",
    "ranges": [{ "start": 0, "end": 0 }]                                      // omitted = whole lap
  },
  "props": [{ "type": "footbridge | marshalPost | tent | scoreboard | billboardRow | tower", "index": 0, "side": "left", "offsetMeters": 10, "lengthMeters": 20, "heightMeters": 8, "color": "#hex" }],
  "sky": { "hdri": "<ENV_TABLE name>", "fogDensityScale": 1 }
}
```

Flag palette sources (for the rule above): Italy 2006 decree Pantone TCX; Belgium protocol guide Pantone 115/032 C; UK Flag Institute RGB; Mexico SEGOB Pantone 3425/186 C; USA State Dept Old Glory Red/Blue RGB; Qatar Law 14/2012 Pantone 1955 C; Bahrain flag guide Pantone 485 C; Malaysia ASEAN spec Pantone 199/2768 C; Azerbaijan flag law Pantone 306/032/362 C; Hungary MSZ 1361:2009 TCX; Singapore National Symbols Kit Pantone 032 C; Austria 2018 regulation Pantone 186 C.

Limits (parser rejects outside them): storeys 1-5, heightMeters 3-40 (pit), depthMeters 5-40, glazing 0-1, fence heightMeters 0-8, floodlight heightMeters 4-40, heads 1-12, spacingMeters 10-120, stripeMeters 0.5-10, seats 1-4 colours, kerb colours exactly 2, offsets 0-200 m, rows 4-40, props ≤ 60, fogDensityScale 0.25-4. Unknown keys: warning, ignored. Colours brighter than `#dadada` per channel (linear 0.7, the white-paint cap pinned by 172 AT3): each channel clamped to 0xda, warning.

## Tooling

`npm run track:locate -- <id> <lat> <lon>` prints the nearest centerline index, the side of the point and its distance, using the same projection as the builder. Per-circuit tasks use it to turn the research doc's lat/lon and turn positions into indices. `npm run check:styles` parses every `public/tracks/*.style.json` and fails on errors or warnings.

## Rendering

Every render module reads the parsed style through one object passed from `main.ts` (no global). Style changes materials and instance counts only at track load; nothing per frame. Debug hook: `__SIMGAME__.sceneStats().style` = `{ id, loaded, warnings }` (task 180). Render modules expose what they built in `group.userData` for unit tests.

## Tasks

Foundation (M1.2e): 179 schema + parser; 180 loader + wiring + extra grandstands + debug hook; 181 tools (locate, check:styles); 182 pit building and grandstand styling; 183 kerbs and run-off paint; 184 palette tints, edge lines, sky; 185 barrier colours and fences; 186 floodlights; 187 props. Per circuit (188-205): data only, `public/tracks/<id>.style.json`, from the research doc, no `src/` changes. A per-circuit task that finds a renderer gap escalates instead of coding.

## Colour predicates used by acceptance tests

Convert hex to HSL (h in degrees, s and l in 0..1). red: h ≥ 345 or h < 15, s ≥ 0.4; orange: 15 ≤ h < 40, s ≥ 0.4; yellow/gold: 40 ≤ h < 70, s ≥ 0.4; green: 70 ≤ h < 165, s ≥ 0.25; teal: 150 ≤ h < 195, s ≥ 0.2; blue: 195 ≤ h < 260, s ≥ 0.3; white: l ≥ 0.85; light: l ≥ 0.6; dark: l ≤ 0.3; cream/sand: 25 ≤ h < 60, s ≤ 0.6, l ≥ 0.6; grey: s ≤ 0.12. Shared helper: `tests/unit/acceptance/helpers/colour.ts` (created by 179's acceptance tests, reused by 188-205).

## Open notes for the next session

- Track JSON has no geo origin; `track:locate` (181) must take the origin from `tools/track-builder/tracks.json` and project with `src/track/geo.ts` `projectLonLat`.
- Defaults are `null` = "renderer default" for colours, except pit facade `#b8bcc0` and doors `#1c1c1e`; pit storeys 1, height 4, depth 8, roofStyle flat, glazing 0; fence `{heightMeters: 3, types: ['armco']}`.
- `sky.hdri` is validated against a `SKY_NAMES` list in `src/track/trackStyle.ts` (no `three` import there).
- Renderer functions get an optional trailing `style` parameter added by 180, so 182-185 do not touch `main.ts`; only 186 and 187 do (187 depends on 186).
- Per-circuit deps: all foundation tasks; fontana, cleveland and detroit also depend on 168.
