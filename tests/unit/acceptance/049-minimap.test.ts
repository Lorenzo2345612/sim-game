import { describe, it, expect } from 'vitest';
import { fitMinimap, toMinimap } from '../../../src/ui/minimap';
import type { MinimapTransform } from '../../../src/ui/minimap';

const SQUARE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [100, 0],
  [100, -100],
  [0, -100],
];

function squareTransform(): MinimapTransform {
  return fitMinimap(SQUARE as [number, number][], 160, 160, 8);
}

describe('049 minimap acceptance', () => {
  it('AT1: 100 m square fits in [8, 152] on both axes with aspect preserved', () => {
    const t = squareTransform();
    const mapped = SQUARE.map(([x, z]) => toMinimap(t, x, z, { x: 0, y: 0 }));
    for (const p of mapped) {
      expect(p.x).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(152 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(152 + 1e-6);
    }
    const spanX = mapped[1].x - mapped[0].x;
    const spanY = mapped[0].y - mapped[3].y;
    expect(spanX).toBeCloseTo(spanY, 6);
  });

  it('AT2: car dot at centerline[0] equals mapped centerline[0] within 0.5 px', () => {
    const t = squareTransform();
    const [cx, cz] = SQUARE[0];
    const dot = toMinimap(t, cx, cz, { x: 0, y: 0 });
    const mappedX = cx * t.scale + t.offsetX;
    const mappedY = cz * t.scale + t.offsetY;
    expect(Math.abs(dot.x - mappedX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(dot.y - mappedY)).toBeLessThanOrEqual(0.5);
  });

  it('AT3: north-up mapping — +X world goes +x px, −Z world goes −y px', () => {
    const t = squareTransform();
    const a = toMinimap(t, 0, 0, { x: 0, y: 0 });
    const east = toMinimap(t, 100, 0, { x: 0, y: 0 });
    const north = toMinimap(t, 0, -100, { x: 0, y: 0 });
    expect(east.x).toBeGreaterThan(a.x);
    expect(north.y).toBeLessThan(a.y);
  });
});
