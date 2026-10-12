import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  Vec3,
  Quat,
  DriverInput,
  SpawnPose,
  WheelState,
  VehicleState,
  TrackData,
  LapEvent,
} from '../../../src/core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function tsBlockAfter(md: string, heading: string): string {
  const rest = md.slice(md.indexOf(heading));
  const m = rest.match(/```ts\n([\s\S]*?)```/);
  if (!m) throw new Error(`no ts block after "${heading}"`);
  return m[1];
}

function fileText(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('task 002 files match the architecture guide blocks', () => {
  const guide = fileText('ai/guides/architecture.md');

  it('src/core/types.ts is exactly the "Shared types" block', () => {
    expect(fileText('src/core/types.ts').trim()).toBe(tsBlockAfter(guide, '## Shared types').trim());
  });

  it('src/core/constants.ts is exactly the "Constants" block', () => {
    expect(fileText('src/core/constants.ts').trim()).toBe(tsBlockAfter(guide, '## Constants').trim());
  });
});

// Compile-time shape checks: tsc --noEmit covers tests/, so an unused
// expect-error directive fails typecheck and a missing/renamed field fails too.
describe('types have the exact shape from the guide', () => {
  const wheel: WheelState = { position: { x: 0, y: 0.4, z: -1.3 }, steering: 0.1, rotation: 12.5, inContact: true };
  const vehicle: VehicleState = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0.7, z: 0, w: 0.7 },
    forwardSpeed: -4.5,
    wheels: [wheel, wheel, wheel, wheel],
  };
  const input: DriverInput = { throttle: 1, brake: 0, steer: -1, reset: false };
  const spawn: SpawnPose = { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 };
  const track: TrackData = {
    id: 'monza',
    name: 'Monza',
    widthMeters: 12,
    lengthMeters: 5310,
    officialLengthMeters: 5310,
    centerline: [[0, 0], [0, -2]],
    sectors: [0, 100, 250],
    source: { dataset: 'openstreetmap', license: 'ODbL', url: 'https://example.org' },
  };

  it('valid literals satisfy every exported interface', () => {
    expect(vehicle.wheels).toHaveLength(4);
    expect(input.steer).toBeLessThan(0);
    expect(spawn.yaw).toBeCloseTo(Math.PI / 2, 10);
    expect(track.sectors[0]).toBe(0);
    expect(vehicle.forwardSpeed).toBeLessThan(0);
  });

  it('required fields cannot be omitted', () => {
    // @ts-expect-error centerline is required
    const partial: TrackData = { id: 'a', name: 'A', widthMeters: 12, lengthMeters: 1, officialLengthMeters: 1, sectors: [0, 0, 0], source: { dataset: '', license: '', url: '' } };
    expect(partial.id).toBe('a');
    // @ts-expect-error reset is required
    const partialInput: DriverInput = { throttle: 0, brake: 0, steer: 0 };
    expect(partialInput.throttle).toBe(0);
    // @ts-expect-error z is required on Vec3
    const badVec: Vec3 = { x: 0, y: 0 };
    expect(badVec.x).toBe(0);
    // @ts-expect-error w is required on Quat
    const badQuat: Quat = { x: 0, y: 0, z: 0 };
    expect(badQuat.x).toBe(0);
  });

  it('LapEvent is a discriminated union on type', () => {
    const started: LapEvent = { type: 'lapStarted', lap: 1, time: 0 };
    const sector: LapEvent = { type: 'sectorCompleted', lap: 1, sector: 2, sectorTime: 45.3 };
    const completed: LapEvent = { type: 'lapCompleted', lap: 1, lapTime: 90.2, isBest: true };
    const events = [started, sector, completed];
    expect(events.map((e) => e.type)).toEqual(['lapStarted', 'sectorCompleted', 'lapCompleted']);
    if (completed.type === 'lapCompleted') {
      expect(completed.isBest).toBe(true);
    }
  });

  it('LapEvent variants reject foreign fields', () => {
    const noTime = (ev: LapEvent): unknown => {
      if (ev.type === 'lapStarted') return ev.time;
      // @ts-expect-error time exists only on lapStarted
      return ev.time;
    };
    expect(noTime({ type: 'lapStarted', lap: 1, time: 3.5 })).toBe(3.5);
  });

});
