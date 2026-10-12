import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

const SETS = [
  { surface: 'asphalt', id: 'Asphalt010' },
  { surface: 'grass', id: 'Grass005' },
  { surface: 'gravel', id: 'Gravel041' },
  { surface: 'concrete', id: 'Concrete030' },
  { surface: 'metal', id: 'Metal032' },
];
const CHANNELS = ['color', 'normal', 'roughness'];
const MIN_BYTES = 20 * 1024;

function texturePaths(): string[] {
  return SETS.flatMap(({ surface }) =>
    CHANNELS.map((channel) => join(ROOT, 'public', 'textures', surface, `${channel}.jpg`)),
  );
}

function runFetch(timeoutMs: number): string {
  const result = spawnSync('npm', ['run', 'fetch:textures'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  expect(result.error, 'npm run fetch:textures could not be spawned').toBeUndefined();
  expect(result.status, `npm run fetch:textures exited ${result.status}: ${result.stderr}`).toBe(0);
  return result.stdout;
}

describe('035 textures fetch acceptance', () => {
  it(
    'AT1: npm run fetch:textures creates all 15 JPG files, each larger than 20 KB',
    { timeout: 900_000 },
    () => {
      runFetch(840_000);
      for (const path of texturePaths()) {
        expect(existsSync(path), `${path} missing`).toBe(true);
        expect(statSync(path).size, `${path} too small`).toBeGreaterThan(MIN_BYTES);
      }
    },
  );

  it('AT2: ASSETS_LICENSES.md has exactly one line per texture set with the ambientCG id, CC0 and URL', () => {
    const lines = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8').split('\n');
    for (const { id } of SETS) {
      const matching = lines.filter((line) => line.includes(id));
      expect(matching, `no ASSETS_LICENSES.md line for ${id}`).toHaveLength(1);
      expect(matching[0]).toContain('CC0');
      expect(matching[0]).toContain(`https://ambientcg.com/a/${id}`);
    }
  });

  it(
    'AT3: second run of fetch:textures exits 0 and re-downloads nothing (all 15 files untouched)',
    { timeout: 600_000 },
    () => {
      const before = texturePaths().map((path) => {
        expect(existsSync(path), `precondition: ${path} missing`).toBe(true);
        return statSync(path).mtimeMs;
      });
      runFetch(540_000);
      texturePaths().forEach((path, i) => {
        expect(statSync(path).mtimeMs, `${path} was rewritten`).toBe(before[i]);
      });
    },
  );
});
