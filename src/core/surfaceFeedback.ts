import type { Surface } from './types';

export interface Feedback { shake: number; low: number; high: number } // each 0..1

export const SURFACE_ROUGHNESS: Record<Surface, number> = { asphalt: 0, runoff: 0.1, grass: 0.3, kerb: 0.6, gravel: 0.8 };

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function surfaceFeedback(
  wheels: ReadonlyArray<{ surface: Surface; kappa: number }>,
  speed: number,
  out: Feedback,
): Feedback {
  const s = Number.isFinite(speed) ? clamp01(speed / 30) : 0;
  let roughSum = 0;
  let kerbs = 0;
  let maxKappa = 0;
  for (const w of wheels) {
    const rough = SURFACE_ROUGHNESS[w.surface];
    if (rough !== undefined) {
      roughSum += rough;
      if (w.surface === 'kerb') kerbs++;
    }
    if (Number.isFinite(w.kappa)) {
      const a = Math.abs(w.kappa);
      if (a > maxKappa) maxKappa = a;
    }
  }
  const n = wheels.length;
  const rough = n > 0 ? roughSum / n : 0;
  const kerbFrac = n > 0 ? kerbs / n : 0;
  const slipExcess = clamp01((maxKappa - 0.15) / 0.35);
  out.shake = rough * s;
  out.low = rough * s;
  out.high = clamp01(kerbFrac * s + 0.5 * slipExcess);
  return out;
}
