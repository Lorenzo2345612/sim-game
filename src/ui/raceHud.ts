import './raceHud.css';
import type { Standing } from '../race/classification';

export interface RaceHudData {
  standings: readonly Standing[];
  playerCar: number;
  laps: number;
}

const TOWER_TOP = 10;
const MAX_ROWS = TOWER_TOP + 1;

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

    this.root.append(top, this.tower);
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
