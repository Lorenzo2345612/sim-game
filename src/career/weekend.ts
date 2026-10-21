import { pointsFor } from './points';
import type { PointsTable, SessionSpec, WeekendFormat } from './types';

export interface SessionResult {
  order: number[];
  bestLaps: (number | null)[];
  classified: boolean[];
  fastestLapCar: number | null;
}

function copyResult(r: SessionResult): SessionResult {
  return {
    order: r.order.slice(),
    bestLaps: r.bestLaps.slice(),
    classified: r.classified.slice(),
    fastestLapCar: r.fastestLapCar,
  };
}

function naturalGrid(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function compareLex(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export class Weekend {
  private readonly sessions: SessionSpec[];
  private readonly carCount: number;
  private readonly tables: Record<string, PointsTable>;
  private readonly results: (SessionResult | undefined)[];
  private readonly totalsByCar: number[];
  private i = 0;

  constructor(format: WeekendFormat, carCount: number, tables: Record<string, PointsTable>) {
    if (!Number.isInteger(carCount) || carCount < 0) throw new Error('Weekend: carCount');
    this.sessions = format.sessions.slice();
    this.carCount = carCount;
    this.tables = tables;
    this.results = this.sessions.map(() => undefined);
    this.totalsByCar = new Array<number>(carCount).fill(0);
    for (let s = 0; s < this.sessions.length; s++) {
      if (this.sessions[s].grid === 'sprint-result') {
        const hasSprint = this.sessions.slice(0, s).some((x) => x.kind === 'sprint');
        if (!hasSprint) throw new Error('Weekend: sprint-result grid without an earlier sprint');
      }
    }
  }

  get index(): number {
    return this.i;
  }

  get current(): SessionSpec | null {
    return this.sessions[this.i] ?? null;
  }

  get done(): boolean {
    return this.i >= this.sessions.length;
  }

  result(i: number): SessionResult | undefined {
    const r = this.results[i];
    return r === undefined ? undefined : copyResult(r);
  }

  totals(): number[] {
    return this.totalsByCar.slice();
  }

  gridFor(): number[] {
    const n = this.carCount;
    const spec = this.current;
    if (spec === null) return [];
    if (spec.kind === 'practice' || spec.kind === 'qualifying') return naturalGrid(n);
    const rule = spec.grid ?? 'qualifying';
    if (rule === 'sprint-result') {
      const last = this.lastSubmitted('sprint');
      return last === undefined ? naturalGrid(n) : last.order.slice();
    }
    const q = this.lastSubmitted('qualifying');
    if (q === undefined) return naturalGrid(n);
    const grid = qualifyingGrid(q);
    if (rule === 'qualifying') return grid;
    const timed = q.bestLaps.filter((l) => l !== null).length;
    const k = Math.min(8, timed);
    return [...grid.slice(0, k).reverse(), ...grid.slice(k)];
  }

  submit(r: SessionResult): number[] {
    if (this.done) throw new Error('Weekend: submit after done');
    const n = this.carCount;
    if (r.order.length !== n) throw new Error('Weekend: order length');
    if (r.bestLaps.length !== n) throw new Error('Weekend: bestLaps length');
    if (r.classified.length !== n) throw new Error('Weekend: classified length');
    const seen = new Array<boolean>(n).fill(false);
    for (const car of r.order) {
      if (!Number.isInteger(car) || car < 0 || car >= n || seen[car]) {
        throw new Error('Weekend: order is not a permutation');
      }
      seen[car] = true;
    }
    for (const lap of r.bestLaps) {
      if (lap !== null && (typeof lap !== 'number' || !Number.isFinite(lap))) {
        throw new Error('Weekend: bestLaps entry');
      }
    }
    for (const c of r.classified) {
      if (typeof c !== 'boolean') throw new Error('Weekend: classified entry');
    }
    if (
      r.fastestLapCar !== null &&
      (!Number.isInteger(r.fastestLapCar) || r.fastestLapCar < 0 || r.fastestLapCar >= n)
    ) {
      throw new Error('Weekend: fastestLapCar');
    }

    const spec = this.sessions[this.i];
    const pts = new Array<number>(n).fill(0);
    if (spec.kind === 'qualifying') {
      const pole = r.order[0];
      if (spec.polePoints !== undefined && r.bestLaps[pole] !== null) pts[pole] = spec.polePoints;
    } else if (spec.points !== undefined) {
      const table = this.tables[spec.points];
      if (table === undefined) throw new Error(`Weekend: unknown points table ${spec.points}`);
      for (let pos = 1; pos <= n; pos++) {
        const car = r.order[pos - 1];
        pts[car] = pointsFor(table, pos, r.classified[car], r.fastestLapCar === car);
      }
    }

    this.results[this.i] = copyResult(r);
    for (let car = 0; car < n; car++) this.totalsByCar[car] += pts[car];
    this.i++;
    return pts;
  }

  standings(): number[] {
    const n = this.carCount;
    const positions: number[][] = Array.from({ length: n }, () => []);
    for (let s = 0; s < this.i; s++) {
      const spec = this.sessions[s];
      if (spec.points === undefined) continue;
      const res = this.results[s];
      if (res === undefined) continue;
      for (let pos = 0; pos < n; pos++) positions[res.order[pos]].push(pos + 1);
    }
    for (const list of positions) list.sort((a, b) => a - b);
    return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const byPoints = this.totalsByCar[b] - this.totalsByCar[a];
      if (byPoints !== 0) return byPoints;
      const byPositions = compareLex(positions[a], positions[b]);
      if (byPositions !== 0) return byPositions;
      return a - b;
    });
  }

  private lastSubmitted(kind: 'qualifying' | 'sprint'): SessionResult | undefined {
    for (let s = this.i - 1; s >= 0; s--) {
      if (this.sessions[s].kind === kind) return this.results[s];
    }
    return undefined;
  }
}

function qualifyingGrid(q: SessionResult): number[] {
  const timed: number[] = [];
  const untimed: number[] = [];
  for (const car of q.order) (q.bestLaps[car] === null ? untimed : timed).push(car);
  untimed.sort((a, b) => a - b);
  return [...timed, ...untimed];
}
