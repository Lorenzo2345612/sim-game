import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Standing } from '../../../src/race/classification';
import { parseCarSpec, type CarSpec, type TyreName } from '../../../src/physics/carSpec';
import { RaceHud, type RaceHudData } from '../../../src/ui/raceHud';
import { formatLapTime } from '../../../src/ui/formatTime';
import { RaceGame } from '../../../src/game/raceGame';
import { parseTrackData } from '../../../src/track/parseTrackData';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadCleveland(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
}

function loadF4(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

type TowerView = 'gap' | 'tyres' | 'laps';
type TowerHud = RaceHud & { cycleView(): TowerView; readonly view: TowerView };
type CompoundGame = RaceGame & { carCompound(car: number): TyreName };

interface HudData306 extends RaceHudData {
  compounds: readonly TyreName[];
}

interface FakeEvent {
  type: string;
  target: FakeEl;
  preventDefault(): void;
}

class FakeEl {
  id = '';
  readonly classes = new Set<string>();
  readonly children: FakeEl[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = { display: '' };
  parent: FakeEl | null = null;
  ownerDocument: FakeDoc;
  onclick: ((ev: FakeEvent) => void) | null = null;
  private text: string | null = null;
  private readonly listeners = new Map<string, ((ev: FakeEvent) => void)[]>();

  constructor(doc: FakeDoc) {
    this.ownerDocument = doc;
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes.clear();
    for (const token of value.split(/\s+/)) if (token) this.classes.add(token);
  }

  get classList(): {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    contains(name: string): boolean;
  } {
    const classes = this.classes;
    return {
      add: (...names: string[]): void => {
        for (const n of names) classes.add(n);
      },
      remove: (...names: string[]): void => {
        for (const n of names) classes.delete(n);
      },
      contains: (name: string): boolean => classes.has(name),
    };
  }

  get textContent(): string {
    return (this.text ?? '') + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string | null) {
    this.text = value;
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeEl): FakeEl {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeEl[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  remove(): void {
    const p = this.parent;
    if (p === null) return;
    const i = p.children.indexOf(this);
    if (i >= 0) p.children.splice(i, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'id') this.id = value;
    else if (name === 'class') this.className = value;
    else if (name.startsWith('data-')) this.dataset[dataKey(name)] = value;
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
    return null;
  }

  addEventListener(type: string, fn: (ev: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (ev: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatchEvent(ev: FakeEvent): boolean {
    this.onclick?.(ev);
    for (const fn of [...(this.listeners.get(ev.type) ?? [])]) fn(ev);
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {} });
  }
}

function dataKey(attr: string): string {
  return attr.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

class FakeDoc {
  readonly body = new FakeEl(this);
  readonly head = new FakeEl(this);

  createElement(): FakeEl {
    return new FakeEl(this);
  }
}

function walk(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap(walk)];
}

function byId(root: FakeEl, id: string): FakeEl {
  const el = walk(root).find((e) => e.id === id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function byClass(root: FakeEl, cls: string): FakeEl[] {
  return walk(root).filter((e) => e.classes.has(cls));
}

function firstByClass(root: FakeEl, cls: string): FakeEl {
  const el = byClass(root, cls)[0];
  if (!el) throw new Error(`missing .${cls}`);
  return el;
}

function standings(): Standing[] {
  return [
    {
      car: 0,
      position: 1,
      lap: 4,
      distance: 300,
      finished: false,
      totalTime: null,
      penalty: 0,
      gapToLeader: null,
      lastLap: 92.5,
      bestLap: 91.0,
    },
    {
      car: 1,
      position: 2,
      lap: 4,
      distance: 260,
      finished: false,
      totalTime: null,
      penalty: 0,
      gapToLeader: null,
      lastLap: 93.0,
      bestLap: 90.4,
    },
    {
      car: 2,
      position: 3,
      lap: 3,
      distance: 220,
      finished: false,
      totalTime: null,
      penalty: 0,
      gapToLeader: null,
      lastLap: null,
      bestLap: null,
    },
  ];
}

function hudData(patch?: Partial<HudData306>): HudData306 {
  return {
    standings: standings(),
    playerCar: 0,
    laps: 5,
    flags: ['green', 'green', 'green'],
    blue: false,
    vscPhase: 'off',
    vscDelta: 0,
    compounds: ['soft', 'hard', 'medium'],
    ...patch,
  };
}

function setup(): { doc: FakeDoc; hud: TowerHud; data: HudData306 } {
  const doc = new FakeDoc();
  const hud = new RaceHud(doc.body as unknown as HTMLElement) as TowerHud;
  const data = hudData();
  hud.update(data);
  return { doc, hud, data };
}

function tower(doc: FakeDoc): FakeEl {
  return byId(doc.body, 'race-tower');
}

function rowsOf(doc: FakeDoc): FakeEl[] {
  return byClass(tower(doc), 'race-row');
}

function field(row: FakeEl, cls: string): string {
  return firstByClass(row, cls).textContent;
}

describe('306 timing tower views', () => {
  it('AT1: the tower starts on GAP with the row texts from before this task', () => {
    const { doc } = setup();
    expect(byId(doc.body, 'tower-view').textContent).toBe('GAP');
    expect(tower(doc).dataset.view).toBe('gap');
    const rows = rowsOf(doc);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => field(r, 'race-row-pos'))).toEqual(['1', '2', '3']);
    expect(rows.map((r) => field(r, 'race-row-name'))).toEqual(['You', 'AI 1', 'AI 2']);
    expect(rows.map((r) => field(r, 'race-row-gap'))).toEqual(['', '+1 lap', '+1 lap']);
    expect(rows.map((r) => field(r, 'race-row-pen'))).toEqual(['', '', '']);
  });

  it('AT2: one click shows the compound badges and the laps on each tyre', () => {
    const { doc, hud, data } = setup();
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    expect(byId(doc.body, 'tower-view').textContent).toBe('TYRES');
    expect(tower(doc).dataset.view).toBe('tyres');
    const rows = rowsOf(doc);
    const badges = rows.map((r) => firstByClass(r, 'tyre'));
    expect(badges.map((b) => b.textContent)).toEqual(['S', 'H', 'M']);
    expect(
      badges.map((b) =>
        ['compound-soft', 'compound-hard', 'compound-medium'].filter((c) => b.classes.has(c)),
      ),
    ).toEqual([['compound-soft'], ['compound-hard'], ['compound-medium']]);
    expect(rows.map((r) => field(r, 'tyre-laps'))).toEqual(['3 L', '3 L', '2 L']);
  });

  it('AT3: the laps view shows each last lap and flags the fastest car', () => {
    const { doc, hud, data } = setup();
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    expect(byId(doc.body, 'tower-view').textContent).toBe('LAPS');
    expect(tower(doc).dataset.view).toBe('laps');
    const rows = rowsOf(doc);
    expect(rows.map((r) => field(r, 'last-lap'))).toEqual([
      formatLapTime(92.5),
      formatLapTime(93.0),
      '-',
    ]);
    expect(rows.map((r) => r.classes.has('fastest'))).toEqual([false, true, false]);
  });

  it('AT4: cycleView returns to the gap view after the laps view', () => {
    const { doc, hud, data } = setup();
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    expect(hud.cycleView()).toBe('gap');
    expect(tower(doc).dataset.view).toBe('gap');
  });

  it('AT5: five more updates keep the tyres view and the row elements', () => {
    const { doc, hud, data } = setup();
    byId(doc.body, 'tower-view').click();
    hud.update(data);
    const before = rowsOf(doc);
    for (let i = 0; i < 5; i++) hud.update(data);
    expect(tower(doc).dataset.view).toBe('tyres');
    const after = rowsOf(doc);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < after.length; i++) expect(after[i]).toBe(before[i]);
  });

  it('AT6: carCompound reports the options compound for player and AI, medium when absent', async () => {
    const track = loadCleveland();
    const spec = loadF4();
    const config = { trackId: 'cleveland', carId: 'f4', aiCount: 3, seed: 1, difficulty: 'medium' as const, laps: 3 };
    const tuned = (await RaceGame.create(track, spec, config, {
      compound: 'soft',
      wear: 0,
      fuel: 20,
    })) as CompoundGame;
    try {
      expect(tuned.carCompound(0)).toBe('soft');
      expect(tuned.carCompound(2)).toBe('soft');
    } finally {
      tuned.dispose();
    }
    const plain = (await RaceGame.create(track, spec, config)) as CompoundGame;
    try {
      expect(plain.carCompound(0)).toBe('medium');
      expect(plain.carCompound(2)).toBe('medium');
    } finally {
      plain.dispose();
    }
  }, 60000);
});
