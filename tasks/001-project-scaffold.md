# 001 — Create the project scaffold

Status: done
Phase: 0
Depends on: nothing
Roles: coder, reviewer

## Goal

Vite + TypeScript + Vitest + ESLint project that installs, compiles, passes lint and tests, and builds.

## Context

EXACT versions in `ai/guides/architecture.md`, section "Pinned versions" (copy the range as is, e.g. `"typescript": "~6.0.3"`, `"@dimforge/rapier3d-compat": "0.21.0"`). `@playwright/test` is NOT installed here. Do not add any other package. `node_modules` and `dist` are already in `.gitignore`.

## Files

- `package.json` — create
- `tsconfig.json` — create
- `vite.config.ts` — create
- `vitest.config.ts` — create
- `eslint.config.js` — create
- `index.html` — create
- `src/main.ts` — create
- `tests/unit/smoke.test.ts` — create

## Steps

1. `package.json`: `"name": "sim-game"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`. `dependencies`: three, @dimforge/rapier3d-compat. `devDependencies`: typescript, vite, vitest, @types/three, eslint, @eslint/js, typescript-eslint, tsx, @types/node. Scripts:
   - `dev`: `vite`
   - `build`: `vite build`
   - `preview`: `vite preview`
   - `typecheck`: `tsc --noEmit`
   - `lint`: `eslint .`
   - `test`: `vitest run`
   - `build:tracks`: `tsx tools/track-builder/buildTrack.ts`
2. `tsconfig.json` compilerOptions: `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `noUncheckedIndexedAccess: false`, `skipLibCheck: true`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `types: ["vite/client","node"]`, `noEmit: true`. `include: ["src","tests","tools","*.ts"]`.
3. `vite.config.ts`: `import { defineConfig } from 'vite'; export default defineConfig({});`
4. `vitest.config.ts`: `defineConfig` from `vitest/config` with `test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] }`.
5. `eslint.config.js` (flat config): import `js from '@eslint/js'` and `tseslint from 'typescript-eslint'`; `export default tseslint.config({ ignores: ['dist','node_modules','public','assets','.ai'] }, js.configs.recommended, ...tseslint.configs.recommended);`
6. `index.html`: `lang="en"`, `<canvas id="game"></canvas>`, `<div id="hud"></div>`, `<div id="status">Loading…</div>`, `<script type="module" src="/src/main.ts"></script>`. Minimal inline `<style>` CSS: `html,body{margin:0;overflow:hidden}`, `canvas{width:100vw;height:100vh;display:block}`, `#hud,#status{position:fixed}`.
7. `src/main.ts` (one line): `document.getElementById('status')!.textContent = 'Phase 0';`
8. `tests/unit/smoke.test.ts`: import `describe, it, expect` from `vitest`; one test `adds numbers` with `expect(1 + 1).toBe(2)`.
9. Run `npm install` (generates `package-lock.json`, which is kept).

## Acceptance criteria

- [ ] `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` exit with code 0.
- [ ] `git status` does not list `node_modules` or `dist`.
- [ ] `package.json` does not contain `@playwright/test`.

## Verification

```
npm install
npm run typecheck
npm run lint
npm test
npm run build
git status --short
```

## Out of scope

- Playwright, e2e config, extra scripts, prettier, husky.
- Creating `tools/track-builder/buildTrack.ts` (task 006).
- Logic in `main.ts`, additional styles, README.
