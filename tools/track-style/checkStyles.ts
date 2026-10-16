import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTrackStyle } from '../../src/track/trackStyle';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLE_SUFFIX = '.style.json';

export interface StyleCheck {
  id: string;
  errors: string[];
  warnings: string[];
}

function tryParseJson(path: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch {
    return null;
  }
}

export function checkStyles(dir: string): StyleCheck[] {
  const ids = readdirSync(dir)
    .filter((name) => name.endsWith(STYLE_SUFFIX))
    .map((name) => name.slice(0, -STYLE_SUFFIX.length))
    .sort();
  return ids.map((id) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trackPath = join(dir, `${id}.json`);
    if (!existsSync(trackPath)) {
      errors.push(`no ${id}.json`);
      return { id, errors, warnings };
    }
    const track = tryParseJson(trackPath);
    if (track === null) {
      errors.push(`${id}.json: invalid JSON`);
      return { id, errors, warnings };
    }
    const centerline = (track.value as { centerline?: unknown }).centerline;
    if (!Array.isArray(centerline)) {
      errors.push(`${id}.json: missing centerline`);
      return { id, errors, warnings };
    }
    const raw = tryParseJson(join(dir, `${id}${STYLE_SUFFIX}`));
    if (raw === null) {
      errors.push(`${id}${STYLE_SUFFIX}: invalid JSON`);
      return { id, errors, warnings };
    }
    const parsed = parseTrackStyle(raw.value, centerline.length);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    return { id, errors, warnings };
  });
}

function main(): void {
  try {
    const dir = process.argv[2] ?? join(ROOT, 'public', 'tracks');
    let failed = false;
    for (const { id, errors, warnings } of checkStyles(dir)) {
      for (const message of [...errors, ...warnings]) {
        console.log(`${id}: ${message}`);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
