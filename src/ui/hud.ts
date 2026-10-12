import { formatLapTime } from './formatTime';

export interface HudData {
  speedKmh: number;
  lap: number;
  currentLapTime: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
}

export class Hud {
  private panel: HTMLDivElement;
  private speedEl: HTMLElement;
  private lapEl: HTMLElement;
  private currentEl: HTMLElement;
  private lastEl: HTMLElement;
  private bestEl: HTMLElement;
  private lastTexts = new Map<HTMLElement, string>();

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.panel = doc.createElement('div');
    this.panel.className = 'hud-panel';

    this.speedEl = doc.createElement('div');
    this.speedEl.className = 'hud-speed';
    this.panel.appendChild(this.speedEl);

    this.lapEl = doc.createElement('div');
    this.lapEl.className = 'hud-lap';
    this.panel.appendChild(this.lapEl);

    this.currentEl = this.timeRow(doc, 'Current', 'hud-current');
    this.lastEl = this.timeRow(doc, 'Last', 'hud-last');
    this.bestEl = this.timeRow(doc, 'Best', 'hud-best');

    container.appendChild(this.panel);
  }

  private timeRow(doc: Document, label: string, className: string): HTMLElement {
    const row = doc.createElement('div');
    row.className = className;
    const labelEl = doc.createElement('span');
    labelEl.className = 'hud-label';
    labelEl.textContent = label;
    const valueEl = doc.createElement('span');
    valueEl.className = 'hud-value';
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    this.panel.appendChild(row);
    return valueEl;
  }

  private setText(node: HTMLElement, text: string): void {
    if (this.lastTexts.get(node) === text) return;
    this.lastTexts.set(node, text);
    node.textContent = text;
  }

  update(data: HudData): void {
    const kmh = Number.isFinite(data.speedKmh) ? Math.round(data.speedKmh) : 0;
    this.setText(this.speedEl, `${kmh} km/h`);
    this.setText(this.lapEl, data.lap <= 0 ? 'Lap -' : `Lap ${data.lap}`);
    this.setText(this.currentEl, formatLapTime(data.currentLapTime));
    this.setText(this.lastEl, formatLapTime(data.lastLapTime));
    this.setText(this.bestEl, formatLapTime(data.bestLapTime));
  }

  dispose(): void {
    this.panel.remove();
    this.lastTexts.clear();
  }
}
