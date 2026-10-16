import { formatLapTime } from './formatTime';

export type SectorColour = 'purple' | 'yellow' | 'none';

export interface HudV2Data {
  speedKmh: number;
  gear: number;
  rpm: number;
  lap: number;
  currentLapTime: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
  sectorTimes: (number | null)[];
  bestSectorTimes: (number | null)[];
  deltaSeconds: number | null;
  lapValid: boolean;
}

export const SHIFT_LIGHT_RPM = 8200;
export const HUD_MAX_RPM = 9000;
const LED_COUNT = 15;
const LED_COLOURS = ['led-green', 'led-amber', 'led-red'];

export function sectorColour(time: number | null, best: number | null): SectorColour {
  if (time === null) return 'none';
  if (best === null || time <= best) return 'purple';
  return 'yellow';
}

function formatDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '';
  return `${delta < 0 ? '-' : '+'}${Math.abs(delta).toFixed(3)}`;
}

export class HudV2 {
  private panel: HTMLDivElement;
  private timing: HTMLDivElement;
  private ledRow: HTMLElement;
  private leds: HTMLElement[] = [];
  private ledThresholds: number[] = [];
  private shiftRpm = SHIFT_LIGHT_RPM;
  private maxRpm = HUD_MAX_RPM;
  private ledBase: string[] = [];
  private ledOn: string[] = [];
  private ledLimiter: string[] = [];
  private speedEl: HTMLElement;
  private lapEl: HTMLElement;
  private gearEl: HTMLElement;
  private rpmEl: HTMLElement;
  private currentEl: HTMLElement;
  private lastEl: HTMLElement;
  private bestEl: HTMLElement;
  private sectorEls: HTMLElement[] = [];
  private deltaEl: HTMLElement;
  private invalidEl: HTMLElement;
  private lastTexts = new Map<HTMLElement, string>();
  private lastClasses = new Map<HTMLElement, string>();
  private lastWidths = new Map<HTMLElement, string>();
  private lastDisplays = new Map<HTMLElement, string>();

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.panel = doc.createElement('div');
    this.panel.className = 'hud2-panel';
    this.timing = doc.createElement('div');
    this.timing.className = 'hud-panel hud2-timing';

    this.ledRow = this.add(doc, 'hud2-leds');
    for (let i = 0; i < LED_COUNT; i++) {
      const led = doc.createElement('span');
      const base = `hud2-led ${LED_COLOURS[Math.floor(i / 5)]}`;
      led.className = base;
      this.lastClasses.set(led, base);
      this.ledBase.push(base);
      this.ledOn.push(`${base} on`);
      this.ledLimiter.push(`${base} on limiter`);
      this.ledThresholds.push(0);
      this.ledRow.appendChild(led);
      this.leds.push(led);
    }

    this.setRpmRange(SHIFT_LIGHT_RPM, HUD_MAX_RPM);

    this.speedEl = this.add(doc, 'hud2-speed hud-speed');
    this.lapEl = doc.createElement('div');
    this.lapEl.className = 'hud2-lap hud-lap';
    this.lastClasses.set(this.lapEl, 'hud2-lap hud-lap');
    this.timing.appendChild(this.lapEl);
    this.gearEl = this.add(doc, 'hud2-gear');

    const track = doc.createElement('div');
    track.className = 'hud2-rpm-track';
    this.rpmEl = doc.createElement('div');
    this.rpmEl.className = 'hud2-rpm-bar';
    this.lastClasses.set(this.rpmEl, 'hud2-rpm-bar');
    track.appendChild(this.rpmEl);
    this.panel.appendChild(track);

    this.currentEl = this.timeRow(doc, 'Current', 'hud2-current');
    this.lastEl = this.timeRow(doc, 'Last', 'hud2-last');
    this.bestEl = this.timeRow(doc, 'Best', 'hud2-best');

    const sectors = doc.createElement('div');
    sectors.className = 'hud2-sectors';
    for (const label of ['S1', 'S2', 'S3']) {
      const lab = doc.createElement('span');
      lab.className = 'hud2-sector-label';
      lab.textContent = label;
      sectors.appendChild(lab);
      const cell = doc.createElement('span');
      cell.className = 'sector sector-none';
      this.lastClasses.set(cell, 'sector sector-none');
      sectors.appendChild(cell);
      this.sectorEls.push(cell);
    }
    this.timing.appendChild(sectors);

    const deltaRow = doc.createElement('div');
    deltaRow.className = 'hud2-delta-row';
    const deltaLabel = doc.createElement('span');
    deltaLabel.className = 'hud2-label';
    deltaLabel.textContent = 'Delta';
    deltaRow.appendChild(deltaLabel);
    this.deltaEl = doc.createElement('span');
    this.deltaEl.className = 'delta';
    this.lastClasses.set(this.deltaEl, 'delta');
    deltaRow.appendChild(this.deltaEl);
    this.timing.appendChild(deltaRow);

    this.invalidEl = doc.createElement('div');
    this.invalidEl.className = 'invalid-badge';
    this.lastClasses.set(this.invalidEl, 'invalid-badge');
    this.invalidEl.textContent = 'INVALID';
    this.lastTexts.set(this.invalidEl, 'INVALID');
    this.invalidEl.style.display = 'none';
    this.lastDisplays.set(this.invalidEl, 'none');
    this.timing.appendChild(this.invalidEl);

    container.appendChild(this.panel);
    container.appendChild(this.timing);
  }

  private add(doc: Document, className: string): HTMLElement {
    const el = doc.createElement('div');
    el.className = className;
    this.lastClasses.set(el, className);
    this.panel.appendChild(el);
    return el;
  }

  private timeRow(doc: Document, label: string, className: string): HTMLElement {
    const row = doc.createElement('div');
    row.className = className;
    const labelEl = doc.createElement('span');
    labelEl.className = 'hud2-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const valueEl = doc.createElement('span');
    valueEl.className = 'hud2-value';
    row.appendChild(valueEl);
    this.timing.appendChild(row);
    return valueEl;
  }

  private setText(node: HTMLElement, text: string): void {
    if (this.lastTexts.get(node) === text) return;
    this.lastTexts.set(node, text);
    node.textContent = text;
  }

  private setClass(node: HTMLElement, className: string): void {
    if (this.lastClasses.get(node) === className) return;
    this.lastClasses.set(node, className);
    node.className = className;
  }

  private setWidth(node: HTMLElement, width: string): void {
    if (this.lastWidths.get(node) === width) return;
    this.lastWidths.set(node, width);
    node.style.width = width;
  }

  private setDisplay(node: HTMLElement, display: string): void {
    if (this.lastDisplays.get(node) === display) return;
    this.lastDisplays.set(node, display);
    node.style.display = display;
  }

  setRpmRange(shiftRpm: number, maxRpm: number): void {
    if (!Number.isFinite(shiftRpm) || !Number.isFinite(maxRpm) || shiftRpm <= 0 || shiftRpm >= maxRpm) return;
    this.shiftRpm = shiftRpm;
    this.maxRpm = maxRpm;
    for (let i = 0; i < LED_COUNT; i++) this.ledThresholds[i] = shiftRpm * (0.8 + (0.2 * i) / (LED_COUNT - 1));
  }

  update(data: HudV2Data): void {
    const kmh = Number.isFinite(data.speedKmh) ? Math.round(data.speedKmh) : 0;
    this.setText(this.speedEl, `${kmh} km/h`);
    this.setText(this.lapEl, data.lap <= 0 ? 'Lap -' : `Lap ${data.lap}`);
    this.setText(this.gearEl, data.gear === -1 ? 'R' : String(data.gear));

    const rpm = Number.isFinite(data.rpm) ? data.rpm : 0;
    const pct = Math.min(100, Math.max(0, (rpm / this.maxRpm) * 100));
    this.setWidth(this.rpmEl, `${pct.toFixed(1)}%`);
    this.setClass(this.rpmEl, `hud2-rpm-bar${rpm >= this.shiftRpm ? ' shift' : ''}`);

    const limiter = rpm >= this.maxRpm - (200 * this.maxRpm) / HUD_MAX_RPM;
    for (let i = 0; i < LED_COUNT; i++) {
      this.setClass(
        this.leds[i],
        limiter ? this.ledLimiter[i] : rpm >= this.ledThresholds[i] ? this.ledOn[i] : this.ledBase[i],
      );
    }

    this.setText(this.currentEl, formatLapTime(data.currentLapTime));
    this.setText(this.lastEl, formatLapTime(data.lastLapTime));
    this.setText(this.bestEl, formatLapTime(data.bestLapTime));

    for (let i = 0; i < this.sectorEls.length; i++) {
      const time = data.sectorTimes[i] ?? null;
      const best = data.bestSectorTimes[i] ?? null;
      this.setText(this.sectorEls[i], formatLapTime(time));
      this.setClass(this.sectorEls[i], `sector sector-${sectorColour(time, best)}`);
    }

    this.setText(this.deltaEl, formatDelta(data.deltaSeconds));
    const delta = data.deltaSeconds;
    const deltaClass =
      delta !== null && Number.isFinite(delta)
        ? delta < 0
          ? 'delta delta-neg'
          : 'delta delta-pos'
        : 'delta';
    this.setClass(this.deltaEl, deltaClass);

    this.setDisplay(this.invalidEl, data.lapValid ? 'none' : '');
    this.setText(this.invalidEl, 'INVALID');
  }

  dispose(): void {
    this.panel.remove();
    this.timing.remove();
    this.lastTexts.clear();
    this.lastClasses.clear();
    this.lastWidths.clear();
    this.lastDisplays.clear();
  }
}
