import './raceHud.css';
import type { Standing } from '../race/classification';
import type { SectorFlag } from '../race/flags';
import type { VscPhase } from '../race/vsc';

export interface RaceHudData {
  standings: readonly Standing[];
  playerCar: number;
  laps: number;
  flags: readonly SectorFlag[];
  blue: boolean;
  vscPhase: VscPhase;
  vscDelta: number;
}

const TOWER_TOP = 10;
const MAX_ROWS = TOWER_TOP + 1;
const MAX_TOASTS = 5;
const TOAST_MS = 4000;

interface TowerRow {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  name: HTMLSpanElement;
  gap: HTMLSpanElement;
  posText: string;
  nameText: string;
  gapText: string;
  player: boolean;
}

function gapText(st: Standing): string {
  if (st.position === 1) return '';
  if (st.gapToLeader === null || !Number.isFinite(st.gapToLeader)) return '+1 lap';
  return `+${st.gapToLeader.toFixed(3)}`;
}

export class RaceHud {
  private readonly root: HTMLDivElement;
  private readonly posEl: HTMLSpanElement;
  private readonly lapEl: HTMLSpanElement;
  private readonly tower: HTMLDivElement;
  private readonly rows: TowerRow[] = [];
  private readonly flagEls: HTMLDivElement[] = [];
  private readonly blueEl: HTMLDivElement;
  private readonly vscEl: HTMLDivElement;
  private readonly toastsEl: HTMLDivElement;
  private readonly flagStates: SectorFlag[] = ['green', 'green', 'green'];
  private blueVisible = false;
  private vscVisible = false;
  private vscText = '';
  private posText = '';
  private lapText = '';

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'race-hud';

    const top = doc.createElement('div');
    top.className = 'race-hud-top';
    this.posEl = doc.createElement('span');
    this.posEl.id = 'race-pos';
    this.lapEl = doc.createElement('span');
    this.lapEl.id = 'race-lap';
    top.append(this.posEl, this.lapEl);

    this.tower = doc.createElement('div');
    this.tower.id = 'race-tower';

    const flags = doc.createElement('div');
    flags.id = 'flags';
    for (let s = 1; s <= 3; s++) {
      const el = doc.createElement('div');
      el.className = `flag-s${s}`;
      el.dataset.state = 'green';
      flags.appendChild(el);
      this.flagEls.push(el);
    }
    this.blueEl = doc.createElement('div');
    this.blueEl.id = 'blue-banner';
    this.blueEl.textContent = 'BLUE FLAG';
    this.blueEl.style.display = 'none';
    this.vscEl = doc.createElement('div');
    this.vscEl.id = 'vsc-banner';
    this.vscEl.style.display = 'none';
    this.toastsEl = doc.createElement('div');
    this.toastsEl.id = 'toasts';

    this.root.append(top, this.tower, flags, this.blueEl, this.vscEl, this.toastsEl);
    parent.appendChild(this.root);
    this.root.style.display = 'none';
  }

  update(data: RaceHudData): void {
    const standings = data.standings;
    const total = standings.length;
    let playerIdx = -1;
    for (let i = 0; i < total; i++) {
      if (standings[i].car === data.playerCar) {
        playerIdx = i;
        break;
      }
    }
    const player = playerIdx >= 0 ? standings[playerIdx] : null;
    this.setText(this.posEl, player === null ? `P-/${total}` : `P${player.position}/${total}`, 'pos');
    const lap = Math.min(player === null ? 0 : player.lap, data.laps);
    this.setText(this.lapEl, `Lap ${lap}/${data.laps}`, 'lap');
    this.updateFlags(data);

    const topN = Math.min(TOWER_TOP, total);
    const withPlayer = playerIdx >= TOWER_TOP;
    const count = Math.min(topN + (withPlayer ? 1 : 0), MAX_ROWS);
    this.ensureRows(count);
    for (let i = 0; i < count; i++) {
      const st = i < topN ? standings[i] : player!;
      this.fillRow(this.rows[i], st, data.playerCar);
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  clearToasts(): void {
    this.toastsEl.replaceChildren();
  }

  pushToast(text: string): void {
    const el = this.root.ownerDocument.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.childElementCount > MAX_TOASTS) {
      this.toastsEl.firstElementChild?.remove();
    }
    window.setTimeout(() => el.remove(), TOAST_MS);
  }

  private updateFlags(data: RaceHudData): void {
    for (let i = 0; i < this.flagEls.length; i++) {
      const s = data.flags[i] ?? 'green';
      if (this.flagStates[i] === s) continue;
      this.flagStates[i] = s;
      this.flagEls[i].dataset.state = s;
    }
    if (this.blueVisible !== data.blue) {
      this.blueVisible = data.blue;
      this.blueEl.style.display = data.blue ? 'block' : 'none';
    }
    const vscOn = data.vscPhase !== 'off';
    if (this.vscVisible !== vscOn) {
      this.vscVisible = vscOn;
      this.vscEl.style.display = vscOn ? 'block' : 'none';
    }
    if (!vscOn) return;
    const d = data.vscDelta;
    const text = `VSC ${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
    if (this.vscText === text) return;
    this.vscText = text;
    this.vscEl.textContent = text;
  }

  dispose(): void {
    this.root.remove();
    this.rows.length = 0;
    this.posText = '';
    this.lapText = '';
  }

  private setText(node: HTMLSpanElement, text: string, key: 'pos' | 'lap'): void {
    const last = key === 'pos' ? this.posText : this.lapText;
    if (last === text) return;
    if (key === 'pos') this.posText = text;
    else this.lapText = text;
    node.textContent = text;
  }

  private ensureRows(count: number): void {
    while (this.rows.length > count) {
      const row = this.rows.pop();
      if (row) row.el.remove();
    }
    while (this.rows.length < count) this.rows.push(this.createRow());
  }

  private createRow(): TowerRow {
    const doc = this.root.ownerDocument;
    const el = doc.createElement('div');
    el.className = 'race-row';
    const pos = doc.createElement('span');
    pos.className = 'race-row-pos';
    const name = doc.createElement('span');
    name.className = 'race-row-name';
    const gap = doc.createElement('span');
    gap.className = 'race-row-gap';
    el.append(pos, name, gap);
    this.tower.appendChild(el);
    return { el, pos, name, gap, posText: '', nameText: '', gapText: '', player: false };
  }

  private fillRow(row: TowerRow, st: Standing, playerCar: number): void {
    const isPlayer = st.car === playerCar;
    if (row.posText !== String(st.position)) {
      row.posText = String(st.position);
      row.pos.textContent = row.posText;
    }
    const name = isPlayer ? 'You' : `AI ${st.car}`;
    if (row.nameText !== name) {
      row.nameText = name;
      row.name.textContent = name;
    }
    const gap = gapText(st);
    if (row.gapText !== gap) {
      row.gapText = gap;
      row.gap.textContent = gap;
    }
    if (row.player !== isPlayer) {
      row.player = isPlayer;
      row.el.className = isPlayer ? 'race-row player' : 'race-row';
    }
  }
}
