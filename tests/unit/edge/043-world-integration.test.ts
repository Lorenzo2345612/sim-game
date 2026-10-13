import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../..', import.meta.url);
const mainPath = fileURLToPath(new URL('src/main.ts', ROOT));

// 043 wiring lives only in src/main.ts and the node test env has no DOM, so these
// are source contracts (same pattern as acceptance 018 AT3), one per spec rule.
function mainSrc(): string {
  return readFileSync(mainPath, 'utf8');
}

describe('043 world integration edges', () => {
  it('EDGE1: surfaceUnderCar is the majority of game.getWheelSurfaces() with an asphalt fallback', () => {
    const src = mainSrc();
    expect(src).toMatch(/surfaceUnderCar/);
    expect(src).toMatch(/getWheelSurfaces/);
    expect(src).toMatch(/['"]asphalt['"]/);
  });

  it('EDGE2: the start lights are kept off at load with setLights(0)', () => {
    expect(mainSrc()).toMatch(/setLights\(\s*0\s*\)/);
  });

  it('EDGE3: the tree field is updated once per frame with camera.position', () => {
    expect(mainSrc()).toMatch(/\.update\(\s*camera\.position\s*\)/);
  });

  it('EDGE4: the terrain grass material repeats with RepeatWrapping (moved to terrainMaterial.ts by 081)', () => {
    const src = readFileSync(fileURLToPath(new URL('src/render/terrainMaterial.ts', ROOT)), 'utf8');
    expect(src).toMatch(/'grass'/);
    expect(src).toMatch(/RepeatWrapping/);
    expect(src).toMatch(/\.repeat\b/);
  });

  it('EDGE5: the environment is applied for the selected track id', () => {
    expect(mainSrc()).toMatch(/applyEnvironment\(\s*scene\s*,\s*track\.id\s*\)/);
  });

  it('EDGE6: the car casts shadows and the terrain and surfaces receive them', () => {
    const src = mainSrc();
    expect(src).toMatch(/castShadow/);
    expect(src).toMatch(/receiveShadow/);
  });

  it('EDGE7: a failed track load shows the error in #status', () => {
    const src = mainSrc();
    expect(src).toMatch(/status\.textContent = 'Error: '/);
    expect(src).toMatch(/main\(\)\.catch\(\s*onError\s*\)/);
  });
});
