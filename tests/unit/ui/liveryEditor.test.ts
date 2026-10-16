import { describe, expect, it } from 'vitest';
import { defaultLivery, parseLivery } from '../../../src/game/livery';
import type { Livery } from '../../../src/game/livery';
import type { KeyValueStorage } from '../../../src/core/settings';
import { LiveryEditor, type LiveryPreview } from '../../../src/ui/liveryEditor';

const hasDom = typeof document !== 'undefined';

class StubPreview implements LiveryPreview {
  cars: string[] = [];
  liveries: Livery[] = [];
  disposed = false;
  setCar(carId: string): void {
    this.cars.push(carId);
  }
  setLivery(livery: Livery): void {
    this.liveries.push(livery);
  }
  dispose(): void {
    this.disposed = true;
  }
}

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...entries };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function makeEditor(storage: KeyValueStorage, carIds: string[] = ['f4', 'gt3-a']): {
  editor: LiveryEditor;
  preview: StubPreview;
  container: HTMLElement;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const preview = new StubPreview();
  const editor = new LiveryEditor(container, storage, carIds, () => preview);
  editor.open();
  return { editor, preview, container };
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

describe.skipIf(!hasDom)('122 livery editor DOM', () => {
  it('opening loads the saved livery or the default, and save writes the storage key', () => {
    const storage = memoryStorage({ 'livery:gt3-a': JSON.stringify({ ...defaultLivery(0), primary: '#123456' }) });
    const { editor } = makeEditor(storage);
    expect(query<HTMLInputElement>('#livery-primary').value).toBe(defaultLivery(0).primary);
    query<HTMLSelectElement>('#livery-car').value = 'gt3-a';
    query<HTMLSelectElement>('#livery-car').dispatchEvent(new Event('change'));
    expect(query<HTMLInputElement>('#livery-primary').value).toBe('#123456');
    query<HTMLInputElement>('#livery-primary').value = '#ff0000';
    query<HTMLInputElement>('#livery-primary').dispatchEvent(new Event('input'));
    query<HTMLButtonElement>('[data-pattern="stripe"]').click();
    query<HTMLInputElement>('#livery-number').value = '44';
    query<HTMLInputElement>('#livery-number').dispatchEvent(new Event('input'));
    query<HTMLButtonElement>('#livery-save').click();
    const saved = parseLivery(JSON.parse(storage.data['livery:gt3-a']!));
    expect(saved.primary).toBe('#ff0000');
    expect(saved.pattern).toBe('stripe');
    expect(saved.number).toBe(44);
    editor.dispose();
  });

  it('save errors surface in #livery-error', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };
    const { editor } = makeEditor(storage);
    query<HTMLButtonElement>('#livery-save').click();
    expect(query<HTMLElement>('#livery-error').textContent).toContain('quota exceeded');
    editor.dispose();
  });

  it('number input values clamp to 0..99', () => {
    const storage = memoryStorage();
    const { editor } = makeEditor(storage);
    const number = query<HTMLInputElement>('#livery-number');
    number.value = '250';
    number.dispatchEvent(new Event('input'));
    query<HTMLButtonElement>('#livery-save').click();
    expect(parseLivery(JSON.parse(storage.data['livery:f4']!)).number).toBe(99);
    number.value = '-5';
    number.dispatchEvent(new Event('input'));
    query<HTMLButtonElement>('#livery-save').click();
    expect(parseLivery(JSON.parse(storage.data['livery:f4']!)).number).toBe(0);
    editor.dispose();
  });

  it('pattern buttons toggle aria-pressed and reach the preview', () => {
    const { editor, preview } = makeEditor(memoryStorage());
    const stripe = query<HTMLButtonElement>('[data-pattern="stripe"]');
    stripe.click();
    expect(stripe.getAttribute('aria-pressed')).toBe('true');
    expect(query<HTMLButtonElement>('[data-pattern="solid"]').getAttribute('aria-pressed')).toBe('false');
    expect(preview.liveries.at(-1)?.pattern).toBe('stripe');
    editor.dispose();
  });

  it('dispose tears down the preview and the DOM', () => {
    const { editor, preview, container } = makeEditor(memoryStorage());
    expect(preview.disposed).toBe(false);
    editor.dispose();
    expect(preview.disposed).toBe(true);
    expect(document.getElementById('livery-editor')).toBeNull();
    expect(container.contains(document.getElementById('livery-editor'))).toBe(false);
  });
});
