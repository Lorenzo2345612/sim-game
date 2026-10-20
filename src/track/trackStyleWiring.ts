import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from './trackStyle';

export { extraGrandstands } from './placement';

export interface StyleResponse { ok: boolean; json(): Promise<unknown> }
export interface LoadedTrackStyle { style: ResolvedTrackStyle; loaded: boolean; errors: string[]; warnings: string[] }

const defaults = (errors: string[] = []): LoadedTrackStyle => ({ style: DEFAULT_TRACK_STYLE, loaded: false, errors, warnings: [] });

export async function loadTrackStyle(
  id: string,
  pointCount: number,
  fetchFn: (url: string) => Promise<StyleResponse> = (url) => fetch(url),
): Promise<LoadedTrackStyle> {
  let res: StyleResponse;
  try {
    res = await fetchFn(`/tracks/${id}.style.json`);
  } catch {
    return defaults();
  }
  if (!res.ok) return defaults();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return defaults(['invalid JSON in style file']);
  }
  const parsed = parseTrackStyle(body, pointCount);
  return { style: parsed.style, loaded: parsed.errors.length === 0, errors: parsed.errors, warnings: parsed.warnings };
}
