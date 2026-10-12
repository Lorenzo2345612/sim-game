const PLACEHOLDER = '-:--.---';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return PLACEHOLDER;
  const totalMs = Math.round(seconds * 1000);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}:${pad(s, 2)}.${pad(ms, 3)}`;
}
