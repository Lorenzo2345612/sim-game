import './results.css';
import { formatLapTime } from './formatTime';
import { gainText, highlights, passesText, recapFor, recapLine } from './recap';
import type { OvertakeEvent, OvertakeSummary } from '../race/overtakeLog';

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
}

export interface ResultsRecap {
  events: readonly OvertakeEvent[];
  name(car: number): string;
}

const ZERO_SUMMARY: OvertakeSummary = { clean: 0, contact: 0, gift: 0, lost: 0 };

export class Results {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly thead: HTMLElement;
  private readonly tbody: HTMLElement;
  private readonly recapBox: HTMLElement;
  private readonly recapHighlights: HTMLElement;
  private readonly recapList: HTMLElement;
  private readonly actions: HTMLElement;
  private filterCar: number | null = null;
  private rowCars = new Map<HTMLElement, number>();

  constructor(parent: HTMLElement) {
    this.doc = parent.ownerDocument;
    this.root = this.doc.createElement('div');
    this.root.id = 'results';
    const panel = this.doc.createElement('div');
    panel.className = 'results-panel';
    const title = this.doc.createElement('div');
    title.className = 'results-title';
    title.textContent = 'Results';
    const table = this.doc.createElement('table');
    table.className = 'results-table';
    this.thead = this.doc.createElement('thead');
    this.tbody = this.doc.createElement('tbody');
    table.append(this.thead, this.tbody);
    this.recapBox = this.doc.createElement('div');
    this.recapBox.className = 'results-recap';
    const recapTitle = this.doc.createElement('div');
    recapTitle.className = 'results-recap-title';
    recapTitle.textContent = 'Race recap';
    this.recapHighlights = this.doc.createElement('div');
    this.recapHighlights.className = 'results-recap-highlights';
    this.recapList = this.doc.createElement('div');
    this.recapList.className = 'results-recap-list';
    this.recapBox.append(recapTitle, this.recapHighlights, this.recapList);
    this.actions = this.doc.createElement('div');
    this.actions.className = 'results-actions';
    panel.append(title, table, this.recapBox, this.actions);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
    this.hide();
  }

  show(rows: readonly ResultsRow[], handlers: { onRestart(): void; onMenu(): void }, recap?: ResultsRecap): void {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const extended = sorted.some((r) => r.car !== undefined || r.grid !== undefined || r.summary !== undefined);
    this.filterCar = null;
    this.header(extended);
    this.tbody.replaceChildren();
    this.rowCars = new Map();
    for (const row of sorted) {
      const tr = this.doc.createElement('tr');
      this.cell(tr, String(row.position));
      this.cell(tr, row.name);
      if (extended) {
        this.cell(tr, row.grid === undefined ? '-' : String(row.grid));
        this.cell(tr, row.grid === undefined ? '-' : gainText(row.grid, row.position));
      }
      this.cell(tr, row.totalTime === null ? 'DNF' : formatLapTime(row.totalTime));
      this.cell(tr, row.bestLap === null ? '-' : formatLapTime(row.bestLap));
      const reasons = row.penaltyReasons ?? [];
      const text =
        row.penalty <= 0
          ? '-'
          : reasons.length > 0
            ? `${row.penalty} s (${reasons.join(', ')})`
            : `${row.penalty} s`;
      this.cell(tr, text, 'penalty');
      if (extended) {
        this.cell(tr, row.summary === undefined ? '-' : passesText(row.summary));
        this.cell(tr, row.summary === undefined ? '-' : String(row.summary.lost));
      }
      if (recap !== undefined && row.car !== undefined) {
        const car = row.car;
        tr.classList.add('clickable');
        this.rowCars.set(tr, car);
        tr.addEventListener('click', () => {
          this.filterCar = this.filterCar === car ? null : car;
          this.paintSelection();
          this.renderRecap(sorted, recap);
        });
      }
      this.tbody.appendChild(tr);
    }
    if (recap !== undefined) {
      this.recapBox.style.display = 'block';
      this.renderRecap(sorted, recap);
    } else {
      this.recapBox.style.display = 'none';
      this.recapHighlights.textContent = '';
      this.recapList.replaceChildren();
    }
    this.actions.replaceChildren(
      this.button('Restart', 'btn-primary', handlers.onRestart),
      this.button('Menu', 'btn-secondary', handlers.onMenu),
    );
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
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
    if (extended) {
      this.headCell(tr, 'Passes', 'clean/contact/gift');
      this.headCell(tr, 'Lost');
    }
    this.thead.replaceChildren(tr);
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
