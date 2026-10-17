import { describe, it, expect } from 'vitest';
import { HudErs, type HudErsData } from '../../../src/ui/hudErs';

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  text: string | null = null;
  writes = 0;
  style: { transform: string };
  classList: { add: (c: string) => void; remove: (c: string) => void; toggle: (c: string, force?: boolean) => boolean; contains: (c: string) => boolean };

  constructor(public ownerDocument: FakeDoc, public tag: string) {
    const target = { transform: '' };
    this.style = new Proxy(target, {
      set: (t, p, value) => {
        this.writes += 1;
        (t as Record<string | symbol, unknown>)[p] = value;
        return true;
      },
    });
    this.classList = {
      add: (c) => {
        this.writes += 1;
        this.classes.add(c);
      },
      remove: (c) => {
        this.writes += 1;
        this.classes.delete(c);
      },
      toggle: (c, force) => {
        this.writes += 1;
        const on = force ?? !this.classes.has(c);
        if (on) this.classes.add(c);
        else this.classes.delete(c);
        return on;
      },
      contains: (c) => this.classes.has(c),
    };
  }

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(value: string) {
    this.writes += 1;
    this.classes = new Set(value.trim().split(/\s+/).filter(Boolean));
  }

  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
    this.writes += 1;
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

function walk(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(walk)];
}

function setup(): { hud: HudErs; container: FakeEl; doc: FakeDoc } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc, 'div');
  const hud = new HudErs(container as unknown as HTMLElement, doc as unknown as Document);
  return { hud, container, doc };
}

function one(container: FakeEl, token: string): FakeEl {
  const found = walk(container).filter((e) => e.classes.has(token));
  expect(found).toHaveLength(1);
  return found[0];
}

function totalWrites(container: FakeEl): number {
  return walk(container).reduce((n, e) => n + e.writes, 0);
}

const base: HudErsData = {
  socFrac: 0.624,
  powerW: 280000,
  mode: 'balance',
  overtake: false,
  clipping: false,
  lapDeployJ: 2e6,
  lapHarvestJ: 0,
  deployCapJ: 8.5e6,
  aeroStraight: true,
};

describe('223 ers hud acceptance', () => {
  it('AT1: balance deploy data renders 62%, scaleY(0.62), BAL, deploy, 6.5 MJ and X', () => {
    const { hud, container } = setup();
    hud.update(base);
    expect(one(container, 'ers-soc').text).toBe('62%');
    expect(one(container, 'ers-bar').style.transform).toBe('scaleY(0.62)');
    const mode = one(container, 'ers-mode');
    expect(mode.text).toBe('BAL');
    expect(mode.classes.has('mode-balance')).toBe(true);
    expect(one(container, 'ers-flow').classes.has('deploy')).toBe(true);
    expect(one(container, 'ers-lap').text).toBe('6.5 MJ');
    expect(one(container, 'ers-aero').text).toBe('X');
    expect(one(container, 'ers-ot').classes.has('active')).toBe(false);
  });

  it('AT2: harvest, clipping, overtake, charge and Z update the flow, clip, ot, mode and aero', () => {
    const { hud, container } = setup();
    hud.update(base);
    hud.update({ ...base, powerW: -175000, clipping: true, overtake: true, mode: 'charge', aeroStraight: false });
    const flow = one(container, 'ers-flow');
    expect(flow.classes.has('harvest')).toBe(true);
    expect(flow.classes.has('deploy')).toBe(false);
    expect(one(container, 'ers-clip').classes.has('active')).toBe(true);
    expect(one(container, 'ers-ot').classes.has('active')).toBe(true);
    const mode = one(container, 'ers-mode');
    expect(mode.text).toBe('CHG');
    expect(mode.classes.has('mode-charge')).toBe(true);
    expect(mode.classes.has('mode-balance')).toBe(false);
    expect(mode.classes.has('mode-attack')).toBe(false);
    expect(one(container, 'ers-aero').text).toBe('Z');
  });

  it('AT3: the same data twice causes zero writes and no element creation on the second call', () => {
    const { hud, container, doc } = setup();
    hud.update(base);
    const writes = totalWrites(container);
    const created = doc.created.length;
    hud.update({ ...base });
    expect(totalWrites(container)).toBe(writes);
    expect(doc.created.length).toBe(created);
  });

  it('AT4: update(null) gives the root the hidden class', () => {
    const { hud, container } = setup();
    hud.update(base);
    hud.update(null);
    expect(one(container, 'ers').classes.has('hidden')).toBe(true);
  });
});
