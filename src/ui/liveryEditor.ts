import type { KeyValueStorage } from '../core/settings';
import { LIVERY_PATTERNS, defaultLivery, loadLivery, saveLivery, type Livery, type LiveryPattern } from '../game/livery';

export interface LiveryPreview {
  setCar(carId: string): void;
  setLivery(livery: Livery): void;
  dispose(): void;
}

export type LiveryPreviewFactory = (canvas: HTMLCanvasElement) => LiveryPreview;

export interface LiveryEditorOptions {
  initialCarId?: string;
  onBack?(): void;
}

const PATTERN_LABELS: Record<LiveryPattern, string> = {
  solid: 'Solid',
  stripe: 'Stripe',
  split: 'Split',
  chevron: 'Chevron',
};

const STYLE = `
#livery-editor {
  position: fixed;
  inset: 0;
  z-index: 25;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--ui-bg);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-stretch: condensed;
}
#livery-editor .livery-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(920px, 94vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 24px;
  background: var(--ui-panel-solid);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}
#livery-editor .livery-title {
  margin-bottom: 2px;
  font-size: 26px;
  font-weight: 800;
  font-style: italic;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
#livery-editor .livery-body {
  display: flex;
  gap: 20px;
  align-items: stretch;
}
@media (max-width: 900px) {
  #livery-editor .livery-body {
    flex-direction: column;
  }
}
#livery-editor .livery-controls {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#livery-editor .livery-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
}
#livery-editor .livery-row label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ui-text-dim);
  cursor: pointer;
}
#livery-editor select,
#livery-editor input[type='number'] {
  padding: 8px 10px;
  font: 600 15px var(--ui-font);
  color: var(--ui-text);
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}
#livery-editor select {
  min-width: 150px;
}
#livery-editor input[type='number'] {
  width: 76px;
}
#livery-editor input[type='color'] {
  width: 64px;
  height: 32px;
  padding: 0;
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  cursor: pointer;
}
#livery-editor select:focus-visible,
#livery-editor input:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
#livery-editor .livery-patterns {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
#livery-editor .livery-patterns button {
  flex: 1;
  padding: 8px 4px;
  font: 600 13px var(--ui-font);
  font-stretch: condensed;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ui-text);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  cursor: pointer;
  transition: border-color var(--ui-fast);
}
#livery-editor .livery-patterns button:hover {
  border-color: var(--ui-accent);
}
#livery-editor .livery-patterns button[aria-pressed='true'] {
  border-color: var(--ui-accent);
  background: rgba(242, 183, 5, 0.1);
}
#livery-editor .livery-preview {
  flex: 1 1 auto;
  display: flex;
}
#livery-editor canvas {
  width: 100%;
  aspect-ratio: 3 / 2;
  align-self: flex-start;
  background: #10141b;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}
#livery-editor .livery-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}
#livery-editor .livery-footer button {
  padding: 9px 14px;
  font: 600 14px var(--ui-font);
  font-stretch: condensed;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  cursor: pointer;
  transition:
    transform var(--ui-fast),
    border-color var(--ui-fast),
    background var(--ui-fast);
}
#livery-editor .livery-footer button:hover {
  transform: translateY(-1px);
  border-color: var(--ui-accent);
}
#livery-editor .livery-footer button:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
#livery-editor .livery-footer .btn-primary {
  color: var(--ui-accent-ink);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}
#livery-editor .livery-spacer {
  flex: 1;
}
#livery-error {
  min-height: 1em;
  font-size: 13px;
  color: var(--ui-bad);
}
@media (prefers-reduced-motion: reduce) {
  #livery-editor .livery-patterns button,
  #livery-editor .livery-footer button {
    transition: none;
  }
}
`;

export class LiveryEditor {
  private readonly doc: Document;
  private readonly style: HTMLStyleElement;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly carSelect: HTMLSelectElement;
  private readonly colourInputs: Record<'primary' | 'secondary' | 'accent', HTMLInputElement>;
  private readonly numberInput: HTMLInputElement;
  private readonly patternButtons = new Map<LiveryPattern, HTMLButtonElement>();
  private readonly errorBox: HTMLElement;
  private preview: LiveryPreview | null = null;
  private current: Livery = defaultLivery(0);
  private shown = false;

  constructor(
    container: HTMLElement,
    private readonly storage: KeyValueStorage,
    carIds: readonly string[],
    private readonly createPreview: LiveryPreviewFactory,
    private readonly opts: LiveryEditorOptions = {},
  ) {
    this.doc = container.ownerDocument ?? document;
    const doc = this.doc;

    this.style = doc.createElement('style');
    this.style.textContent = STYLE;
    doc.head.appendChild(this.style);

    this.root = doc.createElement('div');
    this.root.id = 'livery-editor';
    const box = doc.createElement('div');
    box.className = 'livery-box';
    const title = doc.createElement('div');
    title.className = 'livery-title';
    title.textContent = 'Livery';
    box.appendChild(title);

    const body = doc.createElement('div');
    body.className = 'livery-body';
    const controls = doc.createElement('div');
    controls.className = 'livery-controls';

    this.carSelect = doc.createElement('select');
    this.carSelect.id = 'livery-car';
    const initial = opts.initialCarId && carIds.includes(opts.initialCarId) ? opts.initialCarId : carIds[0];
    for (const id of carIds) {
      const option = doc.createElement('option');
      option.value = id;
      option.textContent = id;
      if (id === initial) option.selected = true;
      this.carSelect.appendChild(option);
    }
    controls.appendChild(this.row('Car', this.carSelect));

    this.colourInputs = {
      primary: this.colourInput('livery-primary'),
      secondary: this.colourInput('livery-secondary'),
      accent: this.colourInput('livery-accent'),
    };
    controls.appendChild(this.row('Primary', this.colourInputs.primary));
    controls.appendChild(this.row('Secondary', this.colourInputs.secondary));
    controls.appendChild(this.row('Accent', this.colourInputs.accent));

    this.numberInput = doc.createElement('input');
    this.numberInput.type = 'number';
    this.numberInput.id = 'livery-number';
    this.numberInput.min = '0';
    this.numberInput.max = '99';
    this.numberInput.step = '1';
    controls.appendChild(this.row('Number', this.numberInput));

    const patterns = doc.createElement('div');
    patterns.className = 'livery-patterns';
    for (const pattern of LIVERY_PATTERNS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.pattern = pattern;
      button.textContent = PATTERN_LABELS[pattern];
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        this.current = { ...this.current, pattern };
        this.refresh();
      });
      patterns.appendChild(button);
      this.patternButtons.set(pattern, button);
    }
    controls.appendChild(patterns);

    this.errorBox = doc.createElement('div');
    this.errorBox.id = 'livery-error';
    controls.appendChild(this.errorBox);

    this.canvas = doc.createElement('canvas');
    this.canvas.id = 'livery-preview';
    const previewBox = doc.createElement('div');
    previewBox.className = 'livery-preview';
    previewBox.appendChild(this.canvas);

    body.append(controls, previewBox);
    box.appendChild(body);

    const footer = doc.createElement('div');
    footer.className = 'livery-footer';
    const spacer = doc.createElement('span');
    spacer.className = 'livery-spacer';
    footer.appendChild(spacer);
    footer.appendChild(this.button('Back', 'livery-back', '', () => this.opts.onBack?.()));
    footer.appendChild(this.button('Save', 'livery-save', 'btn-primary', () => this.save()));
    box.appendChild(footer);
    this.root.appendChild(box);

    this.carSelect.addEventListener('change', () => {
      this.preview?.setCar(this.carId());
      this.reload();
    });
    for (const input of [this.colourInputs.primary, this.colourInputs.secondary, this.colourInputs.accent, this.numberInput]) {
      input.addEventListener('input', () => this.refresh());
    }

    this.root.style.display = 'none';
    container.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  open(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.style.display = 'flex';
    this.preview?.dispose();
    this.preview = this.createPreview(this.canvas);
    this.reload();
    this.preview.setCar(this.carId());
  }

  dispose(): void {
    this.shown = false;
    this.preview?.dispose();
    this.preview = null;
    this.root.remove();
    this.style.remove();
  }

  private carId(): string {
    return this.carSelect.value;
  }

  // Saved livery of the selected car (loadLivery falls back to defaultLivery(0)).
  private reload(): void {
    this.current = loadLivery(this.storage, this.carId());
    this.colourInputs.primary.value = this.current.primary;
    this.colourInputs.secondary.value = this.current.secondary;
    this.colourInputs.accent.value = this.current.accent;
    this.numberInput.value = String(this.current.number);
    this.refresh();
  }

  private refresh(): void {
    const number = Math.round(Number(this.numberInput.value));
    this.current = {
      primary: this.colourInputs.primary.value.toLowerCase(),
      secondary: this.colourInputs.secondary.value.toLowerCase(),
      accent: this.colourInputs.accent.value.toLowerCase(),
      pattern: this.current.pattern,
      number: Number.isFinite(number) ? Math.min(99, Math.max(0, number)) : 0,
    };
    for (const [pattern, button] of this.patternButtons) {
      button.setAttribute('aria-pressed', String(pattern === this.current.pattern));
    }
    this.errorBox.textContent = '';
    this.preview?.setLivery(this.current);
  }

  private save(): void {
    try {
      saveLivery(this.storage, this.carId(), this.current);
      this.errorBox.textContent = '';
    } catch (err) {
      this.errorBox.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  private row(label: string, input: HTMLElement): HTMLElement {
    const row = this.doc.createElement('div');
    row.className = 'livery-row';
    const labelEl = this.doc.createElement('label');
    labelEl.textContent = label;
    labelEl.htmlFor = input.id;
    row.append(labelEl, input);
    return row;
  }

  private colourInput(id: string): HTMLInputElement {
    const input = this.doc.createElement('input');
    input.type = 'color';
    input.id = id;
    return input;
  }

  private button(text: string, id: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.id = id;
    button.textContent = text;
    button.className = className;
    button.addEventListener('click', onClick);
    return button;
  }
}
