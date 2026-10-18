import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

describe('256 post-merge regressions', () => {
  it('AT1: the 253 runoff suite passes and contains no AT6 test', () => {
    const src = readFileSync(
      join(ROOT, 'tests', 'unit', 'acceptance', '253-runoff-flag-colours.test.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/it\(\s*['"]AT6/);
    execSync('npx vitest run tests/unit/acceptance/253-runoff-flag-colours.test.ts', {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 120000,
    });
  }, 180000);

  it(
    'AT2: the 225 AI grip margin edge suite passes with EDGE3 medium < hard < expert on monza',
    () => {
      execSync('npx vitest run tests/unit/edge/225-ai-grip-margin.test.ts', {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 1080000,
      });
    },
    1140000,
  );

  it('AT3: the 225 and 247 acceptance suites pass', () => {
    execSync(
      'npx vitest run tests/unit/acceptance/225-*.test.ts tests/unit/acceptance/247-*.test.ts',
      {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 720000,
      },
    );
  }, 780000);
});
