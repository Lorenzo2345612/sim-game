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
    this.show(panel);
    focus?.focus();
  }

  showPause(handlers: { onResume(): void; onRestart(): void; onChangeTrack(): void }): void {
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel';
    panel.appendChild(this.heading('Paused'));
    panel.appendChild(this.action('Resume', handlers.onResume));
    panel.appendChild(this.action('Restart', handlers.onRestart));
    panel.appendChild(this.action('Change track', handlers.onChangeTrack));
    this.show(panel);
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
}
