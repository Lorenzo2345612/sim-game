import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCarSpec, type CarSpec, type SetupKey } from '../../../src/physics/carSpec';
import type { Setup } from '../../../src/physics/setup';
import {
  loadGameOptions,
  savePreset,
  SETTINGS_KEY,
  type CompoundOption,
  type GameOptions,
  type KeyValueStorage,
} from '../../../src/core/settings';

// Non-literal module specifiers keep typecheck green until the 209 exports exist (the 162/166/208 pattern).
const SETUP_PANEL_MODULE: string = '../../../src/ui/setupPanel';
const SETUP_HUD_MODULE: string = '../../../src/ui/setupHud';
const SAVE_GAME_OPTIONS_MODULE: string = '../../../src/core/settings';

type FormatSetupValue = (key: SetupKey, value: number) => string;
type SaveGameOptions = (storage: KeyValueStorage, opts: GameOptions) => void;

interface SetupHudLike {
  show(setup: Setup, compound: CompoundOption, spec: CarSpec): void;
  hide(): void;
  toggle(): void;
  readonly visible: boolean;
}

type SetupHudCtor = new (container: HTMLElement, doc?: Document) => SetupHudLike;

async function loadFormatSetupValue(): Promise<FormatSetupValue> {
  const mod = (await import(SETUP_PANEL_MODULE)) as { formatSetupValue: FormatSetupValue };
  return mod.formatSetupValue;
}

async function loadSaveGameOptions(): Promise<SaveGameOptions> {
  const mod = (await import(SAVE_GAME_OPTIONS_MODULE)) as { saveGameOptions: SaveGameOptions };
  return mod.saveGameOptions;
}

async function loadSetupHudClass(): Promise<SetupHudCtor> {
  const mod = (await import(SETUP_HUD_MODULE)) as { SetupHud: SetupHudCtor };
  return mod.SetupHud;
}

function memoryStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
  };
}

function fakeStorage(initial: Record<string, unknown>): KeyValueStorage {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_KEY, JSON.stringify(initial));
  return storage;
}

function f4Spec(): CarSpec {
  return parseCarSpec(JSON.parse(readFileSync('public/cars/f4.json', 'utf8')) as unknown);
}

function defaultSetupOf(spec: CarSpec): Setup {
  const out = {} as Setup;
  for (const key of Object.keys(spec.setup) as SetupKey[]) out[key] = spec.setup[key].default;
  return out;
}

class FakeStyle {
  [key: string]: unknown;

  setProperty(name: string, value: string): void {
    this[name] = value;
  }

  removeProperty(name: string): void {
    delete this[name];
  }
}

function dataKey(attr: string): string {
  return attr.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

class FakeEl {
  readonly classes = new Set<string>();
  readonly children: FakeEl[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  id = '';
  hidden = false;
  parent: FakeEl | null = null;
  parentNode: FakeEl | null = null;
  private readonly attrs = new Map<string, string>();
  private text: string | null = null;

  constructor(
    readonly ownerDocument: FakeDoc,
    readonly tag: string,
  ) {}

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes.clear();
    for (const token of value.trim().split(/\s+/)) if (token) this.classes.add(token);
  }

  get classList(): {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    contains(name: string): boolean;
    toggle(name: string): boolean;
    readonly length: number;
  } {
    const classes = this.classes;
    return {
      add: (...names: string[]): void => {
        for (const n of names) classes.add(n);
      },
      remove: (...names: string[]): void => {
        for (const n of names) classes.delete(n);
      },
      contains: (name: string): boolean => classes.has(name),
      toggle: (name: string): boolean => {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      },
      get length(): number {
        return classes.size;
      },
    };
  }

  get textContent(): string {
    return (this.text ?? '') + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string | null) {
    this.text = value;
    for (const child of this.children) {
      child.parent = null;
      child.parentNode = null;
    }
    this.children.length = 0;
  }

  get innerText(): string {
    return this.textContent;
  }

  appendChild(child: FakeEl): FakeEl {
    child.remove();
    child.parent = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) this.appendChild(this.wrap(node));
  }

  prepend(...nodes: (FakeEl | string)[]): void {
    const wrapped = nodes.map((node) => this.wrap(node));
    for (const child of wrapped) {
      child.remove();
      child.parent = this;
      child.parentNode = this;
    }
    this.children.unshift(...wrapped);
  }

  replaceChildren(...nodes: (FakeEl | string)[]): void {
    for (const child of this.children) {
      child.parent = null;
      child.parentNode = null;
    }
    this.children.length = 0;
    this.text = null;
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    const v = String(value);
    this.attrs.set(name, v);
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = v;
  }

  getAttribute(name: string): string | null {
    if (this.attrs.has(name)) return this.attrs.get(name) ?? null;
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
    return null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name.startsWith('data-')) delete this.dataset[dataKey(name)];
  }

  toggleAttribute(name: string, force?: boolean): void {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
  }

  addEventListener(): void {
    /* listener bookkeeping is not needed in the fake */
  }

  removeEventListener(): void {
    /* listener bookkeeping is not needed in the fake */
  }

  dispatchEvent(): boolean {
    return true;
  }

  querySelectorAll(selector: string): FakeEl[] {
    return queryAll(this, selector);
  }

  querySelector(selector: string): FakeEl | null {
    return queryAll(this, selector)[0] ?? null;
  }

  private wrap(node: FakeEl | string): FakeEl {
    if (typeof node !== 'string') return node;
    const text = new FakeEl(this.ownerDocument, '#text');
    text.textContent = node;
    return text;
  }
}

class FakeDoc {
  readonly head: FakeEl;
  readonly body: FakeEl;
  readonly defaultView: { localStorage: KeyValueStorage };

  constructor() {
    this.head = new FakeEl(this, 'head');
    this.body = new FakeEl(this, 'body');
    this.defaultView = { localStorage: memoryStorage() };
  }

  createElement(tag: string): FakeEl {
    return new FakeEl(this, tag);
  }

  createTextNode(value: string): FakeEl {
    const node = new FakeEl(this, '#text');
    node.textContent = value;
    return node;
  }

  getElementById(id: string): FakeEl | null {
    return findById(this.body, id);
  }
}

interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: [string, string][];
}

function parseCompound(sel: string): CompoundSelector | null {
  const out: CompoundSelector = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  while (i < sel.length) {
    let m: RegExpExecArray | null;
    if (sel[i] === '#') {
      m = /^#([\w-]+)/.exec(sel.slice(i));
      if (!m) return null;
      out.id = m[1];
    } else if (sel[i] === '.') {
      m = /^\.([\w-]+)/.exec(sel.slice(i));
      if (!m) return null;
      out.classes.push(m[1]);
    } else if (sel[i] === '[') {
      m = /^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/.exec(sel.slice(i));
      if (!m) return null;
      const value = m[2] ?? m[3] ?? m[4];
      if (value === undefined) return null;
      out.attrs.push([m[1], value]);
    } else {
      m = i === 0 ? /^[a-zA-Z][\w-]*/.exec(sel) : null;
      if (!m) return null;
      out.tag = m[0].toLowerCase();
    }
    i += m[0].length;
  }
  return out;
}

function matchesCompound(el: FakeEl, sel: CompoundSelector): boolean {
  if (sel.tag !== null && el.tag.toLowerCase() !== sel.tag) return false;
  if (sel.id !== null && el.id !== sel.id) return false;
  for (const cls of sel.classes) if (!el.classes.has(cls)) return false;
  for (const [name, value] of sel.attrs) if (el.getAttribute(name) !== value) return false;
  return true;
}

function matchesChain(el: FakeEl, chain: CompoundSelector[]): boolean {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let idx = chain.length - 2;
  let ancestor = el.parent;
  while (idx >= 0 && ancestor) {
    if (matchesCompound(ancestor, chain[idx])) idx -= 1;
    ancestor = ancestor.parent;
  }
  return idx < 0;
}

function descendants(el: FakeEl): FakeEl[] {
  return el.children.flatMap((child) => [child, ...descendants(child)]);
}

function queryAll(root: FakeEl, selector: string): FakeEl[] {
  const chain: CompoundSelector[] = [];
  for (const part of selector.trim().split(/\s+/)) {
    const parsed = parseCompound(part);
    if (!parsed) return [];
    chain.push(parsed);
  }
  if (chain.length === 0) return [];
  return descendants(root).filter((el) => matchesChain(el, chain));
}

function findById(root: FakeEl, id: string): FakeEl | null {
  return descendants(root).find((el) => el.id === id) ?? null;
}

function walk(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap(walk)];
}

function findByClass(root: FakeEl, token: string): FakeEl[] {
  return walk(root).filter((el) => el.classes.has(token));
}

describe('209 setup panel v2', () => {
  it('AT1: formatSetupValue formats every setup key in real units', async () => {
    const format = await loadFormatSetupValue();
    expect(format('brakeBias', 0.6)).toBe('60.0% F');
    expect(format('arbFront', 18000)).toBe('18 kN/m');
    expect(format('rideHeight', -0.006)).toBe('-6 mm');
    expect(format('rideHeight', 0)).toBe('0 mm');
    expect(format('rideHeight', 0.004)).toBe('+4 mm');
    expect(format('tyrePressureKpa', 140)).toBe('20.3 psi (140 kPa)');
    expect(format('finalDrive', 3.5)).toBe('3.50');
    expect(format('frontWing', 5)).toBe('5');
    expect(format('rearWing', Number.NaN)).toBe('—');
  });

  it('AT2: saveGameOptions keeps the other keys stored in settings', async () => {
    const storage = fakeStorage({ preset: 'high', wear: 2 });
    const saveGameOptions = await loadSaveGameOptions();
    saveGameOptions(storage, { wear: 2, fuel: 1, compound: 'soft' });
    expect(loadGameOptions(storage)).toEqual({ wear: 2, fuel: 1, compound: 'soft' });
    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null') as Record<string, unknown>;
    expect(stored.preset).toBe('high');
  });

  it('AT3: savePreset keeps a stored compound', () => {
    const storage = fakeStorage({ compound: 'hard' });
    savePreset(storage, 'medium');
    expect(loadGameOptions(storage).compound).toBe('hard');
  });

  it('AT4: SetupHud show renders nine rows and hide/toggle flip the visibility', async () => {
    const spec = f4Spec();
    const SetupHud = await loadSetupHudClass();
    const doc = new FakeDoc();
    const container = new FakeEl(doc, 'div');
    const hud = new SetupHud(container as unknown as HTMLElement, doc as unknown as Document);
    hud.show(defaultSetupOf(spec), 'soft', spec);
    expect(hud.visible).toBe(true);
    const root = container.children.find((el) => el.id === 'setup-hud');
    expect(root, 'root #setup-hud missing').toBeDefined();
    const rows = root ? findByClass(root, 'setup-hud-row') : [];
    expect(rows).toHaveLength(9);
    const rowText = (key: string): string => {
      const row = rows.find((el) => el.getAttribute('data-setup') === key);
      expect(row, `row ${key} missing`).toBeDefined();
      return row ? row.textContent : '';
    };
    expect(rowText('rearWing')).toContain('5');
    expect(rowText('tyrePressureKpa')).toContain('20.3 psi');
    expect(rowText('compound')).toContain('Soft');
    hud.hide();
    expect(hud.visible).toBe(false);
    hud.toggle();
    expect(hud.visible).toBe(true);
  });
});
