import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { TrackLimits, type TrackLimitEvent } from '../../../src/race/trackLimits';

interface Segment {
  wheelsOff: number;
  seconds: number;
}

function run(segments: Segment[]): { events: TrackLimitEvent[]; limits: TrackLimits } {
  const limits = new TrackLimits(1);
  const events: TrackLimitEvent[] = [];
  let time = 0;
  for (const seg of segments) {
    const steps = Math.round(seg.seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      time += FIXED_DT;
      const ev = limits.update(0, seg.wheelsOff, time);
      if (ev) events.push(ev);
    }
  }
  return { events, limits };
}

describe('127 track limits acceptance', () => {
  it('AT1: 4 excursions of 0.5 s separated by 2 s produce warning 1, warning 2, warning 3, penalty 5', () => {
    const segments: Segment[] = [];
    for (let i = 0; i < 4; i++) {
      segments.push({ wheelsOff: 4, seconds: 0.5 });
      segments.push({ wheelsOff: 0, seconds: 2 });
    }
    const { events } = run(segments);
    expect(events).toEqual([
      { type: 'warning', count: 1 },
      { type: 'warning', count: 2 },
      { type: 'warning', count: 3 },
      { type: 'penalty', seconds: 5 },
    ]);
  });

  it('AT2: excursion of 0.2 s produces no event', () => {
    const { events } = run([{ wheelsOff: 4, seconds: 0.2 }]);
    expect(events).toEqual([]);
  });

  it('AT3: 4 wheels off 0.5 s, back 0.5 s, off 0.5 s produces one strike only', () => {
    const { events, limits } = run([
      { wheelsOff: 4, seconds: 0.5 },
      { wheelsOff: 0, seconds: 0.5 },
      { wheelsOff: 4, seconds: 0.5 },
    ]);
    expect(limits.strikes(0)).toBe(1);
    expect(events).toEqual([{ type: 'warning', count: 1 }]);
  });

  it('AT4: 3 wheels off for 5 s produces no event', () => {
    const { events } = run([{ wheelsOff: 3, seconds: 5 }]);
    expect(events).toEqual([]);
  });
});
