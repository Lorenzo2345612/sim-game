export const TYRE_PITCH = 0.62;
export const TYRE_ROWS = 4;
export const TYRE_ROW_HEIGHT = 0.25;
export const TYRE_OUTER_RADIUS = 0.31;
export const ARMCO_RAIL_HEIGHT = 0.31;
export const ARMCO_RAIL_CENTER = 0.6;
export const ARMCO_POST_SPACING = 2.0;
export const FENCE_HEIGHT = 3.0;
export const FENCE_OFFSET = 1.0;

// Cross-section of a W-beam rail, bottom to top. t is metres along the path
// normal (t > 0 = away from the track), y is metres above the path.
export function wBeamProfile(): Array<[t: number, y: number]> {
  const lo = ARMCO_RAIL_CENTER - ARMCO_RAIL_HEIGHT / 2;
  const hi = ARMCO_RAIL_CENTER + ARMCO_RAIL_HEIGHT / 2;
  const back = 0.05;
  const face = -0.05;
  return [
    [back, lo],
    [back, lo + 0.02],
    [face, lo + 0.055],
    [back, lo + 0.1],
    [0, ARMCO_RAIL_CENTER],
    [back, hi - 0.1],
    [face, hi - 0.055],
    [back, hi - 0.02],
    [back, hi],
  ];
}
