// Colour predicates from docs/design/track-style.md ("Colour predicates used by
// acceptance tests"); shared by 179 and 188-205 acceptance tests.

export function hsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function isRed(hex: string): boolean {
  const { h, s } = hsl(hex);
  return (h >= 345 || h < 15) && s >= 0.4;
}

export function isOrange(hex: string): boolean {
  const { h, s } = hsl(hex);
  return h >= 15 && h < 40 && s >= 0.4;
}

export function isYellow(hex: string): boolean {
  const { h, s } = hsl(hex);
  return h >= 40 && h < 70 && s >= 0.4;
}

export function isGreen(hex: string): boolean {
  const { h, s } = hsl(hex);
  return h >= 70 && h < 165 && s >= 0.25;
}

export function isTeal(hex: string): boolean {
  const { h, s } = hsl(hex);
  return h >= 150 && h < 195 && s >= 0.2;
}

export function isBlue(hex: string): boolean {
  const { h, s } = hsl(hex);
  return h >= 195 && h < 260 && s >= 0.3;
}

export function isWhite(hex: string): boolean {
  return hsl(hex).l >= 0.85;
}

export function isLight(hex: string): boolean {
  return hsl(hex).l >= 0.6;
}

export function isDark(hex: string): boolean {
  return hsl(hex).l <= 0.3;
}

export function isCream(hex: string): boolean {
  const { h, s, l } = hsl(hex);
  return h >= 25 && h < 60 && s <= 0.6 && l >= 0.6;
}

export function isGrey(hex: string): boolean {
  return hsl(hex).s <= 0.12;
}
