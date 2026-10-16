import { describe, it, expect } from 'vitest';
import { HudTyres, type HudTyresData } from '../../../src/ui/hudTyres';
import { updateDirt, dirtGripFactor } from '../../../src/physics/tyreDirt';

// tyreTempText lands in src/ui/hudTyres.ts (208); the variable specifier keeps
// typecheck green until the export exists (the 162/166 pattern).
const HUD_TIRES_MODULE = '../../../src/ui/hudTyres';
type TyreTempText = (tempC: number) => string;

async function loadTyreTempText(): Promise<TyreTempText> {
  const mod = (await import(HUD_TIRES_MODULE)) as { tyreTempText: TyreTempText };
  return mod.tyreTempText;
}

type HudTyresData208 = HudTyresData & {
  dirt: number[];
  compound: 'soft' | 'medium' | 'hard';
  pressureKpa: number;
};

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  text: string | null = null;
  textWrites = 0;
  classWrites = 0;
  styleWrites = 0;
  style: { transform: string };

  constructor(public ownerDocument: FakeDoc, public tag: string) {
    const target = { transform: '' };
    this.style = new Proxy(target, {
      set: (t, p, value) => {
        this.styleWrites += 1;
        (t as Record<string | symbol, unknown>)[p] = value;
        return true;
      },
    });
  }

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.classWrites += 1;
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
    this.children.push(child);
    return child;
  }
}

class FakeDoc {
  created: string[] = [];
  createElement(tag: string): FakeEl {
    this.created.push(tag);
    return new FakeEl(this, tag);
  }
}

const base: HudTyresData208 = {
  tempC: [60, 90, 120, 90],
  wear: [0.5, 1, 0, 0.25],
  dirt: [0, 0.04, 0.05, 1],
  optTempC: 90,
  tempWindowC: 40,
  fuelL: 10,
  meanLapL: null,
  compound: 'soft',
  pressureKpa: 140,
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

describe('208 tyre hud acceptance', () => {
  it('AT1: tyreTempText rounds 86.4 to "86°" and 86.5 to "87°" and shows "—" for NaN and Infinity', async () => {
    const tyreTempText = await loadTyreTempText();
    expect(tyreTempText(86.4)).toBe('86°');
    expect(tyreTempText(86.5)).toBe('87°');
    expect(tyreTempText(Number.NaN)).toBe('—');
    expect(tyreTempText(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('AT2: update renders four tyres with the base temps, wears and blue, green, red, green colours', () => {
    const { hud, container } = setup();
    hud.update(base);
    const tyres = findByClass(container, 'tyre');
    expect(tyres).toHaveLength(4);
    expect(tyres.map((t) => findByClass(t, 'tyre-temp')[0]?.text ?? null)).toEqual([
      '60°',
      '90°',
      '120°',
      '90°',
    ]);
    expect(tyres.map((t) => findByClass(t, 'tyre-wear')[0]?.text ?? null)).toEqual([
      '50%',
      '100%',
      '0%',
      '25%',
    ]);
    expect(tyres.map((t) => [...t.classes].find((c) => c.startsWith('tyre-')))).toEqual([
      'tyre-blue',
      'tyre-green',
      'tyre-red',
      'tyre-green',
    ]);
  });

  it('AT3: the tyre bars scale 0.50, 0.00, 1.00 and 0.75 for wear 0.5, 1, 0 and 0.25', () => {
    const { hud, container } = setup();
    hud.update(base);
    expect(findByClass(container, 'tyre-bar').map((b) => b.style.transform)).toEqual([
      'scaleY(0.50)',
      'scaleY(0.00)',
      'scaleY(1.00)',
      'scaleY(0.75)',
    ]);
  });

  it('AT4: tiles 2 and 3 carry class dirty with the base dirt and none does after dirt zeroes', () => {
    const { hud, container } = setup();
    hud.update(base);
    expect(findByClass(container, 'tyre').map((t) => t.classes.has('dirty'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    const clean: HudTyresData208 = { ...base, dirt: [0, 0, 0, 0] };
    hud.update(clean);
    expect(findByClass(container, 'tyre').map((t) => t.classes.has('dirty'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('AT5: the header shows compound S with 20.3 psi and compound H with a dash for NaN pressure', () => {
    const { hud, container } = setup();
    hud.update(base);
    expect(findByClass(container, 'tyres-compound')[0]?.text ?? null).toBe('S');
    expect(findByClass(container, 'tyres-compound')[0]?.classes.has('compound-soft')).toBe(true);
    expect(findByClass(container, 'tyres-pressure')[0]?.text ?? null).toBe('20.3 psi');
    const hard: HudTyresData208 = { ...base, compound: 'hard', pressureKpa: Number.NaN };
    hud.update(hard);
    expect(findByClass(container, 'tyres-compound')[0]?.text ?? null).toBe('H');
    expect(findByClass(container, 'tyres-compound')[0]?.classes.has('compound-hard')).toBe(true);
    expect(findByClass(container, 'tyres-compound')[0]?.classes.has('compound-soft')).toBe(false);
    expect(findByClass(container, 'tyres-pressure')[0]?.text ?? null).toBe('— psi');
  });

  it('AT6: a second identical update writes no text, class or style and creates no element', () => {
    const { hud, container, doc } = setup();
    const before = doc.created.length;
    hud.update(base);
    const snap = walk(container).map((e) => [e.textWrites, e.classWrites, e.styleWrites]);
    hud.update(base);
    expect(walk(container).map((e) => [e.textWrites, e.classWrites, e.styleWrites])).toEqual(snap);
    expect(doc.created.length).toBe(before);
  });

  it('AT7: dirt picks up 0.1 grass and 0.2 gravel in 10 m, decays e^-1 over 150 m and loses 10% grip', () => {
    expect(updateDirt(0, 'grass', 10, 1)).toBeCloseTo(0.1, 12);
    expect(updateDirt(0, 'gravel', 10, 1)).toBeCloseTo(0.2, 12);
    expect(updateDirt(1, 'asphalt', 15, 10)).toBeCloseTo(Math.exp(-1), 12);
    expect(dirtGripFactor(1, 'asphalt')).toBeCloseTo(0.9, 12);
  });
});
