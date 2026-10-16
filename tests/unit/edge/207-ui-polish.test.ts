import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { HudV2, type HudV2Data } from '../../../src/ui/hudV2';

const read = (p: string): string => readFileSync(p, 'utf8');
const cssFiles = (): string[] =>
  readdirSync('src/ui').filter((f) => f.endsWith('.css')).map((f) => `src/ui/${f}`);

class FakeEl {
  classes = new Set<string>();
  children: FakeEl[] = [];
  text: string | null = null;
  style: Record<string, string> = { width: '', display: '' };
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    toggle: (c: string, on?: boolean) => {
      if (on === undefined ? !this.classes.has(c) : on) this.classes.add(c);
      else this.classes.delete(c);
    },
    contains: (c: string) => this.classes.has(c),
  };
  constructor(public ownerDocument: FakeDoc) {}
  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
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
  created = 0;
  createElement(): FakeEl {
    this.created += 1;
    return new FakeEl(this);
  }
}
const walk = (e: FakeEl): FakeEl[] => [e, ...e.children.flatMap(walk)];

const data = (rpm: number): HudV2Data => ({
  speedKmh: 100, gear: 3, rpm, lap: 1, currentLapTime: null, lastLapTime: null,
  bestLapTime: null, sectorTimes: [null, null, null], bestSectorTimes: [null, null, null],
  deltaSeconds: null, lapValid: true,
});

describe('207 UI polish edge cases', () => {
  it('EDGE1: main.ts imports theme.css before every other import', () => {
    const lines = read('src/main.ts').split('\n').filter((l) => /^import\s/.test(l));
    expect(lines[0]).toMatch(/import\s+['"]\.\/ui\/theme\.css['"]/);
  });

  it('EDGE2: theme.css defines every required token on :root', () => {
    expect(existsSync('src/ui/theme.css')).toBe(true);
    const css = read('src/ui/theme.css');
    expect(css).toMatch(/:root/);
    for (const t of ['bg', 'panel', 'panel-solid', 'border', 'text', 'text-dim', 'accent',
      'good', 'warn', 'bad', 'radius', 'gap', 'font', 'font-num']) {
      expect(css, t).toMatch(new RegExp(`--ui-${t}\\s*:\\s*[^;\\s]`));
    }
  });

  it('EDGE3: UI css has no external URLs, imports, url() or web fonts', () => {
    for (const f of cssFiles()) {
      const css = read(f);
      expect(css, f).not.toMatch(/https?:\/\//);
      expect(css, f).not.toMatch(/@import/);
      expect(css, f).not.toMatch(/@font-face/);
      expect(css, f).not.toMatch(/url\(/);
    }
  });

  it('EDGE4: --ui-text is off-white with no channel above 0xe8', () => {
    const m = read('src/ui/theme.css').match(/--ui-text\s*:\s*#([0-9a-fA-F]{6})\b/);
    expect(m).not.toBeNull();
    const hex = m![1];
    for (const i of [0, 2, 4]) expect(parseInt(hex.slice(i, i + 2), 16)).toBeLessThanOrEqual(0xe8);
  });

  it('EDGE5: motion is disabled under prefers-reduced-motion', () => {
    const all = ['src/ui/theme.css', 'src/ui/menu.css'].map(read).join('\n');
    expect(all).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('EDGE6: transitions use durations of 0 or 120-200 ms', () => {
    for (const f of cssFiles()) {
      for (const decl of read(f).match(/transition\s*:[^;]+;/g) ?? []) {
        for (const m of decl.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
          const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
          if (ms === 0) continue;
          expect(ms, `${f}: ${decl}`).toBeGreaterThanOrEqual(120);
          expect(ms, `${f}: ${decl}`).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it('EDGE7: HudV2 builds exactly 15 hud2-led spans once, in the panel', () => {
    const doc = new FakeDoc();
    const container = new FakeEl(doc);
    const hud = new HudV2(container as unknown as HTMLElement);
    const count = (): number => walk(container).filter((e) => e.classes.has('hud2-led')).length;
    expect(count()).toBe(15);
    const created = doc.created;
    for (const rpm of [0, 4500, 8200, 9000, 20000, -5, NaN]) hud.update(data(rpm));
    expect(count()).toBe(15);
    expect(doc.created).toBe(created);
  });

  it('EDGE8: hud2-rpm-bar is kept and still driven by style.width', () => {
    const doc = new FakeDoc();
    const container = new FakeEl(doc);
    const hud = new HudV2(container as unknown as HTMLElement);
    hud.update(data(4500));
    const bar = walk(container).filter((e) => e.classes.has('hud2-rpm-bar'));
    expect(bar).toHaveLength(1);
    expect(parseFloat(bar[0].style.width)).toBeCloseTo(50, 5);
  });

  it('EDGE9: contract classes and ids remain in the UI sources', () => {
    const src = readdirSync('src/ui').filter((f) => f.endsWith('.ts')).map((f) => read(`src/ui/${f}`)).join('\n');
    for (const t of ['hud-panel', 'hud-speed', 'hud-lap', 'hud2-panel', 'hud2-rpm-bar', 'tyres',
      'menu-panel', 'menu-title', 'track-card', 'track-name', 'track-grid', 'credits-btn', 'setup-panel']) {
      expect(src, t).toContain(t);
    }
  });
});
