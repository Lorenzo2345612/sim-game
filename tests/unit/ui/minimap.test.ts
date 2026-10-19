import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitMinimap, toMinimap, Minimap } from '../../../src/ui/minimap';

const SQUARE: readonly [number, number][] = [
  [0, 0],
  [100, 0],
  [100, -100],
  [0, -100],
];

class FakeCtx {
  ops: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  lineJoin = '';
  lineCap = '';

  clearRect(x: number, y: number, w: number, h: number): void {
    this.ops.push(`clear:${x},${y},${w},${h}`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push(`fillRect:${x},${y},${w},${h}`);
  }
  beginPath(): void {
    this.ops.push('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.ops.push(`moveTo:${x.toFixed(3)},${y.toFixed(3)}`);
  }
  lineTo(x: number, y: number): void {
    this.ops.push(`lineTo:${x.toFixed(3)},${y.toFixed(3)}`);
  }
  stroke(): void {
    this.ops.push(`stroke:${this.strokeStyle}:${this.lineWidth}`);
  }
  arc(x: number, y: number, r: number): void {
    this.ops.push(`arc:${x.toFixed(3)},${y.toFixed(3)},${r}`);
  }
  fill(): void {
    this.ops.push(`fill:${this.fillStyle}`);
  }
  drawImage(): void {
    this.ops.push('drawImage');
  }
}

class FakeEl {
  className = '';
  children: FakeEl[] = [];
  parent: FakeEl | null = null;

  constructor(public ownerDocument: FakeDoc) {}

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

class FakeCanvas extends FakeEl {
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  ctx = new FakeCtx();

  getContext(kind: string): FakeCtx | null {
    return kind === '2d' ? this.ctx : null;
  }
}

class FakeDoc {
  created: string[] = [];
  styleProps: [string, string][] = [];
  documentElement = {
    style: {
      setProperty: (name: string, value: string): void => {
        this.styleProps.push([name, value]);
      },
    },
  };

  createElement(tag: string): FakeEl {
    this.created.push(tag);
    if (tag === 'canvas') return new FakeCanvas(this);
    return new FakeEl(this);
  }
}

function setup(centerline: readonly [number, number][] = SQUARE, size?: number): {
  minimap: Minimap;
  container: FakeEl;
  canvas: FakeCanvas;
  doc: FakeDoc;
} {
  const doc = new FakeDoc();
  const container = new FakeEl(doc);
  const minimap = new Minimap(
    container as unknown as HTMLElement,
    centerline,
    size,
  );
  const canvas = container.children[0] as FakeCanvas;
  return { minimap, container, canvas, doc };
}

describe('fitMinimap degenerate input', () => {
  it('empty centerline: scale 1 and centred', () => {
    const t = fitMinimap([], 160, 160, 8);
    expect(t.scale).toBe(1);
    expect(toMinimap(t, 0, 0, { x: 0, y: 0 })).toEqual({ x: 80, y: 80 });
  });

  it('single point: scale 1 and the point maps to the centre', () => {
    const t = fitMinimap([[400, -250]], 160, 160, 8);
    expect(t.scale).toBe(1);
    expect(toMinimap(t, 400, -250, { x: 0, y: 0 })).toEqual({ x: 80, y: 80 });
  });

  it('zero extent (all points identical): scale 1 and centred', () => {
    const pts: readonly [number, number][] = [
      [12, -34],
      [12, -34],
      [12, -34],
    ];
    const t = fitMinimap(pts, 160, 160, 8);
    expect(t.scale).toBe(1);
    expect(toMinimap(t, 12, -34, { x: 0, y: 0 })).toEqual({ x: 80, y: 80 });
  });

  it('zero extent on one axis only keeps the other axis fitted and centred', () => {
    const pts: readonly [number, number][] = [
      [50, 0],
      [50, -500],
    ];
    const t = fitMinimap(pts, 160, 160, 8);
    expect(t.scale).toBeCloseTo(144 / 500, 10);
    const a = toMinimap(t, 50, 0, { x: 0, y: 0 });
    const b = toMinimap(t, 50, -500, { x: 0, y: 0 });
    expect(a.x).toBeCloseTo(80, 6);
    expect(b.x).toBeCloseTo(80, 6);
    expect(a.y).toBeLessThanOrEqual(152 + 1e-6);
    expect(b.y).toBeGreaterThanOrEqual(8 - 1e-6);
  });
});

describe('fitMinimap aspect and bounds', () => {
  it('wide flat track: height axis is the limit, all points inside padding', () => {
    const pts: readonly [number, number][] = [
      [0, 0],
      [400, 0],
      [400, -1],
      [0, -1],
    ];
    const t = fitMinimap(pts, 160, 160, 8);
    expect(t.scale).toBeCloseTo(144 / 400, 10);
    for (const [x, z] of pts) {
      const p = toMinimap(t, x, z, { x: 0, y: 0 });
      expect(p.x).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(152 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(152 + 1e-6);
    }
  });

  it('identical scale on both axes for a non-square area', () => {
    const pts: readonly [number, number][] = [
      [0, 0],
      [300, 0],
      [300, -60],
    ];
    const t = fitMinimap(pts, 200, 100, 10);
    expect(t.scale).toBeCloseTo(Math.min(180 / 300, 80 / 60), 10);
  });

  it('padding larger than half the size does not produce a negative fit', () => {
    const t = fitMinimap(SQUARE, 160, 160, 100);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(t.scale).toBeGreaterThan(0);
  });
});

describe('toMinimap', () => {
  it('writes into and returns the caller-supplied out object', () => {
    const t = fitMinimap(SQUARE, 160, 160, 8);
    const out = { x: 0, y: 0 };
    const res = toMinimap(t, 10, -20, out);
    expect(res).toBe(out);
    expect(out.x).toBe(10 * t.scale + t.offsetX);
    expect(out.y).toBe(-20 * t.scale + t.offsetY);
  });

  it('east (+X) increases px x and north (−Z) decreases px y', () => {
    const t = fitMinimap(SQUARE, 160, 160, 8);
    const a = toMinimap(t, 10, -10, { x: 0, y: 0 });
    const east = toMinimap(t, 20, -10, { x: 0, y: 0 });
    const north = toMinimap(t, 10, -20, { x: 0, y: 0 });
    expect(east.x).toBeGreaterThan(a.x);
    expect(east.y).toBe(a.y);
    expect(north.y).toBeLessThan(a.y);
    expect(north.x).toBe(a.x);
  });
});

describe('Minimap canvas', () => {
  it('appends one canvas of the default size with the spec CSS', () => {
    const { container, canvas, doc } = setup();
    expect(container.children).toHaveLength(1);
    expect(canvas.width).toBe(160);
    expect(canvas.height).toBe(160);
    expect(canvas.className).toBe('minimap');
    expect(doc.styleProps).toContainEqual(['--minimap-size', '160px']);
  });

  it('honours a custom size', () => {
    const { canvas } = setup(SQUARE, 96);
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);
  });

  it('draws the track and start marker once to a static layer', () => {
    const { minimap, doc, canvas } = setup();
    expect(doc.created.filter((t) => t === 'canvas')).toHaveLength(2);
    const layer = (minimap as unknown as { layer: FakeCanvas }).layer;
    const strokes = layer.ctx.ops.filter((o) => o.startsWith('stroke:'));
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toBe('stroke:#ffffff:3');
    expect(layer.ctx.ops.filter((o) => o.startsWith('lineTo'))).toHaveLength(4);
    expect(canvas.ctx.ops.filter((o) => o.startsWith('stroke:'))).toHaveLength(0);
    expect(canvas.ctx.ops).toContain('drawImage');
  });

  it('update redraws background, static layer and a radius-4 dot at the car', () => {
    const { minimap, canvas } = setup();
    canvas.ctx.ops = [];
    minimap.update(50, -50);
    const ops = canvas.ctx.ops;
    expect(ops[0]).toBe('clear:0,0,160,160');
    expect(ops).toContain('drawImage');
    const arcs = ops.filter((o) => o.startsWith('arc:'));
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toBe('arc:80.000,80.000,4');
    expect(ops.some((o) => o === 'fill:#e02020')).toBe(true);
  });

  it('update moves the dot with the car without appending children', () => {
    const { minimap, container, doc } = setup();
    const before = doc.created.length;
    minimap.update(0, 0);
    const first = canvasArcs(minimap);
    minimap.update(100, -100);
    expect(doc.created.length).toBe(before);
    expect(container.children).toHaveLength(1);
    expect(canvasArcs(minimap)).not.toBe(first);
  });

  it('dispose removes the canvas and releases the bitmaps', () => {
    const { minimap, container, canvas } = setup();
    const layer = (minimap as unknown as { layer: FakeCanvas }).layer;
    minimap.dispose();
    expect(container.children).toHaveLength(0);
    expect(canvas.parent).toBeNull();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(layer.width).toBe(0);
    expect(layer.height).toBe(0);
  });

  it('works with a centerline of a single point', () => {
    const { minimap, canvas } = setup([[10, -10]]);
    canvas.ctx.ops = [];
    minimap.update(10, -10);
    expect(canvas.ctx.ops.filter((o) => o.startsWith('arc:'))).toHaveLength(1);
    expect(canvas.ctx.ops.filter((o) => o.startsWith('stroke:'))).toHaveLength(0);
  });
});

function canvasArcs(minimap: Minimap): string[] {
  const ctx = (minimap as unknown as { canvas: FakeCanvas }).canvas.ctx;
  return ctx.ops.filter((o) => o.startsWith('arc:'));
}

describe('minimap.ts source', () => {
  const src = readFileSync('src/ui/minimap.ts', 'utf8');
  const pure = src.slice(src.indexOf('export function fitMinimap'), src.indexOf('export class Minimap'));

  it('fitMinimap/toMinimap reference no DOM API', () => {
    expect(pure).not.toMatch(/\bdocument\b|\bwindow\b|canvas|Path2D|getContext/);
  });

  it('update body creates no objects', () => {
    const body = src.slice(src.indexOf('  update('), src.indexOf('  dispose('));
    expect(body).not.toMatch(/\bnew\b|\{\s*x:/);
  });

  it('runs where globalThis.document is undefined', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const t = fitMinimap(SQUARE, 160, 160, 8);
    expect(t.scale).toBeCloseTo(1.44, 10);
  });
});
