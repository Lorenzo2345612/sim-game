import { describe, it, expect } from 'vitest';
import { recapLine } from '../../../src/ui/recap';
import type { OvertakeEvent } from '../../../src/race/overtakeLog';

function name(car: number): string {
  return car === 0 ? 'You' : `AI ${car}`;
}

function E(kind: OvertakeEvent['kind']): OvertakeEvent {
  return { t: 10, lap: 2, lapDistance: 1234, passer: 1, passed: 0, position: 3, kind };
}

describe('315 results overtakes tab acceptance', () => {
  it("AT1: recapLine gift ends ' (rival slow or off track)', contact ' (contact)', clean has none", () => {
    expect(recapLine(E('gift'), name)).toBe(
      'L2 · 1.23 km · AI 1 passes You for P3 (rival slow or off track)',
    );
    expect(recapLine(E('contact'), name)).toBe('L2 · 1.23 km · AI 1 passes You for P3 (contact)');
    expect(recapLine(E('clean'), name)).toBe('L2 · 1.23 km · AI 1 passes You for P3');
  });
});
