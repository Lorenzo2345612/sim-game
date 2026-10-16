import { describe, it, expect } from 'vitest';
import { HudV2, SHIFT_LIGHT_RPM, HUD_MAX_RPM, type HudV2Data } from '../../../src/ui/hudV2';

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  classWrites = 0;
  text: string | null = null;
  style: Record<string, string> = { width: '', display: '' };
  constructor(public ownerDocument: FakeDoc) {}
  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
    this.classWrites += 1;
    this.classes = new Set(v.trim().split(/\s+/).filter(Boolean));
  }
  get textContent(): string | null {
    return this.text;
  }
  set textContent(v: string | null) {
    this.text = v;
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  setAttribute(): void {}
}
class FakeDoc {
  createElement(): FakeEl {
    return new FakeEl(this);
  }
}
const walk = (e: FakeEl): FakeEl[] => [e, ...e.children.flatMap(walk)];

const data = (rpm: number): HudV2Data => ({
  speedKmh: 100, gear: 3, rpm, lap: 1, currentLapTime: null, lastLapTime: null,
  bestLapTime: null, sectorTimes: [null, null, null], bestSectorTimes: [null, null, null],
  deltaSeconds: null, lapValid: true,
});

function setup(): { hud: HudV2; leds: FakeEl[] } {
  const container = new FakeEl(new FakeDoc());
  const hud = new HudV2(container as unknown as HTMLElement);
  return { hud, leds: walk(container).filter((e) => e.classes.has('hud2-led')) };
}
const onCount = (leds: FakeEl[]): number => leds.filter((l) => l.classes.has('on')).length;
const threshold = (i: number): number => SHIFT_LIGHT_RPM * (0.8 + (0.2 * i) / 14);

describe('207 LED rules', () => {
  it('LED i is on exactly when rpm reaches its threshold', () => {
    for (let i = 0; i < 15; i++) {
      const { hud, leds } = setup();
      hud.update(data(threshold(i) + 1));
      expect(leds[i].classes.has('on'), `on ${i}`).toBe(true);
      const b = setup();
      b.hud.update(data(threshold(i) - 1));
      expect(b.leds[i].classes.has('on'), `off ${i}`).toBe(false);
    }
  });

  it('no LED is lit below 80% of the shift rpm and 0 rpm', () => {
    const { hud, leds } = setup();
    hud.update(data(0));
    expect(onCount(leds)).toBe(0);
    hud.update(data(threshold(0) - 1));
    expect(onCount(leds)).toBe(0);
  });

  it('all LEDs are on at SHIFT_LIGHT_RPM', () => {
    const { hud, leds } = setup();
    hud.update(data(SHIFT_LIGHT_RPM));
    expect(onCount(leds)).toBe(15);
  });

  it('limiter at HUD_MAX_RPM - 200 puts on+limiter on all LEDs', () => {
    const { hud, leds } = setup();
    hud.update(data(HUD_MAX_RPM - 200));
    expect(leds.every((l) => l.classes.has('on') && l.classes.has('limiter'))).toBe(true);
    const below = setup();
    below.hud.update(data(HUD_MAX_RPM - 201));
    expect(below.leds.some((l) => l.classes.has('limiter'))).toBe(false);
  });

  it('limiter clears when rpm drops', () => {
    const { hud, leds } = setup();
    hud.update(data(HUD_MAX_RPM));
    hud.update(data(0));
    expect(leds.every((l) => l.classes.has('hud2-led') && !l.classes.has('on') && !l.classes.has('limiter'))).toBe(true);
  });

  it('colour classes are fixed: green 0-4, amber 5-9, red 10-14', () => {
    const { hud, leds } = setup();
    const colour = (l: FakeEl): string => ['led-green', 'led-amber', 'led-red'].filter((c) => l.classes.has(c)).join();
    const check = (): void =>
      leds.forEach((l, i) => expect(colour(l), `${i}`).toBe(i < 5 ? 'led-green' : i < 10 ? 'led-amber' : 'led-red'));
    check();
    hud.update(data(HUD_MAX_RPM));
    check();
    hud.update(data(0));
    check();
  });

  it('same rpm twice makes zero LED class writes', () => {
    const { hud, leds } = setup();
    hud.update(data(8000));
    const before = leds.map((l) => l.classWrites);
    hud.update(data(8000));
    expect(leds.map((l) => l.classWrites)).toEqual(before);
  });

  it('NaN and negative rpm keep LEDs off', () => {
    const { hud, leds } = setup();
    hud.update(data(NaN));
    hud.update(data(-100));
    expect(onCount(leds)).toBe(0);
  });
});
