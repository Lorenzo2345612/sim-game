import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HudV2,
  sectorColour,
  SHIFT_LIGHT_RPM,
  HUD_MAX_RPM,
  type HudV2Data,
} from '../../../src/ui/hudV2';

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text: string | null = null;
  textWrites = 0;
  style: Record<string, string> = { width: '', display: '' };

  constructor(public ownerDocument: FakeDoc, public tag: string) {}

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.classes = new Set(value.trim().split(/\s+/).filter(Boolean));
  }

  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
    this.textWrites += 1;
    this.text = value;
  }

  appendChild(child: FakeEl): FakeEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
}

class FakeDoc {
  created: string[] = [];
  createElement(tag: string): FakeEl {
    this.created.push(tag);
    return new FakeEl(this, tag);
  }
}

const base: HudV2Data = {
  speedKmh: 200,
  gear: 4,
  rpm: 5000,
  lap: 1,
  currentLapTime: null,
  lastLapTime: null,
  bestLapTime: null,
  sectorTimes: [null, null, null],
  bestSectorTimes: [null, null, null],
  deltaSeconds: null,
  lapValid: true,
};

function setup(): { hud: HudV2; container: FakeEl; doc: FakeDoc } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc, 'div');
  const hud = new HudV2(container as unknown as HTMLElement);
  return { hud, container, doc };
}

function walk(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(walk)];
}

function findByClass(root: FakeEl, token: string): FakeEl[] {
  return walk(root).filter((e) => e.classes.has(token));
}

function findByText(root: FakeEl, text: string): FakeEl[] {
  return walk(root).filter((e) => e.text === text);
}

describe('sectorColour', () => {
  it('returns none for a null time', () => {
    expect(sectorColour(null, null)).toBe('none');
    expect(sectorColour(null, 10)).toBe('none');
  });

  it('returns purple when there is no best yet or the time is faster or equal', () => {
    expect(sectorColour(10, null)).toBe('purple');
    expect(sectorColour(10, 10)).toBe('purple');
    expect(sectorColour(9.5, 10)).toBe('purple');
  });

  it('returns yellow when slower than the best', () => {
    expect(sectorColour(10.5, 10)).toBe('yellow');
  });
});

describe('HudV2 constants', () => {
  it('exposes the shift threshold and the max rpm', () => {
    expect(SHIFT_LIGHT_RPM).toBe(8200);
    expect(HUD_MAX_RPM).toBe(9000);
  });
});

describe('HudV2 rpm bar', () => {
  it('clamps the width to 0..100 % and treats non-finite rpm as 0', () => {
    const { hud, container } = setup();
    for (const [rpm, expected] of [
      [10_000, 100],
      [-100, 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ] as const) {
      hud.update({ ...base, rpm });
      const width = findByClass(container, 'hud2-rpm-bar')[0].style.width;
      expect(Number.parseFloat(width)).toBe(expected);
    }
  });

  it('removes the shift class when rpm drops below the threshold', () => {
    const { hud, container } = setup();
    hud.update({ ...base, rpm: 8200 });
    expect(findByClass(container, 'shift')).toHaveLength(1);
    hud.update({ ...base, rpm: 8199 });
    expect(findByClass(container, 'shift')).toHaveLength(0);
    expect(findByClass(container, 'hud2-rpm-bar')).toHaveLength(1);
  });
});

describe('HudV2 delta', () => {
  it('formats with three decimals and an explicit sign', () => {
    const { hud, container } = setup();
    for (const [delta, text] of [
      [-0.512, '-0.512'],
      [0.3, '+0.300'],
      [0, '+0.000'],
      [-1.5, '-1.500'],
      [null, ''],
    ] as const) {
      hud.update({ ...base, deltaSeconds: delta });
      expect(findByClass(container, 'delta')[0].textContent).toBe(text);
    }
  });

  it('swaps delta-neg and delta-pos classes between updates', () => {
    const { hud, container } = setup();
    hud.update({ ...base, deltaSeconds: -0.1 });
    expect(findByClass(container, 'delta-neg')).toHaveLength(1);
    expect(findByClass(container, 'delta-pos')).toHaveLength(0);
    hud.update({ ...base, deltaSeconds: 0.1 });
    expect(findByClass(container, 'delta-neg')).toHaveLength(0);
    expect(findByClass(container, 'delta-pos')).toHaveLength(1);
    hud.update({ ...base, deltaSeconds: null });
    expect(findByClass(container, 'delta-neg')).toHaveLength(0);
    expect(findByClass(container, 'delta-pos')).toHaveLength(0);
  });
});

describe('HudV2 invalid badge', () => {
  it('is hidden while the lap is valid and shown when it is not', () => {
    const { hud, container } = setup();
    hud.update(base);
    const badge = findByText(container, 'INVALID')[0];
    expect(badge.style.display).toBe('none');
    hud.update({ ...base, lapValid: false });
    expect(badge.style.display).not.toBe('none');
    hud.update(base);
    expect(badge.style.display).toBe('none');
  });
});

describe('HudV2 sectors', () => {
  it('handles missing entries beyond the provided array length', () => {
    const { hud, container } = setup();
    hud.update({ ...base, sectorTimes: [12], bestSectorTimes: [] });
    const cells = findByClass(container, 'sector');
    expect(cells).toHaveLength(3);
    expect(cells[0].classes.has('sector-purple')).toBe(true);
    expect(cells[1].classes.has('sector-none')).toBe(true);
    expect(cells[2].classes.has('sector-none')).toBe(true);
  });
});

describe('HudV2 write minimization', () => {
  it('does not rewrite texts when identical data is sent twice', () => {
    const { hud, container } = setup();
    hud.update(base);
    const after1 = walk(container).map((e) => e.textWrites);
    hud.update(base);
    expect(walk(container).map((e) => e.textWrites)).toEqual(after1);
  });

  it('creates no elements during update', () => {
    const { hud, doc } = setup();
    const before = doc.created.length;
    hud.update(base);
    hud.update({ ...base, rpm: 9000, gear: 5, deltaSeconds: -0.001, lapValid: false });
    expect(doc.created.length).toBe(before);
  });
});

describe('HudV2 dispose', () => {
  it('removes the panel from the container', () => {
    const { hud, container } = setup();
    const panel = container.children[0];
    hud.update(base);
    hud.dispose();
    expect(container.children).toHaveLength(0);
    expect(panel.parent).toBeNull();
  });
});

describe('hudV2.ts source', () => {
  const src = readFileSync('src/ui/hudV2.ts', 'utf8');

  it('does not reference the global document or window', () => {
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).toMatch(/container\.ownerDocument/);
  });

  it('works in a node environment where globalThis.document is undefined', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const { hud, container } = setup();
    hud.update({ ...base, gear: 3, speedKmh: 123.4 });
    expect(findByText(container, '3')).toHaveLength(1);
    expect(findByText(container, '123 km/h')).toHaveLength(1);
  });
});
