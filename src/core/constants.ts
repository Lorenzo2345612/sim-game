import type { Surface } from './types';

export const FIXED_DT = 1 / 120;          // s
export const MAX_STEPS_PER_FRAME = 8;     // avoid spiral of death
export const GRAVITY = -9.81;             // m/s², Y axis
export const AIR_DENSITY = 1.225;         // kg/m³
export const MS_TO_KMH = 3.6;
export const KERB_WIDTH = 1.2;            // m, outside the asphalt edge
export const VERGE_WIDTH = 4;             // m of grass between asphalt/kerb/runoff and barrier where no runoff
export const BARRIER_GAP = 1;             // m extra beyond verge/runoff
export const CORNER_RADIUS = 400;         // m: points with radius below this are "corner"
export const KERB_RADIUS = 250;           // m: kerbs where radius below this
export const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1, kerb: 0.9, runoff: 0.95, grass: 0.45, gravel: 0.35 }; // × frictionSlip
export const SURFACE_DRAG: Record<Surface, number> = { asphalt: 0, kerb: 0, runoff: 0, grass: 0.15, gravel: 0.6 };   // × m·g, per wheel share
