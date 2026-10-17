import type { ErsMode, ErsTelemetry } from '../physics/hybridTypes';

export type HudErsData = ErsTelemetry & { aeroStraight: boolean | null };

const MODE_TEXT: Record<ErsMode, string> = { charge: 'CHG', balance: 'BAL', attack: 'ATK' };
const FLOW_THRESHOLD_W = 1000;

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export class HudErs {
  private root: HTMLElement;
  private bar: HTMLElement;
  private soc: HTMLElement;
  private mode: HTMLElement;
  private ot: HTMLElement;
  private flow: HTMLElement;
  private clip: HTMLElement;
  private lap: HTMLElement;
  private aero: HTMLElement;
  private lastTexts = new Map<HTMLElement, string>();
  private lastClasses = new Map<HTMLElement, string>();
  private lastTransform = '';

  constructor(container: HTMLElement, doc: Document = container.ownerDocument) {
    this.root = this.make(doc, 'div', 'ers hidden');
    this.bar = this.make(doc, 'span', 'ers-bar');
    this.soc = this.make(doc, 'span', 'ers-soc');
    this.mode = this.make(doc, 'span', 'ers-mode');
    this.ot = this.make(doc, 'span', 'ers-ot');
    this.flow = this.make(doc, 'span', 'ers-flow idle');
    this.clip = this.make(doc, 'span', 'ers-clip');
    this.lap = this.make(doc, 'span', 'ers-lap');
    this.aero = this.make(doc, 'span', 'ers-aero');
    this.ot.textContent = 'OT';
    this.clip.textContent = 'CLIP';
    const track = this.make(doc, 'div', 'ers-track');
    track.appendChild(this.bar);
    const info = this.make(doc, 'div', 'ers-info');
    const row = this.make(doc, 'div', 'ers-row');
    for (const el of [this.soc, this.mode, this.aero]) row.appendChild(el);
    const row2 = this.make(doc, 'div', 'ers-row');
    for (const el of [this.ot, this.flow, this.clip, this.lap]) row2.appendChild(el);
    info.appendChild(row);
    info.appendChild(row2);
    this.root.appendChild(track);
    this.root.appendChild(info);
    container.appendChild(this.root);
  }

  private make(doc: Document, tag: string, className: string): HTMLElement {
    const el = doc.createElement(tag);
    el.className = className;
    this.lastClasses.set(el, className);
    return el;
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

  update(d: HudErsData | null): void {
    if (d === null) {
      this.setClass(this.root, 'ers hidden');
      return;
    }
    this.setClass(this.root, 'ers');
    const soc = Math.min(1, Math.max(0, finite(d.socFrac)));
    const transform = `scaleY(${soc.toFixed(2)})`;
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      this.bar.style.transform = transform;
    }
    this.setText(this.soc, `${Math.round(soc * 100)}%`);
    this.setText(this.mode, MODE_TEXT[d.mode]);
    this.setClass(this.mode, `ers-mode mode-${d.mode}`);
    this.setClass(this.ot, d.overtake ? 'ers-ot active' : 'ers-ot');
    const p = finite(d.powerW);
    const flow = p > FLOW_THRESHOLD_W ? 'deploy' : p < -FLOW_THRESHOLD_W ? 'harvest' : 'idle';
    this.setClass(this.flow, `ers-flow ${flow}`);
    this.setClass(this.clip, d.clipping ? 'ers-clip active' : 'ers-clip');
    this.setText(this.lap, `${((finite(d.deployCapJ) - finite(d.lapDeployJ)) / 1e6).toFixed(1)} MJ`);
    this.setText(this.aero, d.aeroStraight === null ? '' : d.aeroStraight ? 'X' : 'Z');
  }

  dispose(): void {
    this.root.remove();
    this.lastTexts.clear();
    this.lastClasses.clear();
  }
}
