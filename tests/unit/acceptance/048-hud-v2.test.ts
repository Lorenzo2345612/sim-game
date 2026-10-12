import { describe, it, expect } from 'vitest';
import { HudV2, type HudV2Data } from '../../../src/ui/hudV2';

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text: string | null = null;
  style: Record<string, string> = { width: '', display: '' };

  constructor(public ownerDocument: FakeDoc, public tag: string) {}

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.classes = new Set(value.trim().split(/\s+/).filter(Boolean));
  }
  get classList() {
    const classes = this.classes;
    return {
      add: (...tokens: string[]) => tokens.forEach((t) => classes.add(t)),
      remove: (...tokens: string[]) => tokens.forEach((t) => classes.delete(t)),
      contains: (token: string) => classes.has(token),
      toggle: (token: string) => {
        if (classes.delete(token)) return false;
        classes.add(token);
        return true;
      },
    };
  }

  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
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
  createElement(tag: string): FakeEl {
    return new FakeEl(this, tag);
  }
}

const base: HudV2Data = {
  speedKmh: 250,
  gear: 3,
  rpm: 7000,
  lap: 5,
  currentLapTime: 45.123,
  lastLapTime: 90.456,
  bestLapTime: 89.999,
  sectorTimes: [null, null, null],
  bestSectorTimes: [null, null, null],
  deltaSeconds: null,
  lapValid: true,
};

function setup(): { hud: HudV2; container: FakeEl } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc, 'div');
  const hud = new HudV2(container as unknown as HTMLElement);
  return { hud, container };
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

function barWidths(root: FakeEl): number[] {
  return walk(root)
    .map((e) => e.style.width)
    .filter((w) => w !== '')
    .map((w) => Number.parseFloat(w));
}

describe('048 HUD v2 acceptance', () => {
  it('AT1: update writes gear text "3" and an rpm bar width of 7000/9000 within 1 %', () => {
    const { hud, container } = setup();
    hud.update({ ...base, gear: 3, rpm: 7000 });
    expect(findByText(container, '3')).toHaveLength(1);
    const pct = (7000 / 9000) * 100;
    expect(barWidths(container).some((w) => Math.abs(w - pct) <= 1)).toBe(true);
  });

  it('AT2: update sets the shift class on the rpm bar when rpm reaches 8200', () => {
    const { hud, container } = setup();
    hud.update({ ...base, rpm: 8200 });
    expect(findByClass(container, 'shift')).toHaveLength(1);
  });

  it('AT3: update colours sector 2 purple when faster or first best and yellow when slower', () => {
    const faster = setup();
    faster.hud.update({ ...base, sectorTimes: [null, 30, null], bestSectorTimes: [null, 31, null] });
    expect(findByClass(faster.container, 'sector-purple')).toHaveLength(1);
    expect(findByClass(faster.container, 'sector-yellow')).toHaveLength(0);

    const first = setup();
    first.hud.update({ ...base, sectorTimes: [null, 30, null], bestSectorTimes: [null, null, null] });
    expect(findByClass(first.container, 'sector-purple')).toHaveLength(1);
    expect(findByClass(first.container, 'sector-yellow')).toHaveLength(0);

    const slower = setup();
    slower.hud.update({ ...base, sectorTimes: [null, 30, null], bestSectorTimes: [null, 29, null] });
    expect(findByClass(slower.container, 'sector-yellow')).toHaveLength(1);
    expect(findByClass(slower.container, 'sector-purple')).toHaveLength(0);
  });

  it('AT4: update shows "-0.512" with delta-neg and "+0.300" with delta-pos', () => {
    const negative = setup();
    negative.hud.update({ ...base, deltaSeconds: -0.512 });
    const neg = findByClass(negative.container, 'delta-neg');
    expect(neg).toHaveLength(1);
    expect(neg[0].textContent).toBe('-0.512');
    expect(findByClass(negative.container, 'delta-pos')).toHaveLength(0);

    const positive = setup();
    positive.hud.update({ ...base, deltaSeconds: 0.3 });
    const pos = findByClass(positive.container, 'delta-pos');
    expect(pos).toHaveLength(1);
    expect(pos[0].textContent).toBe('+0.300');
    expect(findByClass(positive.container, 'delta-neg')).toHaveLength(0);
  });

  it('AT5: update shows the INVALID badge when the lap is invalid', () => {
    const { hud, container } = setup();
    hud.update({ ...base, lapValid: false });
    const badges = findByText(container, 'INVALID');
    expect(badges).toHaveLength(1);
    expect(badges[0].style.display).not.toBe('none');
  });
});
