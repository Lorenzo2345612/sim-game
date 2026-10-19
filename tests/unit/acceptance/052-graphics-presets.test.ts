import { describe, it, expect } from 'vitest';
import {
  presetSettings,
  savePreset,
  loadPreset,
  SETTINGS_KEY,
} from '../../../src/core/settings';
import { FpsOverlay } from '../../../src/ui/fpsOverlay';

class MapStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

class FakeEl {
  id = '';
  style: { display: string } = { display: '' };
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  text: string | null = null;

  constructor(public ownerDocument: FakeDoc) {}

  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
    this.text = value;
  }

  appendChild(child: FakeEl): FakeEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
}

class FakeDoc {
  createElement(tag: string): FakeEl {
    void tag;
    return new FakeEl(this);
  }
}

function dispatchF3(keyTarget: EventTarget): void {
  const ev = new Event('keydown');
  Object.defineProperty(ev, 'key', { value: 'F3' });
  Object.defineProperty(ev, 'code', { value: 'F3' });
  keyTarget.dispatchEvent(ev);
}

describe('052 graphics presets acceptance', () => {
  it('AT1: low/medium/high map to the spec pixelRatio, shadows, tree LOD and antialias', () => {
    const low = presetSettings('low', 3);
    expect(low.pixelRatio).toBeCloseTo(1, 6);
    expect(low.shadows).toBe(false);
    expect(low.treeFarDistance).toBe(600);
    expect(low.antialias).toBe(false);

    const medium = presetSettings('medium', 3);
    expect(medium.pixelRatio).toBeCloseTo(1.5, 6);
    expect(medium.shadows).toBe(true);
    expect(medium.treeFarDistance).toBe(1000);
    expect(medium.antialias).toBe(true);

    const high = presetSettings('high', 3);
    expect(high.pixelRatio).toBeCloseTo(1.5, 6);
    expect(high.shadows).toBe(true);
    expect(high.treeFarDistance).toBe(1500);
    expect(high.antialias).toBe(true);

    expect(presetSettings('medium', 1).pixelRatio).toBeCloseTo(1, 6);
    expect(presetSettings('high', 1.25).pixelRatio).toBeCloseTo(1.25, 6);
  });

  it('AT2: savePreset then loadPreset round-trips through the settings key', () => {
    const storage = new MapStorage();
    savePreset(storage, 'medium');
    expect(SETTINGS_KEY).toBe('settings');
    expect(storage.getItem('settings')).toBe(JSON.stringify({ preset: 'medium' }));
    expect(loadPreset(storage)).toBe('medium');
  });

  it('AT4: F3 toggles the overlay, which shows rounded fps and draw calls', () => {
    const doc = new FakeDoc();
    const parent = new FakeEl(doc);
    const keyTarget = new EventTarget();
    const overlay = new FpsOverlay(parent as unknown as HTMLElement, keyTarget);
    expect(overlay.element.style.display).toBe('none');

    dispatchF3(keyTarget);
    overlay.update({ fps: 59.4, drawCalls: 1234 });
    expect(overlay.element.style.display).not.toBe('none');
    expect(overlay.element.textContent).toBe('59 FPS | 1234 draw calls');

    dispatchF3(keyTarget);
    expect(overlay.element.style.display).toBe('none');
  });
});
