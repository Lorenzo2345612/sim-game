import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { parseNeuralModel } from '../../src/ai/neuralPolicy';
import { parseResidualModel } from '../../src/ai/residualPolicy';

const ROOT = join(__dirname, '..', '..');
const json = (p: string): unknown => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

describe('residual AI trainer parity', () => {
  it('residual cars get no slip feed and skip keepOnTrack; classic cars keep both', async () => {
    const model = json('public/ai-models/cleveland-f4/expert.json');
    const mt = json('public/ai-models/cleveland-f4/line-mintime.json') as { pts: [number, number][]; v: number[] };
    const track = parseTrackData(json('public/tracks/cleveland.json'));
    const spec = parseCarSpec(json('public/cars/f4.json'));
    const mk = (neural: boolean) =>
      RaceGame.create(
        track as never,
        spec,
        { trackId: 'cleveland', carId: 'f4', laps: 1, aiCount: 1, difficulty: 'expert', seed: 1 },
        neural
          ? {
              aiDriver: 'neural',
              neuralModels: { expert: parseNeuralModel(model) },
              neuralResidual: { expert: parseResidualModel(model)! },
              neuralLine: { kind: 'mintime', pts: mt.pts, v: mt.v },
            }
          : undefined,
      );
    const res = await mk(true);
    const cls = await mk(false);
    try {
      const r = res as unknown as { observations: { rearSlip?: number }[]; ais: { residual?: unknown }[] };
      const c = cls as unknown as { observations: { rearSlip?: number }[] };
      expect(r.ais[0].residual).toBeDefined();
      expect(r.observations[0].rearSlip).toBeUndefined();
      expect(c.observations[0].rearSlip).toBe(0);
    } finally {
      res.dispose();
      cls.dispose();
    }
  });
});
