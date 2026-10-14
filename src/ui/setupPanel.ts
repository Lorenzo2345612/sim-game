import type { CarSpec } from '../physics/carSpec';
import type { Setup, SetupStorage } from '../physics/setup';
import { clampSetup, loadSetup, presetSetup, saveSetup } from '../physics/setup';

export interface SetupPanelOptions {
  spec: CarSpec;
  carId: string;
  trackId: string;
  storage: SetupStorage;
  onApply(s: Setup): void;
  onClose(): void;
}

type SetupKey = keyof Setup;

const GROUPS: { title: string; keys: SetupKey[] }[] = [
  { title: 'Wings', keys: ['frontWing', 'rearWing'] },
  { title: 'Brake bias', keys: ['brakeBias'] },
  { title: 'Final drive', keys: ['finalDrive'] },
  { title: 'Anti-roll', keys: ['arbFront', 'arbRear'] },
  { title: 'Ride height', keys: ['rideHeight'] },
  { title: 'Tyre pressure', keys: ['tyrePressureKpa'] },
];

const LABELS: Record<SetupKey, string> = {
  frontWing: 'Front wing',
  rearWing: 'Rear wing',
  brakeBias: 'Brake bias',
  finalDrive: 'Final drive',
  arbFront: 'Front anti-roll bar',
  arbRear: 'Rear anti-roll bar',
  rideHeight: 'Ride height',
  tyrePressureKpa: 'Tyre pressure (kPa)',
};

const PRESETS = ['stable', 'balanced', 'aggressive'] as const;

const STYLE = `
#setup-panel {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 14, 0.82);
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
}
#setup-panel .setup-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(440px, 92vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 24px;
  background: #12161d;
  border: 1px solid #2c3542;
  border-radius: 10px;
}
#setup-panel .setup-title {
  margin-bottom: 4px;
  font-size: 20px;
  font-weight: 600;
  text-align: center;
}
#setup-panel .setup-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid #232b36;
}
#setup-panel .setup-group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #9fb0c6;
}
#setup-panel .setup-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#setup-panel .setup-row-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
#setup-panel .setup-value {
  color: #f2c200;
  font-variant-numeric: tabular-nums;
}
#setup-panel input[type='range'] {
  width: 100%;
  accent-color: #f2c200;
}
#setup-panel .setup-actions {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  margin-top: 8px;
}
#setup-panel .setup-actions button {
  grid-column: span 2;
  padding: 10px 8px;
  font-size: 15px;
  color: #fff;
  background: #1c2430;
  border: 1px solid #3a4657;
  border-radius: 6px;
  cursor: pointer;
}
#setup-panel .setup-actions button:hover,
#setup-panel .setup-actions button:focus-visible {
  background: #2a3546;
}
#setup-panel .setup-apply,
#setup-panel .setup-back {
  grid-column: span 3;
}
`;

interface SliderRow {
  input: HTMLInputElement;
  value: HTMLElement;
}

export class SetupPanel {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly rows = new Map<SetupKey, SliderRow>();
  private shown = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: SetupPanelOptions,
  ) {
    this.doc = parent.ownerDocument ?? document;
    const doc = this.doc;

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

    for (const group of GROUPS) {
      const section = doc.createElement('section');
      section.className = 'setup-group';
      const heading = doc.createElement('div');
      heading.className = 'setup-group-title';
      heading.textContent = group.title;
      section.appendChild(heading);
      for (const key of group.keys) {
        const range = opts.spec.setup[key];
        const row = doc.createElement('label');
        row.className = 'setup-row';
        const head = doc.createElement('div');
        head.className = 'setup-row-head';
        const name = doc.createElement('span');
        name.textContent = LABELS[key];
        const value = doc.createElement('span');
        value.className = 'setup-value';
        head.append(name, value);
        const input = doc.createElement('input');
        input.type = 'range';
        input.dataset.setup = key;
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        input.value = String(initial[key]);
        value.textContent = input.value;
        input.addEventListener('input', () => {
          value.textContent = input.value;
        });
        row.append(head, input);
        section.appendChild(row);
        this.rows.set(key, { input, value });
      }
      box.appendChild(section);
    }

    const actions = doc.createElement('div');
    actions.className = 'setup-actions';
    for (const preset of PRESETS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
      button.addEventListener('click', () => this.setValues(presetSetup(opts.spec, preset)));
      actions.appendChild(button);
    }
    actions.appendChild(this.button('Apply', 'setup-apply', () => this.apply()));
    actions.appendChild(this.button('Back', 'setup-back', () => this.close()));

    box.appendChild(actions);
    this.root.appendChild(box);
    parent.appendChild(this.root);
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
    this.opts.onApply(setup);
    this.close();
  }

  private setValues(s: Setup): void {
    for (const [key, row] of this.rows) {
      row.input.value = String(s[key]);
      row.value.textContent = row.input.value;
    }
  }
}
