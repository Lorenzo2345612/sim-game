import type { CompoundOption } from '../core/settings';
import type { CarSpec, SetupKey } from '../physics/carSpec';
import type { Setup } from '../physics/setup';
import { formatSetupValue, SETUP_LABELS } from './setupPanel';

export const SETUP_HUD_VISIBLE_KEY = 'setupHudVisible';

const KEYS: SetupKey[] = [
  'frontWing',
  'rearWing',
  'brakeBias',
  'finalDrive',
  'arbFront',
  'arbRear',
  'rideHeight',
  'tyrePressureKpa',
];

const COMPOUND_NAMES: Record<CompoundOption, string> = { soft: 'Soft', medium: 'Medium', hard: 'Hard' };

interface ShownData {
  setup: Setup;
  compound: CompoundOption;
  spec: CarSpec;
}

function viewStorage(doc: Document): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

export class SetupHud {
  private readonly root: HTMLElement;
  private readonly rows = new Map<SetupKey, HTMLElement>();
  private readonly compoundValue: HTMLElement;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private data: ShownData | null = null;
  private shown = false;

  constructor(container: HTMLElement, doc?: Document) {
    const d = doc ?? container.ownerDocument ?? document;
    this.storage = viewStorage(d);

    this.root = d.createElement('div');
    this.root.id = 'setup-hud';
    this.root.className = 'setup-hud';
    this.root.style.display = 'none';

    const title = d.createElement('div');
    title.className = 'setup-hud-title';
    title.textContent = 'Setup';
    this.root.appendChild(title);

    for (const key of KEYS) {
      const row = d.createElement('div');
      row.className = 'setup-hud-row';
      row.dataset.setup = key;
      const label = d.createElement('span');
      label.className = 'setup-hud-label';
      label.textContent = SETUP_LABELS[key];
      const value = d.createElement('span');
      value.className = 'setup-hud-value';
      row.append(label, value);
      this.root.appendChild(row);
      this.rows.set(key, value);
    }

    const compoundRow = d.createElement('div');
    compoundRow.className = 'setup-hud-row';
    compoundRow.dataset.setup = 'compound';
    const compoundLabel = d.createElement('span');
    compoundLabel.className = 'setup-hud-label';
    compoundLabel.textContent = 'Compound';
    this.compoundValue = d.createElement('span');
    this.compoundValue.className = 'setup-hud-value';
    compoundRow.append(compoundLabel, this.compoundValue);
    this.root.appendChild(compoundRow);

    container.appendChild(this.root);
    this.shown = this.readStored();
    this.root.style.display = this.shown ? 'flex' : 'none';
  }

  get visible(): boolean {
    return this.shown;
  }

  show(setup: Setup, compound: CompoundOption, spec: CarSpec): void {
    this.data = { setup, compound, spec };
    this.render();
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  toggle(): void {
    if (this.shown) {
      this.hide();
      return;
    }
    this.render();
    this.setVisible(true);
  }

  dispose(): void {
    this.root.remove();
    this.rows.clear();
    this.data = null;
  }

  private setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.style.display = visible ? 'flex' : 'none';
    try {
      this.storage?.setItem(SETUP_HUD_VISIBLE_KEY, visible ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  /** Rows are built once; only show()/toggle() ever rewrite them, never per frame. */
  private render(): void {
    const data = this.data;
    if (!data) return;
    for (const key of Object.keys(data.spec.setup) as SetupKey[]) {
      const value = this.rows.get(key);
      if (value) value.textContent = formatSetupValue(key, data.setup[key]);
    }
    this.compoundValue.textContent = COMPOUND_NAMES[data.compound];
  }

  private readStored(): boolean {
    try {
      return this.storage?.getItem(SETUP_HUD_VISIBLE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
