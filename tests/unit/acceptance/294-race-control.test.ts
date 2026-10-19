import { describe, it, expect } from 'vitest';
import type { PenaltyEntry } from '../../../src/race/penalties';
import { penaltyAnnouncement, penaltyTag, raceControlMessage } from '../../../src/ui/raceControl';

function entry(p: Partial<PenaltyEntry>): PenaltyEntry {
  return { car: 0, kind: 'penalty', seconds: 5, reason: 'track limits', time: 0, ...p };
}

describe('294 race control acceptance', () => {
  it("AT1: AI 3's 5 s track limits penalty reads '5 SECOND TIME PENALTY FOR AI 3 - TRACK LIMITS'", () => {
    const e = entry({ car: 3, kind: 'penalty', seconds: 5, reason: 'track limits', time: 80 });
    expect(raceControlMessage(e)).toBe('5 SECOND TIME PENALTY FOR AI 3 - TRACK LIMITS');
  });

  it("AT2: the player's 10 s yellow flag overtake penalty reads '10 SECOND TIME PENALTY FOR YOU - YELLOW FLAG OVERTAKE'", () => {
    const e = entry({ car: 0, seconds: 10, reason: 'yellow flag overtake', time: 90 });
    expect(raceControlMessage(e)).toBe('10 SECOND TIME PENALTY FOR YOU - YELLOW FLAG OVERTAKE');
  });

  it('AT3: a warning yields null from raceControlMessage and penaltyAnnouncement', () => {
    const trackLimits = entry({ car: 1, kind: 'warning', seconds: 0, reason: 'track limits', time: 10 });
    const jumpStart = entry({ car: 4, kind: 'warning', seconds: 0, reason: 'jump start', time: 30 });
    for (const e of [trackLimits, jumpStart]) {
      expect(raceControlMessage(e)).toBeNull();
      expect(penaltyAnnouncement(e)).toBeNull();
    }
  });

  it("AT4: player announcements are {TIME PENALTY, +5 SECONDS, Track limits} and {.., +1 SECOND, Jump start}", () => {
    const five = entry({ car: 0, seconds: 5, reason: 'track limits', time: 20 });
    expect(penaltyAnnouncement(five)).toEqual({
      title: 'TIME PENALTY',
      value: '+5 SECONDS',
      reason: 'Track limits',
    });
    const one = entry({ car: 0, seconds: 1, reason: 'jump start', time: 5 });
    const a = penaltyAnnouncement(one);
    expect(a?.value).toBe('+1 SECOND');
    expect(a?.reason).toBe('Jump start');
  });

  it('AT5: penaltyTag renders empty at 0 and +5s / +10s above it', () => {
    expect(penaltyTag(0)).toBe('');
    expect(penaltyTag(5)).toBe('+5s');
    expect(penaltyTag(10)).toBe('+10s');
  });
});
