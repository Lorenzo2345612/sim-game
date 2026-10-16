
## Planner-authorised test edits

- `tests/e2e/acceptance/174-track-banking.spec.ts`: replace `join(__dirname, '../../../public/tracks/daytona.json')` with `join(process.cwd(), 'public/tracks/daytona.json')` (the project is ESM; Playwright runs from the repo root). No other change to that file.
