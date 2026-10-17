import './results.css';
import { formatLapTime } from './formatTime';

export interface ResultsRow {
  position: number;
  name: string;
  totalTime: number | null;
  bestLap: number | null;
  penalty: number;
}

export class Results {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly tbody: HTMLElement;
  private readonly actions: HTMLElement;

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
    this.tbody = this.doc.createElement('tbody');
    table.appendChild(this.tbody);
    this.actions = this.doc.createElement('div');
    this.actions.className = 'results-actions';
    panel.append(title, table, this.actions);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
    this.hide();
  }

  show(rows: readonly ResultsRow[], handlers: { onRestart(): void; onMenu(): void }): void {
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    this.tbody.replaceChildren();
    for (const row of sorted) {
      const tr = this.doc.createElement('tr');
      this.cell(tr, String(row.position));
      this.cell(tr, row.name);
      this.cell(tr, row.totalTime === null ? 'DNF' : formatLapTime(row.totalTime));
      this.cell(tr, row.bestLap === null ? '-' : formatLapTime(row.bestLap));
      this.cell(tr, String(row.penalty));
      this.tbody.appendChild(tr);
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

  private cell(tr: HTMLElement, text: string): void {
    const td = this.doc.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
}
