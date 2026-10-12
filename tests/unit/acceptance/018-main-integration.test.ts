import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../..', import.meta.url);
const monzaPath = fileURLToPath(new URL('public/tracks/monza.json', ROOT));
const indexPath = fileURLToPath(new URL('index.html', ROOT));
const mainPath = fileURLToPath(new URL('src/main.ts', ROOT));

describe('018 main integration acceptance', () => {
  it('AT1: public/tracks/monza.json parses with id monza and centerline length > 2000', () => {
    const track = JSON.parse(readFileSync(monzaPath, 'utf8')) as {
      id: string;
      centerline: unknown[];
    };
    expect(track.id).toBe('monza');
    expect(Array.isArray(track.centerline)).toBe(true);
    expect(track.centerline.length).toBeGreaterThan(2000);
  });

  it('AT2: index.html contains #game canvas, #hud, #status and script /src/main.ts', () => {
    const html = readFileSync(indexPath, 'utf8');
    expect(html).toMatch(/<canvas[^>]*\bid="game"/);
    expect(html).toMatch(/\bid="hud"/);
    expect(html).toMatch(/\bid="status"/);
    expect(html).toMatch(/<script[^>]*\bsrc="\/src\/main\.ts"[^>]*>/);
  });

  it('AT3: src/main.ts references __SIMGAME__, getSpeedKmh, getLap, getSimTime and imports ./ui/hud.css', () => {
    const src = readFileSync(mainPath, 'utf8');
    expect(src).toContain('__SIMGAME__');
    expect(src).toContain('getSpeedKmh');
    expect(src).toContain('getLap');
    expect(src).toContain('getSimTime');
    expect(src).toMatch(/import\s+['"]\.\/ui\/hud\.css['"]/);
  });
});
