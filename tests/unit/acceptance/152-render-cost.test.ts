import { describe, expect, it } from 'vitest';
import { assignCells } from '../../../src/render/chunking';

const CELL = 200;

function buildPositions(): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  for (let i = 0; i < 96; i++) {
    positions.push({ x: (i * 137) % 900 - 450, z: (i * 271) % 700 - 350 });
  }
  positions.push({ x: 0, z: 0 }, { x: 200, z: -200 }, { x: -200.5, z: 199.5 });
  return positions;
}

describe('152 render cost acceptance', () => {
  it('AT3: every instance is assigned to exactly one cell and each cell spans at most 200 m', () => {
    const positions = buildPositions();
    const cells = assignCells(positions, CELL);
    const seen = new Set<number>();
    for (const [key, members] of cells) {
      const [cx, cz] = key.split(',').map(Number);
      expect(Number.isInteger(cx)).toBe(true);
      expect(Number.isInteger(cz)).toBe(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const i of members) {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(positions.length);
        const p = positions[i];
        expect(Math.floor(p.x / CELL)).toBe(cx);
        expect(Math.floor(p.z / CELL)).toBe(cz);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      expect(maxX - minX).toBeLessThanOrEqual(CELL);
      expect(maxZ - minZ).toBeLessThanOrEqual(CELL);
    }
    expect(seen.size).toBe(positions.length);
  });
});
