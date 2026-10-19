export interface Driver {
  first: string;
  last: string;
  code: string;
  nat: string;
  number: number;
}

export interface NameList {
  nat: string;
  first: string[];
  last: string[];
}

export type SeriesMix = Readonly<Record<string, number>>;

export interface GridsFile {
  series: Record<string, { name: string; mix: SeriesMix }>;
  trackSeries: Record<string, string>;
  default: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lettersOnly(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function baseCode(last: string): string {
  return (lettersOnly(last) + 'XXX').slice(0, 3);
}

function codeCandidates(first: string, last: string): string[] {
  const base = baseCode(last);
  const ini = lettersOnly(first).charAt(0) || 'X';
  const out: string[] = [base, ini + base.slice(0, 2)];
  for (let i = 0; i < 26; i++) out.push(base.slice(0, 2) + String.fromCharCode(65 + i));
  for (let b = 2; b <= 26; b++) {
    for (let a = 1; a <= 26; a++) {
      out.push(base.charAt(0) + String.fromCharCode(64 + b) + String.fromCharCode(64 + a));
    }
  }
  return out;
}

function shuffle(nums: number[], rng: () => number): void {
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = nums[i];
    nums[i] = nums[j];
    nums[j] = tmp;
  }
}

export function generateGrid(
  count: number,
  seed: number,
  mix: SeriesMix,
  names: Readonly<Record<string, NameList>>,
): Driver[] {
  if (!Number.isInteger(count) || count < 0 || count > 98) {
    throw new RangeError(`grid count out of range: ${count}`);
  }
  const pool = Object.entries(mix)
    .map(([nat, w]) => ({ list: names[nat], w }))
    .filter((e): e is { list: NameList; w: number } => e.list !== undefined);
  const totalW = pool.reduce((s, e) => s + e.w, 0);
  if (pool.length === 0 || totalW <= 0) throw new RangeError('no mix nationality has a name list');
  if (count === 0) return [];

  const rng = mulberry32(seed);
  const usedNames = new Set<string>();
  const usedCodes = new Set<string>();
  const drivers: Driver[] = [];

  for (let i = 0; i < count; i++) {
    let list: NameList;
    let first: string;
    let last: string;
    let key: string;
    do {
      let r = rng() * totalW;
      let pick = pool[0];
      for (const e of pool) {
        r -= e.w;
        if (r <= 0) {
          pick = e;
          break;
        }
      }
      list = pick.list;
      first = list.first[Math.floor(rng() * list.first.length)];
      last = list.last[Math.floor(rng() * list.last.length)];
      key = `${first} ${last}`;
    } while (usedNames.has(key));
    usedNames.add(key);

    let code = '';
    for (const cand of codeCandidates(first, last)) {
      if (!usedCodes.has(cand)) {
        code = cand;
        break;
      }
    }
    if (code === '') throw new RangeError('driver code space exhausted');
    usedCodes.add(code);

    drivers.push({ first, last, code, nat: list.nat, number: 0 });
  }

  const nums: number[] = [];
  for (let n = 2; n <= 99; n++) nums.push(n);
  shuffle(nums, rng);
  for (let i = 0; i < count; i++) drivers[i].number = nums[i];

  return drivers;
}

export function shortName(d: Driver): string {
  return `${d.first.charAt(0)}. ${d.last}`;
}

export function seriesForTrack(grids: GridsFile, trackId: string): string {
  return grids.trackSeries[trackId] ?? grids.default;
}
