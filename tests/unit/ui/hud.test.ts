import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hud, type HudData } from '../../../src/ui/hud';

class FakeEl {
  className = '';
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text: string | null = null;
  textWrites = 0;

  constructor(public ownerDocument: FakeDoc) {}

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
    return new FakeEl(this);
  }
}

const data: HudData = {
  speedKmh: 123.4,
  lap: 2,
  currentLapTime: 83.456,
  lastLapTime: 5,
  bestLapTime: null,
};

function setup(): { hud: Hud; container: FakeEl; doc: FakeDoc } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc);
  const hud = new Hud(container as unknown as HTMLElement);
  return { hud, container, doc };
}

function cells(container: FakeEl): FakeEl[] {
  const panel = container.children[0];
  const speed = panel.children[0];
  const lap = panel.children[1];
  const current = panel.children[2].children[1];
  const last = panel.children[3].children[1];
  const best = panel.children[4].children[1];
  return [speed, lap, current, last, best];
}

function texts(container: FakeEl): (string | null)[] {
  return cells(container).map((c) => c.text);
}

describe('Hud construction', () => {
  it('appends exactly one hud-panel child to the container', () => {
    const { container } = setup();
    expect(container.children).toHaveLength(1);
    expect(container.children[0].className).toBe('hud-panel');
  });

  it('creates five rows with the spec class names', () => {
    const { container } = setup();
    const panel = container.children[0];
    expect(panel.children.map((r) => r.className)).toEqual([
      'hud-speed',
      'hud-lap',
      'hud-current',
      'hud-last',
      'hud-best',
    ]);
  });

  it('labels the three time rows Current, Last and Best followed by a hud-value span', () => {
    const { container } = setup();
    const panel = container.children[0];
    const labels = ['Current', 'Last', 'Best'];
    for (let i = 0; i < 3; i++) {
      const row = panel.children[2 + i];
      expect(row.children).toHaveLength(2);
      expect(row.children[0].className).toBe('hud-label');
      expect(row.children[0].textContent).toBe(labels[i]);
      expect(row.children[1].className).toBe('hud-value');
    }
  });

  it('creates speed and lap rows without child labels', () => {
    const { container } = setup();
    const panel = container.children[0];
    expect(panel.children[0].children).toHaveLength(0);
    expect(panel.children[1].children).toHaveLength(0);
  });

  it('starts with empty value cells', () => {
    const { container } = setup();
    expect(texts(container)).toEqual([null, null, null, null, null]);
  });

  it('creates six divs and six spans in the constructor', () => {
    const { doc } = setup();
    expect(doc.created.filter((t) => t === 'div')).toHaveLength(6);
    expect(doc.created.filter((t) => t === 'span')).toHaveLength(6);
  });

  it('creates no elements during update', () => {
    const { hud, container, doc } = setup();
    const before = doc.created.length;
    hud.update(data);
    hud.update(data);
    expect(doc.created.length).toBe(before);
    expect(container.children).toHaveLength(1);
  });
});

describe('Hud update texts', () => {
  it('writes rounded speed in km/h', () => {
    const { hud, container } = setup();
    hud.update(data);
    expect(container.children[0].children[0].text).toBe('123 km/h');
    hud.update({ ...data, speedKmh: 99.5 });
    expect(container.children[0].children[0].text).toBe('100 km/h');
    hud.update({ ...data, speedKmh: 0 });
    expect(container.children[0].children[0].text).toBe('0 km/h');
  });

  it('falls back to 0 km/h for non-finite speed', () => {
    const { hud, container } = setup();
    for (const s of [NaN, Infinity, -Infinity]) {
      hud.update({ ...data, speedKmh: s });
      expect(container.children[0].children[0].text).toBe('0 km/h');
    }
  });

  it('writes Lap n for positive lap', () => {
    const { hud, container } = setup();
    hud.update(data);
    expect(container.children[0].children[1].text).toBe('Lap 2');
  });

  it('writes Lap - for zero and negative lap', () => {
    const { hud, container } = setup();
    for (const lap of [0, -1, -100]) {
      hud.update({ ...data, lap });
      expect(container.children[0].children[1].text).toBe('Lap -');
    }
  });

  it('formats the three times with formatLapTime', () => {
    const { hud, container } = setup();
    hud.update(data);
    const [, , current, last, best] = texts(container);
    expect(current).toBe('1:23.456');
    expect(last).toBe('0:05.000');
    expect(best).toBe('-:--.---');
  });
});

describe('Hud update write minimization', () => {
  it('does not write textContent again when identical data is sent twice', () => {
    const { hud, container } = setup();
    hud.update(data);
    const after1 = cells(container).map((c) => c.textWrites);
    expect(after1).toEqual([1, 1, 1, 1, 1]);
    hud.update(data);
    hud.update(data);
    expect(cells(container).map((c) => c.textWrites)).toEqual(after1);
  });

  it('rewrites only the rows whose text changed', () => {
    const { hud, container } = setup();
    hud.update(data);
    const before = cells(container).map((c) => c.textWrites);
    hud.update({ ...data, speedKmh: 124 });
    const after = cells(container).map((c) => c.textWrites);
    expect(after).toEqual([before[0] + 1, before[1], before[2], before[3], before[4]]);
    hud.update({ ...data, speedKmh: 124, lastLapTime: 600.001 });
    const after2 = cells(container).map((c) => c.textWrites);
    expect(after2).toEqual([after[0], after[1], after[2], after[3] + 1, after[4]]);
  });

  it('does not rewrite when only a non-displayed value changes', () => {
    const { hud, container } = setup();
    hud.update({ ...data, speedKmh: 123.2 });
    const before = cells(container).map((c) => c.textWrites);
    hud.update({ ...data, speedKmh: 123.4 });
    expect(cells(container).map((c) => c.textWrites)).toEqual(before);
  });
});

describe('Hud dispose', () => {
  it('removes the panel from the container', () => {
    const { hud, container } = setup();
    const panel = container.children[0];
    hud.update(data);
    hud.dispose();
    expect(container.children).toHaveLength(0);
    expect(panel.parent).toBeNull();
  });
});

describe('hud.ts source', () => {
  const src = readFileSync('src/ui/hud.ts', 'utf8');

  it('does not reference the global document or window', () => {
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).toMatch(/container\.ownerDocument/);
  });

  it('works in a node environment where globalThis.document is undefined', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const { hud, container } = setup();
    hud.update(data);
    expect(container.children[0].children[0].text).toBe('123 km/h');
  });
});
