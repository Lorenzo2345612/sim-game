import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('VITEST')) delete env[k];
  }
  return env;
}

describe('287 decouple POST9 from the published models', () => {
  it(
    'AT1: master with hand-published public/ai-models/cleveland-f4/expert.json — all tests in the post file pass',
    () => {
      const r = spawnSync(
        'npx',
        [
          'vitest',
          'run',
          'tests/unit/edge/269-evolved-neural-driver.post.test.ts',
          '--no-color',
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 540_000,
          maxBuffer: 32 * 1024 * 1024,
          env: childEnv(),
        },
      );
      const tail = [r.stdout, r.stderr].filter(Boolean).join('\n').slice(-4000);
      expect(r.error?.message ?? '', tail).toBe('');
      expect(r.status, tail).toBe(0);
    },
    600_000,
  );

  it('AT2: git status --short public/ai-models is empty after the run', () => {
    const r = spawnSync('git', ['status', '--short', 'public/ai-models'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.stdout.trim(), r.stdout).toBe('');
  });
});
