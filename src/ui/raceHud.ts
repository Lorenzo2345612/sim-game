import './raceHud.css';
import type { Standing } from '../race/classification';
import type { SectorFlag } from '../race/flags';
import type { VscPhase } from '../race/vsc';
import { YellowAlert } from './yellowAlert';
import { penaltyTag, type PenaltyAnnouncement } from './raceControl';

export interface RaceHudData {
  standings: readonly Standing[];
  playerCar: number;
  laps: number;
  flags: readonly SectorFlag[];
  blue: boolean;
  vscPhase: VscPhase;
  vscDelta: number;
  giveBack?: { passed: number; remaining: number } | null;
  playerFlag?: SectorFlag;
  playerSector?: number;
  /** Sim time in seconds. */
  time?: number;
  /** Tower name per car index (296); missing entries fall back to 'You' / 'AI n'. */
  names?: readonly string[];
}

const TOWER_TOP = 10;
const MAX_ROWS = TOWER_TOP + 1;
const MAX_TOASTS = 5;
const TOAST_MS = 4000;
const RC_SHOW_MS = 6000;
const ANNOUNCE_MS = 4000;
const MAX_RC_QUEUE = 5;

let rcEl: HTMLDivElement | null = null;
let rcMsgEl: HTMLDivElement | null = null;
let rcQueue: string[] = [];
let rcTimer = 0;
let announceEl: HTMLDivElement | null = null;
let announceTimer = 0;

function ensureRaceControl(doc: Document): void {
  if (rcEl !== null && rcEl.ownerDocument === doc) return;
  rcEl = doc.createElement('div');
  rcEl.id = 'race-control';
  const head = doc.createElement('div');
  head.className = 'race-control-head';
  head.textContent = 'RACE CONTROL';
  rcMsgEl = doc.createElement('div');
  rcMsgEl.className = 'race-control-msg';
  rcEl.append(head, rcMsgEl);
  rcEl.style.display = 'none';
  doc.body.appendChild(rcEl);
}

function ensureAnnounce(doc: Document): void {
  if (announceEl !== null && announceEl.ownerDocument === doc) return;
  announceEl = doc.createElement('div');
  announceEl.id = 'penalty-announce';
  for (const line of ['pen-announce-title', 'pen-announce-value', 'pen-announce-reason']) {
    const el = doc.createElement('div');
    el.className = line;
    announceEl.appendChild(el);
  }
  announceEl.style.display = 'none';
  doc.body.appendChild(announceEl);
}

function showNextRc(): void {
  const text = rcQueue.shift();
  if (text === undefined || rcEl === null || rcMsgEl === null) {
    if (rcEl !== null) rcEl.style.display = 'none';
    return;
  }
  rcMsgEl.textContent = text;
  rcEl.style.display = 'block';
  rcTimer = window.setTimeout(() => showNextRc(), RC_SHOW_MS);
}

export function pushRaceControl(text: string): void {
  ensureRaceControl(document);
  if (rcEl === null) return;
  const busy = rcQueue.length > 0 || rcEl.style.display !== 'none';
  rcQueue.push(text);
  while (rcQueue.length > MAX_RC_QUEUE) rcQueue.shift();
  if (busy) return;
  showNextRc();
}

export function announcePenalty(a: PenaltyAnnouncement): void {
  ensureAnnounce(document);
  if (announceEl === null) return;
  const [title, value, reason] = announceEl.children as unknown as HTMLDivElement[];
  title.textContent = a.title;
  value.textContent = a.value;
  reason.textContent = a.reason;
  announceEl.style.display = 'block';
  announceEl.classList.remove('pen-announce-in');
  void announceEl.offsetWidth;
  announceEl.classList.add('pen-announce-in');
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    if (announceEl !== null) announceEl.style.display = 'none';
  }, ANNOUNCE_MS);
}

export function clearRaceControl(): void {
  clearTimeout(rcTimer);
  rcQueue = [];
  if (rcEl !== null) rcEl.style.display = 'none';
}

export function clearPenaltyAnnounce(): void {
  clearTimeout(announceTimer);
  if (announceEl !== null) announceEl.style.display = 'none';
}

interface TowerRow {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  name: HTMLSpanElement;
  gap: HTMLSpanElement;
  pen: HTMLSpanElement;
  posText: string;
  nameText: string;
  gapText: string;
  penText: string;
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
  private readonly giveBackEl: HTMLDivElement;
  private giveBackText = '';
  private readonly vscEl: HTMLDivElement;
  private readonly toastsEl: HTMLDivElement;
  private readonly alertEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly lightEls: HTMLElement[] = [];
  private readonly alert = new YellowAlert();
  private alertMode = '';
  private alertLights = '';
  private alertText = '';
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
      el.id = `flag-s${s}`;
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

    this.alertEl = doc.createElement('div');
    this.alertEl.id = 'yellow-alert';
    this.alertEl.dataset.mode = 'none';
    this.alertEl.dataset.lights = 'off';
    for (const side of ['l', 'r']) {
      const led = doc.createElement('div');
      led.className = `led ${side}`;
      for (let i = 0; i < 4; i++) {
        const light = doc.createElement('i');
        light.className = 'light';
        led.appendChild(light);
      }
      this.alertEl.appendChild(led);
    }
    this.bannerEl = doc.createElement('div');
    this.bannerEl.id = 'yellow-banner';
    this.alertEl.appendChild(this.bannerEl);

    this.giveBackEl = doc.createElement('div');
    this.giveBackEl.id = 'giveback-banner';
    this.giveBackEl.style.display = 'none';

    this.root.append(top, this.tower, flags, this.alertEl, this.giveBackEl, this.blueEl, this.vscEl, this.toastsEl);
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
    this.updateAlert(data);

    const topN = Math.min(TOWER_TOP, total);
    const withPlayer = playerIdx >= TOWER_TOP;
    const count = Math.min(topN + (withPlayer ? 1 : 0), MAX_ROWS);
    this.ensureRows(count);
    for (let i = 0; i < count; i++) {
      const st = i < topN ? standings[i] : player!;
      this.fillRow(this.rows[i], st, data.playerCar, data.names);
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  clearToasts(): void {
    this.toastsEl.replaceChildren();
    clearRaceControl();
    clearPenaltyAnnounce();
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

  private updateAlert(data: RaceHudData): void {
    const v = this.alert.update(data.playerFlag ?? 'green', data.playerSector ?? 1, data.time ?? 0);
    if (this.alertMode !== v.mode) {
      this.alertMode = v.mode;
      this.alertEl.dataset.mode = v.mode;
    }
    const lights = v.lightsOn ? 'on' : 'off';
    if (this.alertLights !== lights) {
      this.alertLights = lights;
      this.alertEl.dataset.lights = lights;
    }
    if (this.alertText !== v.text) {
      this.alertText = v.text;
      this.bannerEl.textContent = v.text;
    }
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
    const gb = data.giveBack ?? null;
    const gbText = gb === null ? '' : `GIVE THE POSITION BACK TO AI ${gb.passed} · ${Math.ceil(gb.remaining)} s`;
    if (this.giveBackText !== gbText) {
      this.giveBackText = gbText;
      this.giveBackEl.textContent = gbText;
      this.giveBackEl.style.display = gb === null ? 'none' : 'block';
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
    const pen = doc.createElement('span');
    pen.className = 'race-row-pen';
    el.append(pos, name, gap, pen);
    this.tower.appendChild(el);
    return { el, pos, name, gap, pen, posText: '', nameText: '', gapText: '', penText: '', player: false };
  }

  private fillRow(
    row: TowerRow,
    st: Standing,
    playerCar: number,
    names?: readonly string[],
  ): void {
    const isPlayer = st.car === playerCar;
    if (row.posText !== String(st.position)) {
      row.posText = String(st.position);
      row.pos.textContent = row.posText;
    }
    const name = names?.[st.car] ?? (isPlayer ? 'You' : `AI ${st.car}`);
    if (row.nameText !== name) {
      row.nameText = name;
      row.name.textContent = name;
    }
    const gap = gapText(st);
    if (row.gapText !== gap) {
      row.gapText = gap;
      row.gap.textContent = gap;
    }
    const pen = penaltyTag(st.penalty);
    if (row.penText !== pen) {
      row.penText = pen;
      row.pen.textContent = pen;
    }
    row.pen.style.display = pen === '' ? 'none' : '';
    if (row.player !== isPlayer) {
      row.player = isPlayer;
      row.el.className = isPlayer ? 'race-row player' : 'race-row';
    }
  }
}
