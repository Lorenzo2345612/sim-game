import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HudTyres,
  tyreColour,
  fuelText,
  type HudTyresData,
} from '../../../src/ui/hudTyres';

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text: string | null = null;
  textWrites = 0;

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

const base: HudTyresData = {
  tempC: [90, 90, 90, 90],
  wear: [1, 1, 1, 1],
  optTempC: 90,
  tempWindowC: 40,
  fuelL: 50,
  meanLapL: null,
};

function setup(): { hud: HudTyres; container: FakeEl; doc: FakeDoc } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc, 'div');
  const hud = new HudTyres(container as unknown as HTMLElement);
  return { hud, container, doc };
}

function walk(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(walk)];
}

function findByClass(root: FakeEl, token: string): FakeEl[] {
  return walk(root).filter((e) => e.classes.has(token));
}

describe('tyreColour', () => {
  it('bounds are green, just outside is blue or red', () => {
    expect(tyreColour(70, 90, 40)).toBe('green');
    expect(tyreColour(110, 90, 40)).toBe('green');
    expect(tyreColour(69.9, 90, 40)).toBe('blue');
    expect(tyreColour(110.1, 90, 40)).toBe('red');
  });

  it('a non-finite temp falls back to green', () => {
    expect(tyreColour(Number.NaN, 90, 40)).toBe('green');
  });
});

describe('fuelText', () => {
  it('uses one decimal for fuel and laps', () => {
    expect(fuelText(10, 3)).toBe('10.0 L · 3.3 laps');
    expect(fuelText(0, 2.5)).toBe('0.0 L · 0.0 laps');
  });

  it('shows a dash when the mean lap is null, zero or negative', () => {
    expect(fuelText(10, null)).toBe('10.0 L · —');
    expect(fuelText(10, 0)).toBe('10.0 L · —');
    expect(fuelText(10, -1)).toBe('10.0 L · —');
  });

  it('clamps negative fuel to 0.0', () => {
    expect(fuelText(-5, 2.5)).toBe('0.0 L · 0.0 laps');
  });

  it('shows a dash for non-finite input', () => {
    expect(fuelText(Number.NaN, 2.5)).toBe('— L · —');
    expect(fuelText(10, Number.POSITIVE_INFINITY)).toBe('10.0 L · —');
  });
});

describe('HudTyres dom', () => {
  it('renders four tyre boxes with colours and wear percentages', () => {
    const { hud, container } = setup();
    hud.update({ ...base, tempC: [60, 90, 120, 90], wear: [0.5, 1, 0, 2] });
    const tyres = findByClass(container, 'tyre');
    expect(tyres).toHaveLength(4);
    expect(tyres.map((t) => [...t.classes].find((c) => c.startsWith('tyre-')))).toEqual([
      'tyre-blue',
      'tyre-green',
      'tyre-red',
      'tyre-green',
    ]);
    expect(tyres.map((t) => t.text)).toEqual(['50%', '100%', '0%', '100%']);
    expect(findByClass(container, 'fuel')[0].text).toBe('50.0 L · —');
  });

  it('rounds wear half-up and handles missing array entries as a dash', () => {
    const { hud, container } = setup();
    hud.update({ ...base, wear: [0.875, 0.124, 1.5, -0.2] });
    hud.update({ ...base, wear: [0.875], tempC: [90] });
    const tyres = findByClass(container, 'tyre');
    expect(tyres.map((t) => t.text)).toEqual(['88%', '—', '—', '—']);
  });

  it('swaps tyre colours between updates', () => {
    const { hud, container } = setup();
    hud.update({ ...base, tempC: [60, 60, 60, 60] });
    expect(findByClass(container, 'tyre-blue')).toHaveLength(4);
    hud.update(base);
    expect(findByClass(container, 'tyre-blue')).toHaveLength(0);
    expect(findByClass(container, 'tyre-green')).toHaveLength(4);
  });
});

describe('HudTyres write minimization', () => {
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
    hud.update({ ...base, fuelL: 1, tempC: [1, 2, 3, 4], wear: [0, 0, 0, 0] });
    expect(doc.created.length).toBe(before);
  });
});

describe('HudTyres dispose', () => {
  it('removes the panel from the container', () => {
    const { hud, container } = setup();
    const panel = container.children[0];
    hud.update(base);
    hud.dispose();
    expect(container.children).toHaveLength(0);
    expect(panel.parent).toBeNull();
  });
});

describe('hudTyres.ts source', () => {
  const src = readFileSync('src/ui/hudTyres.ts', 'utf8');

  it('does not reference the global document or window', () => {
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).toMatch(/container\.ownerDocument/);
  });

  it('works in a node environment where globalThis.document is undefined', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const { hud, container } = setup();
    hud.update({ ...base, fuelL: 10, meanLapL: 2.5 });
    expect(findByClass(container, 'fuel')[0].text).toBe('10.0 L · 4.0 laps');
  });
});
