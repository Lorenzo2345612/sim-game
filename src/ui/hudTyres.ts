export type TyreColour = 'blue' | 'green' | 'red';
export type TyreCompound = 'soft' | 'medium' | 'hard';

const PSI_PER_KPA = 6.894757;
const DIRTY_THRESHOLD = 0.05;

const COMPOUND_LETTER: Record<TyreCompound, string> = { soft: 'S', medium: 'M', hard: 'H' };

export function tyreColour(tempC: number, optTempC: number, windowC: number): TyreColour {
  const half = windowC / 2;
  if (tempC < optTempC - half) return 'blue';
  if (tempC > optTempC + half) return 'red';
  return 'green';
}

export function tyreTempText(tempC: number): string {
  if (!Number.isFinite(tempC)) return '—';
  return `${Math.round(tempC)}°`;
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
  tempC: number[]; wear: number[]; dirt: number[]; // length 4: FL FR RL RR
  optTempC: number; tempWindowC: number;
  fuelL: number; meanLapL: number | null;
  compound: TyreCompound; pressureKpa: number;
}

function wearText(wear: number): string {
  if (!Number.isFinite(wear)) return '—';
  const pct = Math.min(100, Math.max(0, Math.round(wear * 100)));
  return `${pct}%`;
}

function barTransform(wear: number): string {
  const r = Number.isFinite(wear) ? Math.min(1, Math.max(0, 1 - wear)) : 0;
  return `scaleY(${r.toFixed(2)})`;
}

function pressureText(kPa: number): string {
  if (!Number.isFinite(kPa)) return '— psi';
  return `${(kPa / PSI_PER_KPA).toFixed(1)} psi`;
}

export class HudTyres {
  private panel: HTMLDivElement;
  private tyreEls: HTMLElement[] = [];
  private tempEls: HTMLElement[] = [];
  private wearEls: HTMLElement[] = [];
  private barEls: HTMLElement[] = [];
  private compoundEl: HTMLElement;
  private pressureEl: HTMLElement;
  private fuelEl: HTMLElement;
  private lastTexts = new Map<HTMLElement, string>();
  private lastClasses = new Map<HTMLElement, string>();
  private lastTransforms = new Map<HTMLElement, string>();

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.panel = doc.createElement('div');
    this.panel.className = 'tyres';

    const head = doc.createElement('div');
    head.className = 'tyres-head';
    this.compoundEl = doc.createElement('span');
    this.compoundEl.className = 'tyres-compound';
    this.lastClasses.set(this.compoundEl, this.compoundEl.className);
    this.pressureEl = doc.createElement('span');
    this.pressureEl.className = 'tyres-pressure';
    this.lastClasses.set(this.pressureEl, this.pressureEl.className);
    head.appendChild(this.compoundEl);
    head.appendChild(this.pressureEl);
    this.panel.appendChild(head);

    for (let i = 0; i < 4; i++) {
      const tyre = doc.createElement('div');
      tyre.className = 'tyre tyre-green';
      this.lastClasses.set(tyre, tyre.className);
      const temp = doc.createElement('span');
      temp.className = 'tyre-temp';
      const wear = doc.createElement('span');
      wear.className = 'tyre-wear';
      const bar = doc.createElement('span');
      bar.className = 'tyre-bar';
      tyre.appendChild(temp);
      tyre.appendChild(wear);
      tyre.appendChild(bar);
      this.panel.appendChild(tyre);
      this.tyreEls.push(tyre);
      this.tempEls.push(temp);
      this.wearEls.push(wear);
      this.barEls.push(bar);
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

  private setTransform(node: HTMLElement, value: string): void {
    if (this.lastTransforms.get(node) === value) return;
    this.lastTransforms.set(node, value);
    node.style.transform = value;
  }

  update(d: HudTyresData): void {
    for (let i = 0; i < this.tyreEls.length; i++) {
      const tempC = d.tempC[i] ?? Number.NaN;
      const wear = d.wear[i] ?? Number.NaN;
      const colour = tyreColour(tempC, d.optTempC, d.tempWindowC);
      const dirty = (d.dirt[i] ?? 0) >= DIRTY_THRESHOLD;
      this.setClass(this.tyreEls[i], `tyre tyre-${colour}${dirty ? ' dirty' : ''}`);
      this.setText(this.tempEls[i], tyreTempText(tempC));
      this.setText(this.wearEls[i], wearText(wear));
      this.setTransform(this.barEls[i], barTransform(wear));
    }
    this.setClass(this.compoundEl, `tyres-compound compound-${d.compound}`);
    this.setText(this.compoundEl, COMPOUND_LETTER[d.compound]);
    this.setText(this.pressureEl, pressureText(d.pressureKpa));
    this.setText(this.fuelEl, fuelText(d.fuelL, d.meanLapL));
  }

  dispose(): void {
    this.panel.remove();
    this.lastTexts.clear();
    this.lastClasses.clear();
    this.lastTransforms.clear();
  }
}
