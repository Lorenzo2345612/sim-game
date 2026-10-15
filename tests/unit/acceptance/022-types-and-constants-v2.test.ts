import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SURFACE_GRIP,
  SURFACE_DRAG,
  KERB_WIDTH,
  VERGE_WIDTH,
  BARRIER_GAP,
  CORNER_RADIUS,
  KERB_RADIUS,
} from '../../../src/core/constants';

describe('022 types and constants acceptance', () => {
  it('AT1: TrackDataV2, Surface and Terrain are exported and a literal TrackDataV2 typechecks', () => {
    const root = resolve(__dirname, '../../..');
    const fixture = resolve(root, 'tests/unit/acceptance/022-fixture-trackdatav2.ts');
    const result = spawnSync(
      'npx',
      [
        '--no-install',
        'tsc',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'bundler',
        '--lib',
        'ES2022',
        '--skipLibCheck',
        '--ignoreConfig',
        fixture,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(result.status, `tsc failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('AT2: SURFACE_GRIP is asphalt 1, kerb 0.9, runoff 0.95, grass 0.45, gravel 0.35', () => {
    expect(SURFACE_GRIP.asphalt).toBeCloseTo(1, 10);
    expect(SURFACE_GRIP.kerb).toBeCloseTo(0.9, 10);
    expect(SURFACE_GRIP.runoff).toBeCloseTo(0.95, 10);
    expect(SURFACE_GRIP.grass).toBeCloseTo(0.45, 10);
    expect(SURFACE_GRIP.gravel).toBeCloseTo(0.35, 10);
  });

  it('AT3: SURFACE_DRAG c0/c1 is 0/0 for asphalt, kerb and runoff, grass 0.10/0.004, gravel 0.08/0.03 and KERB_WIDTH 1.2, VERGE_WIDTH 4, BARRIER_GAP 1, CORNER_RADIUS 400, KERB_RADIUS 250', () => {
    expect(SURFACE_DRAG.asphalt).toEqual({ c0: 0, c1: 0 });
    expect(SURFACE_DRAG.kerb).toEqual({ c0: 0, c1: 0 });
    expect(SURFACE_DRAG.runoff).toEqual({ c0: 0, c1: 0 });
    expect(SURFACE_DRAG.grass).toEqual({ c0: 0.1, c1: 0.004 });
    expect(SURFACE_DRAG.gravel).toEqual({ c0: 0.08, c1: 0.03 });
    expect(KERB_WIDTH).toBeCloseTo(1.2, 10);
    expect(VERGE_WIDTH).toBeCloseTo(4, 10);
    expect(BARRIER_GAP).toBeCloseTo(1, 10);
    expect(CORNER_RADIUS).toBeCloseTo(400, 10);
    expect(KERB_RADIUS).toBeCloseTo(250, 10);
  });
});
