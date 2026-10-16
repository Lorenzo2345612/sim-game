import { describe, it, expect } from 'vitest';
import { HudV2, SHIFT_LIGHT_RPM, type HudV2Data } from '../../../src/ui/hudV2';

const LED_COUNT = 15;

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
  gear: 1,
  rpm: 0,
  lap: 1,
  currentLapTime: null,
  lastLapTime: null,
  bestLapTime: null,
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

function leds(container: FakeEl): FakeEl[] {
  const row = findByClass(container, 'hud2-leds');
  expect(row).toHaveLength(1);
  return row[0].children;
}

function barPct(container: FakeEl): number {
  const bars = findByClass(container, 'hud2-rpm-bar');
  expect(bars).toHaveLength(1);
  return Number.parseFloat(bars[0].style.width);
}

function shiftRpmRange(hud: HudV2, shiftRpm: number, maxRpm: number): void {
  (hud as unknown as { setRpmRange(s: number, m: number): void }).setRpmRange(shiftRpm, maxRpm);
}

describe('222 hud rpm range acceptance', () => {
  it('AT1: with no setRpmRange call, rpm 8200 sets the shift class and LEDs keep the default thresholds', () => {
    const { hud, container } = setup();
    hud.update({ ...base, rpm: 7000 });
    const thresholds = Array.from(
      { length: LED_COUNT },
      (_, i) => SHIFT_LIGHT_RPM * (0.8 + (0.2 * i) / (LED_COUNT - 1)),
    );
    const lit = leds(container).map((led) => led.classes.has('on'));
    expect(lit).toEqual(thresholds.map((t) => 7000 >= t));

    hud.update({ ...base, rpm: thresholds[2] });
    const atBoundary = leds(container).map((led) => led.classes.has('on'));
    expect(atBoundary).toEqual(thresholds.map((_, i) => i <= 2));

    hud.update({ ...base, rpm: 8200 });
    expect(findByClass(container, 'shift')).toHaveLength(1);
  });

  it('AT2: setRpmRange(14200, 15000) shifts at 14200 and scales the bar to 15000', () => {
    const { hud, container } = setup();
    shiftRpmRange(hud, 14200, 15000);

    hud.update({ ...base, rpm: 8200 });
    expect(findByClass(container, 'shift')).toHaveLength(0);
    expect(leds(container).some((led) => led.classes.has('on'))).toBe(false);

    hud.update({ ...base, rpm: 14200 });
    expect(findByClass(container, 'shift')).toHaveLength(1);

    hud.update({ ...base, rpm: 7500 });
    expect(Math.abs(barPct(container) - 50)).toBeLessThanOrEqual(1);
  });

  it('AT3: invalid ranges are ignored and the defaults (8200/9000) stay in effect', () => {
    const { hud, container } = setup();
    shiftRpmRange(hud, 9000, 8000);
    shiftRpmRange(hud, NaN, 15000);

    hud.update({ ...base, rpm: 8200 });
    expect(findByClass(container, 'shift')).toHaveLength(1);
    expect(Math.abs(barPct(container) - (8200 / 9000) * 100)).toBeLessThanOrEqual(1);
  });
});
