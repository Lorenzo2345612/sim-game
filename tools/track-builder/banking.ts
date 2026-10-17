export interface BankRange {
  fromMeters: number;
  toMeters: number;
  degrees: number;
  raisedSide: 'left' | 'right';
}

const DEG_TO_RAD = Math.PI / 180;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Signed ring distance a -> b: positive when b is forward of a on the ring.
function ringDelta(a: number, b: number, length: number): number {
  const d = (((b - a) % length) + length) % length;
  return d > length / 2 ? d - length : d;
}

// Ramp centred on a boundary: half at the boundary, full `ramp` inside, zero `ramp` outside.
function rampFactor(interiorDist: number, ramp: number): number {
  if (ramp > 0) return clamp01(0.5 + interiorDist / ramp);
  return interiorDist > 0 ? 1 : interiorDist < 0 ? 0 : 0.5;
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * Per-index signed cross-slope in radians along a closed centerline; positive
 * means the right edge (relative to the driving direction) is higher. Ranges
 * wrap past `lengthMeters` when `toMeters < fromMeters`; when ranges overlap
 * the larger magnitude wins at each index. Omitting `rampMeters` selects auto
 * mode: each range ramps up with a smoothstep inside itself over
 * `R = max(60, 7.5·|degrees|)` m (halved to `span/2` when `2R > span`),
 * zero at the boundaries and full `R` metres inside.
 */
export function bankProfile(
  cumulativeMeters: number[],
  lengthMeters: number,
  ranges: BankRange[],
  rampMeters?: number,
): number[] {
  for (const m of cumulativeMeters) {
    if (!Number.isFinite(m)) throw new Error(`bankProfile: non-finite cumulativeMeters entry ${String(m)}`);
  }
  if (!Number.isFinite(lengthMeters)) throw new Error('bankProfile: lengthMeters must be finite');
  if (rampMeters !== undefined && !Number.isFinite(rampMeters)) {
    throw new Error('bankProfile: rampMeters must be finite');
  }
  const auto = rampMeters === undefined;
  const list = ranges ?? [];
  for (const r of list) {
    if (!Number.isFinite(r.fromMeters) || !Number.isFinite(r.toMeters) || !Number.isFinite(r.degrees)) {
      throw new Error('bankProfile: non-finite bank range');
    }
  }
  const out = new Array<number>(cumulativeMeters.length).fill(0);
  if (!(lengthMeters > 0)) return out;
  for (const r of list) {
    const span = (((r.toMeters - r.fromMeters) % lengthMeters) + lengthMeters) % lengthMeters;
    if (r.degrees === 0 || span === 0) continue;
    const full = r.degrees * DEG_TO_RAD * (r.raisedSide === 'left' ? -1 : 1);
    let ramp = rampMeters;
    if (auto) {
      ramp = Math.max(60, 7.5 * Math.abs(r.degrees));
      if (2 * ramp > span) ramp = span / 2;
    }
    for (let i = 0; i < cumulativeMeters.length; i++) {
      const m = (((cumulativeMeters[i] % lengthMeters) + lengthMeters) % lengthMeters);
      const fromDist = ringDelta(r.fromMeters, m, lengthMeters);
      const toDist = ringDelta(m, r.toMeters, lengthMeters);
      const factor = auto
        ? smoothstep(clamp01(Math.min(fromDist, toDist) / (ramp as number)))
        : Math.min(rampFactor(fromDist, rampMeters as number), rampFactor(toDist, rampMeters as number));
      const value = full * factor;
      if (Math.abs(value) > Math.abs(out[i])) out[i] = value;
    }
  }
  return out;
}
