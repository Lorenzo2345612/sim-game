import type { OvertakeEvent, OvertakeSummary } from '../race/overtakeLog';

export function gainText(grid: number, position: number): string {
  const gain = grid - position;
  return gain > 0 ? `+${gain}` : String(gain);
}

export function passesText(s: OvertakeSummary): string {
  return `${s.clean}/${s.contact}/${s.gift}`;
}

export function recapLine(e: OvertakeEvent, name: (car: number) => string): string {
  const km = (e.lapDistance / 1000).toFixed(2);
  const suffix =
    e.kind === 'clean' ? '' : e.kind === 'gift' ? ' (rival slow or off track)' : ` (${e.kind})`;
  return `L${e.lap} · ${km} km · ${name(e.passer)} passes ${name(e.passed)} for P${e.position}${suffix}`;
}

export function highlights(
  grid: readonly number[],
  position: readonly number[],
  s: readonly OvertakeSummary[],
  name: (car: number) => string,
): string {
  const parts: string[] = [];
  let bestClean = 0;
  let bestCleanCar = -1;
  let bestGain = 0;
  let bestGainCar = -1;
  for (let i = 0; i < grid.length; i++) {
    const clean = s[i] ? s[i].clean : 0;
    if (clean > bestClean) {
      bestClean = clean;
      bestCleanCar = i;
    }
    const gain = grid[i] - position[i];
    if (gain > bestGain) {
      bestGain = gain;
      bestGainCar = i;
    }
  }
  if (bestCleanCar >= 0) parts.push(`Most overtakes: ${name(bestCleanCar)} (${bestClean})`);
  if (bestGainCar >= 0) {
    parts.push(`Most places gained: ${name(bestGainCar)} (${gainText(grid[bestGainCar], position[bestGainCar])})`);
  }
  return parts.join(' · ');
}

export function recapFor(events: readonly OvertakeEvent[], car: number | null): OvertakeEvent[] {
  return events
    .filter((e) => car === null || e.passer === car || e.passed === car)
    .sort((a, b) => a.t - b.t);
}
