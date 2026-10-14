import type { CreditEntry } from '../../tools/assets/buildCredits';

export interface TrackChoice {
  id: string;
  name: string;
}

export const TRACK_CHOICES: TrackChoice[] = [
  { id: 'monza', name: 'Monza' },
  { id: 'spa', name: 'Spa' },
  { id: 'silverstone', name: 'Silverstone' },
];

export const LAST_TRACK_KEY = 'lastTrack';

export class Menu {
  private readonly doc: Document;
  private shown = false;
  private creditsEsc: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly storage: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  ) {
    this.doc = root.ownerDocument ?? document;
    if (!root.id) root.id = 'menu';
    this.hide();
  }

  get visible(): boolean {
    return this.shown;
  }

  showTrackSelect(onSelect: (id: string) => void): void {
    const last = this.storage.getItem(LAST_TRACK_KEY);
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel';
    panel.appendChild(this.heading('Select track'));
    let focus: HTMLElement | null = null;
    for (const choice of TRACK_CHOICES) {
      const button = this.doc.createElement('button');
      button.dataset.track = choice.id;
      button.textContent = choice.name;
      if (choice.id === last) {
        button.classList.add('selected');
        focus = button;
      }
      button.addEventListener('click', () => {
        this.storage.setItem(LAST_TRACK_KEY, choice.id);
        onSelect(choice.id);
      });
      panel.appendChild(button);
    }
    panel.appendChild(this.creditsAction(() => this.showTrackSelect(onSelect)));
    this.show(panel);
    focus?.focus();
  }

  showPause(handlers: {
    onResume(): void;
    onRestart(): void;
    onChangeTrack(): void;
    onSetup?(): void;
  }): void {
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel';
    panel.appendChild(this.heading('Paused'));
    panel.appendChild(this.action('Resume', handlers.onResume));
    panel.appendChild(this.action('Restart', handlers.onRestart));
    if (handlers.onSetup) panel.appendChild(this.action('Setup', handlers.onSetup));
    panel.appendChild(this.action('Change track', handlers.onChangeTrack));
    panel.appendChild(this.creditsAction(() => this.showPause(handlers)));
    this.show(panel);
  }

  showCredits(onClose: () => void): void {
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel';
    panel.id = 'credits-panel';
    panel.style.maxWidth = '720px';
    panel.appendChild(this.heading('Credits'));
    const list = this.doc.createElement('div');
    list.style.maxHeight = '60vh';
    list.style.overflowY = 'auto';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.textContent = 'Loading…';
    panel.appendChild(list);
    this.show(panel);
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.closeCredits(onClose);
    };
    this.creditsEsc = onKey;
    this.doc.addEventListener('keydown', onKey);
    void this.fillCredits(list);
  }

  hide(): void {
    this.shown = false;
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  private show(panel: HTMLElement): void {
    this.root.replaceChildren(panel);
    this.root.style.display = 'flex';
    this.shown = true;
  }

  private heading(text: string): HTMLElement {
    const el = this.doc.createElement('div');
    el.className = 'menu-title';
    el.textContent = text;
    return el;
  }

  private action(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private creditsAction(onClose: () => void): HTMLButtonElement {
    const button = this.action('Credits', () => this.showCredits(onClose));
    button.id = 'credits-btn';
    return button;
  }

  private closeCredits(onClose: () => void): void {
    if (this.creditsEsc) {
      this.doc.removeEventListener('keydown', this.creditsEsc);
      this.creditsEsc = null;
    }
    this.hide();
    onClose();
  }

  private async fillCredits(list: HTMLElement): Promise<void> {
    try {
      const res = await fetch('/credits.json');
      if (!res.ok) throw new Error(`credits.json HTTP ${res.status}`);
      const entries = (await res.json()) as CreditEntry[];
      list.replaceChildren();
      for (const entry of entries) {
        const row = this.doc.createElement('div');
        const link = this.doc.createElement('a');
        link.href = entry.url;
        link.textContent = entry.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.color = '#7ab8ff';
        row.append(`${entry.asset} — ${entry.author} — ${entry.license} — `, link);
        list.appendChild(row);
      }
    } catch (err) {
      list.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}
