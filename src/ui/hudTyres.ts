export type TyreColour = 'blue' | 'green' | 'red';

export function tyreColour(tempC: number, optTempC: number, windowC: number): TyreColour {
  const half = windowC / 2;
  if (tempC < optTempC - half) return 'blue';
  if (tempC > optTempC + half) return 'red';
  return 'green';
}

export function fuelText(fuelL: number, meanLapL: number | null): string {
  const fuel = Number.isFinite(fuelL) ? Math.max(0, fuelL) : null;
  const laps =
    fuel !== null && meanLapL !== null && Number.isFinite(meanLapL) && meanLapL > 0
      ? (fuel / meanLapL).toFixed(1)
      : null;
  const fuelStr = fuel === null ? '—' : fuel.toFixed(1);
  return `${fuelStr} L · ${laps ?? '—'}${laps === null ? '' : ' laps'}`;
}

export interface HudTyresData {
  tempC: number[]; wear: number[];      // length 4: FL FR RL RR
  optTempC: number; tempWindowC: number;
  fuelL: number; meanLapL: number | null;
}

function wearText(wear: number): string {
  if (!Number.isFinite(wear)) return '—';
  const pct = Math.min(100, Math.max(0, Math.round(wear * 100)));
  return `${pct}%`;
}

export class HudTyres {
  private panel: HTMLDivElement;
  private tyreEls: HTMLElement[] = [];
  private fuelEl: HTMLElement;
  private lastTexts = new Map<HTMLElement, string>();
  private lastClasses = new Map<HTMLElement, string>();

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.panel = doc.createElement('div');
    this.panel.className = 'tyres';

    for (let i = 0; i < 4; i++) {
      const tyre = doc.createElement('div');
      tyre.className = 'tyre tyre-green';
      this.lastClasses.set(tyre, tyre.className);
      this.panel.appendChild(tyre);
      this.tyreEls.push(tyre);
    }

    this.fuelEl = doc.createElement('div');
    this.fuelEl.className = 'fuel';
    this.panel.appendChild(this.fuelEl);

    container.appendChild(this.panel);
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

  update(d: HudTyresData): void {
    for (let i = 0; i < this.tyreEls.length; i++) {
      const colour = tyreColour(d.tempC[i] ?? Number.NaN, d.optTempC, d.tempWindowC);
      this.setClass(this.tyreEls[i], `tyre tyre-${colour}`);
      this.setText(this.tyreEls[i], wearText(d.wear[i] ?? Number.NaN));
    }
    this.setText(this.fuelEl, fuelText(d.fuelL, d.meanLapL));
  }

  dispose(): void {
    this.panel.remove();
    this.lastTexts.clear();
    this.lastClasses.clear();
  }
}
