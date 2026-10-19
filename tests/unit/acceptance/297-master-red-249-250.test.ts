import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const NESTED_TIMEOUT = 900_000;

function runCmd(cmd: string, args: string[], timeout: number): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

describe('297 master red acceptance', () => {
  it('AT1: npx vitest run tests/unit/acceptance/249- tests/unit/acceptance/250- exits 0 (all pass)', () => {
    const r = runCmd(
      'npx',
      ['vitest', 'run', 'tests/unit/acceptance/249-', 'tests/unit/acceptance/250-'],
      NESTED_TIMEOUT,
    );
    expect(r.status, r.out.slice(-4000)).toBe(0);
  }, NESTED_TIMEOUT);
});
