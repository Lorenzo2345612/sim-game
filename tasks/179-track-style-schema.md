# 179 — TrackStyle schema, defaults and parser

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`src/track/trackStyle.ts` defines the per-circuit style data model, its defaults, a validating parser and range helpers. Pure TypeScript, no `three`.

## Context

Closed design: `docs/design/track-style.md` (file format, limits, defaults in "Open notes"). Types `Side`, `TrackSegment`, `BarrierSegment` come from `src/core/types.ts` (architecture.md). Offsets are measured from the track edge. Test helper `tests/unit/acceptance/helpers/colour.ts` (AT20) is written by the acceptance role from the design's "Colour predicates"; it exports `hsl(hex): {h, s, l}` and the predicates `isRed isOrange isYellow isGreen isTeal isBlue isWhite isLight isDark isCream isGrey` (each `(hex: string) => boolean`).

## Files

- `src/track/trackStyle.ts` — create.
- `tests/unit/acceptance/179-track-style-schema.test.ts`, `tests/unit/acceptance/helpers/colour.ts` — create (acceptance role).

## Steps

Exports (import `Side`, `BarrierSegment`, `TrackSegment` from `../core/types`):

```ts
export type Hex = string; // '#rrggbb', stored lower-case
export interface StyleRange { start: number; end: number; side?: Side }
export interface KerbRange extends StyleRange { colors?: [Hex, Hex]; outerStrip?: Hex }
export type RunoffPattern = 'none' | 'solid' | 'stripes' | 'bands';
export interface RunoffPaintRange extends StyleRange { pattern?: RunoffPattern; colors?: Hex[]; stripeMeters?: number }
export interface BarrierStyleRange extends StyleRange { fenceHeightMeters: number }
export type PitRoofStyle = 'flat' | 'canopy' | 'folded' | 'sail' | 'curved';
export type PropType = 'footbridge' | 'marshalPost' | 'tent' | 'scoreboard' | 'billboardRow' | 'tower';
export interface ExtraGrandstand { start: number; end: number; side: Side; offsetMeters: number; rows: number; roof: boolean }
export interface FloodlightStyle { style: 'arm' | 'mast'; heightMeters: number; heads: number; spacingMeters: number; offsetMeters: number; side: 'both' | Side; ranges: StyleRange[] }
export interface TrackProp { type: PropType; index: number; side: Side; offsetMeters: number; lengthMeters: number; heightMeters: number; color: Hex | null }
export interface ResolvedTrackStyle {
  version: 1;
  palette: { asphalt: Hex | null; grass: Hex | null; gravel: Hex | null };
  edgeLines: { color: Hex | null };
  kerbs: { colors: [Hex, Hex] | null; outerStrip: Hex | null; ranges: KerbRange[] };
  runoffPaint: { pattern: RunoffPattern; colors: Hex[]; stripeMeters: number; ranges: RunoffPaintRange[] };
  barriers: {
    concrete: { color: Hex | null; bandColor: Hex | null }; armco: { color: Hex | null };
    tyres: { beltColor: Hex | null }; foam: { colors: [Hex, Hex] | null };
    fence: { heightMeters: number; types: BarrierSegment['type'][]; color: Hex | null };
    ranges: BarrierStyleRange[];
  };
  pitBuilding: { storeys: number; heightMeters: number; depthMeters: number; facade: Hex; roof: Hex | null; doors: Hex; accent: Hex | null; roofStyle: PitRoofStyle; glazing: number };
  grandstands: { structure: Hex | null; roof: Hex | null; seats: Hex[] | null; roofStyle: 'flat' | 'sail' | 'truss' };
  extraGrandstands: ExtraGrandstand[];
  floodlights: FloodlightStyle | null;
  props: TrackProp[];
  sky: { hdri: string | null; fogDensityScale: number };
}
export const SKY_NAMES: readonly string[]; // 'kloofendal_48d_partly_cloudy_puresky','kloofendal_overcast_puresky','qwantani_noon_puresky'
export const DEFAULT_TRACK_STYLE: ResolvedTrackStyle;
export function parseTrackStyle(raw: unknown, pointCount: number): { style: ResolvedTrackStyle; errors: string[]; warnings: string[] };
export function rangeContains(range: StyleRange, index: number, pointCount: number): boolean;
export function segmentOverride<R extends StyleRange>(ranges: readonly R[], segment: TrackSegment, pointCount: number): R | null;
```

Defaults (all of design "Open notes"): pit facade `#b8bcc0`, doors `#1c1c1e`, storeys 1, height 4, depth 8, roofStyle flat, glazing 0, others null; fence `{3, ['armco'], null}`; runoffPaint `{pattern 'none', colors [], stripeMeters 2, ranges []}`; grandstands `{null, null, null, 'flat'}`; fogDensityScale 1; arrays `[]`; floodlights null.

Parser rules:
- Errors are strings `"<path>: <reason>"` (e.g. `pitBuilding.storeys: must be 1-5`); an invalid key keeps its default and other keys of the same section stay valid. `null`/`undefined` raw → defaults, no error. Raw not an object, or `version !== 1` → exactly 1 error containing `version`, defaults returned. A key set to `null` counts as absent (except `floodlights: null` = default).
- A section that is not an object → 1 error naming the section, section default. Unknown keys at top level and in each section object → warning `"<path>: unknown key"` (not inside array entries).
- Limits exactly as design "Limits"; integers required for storeys, heads, rows, indices; props `lengthMeters` 1-200, `heightMeters` 1-40. kerb colours exactly 2 hex; runoffPaint colours 1-4 hex; `seats` 1-4 hex. Hex = `/^#[0-9a-fA-F]{6}$/`, lower-cased; any channel above 0xda is clamped to 0xda with one warning per field (AT21).
- Ranges (`kerbs.ranges`, `runoffPaint.ranges`, `barriers.ranges`, `floodlights.ranges`, `extraGrandstands`): start/end integers in `[0, pointCount-1]`, side optional `left|right` (required for extraGrandstands). An invalid entry → 1 error `"<path>[i]: ..."` and the entry is dropped; valid entries keep input order. barriers range requires `fenceHeightMeters` 0-8.
- Defaults filled per entry: extraGrandstands offset 15, rows 12, roof true; props offset 10, length 10, height 4, color null, side 'left'; floodlights `{style 'arm', heightMeters 8, heads 1, spacingMeters 20, offsetMeters 6, side 'both', ranges []}`.
- props > 60 entries → 1 error `props`, props `[]` (checked before per-entry validation). Invalid prop → error `props[i]`, dropped.
- Never throws, never mutates input; result shares no object/array with the input (deep copy).
- `sky.hdri` must be in `SKY_NAMES`.
- `rangeContains`: inclusive both ends, wraps when `end < start`.
- `segmentOverride`: last range in the array for which `rangeContains(range, segment.start, pointCount)` and (`range.side` undefined or equals `segment.side`); else null; returns the same object reference.

Conventions: indices inclusive; invalid input never throws (collected as errors); colours lower-case; no input mutation; ties in `segmentOverride` → last match.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture/offset note: offsets measured from the track edge; fixture STRAIGHT is not used here.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | raw `{version: 1}`, pointCount 100 | `parseTrackStyle(raw, 100)` | style deep-equals `DEFAULT_TRACK_STYLE`; errors `[]`; warnings `[]` |
| AT2 | raw `null` | parse | style deep-equals `DEFAULT_TRACK_STYLE`; errors `[]` |
| AT3 | `DEFAULT_TRACK_STYLE` | read | pitBuilding = `{storeys: 1, heightMeters: 4, depthMeters: 8, facade: '#b8bcc0', roof: null, doors: '#1c1c1e', accent: null, roofStyle: 'flat', glazing: 0}`; barriers.fence = `{heightMeters: 3, types: ['armco'], color: null}`; kerbs.colors null; runoffPaint.pattern 'none'; floodlights null; props `[]`; extraGrandstands `[]`; sky = `{hdri: null, fogDensityScale: 1}` |
| AT4 | pitBuilding `{storeys: 3, heightMeters: 12, facade: '#A1B2C3', roofStyle: 'folded', glazing: 0.5}` | parse | those values kept, facade lower-cased `'#a1b2c3'`; unspecified pit keys keep defaults (depthMeters 8, doors '#1c1c1e') |
| AT5 | `{version: 2}` | parse | exactly 1 error containing `version`; style deep-equals defaults |
| AT6 | pitBuilding `{storeys: 6, facade: '#dadada'}` | parse | 1 error containing `pitBuilding.storeys`; storeys 1; facade `'#dadada'` |
| AT7 | kerbs.colors `['#fff', '#000000']`; then `['#ff0000', '#ffffff', '#000000']` | parse each | each: 1 error containing `kerbs.colors`; kerbs.colors null |
| AT8 | top-level key `foo: 1` and pitBuilding key `bar: 2` | parse | errors `[]`; 2 warnings, one containing `foo`, one containing `pitBuilding.bar` |
| AT9 | barriers.ranges `[{start: 0, end: 100, fenceHeightMeters: 4}, {start: 90, end: 99, side: 'left', fenceHeightMeters: 5}]`, pointCount 100 | parse | 1 error containing `barriers.ranges[0]`; ranges = only the second entry |
| AT10 | `rangeContains` | `({start: 90, end: 10}, i, 100)` for i = 95, 5, 0, 10, 50; `({start: 10, end: 20}, i, 100)` for 10, 20, 21 | true, true, true, true, false; true, true, false |
| AT11 | ranges `A = {start: 0, end: 50, side: 'left'}`, `B = {start: 40, end: 60}` | `segmentOverride([A, B], seg, 100)` for seg `{start: 45, end: 70, side: 'left'}`, `{start: 45, end: 70, side: 'right'}`, `{start: 10, end: 20, side: 'left'}`, `{start: 10, end: 20, side: 'right'}` | B, B, A, null (same object references) |
| AT12 | props with 61 valid entries | parse | 1 error containing `props`; props `[]` |
| AT13 | props `[{type: 'tent', index: 5, side: 'left'}, {type: 'rocket', index: 6, side: 'left'}]` | parse | 1 error containing `props[1]`; props length 1, type 'tent', with defaults offsetMeters 10, lengthMeters 10, heightMeters 4, color null |
| AT14 | floodlights `{spacingMeters: 30}` | parse | floodlights = `{style: 'arm', heightMeters: 8, heads: 1, spacingMeters: 30, offsetMeters: 6, side: 'both', ranges: []}` |
| AT15 | floodlights `{spacingMeters: 5}`; then `{heightMeters: 41}` | parse each | 1 error each (`floodlights.spacingMeters`, `floodlights.heightMeters`); the invalid key takes its default, floodlights not null |
| AT16 | extraGrandstands `[{start: 10, end: 20, side: 'left'}]` | parse | entry = `{start: 10, end: 20, side: 'left', offsetMeters: 15, rows: 12, roof: true}` |
| AT17 | sky.hdri `'unknown_sky'`; then `'kloofendal_overcast_puresky'` | parse each | first: 1 error containing `sky.hdri`, hdri null; second: no error, hdri kept |
| AT18 | a deep-frozen input with every section | parse | does not throw; returned style shares no object with the input (mutating `style.props[0]` leaves the input unchanged) |
| AT19 | source of `src/track/trackStyle.ts` | read text | contains no `from 'three'` |
| AT20 | helper `tests/unit/acceptance/helpers/colour.ts` exporting `hsl(hex)` and `isRed, isOrange, isYellow, isGreen, isTeal, isBlue, isWhite, isLight, isDark, isCream, isGrey` per the design predicates | call | `isRed('#d0432d')`, `isGreen('#58d23a')`, `isCream('#cdb89a')`, `isWhite('#ffffff')`, `isGrey('#808080')`, `isBlue('#1f4fbf')`, `isYellow('#f2c400')`, `isTeal('#1f9e8f')` all true; `isRed('#58d23a')`, `isGreen('#d0432d')`, `isWhite('#cdb89a')` false |
| AT21 | pitBuilding `{facade: '#ffffff', doors: '#f0e0d0'}` | parse | errors `[]`; 2 warnings containing `pitBuilding.facade` and `pitBuilding.doors`; facade `'#dadada'`, doors `'#dadad0'` (each channel clamped to ≤ 0xda, the white-paint cap of linear 0.7) |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/179-track-style-schema.test.ts`.
- [ ] Only the exports above are public; no `three`, no `any`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Loading from disk/network, rendering, tools (180, 181+). Unknown-key handling inside array entries. Any change to `src/core/types.ts`.
