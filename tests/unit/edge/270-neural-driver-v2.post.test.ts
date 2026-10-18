import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { N_W } from '../../../src/ai/neuralPolicy';
import { RaceGame } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { defaultSetup } from '../../../src/physics/setup';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { hasKerb } from '../../../src/track/surfaces';
import { joinGenome, splitGenome, N_SET } from '../../../scripts/evolve/genome.mts';
import { trackLimits } from '../../../scripts/evolve/limits.mts';

const ROOT = join(__dirname, '..', '..', '..');
const rd = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const spec = (): CarSpec => parseCarSpec(rd('public/cars/f4.json'));
const track = (id: string): TrackDataV2 => parseTrackData(rd(`public/tracks/${id}.json`)) as TrackDataV2;

describe('270 neural driver v2 post-code gaps', () => {
  it('POST1: hasKerb is true exactly on indices covered by a kerb of that side', () => {
    const t = track('cleveland');
    const k = t.kerbs[0];
    expect(hasKerb(t, k.side, k.start)).toBe(true);
    const other = k.side === 'left' ? 'right' : 'left';
    const covered = t.kerbs.some((s) => s.side === other && hasKerb(t, other, k.start));
    expect(hasKerb(t, other, k.start)).toBe(covered);
    const none = { ...t, kerbs: [] } as TrackDataV2;
    expect(hasKerb(none, 'left', 0)).toBe(false);
    expect(hasKerb(none, 'right', 5)).toBe(false);
  });

  it('POST2: trackLimits with a huge dt eliminates in one step; 3 off never invalidates', () => {
    const a = trackLimits();
    a.step(4, 100);
    expect(a.eliminated).toBe(true);
    expect(a.lapValid).toBe(false);
    const b = trackLimits();
    b.step(3, 1000);
    b.step(0, 0);
    expect(b.lapValid).toBe(true);
    expect(b.eliminated).toBe(false);
  });

  it('POST3: zero dt with 4 off invalidates the lap but does not eliminate', () => {
    const t = trackLimits();
    t.step(4, 0);
    expect(t.lapValid).toBe(false);
    expect(t.eliminated).toBe(false);
  });

  it('POST4: splitGenome clamps genes beyond ±1 and treats missing genes as default', () => {
    const f4 = spec();
    const big = joinGenome(new Float64Array(N_W), new Array(N_SET).fill(7));
    const one = joinGenome(new Float64Array(N_W), new Array(N_SET).fill(1));
    expect(splitGenome(big, f4).setup).toEqual(splitGenome(one, f4).setup);
    const short = new Float64Array(N_W);
    expect(splitGenome(short, f4).setup).toEqual(defaultSetup(f4));
  });

  it('POST5: joinGenome without genes zero-fills them and throws on an incompatible length', () => {
    const g = joinGenome(new Float64Array(N_W));
    expect(g.length).toBe(N_W + N_SET);
    for (let k = 0; k < N_SET; k++) expect(g[N_W + k]).toBe(0);
    expect(() => joinGenome(new Float64Array(N_W + 1))).toThrow();
    expect(() => joinGenome(new Float64Array(0))).toThrow();
  });

  it('POST6: splitGenome returns only the first N_W weights of a full genome', () => {
    const w = new Float64Array(N_W).map((_, i) => i * 0.001);
    const { weights } = splitGenome(joinGenome(w, new Array(N_SET).fill(0.5)), spec());
    expect(weights.length).toBe(N_W);
    expect(weights[N_W - 1]).toBe(w[N_W - 1]);
  });

  it('POST7: player car and AI without neural model keep the base spec; setup of another difficulty is ignored', async () => {
    const f4 = spec();
    const mk = (opts: object) =>
      RaceGame.create(track('monza'), f4, { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 1, difficulty: 'medium', seed: 1 }, opts);
    type I = { ais: { vehicle: { spec: CarSpec } }[]; vehicles: { spec: CarSpec }[] };
    const g1 = await mk({
      aiDriver: 'neural',
      neuralModels: { medium: new Float64Array(N_W) },
      neuralSetups: { hard: { rearWing: 0 }, medium: { rearWing: 0 } },
    });
    const i1 = g1 as unknown as I;
    expect(i1.vehicles[0].spec.aero.claRear).toBeCloseTo(f4.aero.claRear, 12);
    g1.dispose();
    const g2 = await mk({ aiDriver: 'classic', neuralSetups: { medium: { rearWing: 0 } } });
    expect((g2 as unknown as I).ais[0].vehicle.spec.aero.claRear).toBeCloseTo(f4.aero.claRear, 12);
    g2.dispose();
    const g3 = await mk({ aiDriver: 'neural', neuralModels: { medium: new Float64Array(N_W) }, neuralSetups: { hard: { rearWing: 0 } } });
    expect((g3 as unknown as I).ais[0].vehicle.spec.aero.claRear).toBeCloseTo(f4.aero.claRear, 12);
    g3.dispose();
  });
});
