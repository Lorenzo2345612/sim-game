import { describe, it, expect } from 'vitest';
import type { PenaltyEntry } from '../../../src/race/penalties';
import { raceControlMessage } from '../../../src/ui/raceControl';

function entry(p: Partial<PenaltyEntry>): PenaltyEntry {
  return { car: 0, kind: 'penalty', seconds: 5, reason: 'track limits', time: 0, ...p };
}

describe('296 driver names in the race UI acceptance', () => {
  it("AT1: a custom name fn uppercases into the message; without it the 294 text is unchanged", () => {
    const e = entry({ car: 3, seconds: 5, reason: 'track limits', time: 80 });
    const name = (c: number): string => (c === 3 ? 'D. Ruiz' : 'You');
    expect(raceControlMessage(e, name)).toBe('5 SECOND TIME PENALTY FOR D. RUIZ - TRACK LIMITS');
    expect(raceControlMessage(e)).toBe('5 SECOND TIME PENALTY FOR AI 3 - TRACK LIMITS');
    const player = entry({ car: 0, seconds: 10, reason: 'yellow flag overtake', time: 90 });
    expect(raceControlMessage(player, name)).toBe(
      '10 SECOND TIME PENALTY FOR YOU - YELLOW FLAG OVERTAKE',
    );
    expect(raceControlMessage(player)).toBe(
      '10 SECOND TIME PENALTY FOR YOU - YELLOW FLAG OVERTAKE',
    );
  });
});
