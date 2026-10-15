import type { Surface } from '../core/types';

// Dirt picked up per metre rolled (task 166): grass/gravel only.
export const DIRT_PICKUP: Record<Surface, number> = {
  asphalt: 0,
  kerb: 0,
  grass: 0.02,
  gravel: 0.04,
  runoff: 0,
};
// Exponential cleaning length on asphalt/kerb/runoff, m.
export const DIRT_CLEAN_LENGTH = 400;
export const DIRT_GRIP_LOSS = 0.25;

function isPaved(surface: Surface): boolean {
  return surface === 'asphalt' || surface === 'kerb' || surface === 'runoff';
}

export function updateDirt(dirt: number, surface: Surface, speed: number, dt: number): number {
  if (!Number.isFinite(dirt)) return 0;
  const d0 = Math.min(1, Math.max(0, dirt));
  if (!Number.isFinite(speed) || !Number.isFinite(dt) || dt < 0) return d0;
  const rolled = Math.abs(speed) * dt;
  if (isPaved(surface)) return d0 * Math.exp(-rolled / DIRT_CLEAN_LENGTH);
  return Math.min(1, d0 + DIRT_PICKUP[surface] * rolled);
}

export function dirtGripFactor(dirt: number, surface: Surface): number {
  if (!isPaved(surface)) return 1;
  if (!Number.isFinite(dirt)) return 1;
  return 1 - DIRT_GRIP_LOSS * Math.min(1, Math.max(0, dirt));
}
