import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { Standing } from '../../../src/race/classification';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const TOL = 1e-9;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

// Bilinear sample of the terrain grid; heights column-major, col * (rows + 1) + row (src/main.ts).
function terrainHeight(track: TrackDataV2, x: number, z: number): number {
  const t = track.terrain;
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  const fx = Math.min(Math.max(((x - minX) / t.sizeX) * t.cols, 0), t.cols);
  const fz = Math.min(Math.max(((z - minZ) / t.sizeZ) * t.rows, 0), t.rows);
  const j = Math.min(Math.floor(fx), t.cols - 1);
  const i = Math.min(Math.floor(fz), t.rows - 1);
  const tx = fx - j;
  const tz = fz - i;
  const h00 = t.heights[j * vertexRows + i];
  const h10 = t.heights[(j + 1) * vertexRows + i];
  const h01 = t.heights[j * vertexRows + i + 1];
  const h11 = t.heights[(j + 1) * vertexRows + i + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

function isFiniteState(s: VehicleState): boolean {
  const r = s.rotation;
  return (
    Number.isFinite(s.position.x) &&
    Number.isFinite(s.position.y) &&
    Number.isFinite(s.position.z) &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.z) &&
    Number.isFinite(r.w) &&
    Number.isFinite(s.forwardSpeed)
  );
}

function expectClose(a: number, b: number, label: string): void {
  expect(Math.abs(a - b), label).toBeLessThanOrEqual(TOL);
}

function expectCloseOpt(a: number | null, b: number | null, label: string): void {
  if (a === null || b === null) expect(a, label).toBe(b);
  else expectClose(a, b, label);
}

function expectSameStanding(a: Standing, b: Standing): void {
  expect(a.car, 'car').toBe(b.car);
  expect(a.position, 'position').toBe(b.position);
  expect(a.lap, 'lap').toBe(b.lap);
  expect(a.finished, 'finished').toBe(b.finished);
  expectClose(a.distance, b.distance, 'distance');
  expectClose(a.penalty, b.penalty, 'penalty');
  expectCloseOpt(a.totalTime, b.totalTime, 'totalTime');
  expectCloseOpt(a.gapToLeader, b.gapToLeader, 'gapToLeader');
  expectCloseOpt(a.lastLap, b.lastLap, 'lastLap');
  expectCloseOpt(a.bestLap, b.bestLap, 'bestLap');
}

interface Snapshot {
  standings: Standing[];
  positions: Array<{ x: number; y: number; z: number }>;
}

async function runSnapshot(
  track: TrackDataV2,
  spec: CarSpec,
  config: RaceConfig,
  seconds: number,
): Promise<Snapshot> {
  const game = await RaceGame.create(track, spec, config);
  try {
    for (let i = 0; i < steps(seconds); i++) game.step(IDLE);
    const states = game.getStates(buffers(game.carCount));
    return {
      standings: game.standings().map((s: Standing) => ({ ...s })),
      positions: states.map((s: VehicleState) => ({
        x: s.position.x,
        y: s.position.y,
        z: s.position.z,
      })),
    };
  } finally {
    game.dispose();
  }
}

describe('093 multi-car race game acceptance', () => {
  it(
    'AT1: 60 s with 5 AI on monza — every AI moves > 1 km, no NaN, no car below terrain',
    async () => {
      const track = loadTrack();
      const game = await RaceGame.create(track, loadSpec(), raceConfig(5));
      try {
        const buf = buffers(6);
        const prevX = new Float64Array(6);
        const prevY = new Float64Array(6);
        const prevZ = new Float64Array(6);
        const dist = new Float64Array(6);
        const minClearance = new Float64Array(6).fill(Infinity);
        let nanCount = 0;
        let prevValid = false;
        for (let s = 0; s < steps(60); s++) {
          game.step(IDLE);
          game.getStates(buf);
          for (let i = 0; i < 6; i++) {
            const st = buf[i];
            if (!isFiniteState(st)) nanCount++;
            const { x, y, z } = st.position;
            if (prevValid) dist[i] += Math.hypot(x - prevX[i], y - prevY[i], z - prevZ[i]);
            prevX[i] = x;
            prevY[i] = y;
            prevZ[i] = z;
            const clearance = y - terrainHeight(track, x, z);
            if (clearance < minClearance[i]) minClearance[i] = clearance;
          }
          prevValid = true;
        }
        expect(nanCount, 'non-finite states').toBe(0);
        for (let i = 1; i <= 5; i++) expect(dist[i], `AI car ${i} path length`).toBeGreaterThan(1000);
        for (let i = 0; i < 6; i++)
          expect(minClearance[i], `car ${i} clearance over terrain`).toBeGreaterThanOrEqual(0);
      } finally {
        game.dispose();
      }
    },
    120000,
  );

  it(
    'AT2: a step before go leaves every car within 0.5 m of its grid slot',
    async () => {
      const track = loadTrack();
      const game = await RaceGame.create(track, loadSpec(), raceConfig(5));
      try {
        const slots = gridSlots(track, 6);
        game.step(IDLE);
        const states = game.getStates(buffers(6));
        for (let i = 0; i < 6; i++) {
          const slot = i === 0 ? slots[5] : slots[i - 1];
          const p = states[i].position;
          const d = Math.hypot(p.x - slot.position.x, p.y - slot.position.y, p.z - slot.position.z);
          expect(d, `car ${i} distance to its grid slot`).toBeLessThanOrEqual(0.5);
        }
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT3: 120 ticks with 11 AI take under 2.0 s of wall time',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(11));
      try {
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) game.step(IDLE);
        const elapsed = (performance.now() - t0) / 1000;
        expect(elapsed, 'wall seconds for 120 ticks').toBeLessThan(2.0);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT4: two runs with seed 1 give identical standings and positions (± 1e-9)',
    async () => {
      const track = loadTrack();
      const spec = loadSpec();
      const a = await runSnapshot(track, spec, raceConfig(5), 30);
      const b = await runSnapshot(track, spec, raceConfig(5), 30);
      expect(a.standings.length, 'standing count').toBe(b.standings.length);
      for (let i = 0; i < a.standings.length; i++) expectSameStanding(a.standings[i], b.standings[i]);
      expect(a.positions.length, 'car count').toBe(b.positions.length);
      for (let i = 0; i < a.positions.length; i++) {
        expectClose(a.positions[i].x, b.positions[i].x, `car ${i} x`);
        expectClose(a.positions[i].y, b.positions[i].y, `car ${i} y`);
        expectClose(a.positions[i].z, b.positions[i].z, `car ${i} z`);
      }
    },
    120000,
  );
});
