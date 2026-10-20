import './results.css';
import { formatLapTime } from './formatTime';
import { gainText, highlights, recapFor, recapLine } from './recap';
import type { OvertakeEvent, OvertakeSummary } from '../race/overtakeLog';

type Tab = 'classification' | 'overtakes';

const LEGEND = [
  'Clean: passed without contact',
  'Contact: passed with contact',
  'Rival slow/off: passed a car that was stopped, off track or much slower',
];

export type ResultStatus = 'finished' | 'running' | 'dnf';

export interface ResultsRow {
  car?: number;
  grid?: number;
  summary?: OvertakeSummary;
  position: number;
  name: string;
  totalTime: number | null;
  bestLap: number | null;
  penalty: number;
  penaltyReasons?: string[];
  status?: ResultStatus;
}

export interface ResultsRecap {
  events: readonly OvertakeEvent[];
  name(car: number): string;
}

function timeText(row: ResultsRow): string {
  if (row.status === 'running') return 'Running';
  if (row.status === 'dnf' || row.totalTime === null) return 'DNF';
  return formatLapTime(row.totalTime + row.penalty);
}

const ZERO_SUMMARY: OvertakeSummary = { clean: 0, contact: 0, gift: 0, lost: 0 };

export class Results {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly thead: HTMLElement;
  private readonly tbody: HTMLElement;
  private readonly overtakeThead: HTMLElement;
  private readonly overtakeTbody: HTMLElement;
  private readonly recapHighlights: HTMLElement;
  private readonly recapList: HTMLElement;
  private readonly actions: HTMLElement;
  private filterCar: number | null = null;
  private rowCars = new Map<HTMLElement, number>();
  private recap: ResultsRecap | undefined;

  constructor(parent: HTMLElement) {
    this.doc = parent.ownerDocument;
    this.root = this.doc.createElement('div');
    this.root.id = 'results';
    const panel = this.doc.createElement('div');
    panel.className = 'results-panel';
    const title = this.doc.createElement('div');
    title.className = 'results-title';
    title.textContent = 'Results';
    this.tabs = this.doc.createElement('div');
    this.tabs.className = 'results-tabs';
    for (const tab of ['classification', 'overtakes'] as const) {
      const button = this.doc.createElement('button');
      button.id = `results-tab-${tab}`;
      button.textContent = tab === 'classification' ? 'Classification' : 'Overtakes';
      button.addEventListener('click', () => this.selectTab(tab));
      this.tabButtons.set(tab, button);
      this.tabs.appendChild(button);
    }
    const table = this.doc.createElement('table');
    table.className = 'results-table';
    this.thead = this.doc.createElement('thead');
    this.tbody = this.doc.createElement('tbody');
    table.append(this.thead, this.tbody);
    const classificationPane = this.doc.createElement('div');
    classificationPane.className = 'results-pane';
    classificationPane.appendChild(table);
    this.panes.set('classification', classificationPane);
    const overtakePane = this.doc.createElement('div');
    overtakePane.id = 'results-overtakes';
    overtakePane.className = 'results-pane';
    const overtakeTable = this.doc.createElement('table');
    overtakeTable.className = 'results-overtakes-table';
    this.overtakeThead = this.doc.createElement('thead');
    this.overtakeTbody = this.doc.createElement('tbody');
    overtakeTable.append(this.overtakeThead, this.overtakeTbody);
    this.recapHighlights = this.doc.createElement('div');
    this.recapHighlights.className = 'results-recap-highlights';
    const legend = this.doc.createElement('div');
    legend.className = 'results-legend';
    for (const line of LEGEND) {
      const item = this.doc.createElement('div');
      item.className = 'results-legend-item';
      item.textContent = line;
      legend.appendChild(item);
    }
    this.recapList = this.doc.createElement('div');
    this.recapList.className = 'results-recap-list';
    overtakePane.append(overtakeTable, this.recapHighlights, legend, this.recapList);
    this.panes.set('overtakes', overtakePane);
    this.actions = this.doc.createElement('div');
    this.actions.className = 'results-actions';
    panel.append(title, this.tabs, classificationPane, overtakePane, this.actions);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
    this.hide();
  }

  show(rows: readonly ResultsRow[], handlers: { onRestart(): void; onMenu(): void }, recap?: ResultsRecap): void {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const extended = sorted.some((r) => r.car !== undefined || r.grid !== undefined || r.summary !== undefined);
    this.filterCar = null;
    this.header(extended);
    this.overtakeHeader();
    this.recap = recap;
    this.fillBody(sorted, extended);
    if (recap !== undefined) {
      this.tabs.style.display = 'flex';
      this.renderRecap(sorted, recap);
    } else {
      this.tabs.style.display = 'none';
      this.recapHighlights.textContent = '';
      this.recapList.replaceChildren();
    }
    this.selectTab('classification');
    this.actions.replaceChildren(
      this.button('Restart', 'btn-primary', handlers.onRestart),
      this.button('Menu', 'btn-secondary', handlers.onMenu),
    );
    this.root.style.display = 'flex';
  }

  update(rows: readonly ResultsRow[]): void {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const extended = sorted.some((r) => r.car !== undefined || r.grid !== undefined || r.summary !== undefined);
    this.fillBody(sorted, extended);
    if (this.recap !== undefined) this.renderRecap(sorted, this.recap);
  }

  private fillBody(sorted: readonly ResultsRow[], extended: boolean): void {
    const recap = this.recap;
    this.tbody.replaceChildren();
    this.overtakeTbody.replaceChildren();
    this.rowCars = new Map();
    for (const row of sorted) {
      const tr = this.doc.createElement('tr');
      this.cell(tr, String(row.position));
      this.cell(tr, row.name);
      if (extended) {
        this.cell(tr, row.grid === undefined ? '-' : String(row.grid));
        this.cell(tr, row.grid === undefined ? '-' : gainText(row.grid, row.position));
      }
      this.cell(tr, timeText(row));
      this.cell(tr, row.bestLap === null ? '-' : formatLapTime(row.bestLap));
      const reasons = row.penaltyReasons ?? [];
      const text =
        row.penalty <= 0
          ? '-'
          : reasons.length > 0
            ? `${row.penalty} s (${reasons.join(', ')})`
            : `${row.penalty} s`;
      this.cell(tr, text, 'penalty');
      this.tbody.appendChild(tr);
      const ot = this.doc.createElement('tr');
      const s = row.summary;
      this.cell(ot, String(row.position));
      this.cell(ot, row.name);
      this.cell(ot, s === undefined ? '-' : String(s.clean));
      this.cell(ot, s === undefined ? '-' : String(s.contact));
      this.cell(ot, s === undefined ? '-' : String(s.gift));
      this.cell(ot, s === undefined ? '-' : String(s.lost));
      if (recap !== undefined && row.car !== undefined) {
        const car = row.car;
        ot.classList.add('clickable');
        this.rowCars.set(ot, car);
        ot.addEventListener('click', () => {
          this.filterCar = this.filterCar === car ? null : car;
          this.paintSelection();
          this.renderRecap(sorted, recap);
        });
      }
      this.overtakeTbody.appendChild(ot);
    }
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private selectTab(tab: Tab): void {
    for (const [name, button] of this.tabButtons) {
      if (name === tab) button.classList.add('active');
      else button.classList.remove('active');
    }
    for (const [name, pane] of this.panes) pane.style.display = name === tab ? 'flex' : 'none';
  }

  private header(extended: boolean): void {
    const tr = this.doc.createElement('tr');
    this.headCell(tr, 'P');
    this.headCell(tr, 'Name');
    if (extended) {
      this.headCell(tr, 'Grid');
      this.headCell(tr, '+/−');
    }
    this.headCell(tr, 'Time');
    this.headCell(tr, 'Best lap');
    this.headCell(tr, 'Penalty');
    this.thead.replaceChildren(tr);
  }

  private overtakeHeader(): void {
    const tr = this.doc.createElement('tr');
    for (const label of ['P', 'Name', 'Clean', 'Contact', 'Rival slow/off', 'Lost']) this.headCell(tr, label);
    this.overtakeThead.replaceChildren(tr);
  }

  private renderRecap(rows: readonly ResultsRow[], recap: ResultsRecap): void {
    const byCar = new Map<number, ResultsRow>();
    for (const r of rows) if (r.car !== undefined) byCar.set(r.car, r);
    const cars = [...byCar.keys()].sort((a, b) => a - b);
    const grid: number[] = [];
    const position: number[] = [];
    const summary: OvertakeSummary[] = [];
    for (const c of cars) {
      const r = byCar.get(c);
      grid.push(r?.grid ?? 0);
      position.push(r?.position ?? 0);
      summary.push(r?.summary ?? ZERO_SUMMARY);
    }
    const nameOf = (i: number): string => recap.name(cars[i]);
    this.recapHighlights.textContent = highlights(grid, position, summary, nameOf);
    this.recapList.replaceChildren(
      ...recapFor(recap.events, this.filterCar).map((e) => {
        const item = this.doc.createElement('div');
        item.className = 'results-recap-item';
        item.textContent = recapLine(e, recap.name);
        return item;
      }),
    );
  }

  private paintSelection(): void {
    for (const [tr, car] of this.rowCars) {
      if (this.filterCar !== null && car === this.filterCar) tr.classList.add('selected');
      else tr.classList.remove('selected');
    }
  }

  private cell(tr: HTMLElement, text: string, className?: string): void {
    const td = this.doc.createElement('td');
    td.textContent = text;
    if (className !== undefined) td.className = className;
    tr.appendChild(td);
  }

  private headCell(tr: HTMLElement, text: string, title?: string): void {
    const th = this.doc.createElement('th');
    th.textContent = text;
    if (title !== undefined) th.title = title;
    tr.appendChild(th);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
}
