import { describe, it, expect } from 'vitest';
import { gainText, passesText, recapLine, highlights, recapFor } from '../../../src/ui/recap';
import type { OvertakeEvent, OvertakeSummary } from '../../../src/race/overtakeLog';

function name(car: number): string {
  return car === 0 ? 'You' : `AI ${car}`;
}

function E(t: number, lap: number, d: number, a: number, b: number, pos: number, kind: OvertakeEvent['kind']): OvertakeEvent {
  return { t, lap, lapDistance: d, passer: a, passed: b, position: pos, kind };
}

describe('291 results overtake recap acceptance', () => {
  it("AT1: gainText(5,2) '+3' / gainText(2,4) '-2' / gainText(3,3) '0'", () => {
    expect(gainText(5, 2)).toBe('+3');
    expect(gainText(2, 4)).toBe('-2');
    expect(gainText(3, 3)).toBe('0');
  });

  it("AT2: passesText({clean 3, contact 1, gift 2, lost 0}) is '3/1/2'", () => {
    const s: OvertakeSummary = { clean: 3, contact: 1, gift: 2, lost: 0 };
    expect(passesText(s)).toBe('3/1/2');
  });

  it("AT3: recapLine clean / contact / gift with lap, km and names", () => {
    expect(recapLine(E(10, 2, 1234, 1, 0, 3, 'clean'), name)).toBe('L2 · 1.23 km · AI 1 passes You for P3');
    expect(recapLine(E(10, 2, 1234, 1, 0, 3, 'contact'), name)).toBe('L2 · 1.23 km · AI 1 passes You for P3 (contact)');
    expect(recapLine(E(10, 2, 1234, 1, 0, 3, 'gift'), name)).toBe('L2 · 1.23 km · AI 1 passes You for P3 (gift)');
  });

  it('AT4: recapFor sorts chronologically; car filter keeps only its events', () => {
    const events: OvertakeEvent[] = [E(30, 1, 0, 1, 2, 1, 'clean'), E(10, 1, 0, 2, 3, 2, 'clean'), E(20, 1, 0, 3, 1, 3, 'clean')];
    const all: OvertakeEvent[] = recapFor(events, null);
    expect(all.map((e) => e.t)).toEqual([10, 20, 30]);
    const car2: OvertakeEvent[] = recapFor(events, 2);
    expect(car2.map((e) => e.t)).toEqual([10, 30]);
  });

  it("AT5: highlights — most overtakes and most places gained, ties to lowest car index", () => {
    const grid = [4, 1, 2, 3];
    const position = [4, 3, 1, 2];
    const s: OvertakeSummary[] = [
      { clean: 0, contact: 0, gift: 0, lost: 0 },
      { clean: 0, contact: 0, gift: 0, lost: 0 },
      { clean: 2, contact: 0, gift: 0, lost: 0 },
      { clean: 2, contact: 0, gift: 0, lost: 0 },
    ];
    expect(highlights(grid, position, s, name)).toBe('Most overtakes: AI 2 (2) · Most places gained: AI 2 (+1)');
  });

  it("AT6: highlights is '' when grid equals position and all summaries are 0", () => {
    const grid = [1, 2, 3, 4];
    const position = [1, 2, 3, 4];
    const s: OvertakeSummary[] = [
      { clean: 0, contact: 0, gift: 0, lost: 0 },
      { clean: 0, contact: 0, gift: 0, lost: 0 },
      { clean: 0, contact: 0, gift: 0, lost: 0 },
      { clean: 0, contact: 0, gift: 0, lost: 0 },
    ];
    expect(highlights(grid, position, s, name)).toBe('');
  });

  it('AT7: recapFor does not mutate the input array', () => {
    const events: OvertakeEvent[] = [E(30, 1, 0, 1, 2, 1, 'clean'), E(10, 1, 0, 2, 3, 2, 'clean'), E(20, 1, 0, 3, 1, 3, 'clean')];
    const before = events.map((e) => e.t);
    recapFor(events, null);
    recapFor(events, 2);
    expect(events.map((e) => e.t)).toEqual(before);
  });
});
