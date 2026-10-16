import { loadGameOptions, saveGameOptions, type CompoundOption } from '../core/settings';
import type { CarSpec, SetupKey } from '../physics/carSpec';
import type { Setup, SetupStorage } from '../physics/setup';
import { clampSetup, defaultSetup, loadSetup, presetSetup, saveSetup } from '../physics/setup';

export interface SetupPanelOptions {
  spec: CarSpec;
  carId: string;
  trackId: string;
  storage: SetupStorage;
  compound: CompoundOption;
  onApply(s: Setup): void;
  onClose(): void;
}

const PSI_PER_KPA = 6.894757;

export const SETUP_LABELS: Record<SetupKey, string> = {
  frontWing: 'Front wing',
  rearWing: 'Rear wing',
  brakeBias: 'Brake bias',
  finalDrive: 'Final drive',
  arbFront: 'Front anti-roll bar',
  arbRear: 'Rear anti-roll bar',
  rideHeight: 'Ride height',
  tyrePressureKpa: 'Tyre pressure',
};

export function formatSetupValue(key: SetupKey, value: number): string {
  if (!Number.isFinite(value)) return '—';
  switch (key) {
    case 'frontWing':
    case 'rearWing':
      return String(Math.round(value));
    case 'brakeBias':
      return `${(value * 100).toFixed(1)}% F`;
    case 'finalDrive':
      return value.toFixed(2);
    case 'arbFront':
    case 'arbRear':
      return `${Math.round(value / 1000)} kN/m`;
    case 'rideHeight': {
      const mm = Math.round(value * 1000);
      return `${mm > 0 ? '+' : ''}${mm} mm`;
    }
    case 'tyrePressureKpa':
      return `${(value / PSI_PER_KPA).toFixed(1)} psi (${Math.round(value)} kPa)`;
  }
}

/** Dim delta against the car default in the row's own unit; empty once it rounds back to zero. */
function formatSetupDelta(key: SetupKey, value: number, base: number): string {
  if (!Number.isFinite(value)) return '';
  const d = value - base;
  const sign = d > 0 ? '+' : '−';
  const a = Math.abs(d);
  switch (key) {
    case 'frontWing':
    case 'rearWing': {
      const n = Math.round(a);
      return n === 0 ? '' : `${sign}${n}`;
    }
    case 'brakeBias': {
      const n = Math.round(a * 1000) / 10;
      return n === 0 ? '' : `${sign}${n.toFixed(1)}%`;
    }
    case 'finalDrive': {
      const n = Math.round(a * 100) / 100;
      return n === 0 ? '' : `${sign}${n.toFixed(2)}`;
    }
    case 'arbFront':
    case 'arbRear': {
      const n = Math.round(a / 1000);
      return n === 0 ? '' : `${sign}${n} kN/m`;
    }
    case 'rideHeight': {
      const n = Math.round(a * 1000);
      return n === 0 ? '' : `${sign}${n} mm`;
    }
    case 'tyrePressureKpa': {
      const n = Math.round(a);
      return n === 0 ? '' : `${sign}${n} kPa`;
    }
  }
}

const GROUPS: { title: string; keys: SetupKey[] }[] = [
  { title: 'Aero', keys: ['frontWing', 'rearWing'] },
  { title: 'Brakes', keys: ['brakeBias'] },
  { title: 'Gearing', keys: ['finalDrive'] },
  { title: 'Suspension', keys: ['arbFront', 'arbRear', 'rideHeight'] },
  { title: 'Tyres', keys: ['tyrePressureKpa'] },
];

const PRESETS = ['stable', 'balanced', 'aggressive'] as const;

const COMPOUNDS: CompoundOption[] = ['soft', 'medium', 'hard'];
const COMPOUND_NAMES: Record<CompoundOption, string> = { soft: 'Soft', medium: 'Medium', hard: 'Hard' };
const COMPOUND_LETTERS: Record<CompoundOption, string> = { soft: 'S', medium: 'M', hard: 'H' };

const STYLE = `
#setup-panel {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--ui-bg);
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-stretch: condensed;
}
#setup-panel .setup-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(880px, 94vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 24px;
  background: var(--ui-panel-solid);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
}
#setup-panel .setup-title {
  margin-bottom: 2px;
  font-size: 26px;
  font-weight: 800;
  font-style: italic;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
#setup-panel .setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 28px;
}
@media (max-width: 900px) {
  #setup-panel .setup-grid {
    grid-template-columns: 1fr;
  }
}
#setup-panel .setup-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--ui-border);
}
#setup-panel .setup-group:last-child {
  grid-column: 1 / -1;
}
#setup-panel .setup-group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ui-text-dim);
}
#setup-panel .setup-row {
  display: grid;
  grid-template-columns: minmax(96px, auto) auto auto minmax(80px, 1fr) auto;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
#setup-panel .setup-label {
  cursor: pointer;
  white-space: nowrap;
}
#setup-panel .setup-value {
  color: var(--ui-accent);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
#setup-panel .setup-delta {
  min-width: 4.5em;
  text-align: right;
  color: var(--ui-text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
#setup-panel .setup-steps {
  display: flex;
  gap: 4px;
}
#setup-panel .setup-step {
  width: 26px;
  height: 24px;
  padding: 0;
  font: 700 15px var(--ui-font);
  color: var(--ui-text);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  cursor: pointer;
  transition: border-color var(--ui-fast);
}
#setup-panel .setup-step:hover {
  border-color: var(--ui-accent);
}
#setup-panel input[type='range'] {
  width: 100%;
  accent-color: var(--ui-accent);
}
#setup-panel .setup-compounds {
  display: flex;
  gap: 8px;
}
#setup-panel .compound-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 4px;
  font: 600 13px var(--ui-font);
  color: var(--ui-text);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  cursor: pointer;
  transition: border-color var(--ui-fast);
}
#setup-panel .compound-btn:hover {
  border-color: var(--ui-accent);
}
#setup-panel .compound-btn.selected {
  border-color: var(--ui-accent);
  background: rgba(242, 183, 5, 0.1);
}
#setup-panel .compound-letter {
  font-size: 18px;
  font-weight: 800;
  font-style: italic;
}
#setup-panel .compound-btn[data-compound='soft'] .compound-letter {
  color: var(--ui-bad);
}
#setup-panel .compound-btn[data-compound='medium'] .compound-letter {
  color: var(--ui-accent);
}
#setup-panel .compound-btn[data-compound='hard'] .compound-letter {
  color: var(--ui-text);
}
#setup-panel .compound-opt {
  font-size: 11px;
  color: var(--ui-text-dim);
}
#setup-panel .setup-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}
#setup-panel .setup-footer .setup-spacer {
  flex: 1;
}
#setup-panel .setup-footer button {
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
#setup-panel .setup-footer button:hover {
  transform: translateY(-1px);
  border-color: var(--ui-accent);
}
#setup-panel .setup-footer button:focus-visible,
#setup-panel .setup-step:focus-visible,
#setup-panel .compound-btn:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}
#setup-panel .setup-footer .btn-primary {
  color: var(--ui-accent-ink);
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}
@media (prefers-reduced-motion: reduce) {
  #setup-panel .setup-footer button,
  #setup-panel .setup-step,
  #setup-panel .compound-btn {
    transition: none;
  }
}
`;

interface SliderRow {
  input: HTMLInputElement;
  value: HTMLElement;
  delta: HTMLElement;
}

export class SetupPanel {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly rows = new Map<SetupKey, SliderRow>();
  private readonly compoundButtons = new Map<CompoundOption, HTMLButtonElement>();
  private selectedCompound: CompoundOption;
  private appliedCompound: CompoundOption;
  private shown = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: SetupPanelOptions,
  ) {
    this.doc = parent.ownerDocument ?? document;
    const doc = this.doc;
    this.selectedCompound = opts.compound;
    this.appliedCompound = opts.compound;

    this.style = doc.createElement('style');
    this.style.textContent = STYLE;
    doc.head.appendChild(this.style);

    this.root = doc.createElement('div');
    this.root.id = 'setup-panel';
    this.root.style.display = 'none';

    const box = doc.createElement('div');
    box.className = 'setup-box';
    const title = doc.createElement('div');
    title.className = 'setup-title';
    title.textContent = 'Car setup';
    box.appendChild(title);

    const initial = loadSetup(opts.carId, opts.trackId, opts.spec, opts.storage);

    const grid = doc.createElement('div');
    grid.className = 'setup-grid';
    for (const group of GROUPS) {
      const section = doc.createElement('section');
      section.className = 'setup-group';
      const heading = doc.createElement('div');
      heading.className = 'setup-group-title';
      heading.textContent = group.title;
      section.appendChild(heading);
      if (group.title === 'Tyres') section.appendChild(this.compoundRow());
      for (const key of group.keys) {
        section.appendChild(this.sliderRow(key, initial[key]));
      }
      grid.appendChild(section);
    }
    box.appendChild(grid);

    const footer = doc.createElement('div');
    footer.className = 'setup-footer';
    for (const preset of PRESETS) {
      const name = preset.charAt(0).toUpperCase() + preset.slice(1);
      footer.appendChild(
        this.button(name, '', () => this.setValues(presetSetup(opts.spec, preset))),
      );
    }
    footer.appendChild(this.button('Reset', '', () => this.setValues(defaultSetup(opts.spec))));
    const spacer = doc.createElement('span');
    spacer.className = 'setup-spacer';
    footer.appendChild(spacer);
    footer.appendChild(this.button('Apply', 'btn-primary', () => this.apply()));
    footer.appendChild(this.button('Close', '', () => this.close()));

    box.appendChild(footer);
    this.root.appendChild(box);
    parent.appendChild(this.root);
    this.refreshCompound();
  }

  get visible(): boolean {
    return this.shown;
  }

  open(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.style.display = 'flex';
  }

  /** Hides the panel, drops unsaved edits and reports back to the caller. */
  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.style.display = 'none';
    this.setValues(loadSetup(this.opts.carId, this.opts.trackId, this.opts.spec, this.opts.storage));
    this.selectedCompound = this.appliedCompound;
    this.refreshCompound();
    this.opts.onClose();
  }

  getValues(): Setup {
    const out = {} as Setup;
    for (const [key, row] of this.rows) out[key] = Number(row.input.value);
    return out;
  }

  dispose(): void {
    this.shown = false;
    this.root.remove();
    this.style.remove();
  }

  private sliderRow(key: SetupKey, value: number): HTMLElement {
    const doc = this.doc;
    const range = this.opts.spec.setup[key];
    const row = doc.createElement('div');
    row.className = 'setup-row';
    const label = doc.createElement('label');
    label.className = 'setup-label';
    label.htmlFor = `setup-${key}`;
    label.textContent = SETUP_LABELS[key];
    const formatted = doc.createElement('span');
    formatted.className = 'setup-value';
    const steps = doc.createElement('div');
    steps.className = 'setup-steps';
    const input = doc.createElement('input');
    input.type = 'range';
    input.id = `setup-${key}`;
    input.dataset.setup = key;
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(value);
    input.setAttribute('aria-label', SETUP_LABELS[key]);
    const delta = doc.createElement('span');
    delta.className = 'setup-delta';
    const stepBtn = (dir: 1 | -1, text: string): HTMLButtonElement => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'setup-step';
      button.textContent = text;
      button.setAttribute('aria-label', `${dir > 0 ? 'Increase' : 'Decrease'} ${SETUP_LABELS[key]}`);
      button.addEventListener('click', () => this.step(key, dir));
      return button;
    };
    steps.append(stepBtn(-1, '−'), stepBtn(1, '+'));
    row.append(label, formatted, steps, input, delta);
    input.addEventListener('input', () => this.refresh(key));
    this.rows.set(key, { input, value: formatted, delta });
    this.refresh(key);
    return row;
  }

  private compoundRow(): HTMLElement {
    const doc = this.doc;
    const row = doc.createElement('div');
    row.className = 'setup-compounds';
    for (const compound of COMPOUNDS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'compound-btn';
      button.dataset.compound = compound;
      button.setAttribute('aria-label', COMPOUND_NAMES[compound]);
      const letter = doc.createElement('span');
      letter.className = 'compound-letter';
      letter.textContent = COMPOUND_LETTERS[compound];
      const name = doc.createElement('span');
      name.className = 'compound-name';
      name.textContent = COMPOUND_NAMES[compound];
      const opt = doc.createElement('span');
      opt.className = 'compound-opt';
      opt.textContent = `opt ${this.opts.spec.tyres.compounds[compound].optTempC}°C`;
      button.append(letter, name, opt);
      button.addEventListener('click', () => {
        this.selectedCompound = compound;
        this.refreshCompound();
      });
      row.appendChild(button);
      this.compoundButtons.set(compound, button);
    }
    return row;
  }

  private refreshCompound(): void {
    for (const [compound, button] of this.compoundButtons) {
      const selected = compound === this.selectedCompound;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  private step(key: SetupKey, dir: 1 | -1): void {
    const row = this.rows.get(key);
    if (!row) return;
    const range = this.opts.spec.setup[key];
    const next = Number(row.input.value) + dir * range.step;
    row.input.value = String(Math.min(Math.max(next, range.min), range.max));
    this.refresh(key);
  }

  private refresh(key: SetupKey): void {
    const row = this.rows.get(key);
    if (!row) return;
    const value = Number(row.input.value);
    row.value.textContent = formatSetupValue(key, value);
    row.delta.textContent = formatSetupDelta(key, value, this.opts.spec.setup[key].default);
  }

  private button(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.className = className;
    button.addEventListener('click', onClick);
    return button;
  }

  private apply(): void {
    const setup = clampSetup(this.opts.spec, this.getValues());
    saveSetup(this.opts.carId, this.opts.trackId, setup, this.opts.storage);
    this.appliedCompound = this.selectedCompound;
    saveGameOptions(this.opts.storage, {
      ...loadGameOptions(this.opts.storage),
      compound: this.appliedCompound,
    });
    this.opts.onApply(setup);
    this.close();
  }

  private setValues(s: Setup): void {
    for (const [key, row] of this.rows) {
      row.input.value = String(s[key]);
      this.refresh(key);
    }
  }
}
