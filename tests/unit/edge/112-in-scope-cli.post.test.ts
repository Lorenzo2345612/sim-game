import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

const IN_SCOPE_IDS = ['lmp2-a', 'hyper-a'];

describe('112 in-scope CLI edges', () => {
  it.each(IN_SCOPE_IDS)('POST14: a CLI subprocess build of %s reproduces the on-disk bytes', (id) => {
    const glb = join(MODELS, `${id}.glb`);
    const json = join(MODELS, `${id}.json`);
    expect(existsSync(glb), `${id}.glb`).toBe(true);
    expect(existsSync(json), `${id}.json`).toBe(true);
    const glbTmp = `${glb}.post-tmp`;
    const jsonTmp = `${json}.post-tmp`;
    copyFileSync(glb, glbTmp);
    copyFileSync(json, jsonTmp);
    const glbBefore = readFileSync(glbTmp);
    const jsonBefore = readFileSync(jsonTmp);
    try {
      execFileSync(TSX, ['tools/assets/buildCar.ts', id], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 900000,
      });
      expect(readFileSync(glb).equals(glbBefore), `${id} glb`).toBe(true);
      expect(readFileSync(json).equals(jsonBefore), `${id} json`).toBe(true);
    } finally {
      copyFileSync(glbTmp, glb);
      copyFileSync(jsonTmp, json);
      unlinkSync(glbTmp);
      unlinkSync(jsonTmp);
    }
  }, 900000);

  it('POST15: a CLI build of an unknown id exits 1 and names the id', () => {
    let status: number | null = null;
    let stderr = '';
    try {
      execFileSync(TSX, ['tools/assets/buildCar.ts', 'no-such-car-112'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      status = e.status ?? null;
      stderr = String(e.stderr ?? '');
    }
    expect(status).toBe(1);
    expect(stderr).toContain('unknown car id: no-such-car-112');
  });

  it('POST16: buildCar rejects unknown and empty ids before touching outputs', async () => {
    for (const id of ['', 'no-such-car-112']) {
      await expect(buildCar(id), JSON.stringify(id)).rejects.toThrow(`unknown car id: ${id}`);
    }
  });
});
