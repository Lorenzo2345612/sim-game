import './menu.css';
import type { TrackIndexEntry } from '../../tools/track-builder/buildTrackIndex';
import type { CreditEntry } from '../../tools/assets/buildCredits';
import type { Difficulty } from '../ai/traffic';

export interface TrackChoice {
  id: string;
  name: string;
}

export const TRACK_CHOICES: TrackChoice[] = [
  { id: 'monza', name: 'Monza' },
  { id: 'spa', name: 'Spa' },
  { id: 'silverstone', name: 'Silverstone' },
  { id: 'mexico', name: 'Mexico City' },
  { id: 'daytona', name: 'Daytona' },
  { id: 'lusail', name: 'Lusail' },
  { id: 'bahrain', name: 'Sakhir' },
  { id: 'braselton', name: 'Braselton' },
  { id: 'elkhart', name: 'Elkhart Lake' },
  { id: 'sepang', name: 'Sepang' },
  { id: 'baku', name: 'Baku' },
  { id: 'budapest', name: 'Budapest' },
  { id: 'singapore', name: 'Singapore' },
  { id: 'lasvegas', name: 'Las Vegas' },
  { id: 'spielberg', name: 'Spielberg' },
  { id: 'fontana', name: 'Fontana Interior' },
  { id: 'fontana-roval', name: 'Fontana Sports Car Course' },
  { id: 'cleveland', name: 'Cleveland' },
  { id: 'detroit', name: 'Detroit' },
  { id: 'ermita-centro', name: 'Ermita Centro' },
  { id: 'ermita-federal', name: 'Ermita Federal' },
  { id: 'ermita-norte', name: 'Ermita Norte' },
  { id: 'ermita-mixto', name: 'Ermita Mixto' },
  { id: 'ermita-poniente', name: 'Ermita Poniente' },
  { id: 'ermita-veloz', name: 'Ermita Veloz' },
];

export const LAST_TRACK_KEY = 'lastTrack';

export const CAR_STORAGE_KEY = 'simgame.car';

// Valid ids for the saved/?car= choice (main.ts validation); the picker lists /cars/index.json.
export const CAR_IDS: readonly string[] = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'lmp2-a', 'hyper-a', 'ow26'];

export interface QuickRaceOptions {
  trackId: string;
  laps: number;
  aiCount: number;
  difficulty: Difficulty;
  aiDriver: 'classic' | 'neural';
}

const QUICK_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const DEFAULT_DIFFICULTY: Difficulty = 'medium';

// Empty or non-finite input falls back; a finite value outside the range is clamped.
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export interface CarIndexEntry {
  id: string;
  name: string;
  category: string;
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function outlinePath(outline: Array<[number, number]>): string {
  if (outline.length === 0) return '';
  let d = `M${outline[0][0]} ${outline[0][1]}`;
  for (let i = 1; i < outline.length; i += 1) {
    d += ` L${outline[i][0]} ${outline[i][1]}`;
  }
  return `${d} Z`;
}

function isOutline(value: unknown): value is Array<[number, number]> {
  return (
    Array.isArray(value) &&
    value.every(
      (point) => Array.isArray(point) && point.length === 2 && typeof point[0] === 'number' && typeof point[1] === 'number',
    )
  );
}

function parseIndex(data: unknown): TrackIndexEntry[] | null {
  if (!Array.isArray(data)) return null;
  const entries: TrackIndexEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      entry.id === '' ||
      typeof entry.name !== 'string' ||
      entry.name === '' ||
      typeof entry.country !== 'string' ||
      entry.country === '' ||
      typeof entry.lengthKm !== 'number' ||
      !isOutline(entry.outline)
    ) {
      return null;
    }
    entries.push({
      id: entry.id,
      name: entry.name,
      country: entry.country,
      lengthKm: entry.lengthKm,
      outline: entry.outline,
    });
  }
  return entries;
}

function parseCarIndex(data: unknown): CarIndexEntry[] | null {
  if (!Array.isArray(data)) return null;
  const entries: CarIndexEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      entry.id === '' ||
      typeof entry.name !== 'string' ||
      entry.name === '' ||
      typeof entry.category !== 'string' ||
      entry.category === ''
    ) {
      return null;
    }
    entries.push({ id: entry.id, name: entry.name, category: entry.category });
  }
  return entries;
}

export class Menu {
  private readonly doc: Document;
  private shown = false;
  private creditsEsc: ((event: KeyboardEvent) => void) | null = null;
  private trackRender = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly storage: { getItem(k: string): string | null; setItem(k: string, v: string): void },
    private readonly onLivery?: () => void,
  ) {
    this.doc = root.ownerDocument ?? document;
    if (!root.id) root.id = 'menu';
    this.hide();
  }

  get visible(): boolean {
    return this.shown;
  }

  showTrackSelect(onSelect: (id: string) => void, onQuickRace?: (o: QuickRaceOptions) => void): void {
    const token = ++this.trackRender;
    void Promise.all([this.loadTrackIndex(), this.loadCarIndex(), this.loadAiModelIndex()]).then(
      ([entries, cars, aiModels]) => {
        if (token !== this.trackRender) return;
        this.renderTrackSelect(entries, cars, aiModels, onSelect, onQuickRace);
      },
    );
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
    panel.appendChild(this.action('Resume', handlers.onResume, true));
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
    this.trackRender += 1;
    this.shown = false;
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  private async loadTrackIndex(): Promise<TrackIndexEntry[] | null> {
    try {
      const res = await fetch('/tracks/index.json');
      if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
      return parseIndex(await res.json());
    } catch {
      return null;
    }
  }

  private async loadCarIndex(): Promise<CarIndexEntry[] | null> {
    try {
      const res = await fetch('/cars/index.json');
      if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
      return parseCarIndex(await res.json());
    } catch {
      return null;
    }
  }

  // "<track>-<car>": difficulties with an exported neural model (task 269).
  private async loadAiModelIndex(): Promise<Record<string, string[]> | null> {
    try {
      const res = await fetch('/ai-models/index.json');
      if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const out: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (Array.isArray(value) && value.every((d) => typeof d === 'string')) out[key] = value as string[];
      }
      return out;
    } catch {
      return null;
    }
  }

  private renderTrackSelect(
    entries: TrackIndexEntry[] | null,
    cars: CarIndexEntry[] | null,
    aiModels: Record<string, string[]> | null,
    onSelect: (id: string) => void,
    onQuickRace?: (o: QuickRaceOptions) => void,
  ): void {
    const last = this.storage.getItem(LAST_TRACK_KEY);
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel track-select';
    panel.appendChild(this.heading('Select track'));
    const grid = this.doc.createElement('div');
    grid.className = 'track-grid';
    let focus: HTMLElement | null = null;
    for (const choice of TRACK_CHOICES) {
      const entry = entries?.find((candidate) => candidate.id === choice.id) ?? null;
      const button = this.trackCard(choice, entry);
      if (choice.id === last) {
        button.classList.add('selected');
        focus = button;
      }
      button.addEventListener('click', () => {
        this.storage.setItem(LAST_TRACK_KEY, choice.id);
        onSelect(choice.id);
      });
      grid.appendChild(button);
    }
    const picker = this.carPicker(cars);
    if (picker) panel.appendChild(picker);
    const body = this.doc.createElement('div');
    body.className = 'track-body';
    body.appendChild(grid);
    body.appendChild(this.trackDetails(grid, entries));
    panel.appendChild(body);
    if (this.onLivery) panel.appendChild(this.action('Livery', this.onLivery));
    if (onQuickRace) {
      const qr = this.action('Quick race', () => this.showQuickRace(onSelect, onQuickRace, cars, aiModels));
      qr.id = 'quick-race';
      panel.appendChild(qr);
    }
    panel.appendChild(this.creditsAction(() => this.showTrackSelect(onSelect, onQuickRace)));
    this.wireCardKeys(grid);
    this.show(panel);
    focus?.focus();
  }

  private showQuickRace(
    onSelect: (id: string) => void,
    onQuickRace: (o: QuickRaceOptions) => void,
    cars: CarIndexEntry[] | null,
    aiModels: Record<string, string[]> | null,
  ): void {
    const panel = this.doc.createElement('div');
    panel.className = 'menu-panel';
    panel.id = 'qr-panel';
    panel.appendChild(this.heading('Quick race'));
    const last = this.storage.getItem(LAST_TRACK_KEY);
    const track = this.doc.createElement('select');
    track.id = 'qr-track';
    for (const choice of TRACK_CHOICES) {
      const option = this.doc.createElement('option');
      option.value = choice.id;
      option.textContent = choice.name;
      if (choice.id === last) option.selected = true;
      track.appendChild(option);
    }
    panel.appendChild(this.fieldRow('Track', track));
    const picker = this.carPicker(cars);
    if (picker) panel.appendChild(picker);
    const laps = this.numberInput('qr-laps', 1, 50, 5);
    panel.appendChild(this.fieldRow('Laps', laps));
    const ai = this.numberInput('qr-ai', 0, 15, 11);
    panel.appendChild(this.fieldRow('Opponents', ai));
    const diff = this.doc.createElement('select');
    diff.id = 'qr-diff';
    for (const level of QUICK_DIFFICULTIES) {
      const option = this.doc.createElement('option');
      option.value = level;
      option.textContent = level;
      if (level === DEFAULT_DIFFICULTY) option.selected = true;
      diff.appendChild(option);
    }
    panel.appendChild(this.fieldRow('Difficulty', diff));
    // Neural AI toggle: only for track+car pairs with an exported model (task 269).
    const aiDriver = this.doc.createElement('select');
    aiDriver.id = 'qr-ai-driver';
    for (const mode of ['classic', 'neural'] as const) {
      const option = this.doc.createElement('option');
      option.value = mode;
      option.textContent = mode;
      aiDriver.appendChild(option);
    }
    const aiRow = this.fieldRow('AI: classic / neural (experimental)', aiDriver);
    const carSelect = picker?.querySelector<HTMLSelectElement>('#car-picker') ?? null;
    const updateAiDriver = (): void => {
      const car = carSelect?.value ?? this.storage.getItem(CAR_STORAGE_KEY) ?? 'f4';
      aiRow.style.display = aiModels?.[`${track.value}-${car}`] ? '' : 'none';
    };
    track.addEventListener('change', updateAiDriver);
    carSelect?.addEventListener('change', updateAiDriver);
    updateAiDriver();
    panel.appendChild(aiRow);
    const start = this.action(
      'Start',
      () => {
        this.storage.setItem(LAST_TRACK_KEY, track.value);
        onQuickRace({
          trackId: track.value,
          laps: clampInt(laps.value, 1, 50, 5),
          aiCount: clampInt(ai.value, 0, 15, 11),
          difficulty: QUICK_DIFFICULTIES.includes(diff.value as Difficulty) ? (diff.value as Difficulty) : DEFAULT_DIFFICULTY,
          aiDriver: aiRow.style.display !== 'none' && aiDriver.value === 'neural' ? 'neural' : 'classic',
        });
      },
      true,
    );
    start.id = 'qr-start';
    panel.appendChild(start);
    panel.appendChild(this.action('Back', () => this.showTrackSelect(onSelect, onQuickRace)));
    this.show(panel);
    track.focus();
  }

  private numberInput(id: string, min: number, max: number, value: number): HTMLInputElement {
    const input = this.doc.createElement('input');
    input.id = id;
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    return input;
  }

  private fieldRow(label: string, control: HTMLElement): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'car-row qr-row';
    const el = this.doc.createElement('label');
    el.textContent = label;
    el.htmlFor = control.id;
    row.append(el, control);
    return row;
  }

  private trackCard(choice: TrackChoice, entry: TrackIndexEntry | null): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.className = 'track-card';
    button.dataset.track = choice.id;
    if (entry) {
      const svg = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'track-outline');
      svg.setAttribute('viewBox', '-0.04 -0.04 1.08 1.08');
      svg.setAttribute('aria-hidden', 'true');
      const path = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', outlinePath(entry.outline));
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(path);
      button.appendChild(svg);
    }
    const name = this.doc.createElement('span');
    name.className = 'track-name';
    name.textContent = entry?.name ?? choice.name;
    button.appendChild(name);
    if (entry) {
      const meta = this.doc.createElement('span');
      meta.className = 'track-meta';
      meta.textContent = `${entry.country} · ${entry.lengthKm.toFixed(3)} km`;
      button.appendChild(meta);
    }
    return button;
  }

  // Side panel built once; focus/hover on a card only rewrites its text and outline path.
  private trackDetails(grid: HTMLElement, entries: TrackIndexEntry[] | null): HTMLElement {
    const box = this.doc.createElement('div');
    box.className = 'track-details';
    const svg = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'detail-outline');
    svg.setAttribute('viewBox', '-0.04 -0.04 1.08 1.08');
    svg.setAttribute('aria-hidden', 'true');
    const path = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);
    const name = this.doc.createElement('div');
    name.className = 'detail-name';
    const country = this.doc.createElement('div');
    country.className = 'detail-country';
    const length = this.doc.createElement('div');
    length.className = 'detail-length';
    box.append(svg, name, country, length);
    const show = (card: HTMLElement | null): void => {
      const id = card?.dataset.track;
      if (!id) return;
      const entry = entries?.find((candidate) => candidate.id === id) ?? null;
      name.textContent = entry?.name ?? TRACK_CHOICES.find((c) => c.id === id)?.name ?? id;
      country.textContent = entry?.country ?? '';
      length.textContent = entry ? `${entry.lengthKm.toFixed(3)} km` : '';
      path.setAttribute('d', entry ? outlinePath(entry.outline) : '');
    };
    const cardOf = (event: Event): HTMLElement | null =>
      event.target instanceof Element ? event.target.closest<HTMLElement>('.track-card') : null;
    grid.addEventListener('focusin', (event) => show(cardOf(event)));
    grid.addEventListener('mouseover', (event) => show(cardOf(event)));
    show(grid.querySelector<HTMLElement>('.track-card.selected') ?? grid.querySelector<HTMLElement>('.track-card'));
    return box;
  }

  private carPicker(cars: CarIndexEntry[] | null): HTMLElement | null {
    if (!cars || cars.length === 0) return null;
    const row = this.doc.createElement('div');
    row.className = 'car-row';
    const label = this.doc.createElement('label');
    label.textContent = 'Car';
    label.htmlFor = 'car-picker';
    const select = this.doc.createElement('select');
    select.id = 'car-picker';
    const saved = this.storage.getItem(CAR_STORAGE_KEY);
    for (const car of cars) {
      const option = this.doc.createElement('option');
      option.value = car.id;
      option.textContent = car.name;
      if (car.id === saved) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.storage.setItem(CAR_STORAGE_KEY, select.value);
    });
    row.append(label, select);
    return row;
  }

  // Arrow keys move focus to the nearest card strictly in that direction.
  private wireCardKeys(grid: HTMLElement): void {
    grid.addEventListener('keydown', (event) => {
      const delta = ARROW_DELTAS[event.key];
      if (!delta) return;
      const active = this.doc.activeElement;
      const current = active instanceof HTMLElement ? active.closest<HTMLElement>('.track-card') : null;
      if (!current || !grid.contains(current)) return;
      event.preventDefault();
      const cards = Array.from(grid.querySelectorAll<HTMLElement>('.track-card'));
      const [dirX, dirY] = delta;
      const cx = current.offsetLeft + current.offsetWidth / 2;
      const cy = current.offsetTop + current.offsetHeight / 2;
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;
      for (const card of cards) {
        if (card === current) continue;
        const dx = card.offsetLeft + card.offsetWidth / 2 - cx;
        const dy = card.offsetTop + card.offsetHeight / 2 - cy;
        const offAxis = dirX !== 0 ? Math.sign(dx) - dirX : Math.sign(dy) - dirY;
        if (offAxis !== 0) continue;
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
          best = card;
          bestDistance = distance;
        }
      }
      best?.focus();
    });
  }

  private show(panel: HTMLElement): void {
    this.trackRender += 1;
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

  private action(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.className = primary ? 'btn-primary' : 'btn-secondary';
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
        link.style.color = 'var(--ui-accent)';
        row.append(`${entry.asset} — ${entry.author} — ${entry.license} — `, link);
        list.appendChild(row);
      }
    } catch (err) {
      list.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}
