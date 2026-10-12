import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const pkgRaw = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
const pkg = JSON.parse(pkgRaw) as {
  name: string;
  private: boolean;
  version: string;
  type: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const PINNED: Record<string, string> = {
  typescript: '~6.0.3',
  vite: '^8.3.4',
  vitest: '^5.0.3',
  three: '^0.186.1',
  '@types/three': '^0.186.0',
  '@dimforge/rapier3d-compat': '0.21.0',
  eslint: '^10.12.0',
  '@eslint/js': '^10.0.1',
  'typescript-eslint': '^8.71.1',
  tsx: '^4.23.15',
  '@types/node': '^24.0.0',
};

describe('project scaffold', () => {
  it('does not contain @playwright/test in package.json', () => {
    expect(pkgRaw).not.toContain('@playwright/test');
    expect(pkg.devDependencies['@playwright/test']).toBeUndefined();
    expect(pkg.dependencies['@playwright/test']).toBeUndefined();
  });

  it('keeps node_modules and dist out of git status', () => {
    const out = execFileSync('git', ['status', '--short'], { cwd: ROOT }).toString();
    expect(out).not.toMatch(/node_modules/);
    expect(out).not.toMatch(/(^|\s)dist\//);
  });

  it('declares required package identity', () => {
    expect(pkg.name).toBe('sim-game');
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBe('0.0.0');
    expect(pkg.type).toBe('module');
  });

  it('declares the required scripts verbatim', () => {
    expect(pkg.scripts).toMatchObject({
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      test: 'vitest run',
      'build:tracks': 'tsx tools/track-builder/buildTrack.ts',
    });
  });

  it('pins dependency ranges to the architecture guide', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(PINNED)) {
      expect(all[name], name).toBe(range);
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual(
      ['@dimforge/rapier3d-compat', 'three'].sort(),
    );
  });

  it('has an installed dependency tree and lockfile', () => {
    expect(existsSync(resolve(ROOT, 'package-lock.json'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'node_modules/vite'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'node_modules/@dimforge/rapier3d-compat'))).toBe(true);
  });

  it('compiles, lints and builds with exit code 0', () => {
    const run = (args: string[]) =>
      execFileSync('npm', args, { cwd: ROOT, stdio: 'pipe' }).toString();
    expect(run(['run', 'typecheck'])).toBeDefined();
    expect(run(['run', 'lint'])).toBeDefined();
    expect(run(['run', 'build'])).toContain('dist/');
  });
});
