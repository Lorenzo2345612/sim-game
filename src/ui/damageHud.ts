import './damageHud.css';
import type { DamageMode } from '../physics/contactEvents';
import { widgetColour, type DamageState, type WidgetColour } from '../physics/damage';

type PartId = 'fw' | 'rw' | 'fl' | 'fr' | 'rl' | 'rr';

const PARTS: readonly PartId[] = ['fw', 'fl', 'fr', 'rl', 'rr', 'rw'];
// Wheel order FL, FR, RL, RR matches DamageState.suspension/detached.
const CORNERS: readonly PartId[] = ['fl', 'fr', 'rl', 'rr'];

export class DamageHud {
  private readonly root: HTMLElement;
  private readonly cells = new Map<PartId, HTMLElement>();
  private readonly colours = new Map<PartId, WidgetColour>();

  constructor(parent: HTMLElement, mode: DamageMode) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = mode === 'off' ? 'damage-hud hidden' : 'damage-hud';
    const grid = doc.createElement('div');
    grid.className = 'damage-grid';
    for (const id of PARTS) {
      const cell = doc.createElement('div');
      cell.id = `damage-${id}`;
      cell.className = 'green';
      cell.textContent = id.toUpperCase();
      this.cells.set(id, cell);
      this.colours.set(id, 'green');
      grid.appendChild(cell);
    }
    this.root.appendChild(grid);
    parent.appendChild(this.root);
  }

  update(state: DamageState): void {
    this.setColour('fw', widgetColour(state.frontWing, false));
    this.setColour('rw', widgetColour(state.rearWing, false));
    for (let i = 0; i < 4; i++) {
      this.setColour(CORNERS[i], widgetColour(state.suspension[i], state.detached[i]));
    }
  }

  private setColour(id: PartId, colour: WidgetColour): void {
    if (this.colours.get(id) === colour) return;
    this.colours.set(id, colour);
    const cell = this.cells.get(id);
    if (cell !== undefined) cell.className = colour;
  }

  dispose(): void {
    this.root.remove();
    this.cells.clear();
    this.colours.clear();
  }
}
