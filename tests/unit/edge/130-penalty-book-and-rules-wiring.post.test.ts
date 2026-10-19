import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { carLimitsFromSpec, speedProfile } from '../../../src/ai/speedProfile';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { RaceHud, type RaceHudData } from '../../../src/ui/raceHud';
import { Results } from '../../../src/ui/results';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number, gridOrder?: number[]): RaceConfig {
  return {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty: 'medium',
    seed: 1,
    gridOrder,
  };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

class FakeEl {
  private readonly cls = new Set<string>();
  id = '';
  textContent: string | null = null;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = { display: '' };
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (c: string): void => void this.cls.add(c),
    remove: (c: string): void => void this.cls.delete(c),
    contains: (c: string): boolean => this.cls.has(c),
  };
  constructor(public ownerDocument: FakeDoc) {}
  get className(): string {
    return [...this.cls].join(' ');
  }
  set className(v: string) {
    this.cls.clear();
    for (const c of v.split(/\s+/).filter(Boolean)) this.cls.add(c);
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  appendChild(c: FakeEl): FakeEl {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(...cs: FakeEl[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const c of cs) this.appendChild(c);
  }
  remove(): void {
    const p = this.parent;
    if (p === null) return;
    const i = p.children.indexOf(this);
    if (i >= 0) p.children.splice(i, 1);
    this.parent = null;
  }
  addEventListener(): void {}
}

class FakeDoc {
  createElement(): FakeEl {
    return new FakeEl(this);
  }
}

function walk(e: FakeEl): FakeEl[] {
  return [e, ...e.children.flatMap(walk)];
}

function byId(root: FakeEl, id: string): FakeEl {
  const el = walk(root).find((e) => e.id === id);
  if (!el) throw new Error(`no #${id}`);
  return el;
}

function byClass(root: FakeEl, cls: string): FakeEl[] {
  return walk(root).filter((e) => e.classList.contains(cls));
}

function hudData(patch: Partial<RaceHudData>): RaceHudData {
  return {
    standings: [],
    playerCar: 0,
    laps: 3,
    flags: ['green', 'green', 'green'],
    blue: false,
    vscPhase: 'off',
    vscDelta: 0,
    ...patch,
  };
}

function stepUntilGo(game: RaceGame, input: DriverInput, maxTicks = steps(12)): number {
  let prev = game.startLights();
  for (let i = 0; i < maxTicks; i++) {
    game.step(input);
    const lights = game.startLights();
    if (prev > 0 && lights === 0) return game.simTime;
    prev = lights;
  }
  throw new Error('go not reached');
}

// Drives the player like a race AI: an AiDriver fed the player's own state.
function playerAiStep(
  game: RaceGame,
  state: VehicleState,
  obs: AiObservation,
  drv: AiDriver,
  cmd: DriverInput,
): void {
  game.getStates([state]);
  const q = state.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  obs.x = state.position.x;
  obs.z = state.position.z;
  obs.yaw = Math.atan2(-fx, -fz);
  obs.speed = state.forwardSpeed;
  drv.update(obs, FIXED_DT, cmd);
  game.step(cmd);
}

function makePlayerDriver(game: RaceGame, track: TrackDataV2, spec: CarSpec): AiDriver {
  const line = computeRacingLine(track.centerline, track.widthMeters / 2);
  const limits = carLimitsFromSpec(spec, game.getTelemetry().fuelKg);
  const speeds = speedProfile(line, {
    ...limits,
    muLat: limits.muLat * 0.82,
    muLong: limits.muLong * 0.82,
  });
  const drv = new AiDriver(line, speeds, { speedScale: 0.9 });
  drv.setSteerCurve(spec.steering.maxAngleLow, spec.steering.maxAngleHigh, spec.steering.fullSpeed);
  return drv;
}

describe('130 penalty book and rules wiring post-code gaps', () => {

  it('POST1: HUD sector flags take their data-state and the blue/vsc banners follow the feed', () => {
    const doc = new FakeDoc();
    const parent = new FakeEl(doc);
    const hud = new RaceHud(parent as unknown as HTMLElement);
    const flags = byId(parent, 'flags');
    const [s1, s2, s3] = byClass(flags, 'flag-s1').concat(
      byClass(flags, 'flag-s2'),
      byClass(flags, 'flag-s3'),
    );
    expect([s1.dataset.state, s2.dataset.state, s3.dataset.state], 'all green at start').toEqual([
      'green',
      'green',
      'green',
    ]);
    hud.update(hudData({ flags: ['yellow', 'double-yellow', 'green'] }));
    expect([s1.dataset.state, s2.dataset.state, s3.dataset.state]).toEqual([
      'yellow',
      'double-yellow',
      'green',
    ]);
    hud.update(hudData({ flags: ['green', 'green', 'green'] }));
    expect([s1.dataset.state, s2.dataset.state, s3.dataset.state], 'back to green').toEqual([
      'green',
      'green',
      'green',
    ]);
    const blue = byId(parent, 'blue-banner');
    expect(blue.style.display, 'hidden until fed blue').toBe('none');
    hud.update(hudData({ blue: true }));
    expect(blue.style.display).toBe('block');
    hud.update(hudData({ blue: false }));
    expect(blue.style.display).toBe('none');
    const vsc = byId(parent, 'vsc-banner');
    expect(vsc.style.display, 'hidden while phase off').toBe('none');
    hud.update(hudData({ vscPhase: 'deployed', vscDelta: 1.23 }));
    expect(vsc.style.display).toBe('block');
    expect(vsc.textContent, 'delta with sign and one decimal').toBe('VSC +1.2');
    hud.update(hudData({ vscPhase: 'ending', vscDelta: -0.54 }));
    expect(vsc.style.display, 'ending still shows the banner').toBe('block');
    expect(vsc.textContent).toBe('VSC -0.5');
    hud.update(hudData({ vscPhase: 'off' }));
    expect(vsc.style.display).toBe('none');
  });

  it('POST2: toasts stack at most 5 and clearToasts empties them', () => {
    // Scoped stub: a global window breaks Rapier's WASM step in the sim tests.
    vi.stubGlobal('window', { setTimeout: () => 0 });
    try {
      const doc = new FakeDoc();
      const parent = new FakeEl(doc);
      const hud = new RaceHud(parent as unknown as HTMLElement);
      const box = byId(parent, 'toasts');
      for (let i = 1; i <= 7; i++) hud.pushToast(`t${i}`);
      expect(box.children).toHaveLength(5);
      expect(byClass(box, 'toast').map((e) => e.textContent), 'oldest dropped first').toEqual([
        't3',
        't4',
        't5',
        't6',
        't7',
      ]);
      hud.clearToasts();
      expect(box.children).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('POST3: the results penalty cell shows bare seconds when no reasons are given', () => {
    const doc = new FakeDoc();
    const parent = new FakeEl(doc);
    const results = new Results(parent as unknown as HTMLElement);
    results.show(
      [
        { position: 1, name: 'You', totalTime: 61, bestLap: 60, penalty: 5 },
        { position: 2, name: 'Bot', totalTime: 62, bestLap: 61, penalty: 0, penaltyReasons: ['track limits'] },
      ],
      { onRestart: () => {}, onMenu: () => {} },
    );
    const cell = (name: string): FakeEl => {
      const row = walk(parent).find((e) => e.children.length >= 5 && e.children[1].textContent === name);
      if (!row) throw new Error(`no row ${name}`);
      return row.children[4];
    };
    expect(cell('You').textContent, 'penalty without reasons').toBe('5 s');
    expect(cell('Bot').textContent, 'zero penalty ignores reasons').toBe('-');
  });

  it('POST4: the debug hooks reject the player and out-of-range cars', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      expect(() => game.debugStopCar(0), 'the player cannot be debug-stopped').toThrow(RangeError);
      expect(() => game.debugStopCar(-1)).toThrow(RangeError);
      expect(() => game.debugStopCar(1.5)).toThrow(RangeError);
      expect(() => game.debugStopCar(game.carCount)).toThrow(RangeError);
      expect(() => game.debugForceTrackLimits(-1, 1)).toThrow(RangeError);
      expect(() => game.debugForceTrackLimits(game.carCount, 1)).toThrow(RangeError);
      expect(() => game.debugForceTrackLimits(0.5, 1)).toThrow(RangeError);
      expect(game.penalties.entries(), 'failed hooks book nothing').toEqual([]);
      game.debugForceTrackLimits(1, -3);
      expect(game.penalties.entries(), 'a negative count books nothing').toEqual([]);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST5: strikes past the first penalty keep booking 5 s each', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      game.debugForceTrackLimits(1, 10);
      const entries = game.penalties.entries();
      expect(entries.map((e) => e.kind), '3 warnings then a penalty per further strike').toEqual([
        'warning',
        'warning',
        'warning',
        ...Array.from({ length: 7 }, () => 'penalty'),
      ]);
      expect(entries.every((e) => e.car === 1 && e.reason === 'track limits')).toBe(true);
      expect(entries.slice(3).every((e) => e.seconds === 5)).toBe(true);
      expect(game.penalties.total(1)).toBe(35);
      expect(game.standings().find((s) => s.car === 1)?.penalty, 'feeds classification').toBe(35);
      expect(game.penalties.total(0), 'the player is untouched').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST6: an idle player deploys the VSC and it clears to off once everyone drives again', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      const go = stepUntilGo(game, IDLE);
      let deployedAt = Number.NaN;
      for (let i = 0; i < steps(11) && Number.isNaN(deployedAt); i++) {
        game.step(IDLE);
        if (game.vsc.phase === 'deployed') deployedAt = game.simTime;
      }
      expect(deployedAt - go, 'the idle player counts as a stopped car').toBeLessThanOrEqual(10.2);
      for (let i = 0; i < steps(2); i++) game.step(IDLE);
      expect(game.vsc.phase, 'still deployed while the player sits').toBe('deployed');
      expect(game.playerVscDelta, 'a stopped player only loses time').toBeGreaterThan(0);
      for (let i = 0; i < steps(1) && game.vsc.phase !== 'ending'; i++) game.step(FULL);
      expect(game.vsc.phase, 'everyone moving again').toBe('ending');
      for (let i = 0; i < steps(6) && game.vsc.phase !== 'off'; i++) game.step(FULL);
      expect(game.vsc.phase, '5 s after the clear').toBe('off');
      expect(game.playerVscDelta, 'deltas reset with the phase').toBe(0);
      game.step(FULL);
      expect(game.playerVscDelta).toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST7: a player above the VSC pace books one 5 s VSC delta penalty', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, raceConfig(1, [0, 1]));
    try {
      const go = stepUntilGo(game, IDLE);
      game.debugStopCar(1);
      const drv = makePlayerDriver(game, track, spec);
      const state = createVehicleState(4);
      const obs: AiObservation = { x: 0, z: 0, yaw: 0, speed: 0, rearSlip: 0, yawRate: 0, steerAngle: 0 };
      const cmd: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
      let deployedAt = Number.NaN;
      for (let i = 0; i < steps(14); i++) {
        playerAiStep(game, state, obs, drv, cmd);
        if (Number.isNaN(deployedAt) && game.vsc.phase === 'deployed') deployedAt = game.simTime;
        if (!Number.isNaN(deployedAt) && game.penalties.forCar(0).some((e) => e.reason === 'VSC delta')) {
          break;
        }
      }
      expect(deployedAt - go, 'VSC after 10 s of the held AI').toBeLessThanOrEqual(10.2);
      const entries = game.penalties.forCar(0).filter((e) => e.reason === 'VSC delta');
      expect(entries, 'one VSC delta entry for the player').toHaveLength(1);
      expect(entries[0].kind).toBe('penalty');
      expect(entries[0].seconds).toBe(5);
      expect(entries[0].time).toBeGreaterThan(deployedAt);
      expect(game.penalties.total(0)).toBe(5);
      expect(game.standings().find((s) => s.car === 0)?.penalty, 'feeds classification').toBe(5);
      expect(game.penalties.total(1), 'the held AI only loses time').toBe(0);
      expect(game.vsc.phase, 'the held AI keeps the VSC out').toBe('deployed');
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST8: playerBlueFlag turns true when an AI is within 200 m behind a lap ahead', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, raceConfig(1, [0, 1]));
    try {
      const states = Array.from({ length: game.carCount }, () => createVehicleState(4));
      stepUntilGo(game, IDLE);
      expect(game.playerBlueFlag, 'nobody a lap ahead at the start').toBe(false);
      // Band-limited player: AiDriver steering at 7-14 m/s keeps it above the 5 m/s
      // yellow cause so the AI can overtake and lap it.
      const drv = makePlayerDriver(game, track, spec);
      const obs: AiObservation = { x: 0, z: 0, yaw: 0, speed: 0, rearSlip: 0, yawRate: 0, steerAngle: 0 };
      const aiCmd: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
      const cmd: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
      let seen = false;
      for (let i = 0; i < steps(220) && !seen; i++) {
        game.getStates(states);
        const s = states[0];
        const q = s.rotation;
        const fx = -2 * (q.w * q.y + q.x * q.z);
        const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
        obs.x = s.position.x;
        obs.z = s.position.z;
        obs.yaw = Math.atan2(-fx, -fz);
        obs.speed = s.forwardSpeed;
        drv.update(obs, FIXED_DT, aiCmd);
        cmd.steer = aiCmd.steer;
        if (s.forwardSpeed > 14) {
          cmd.throttle = 0;
          cmd.brake = 1;
        } else if (s.forwardSpeed < 7) {
          cmd.throttle = 1;
          cmd.brake = 0;
        } else {
          cmd.throttle = 0;
          cmd.brake = 0;
        }
        game.step(cmd);
        seen = game.playerBlueFlag;
      }
      expect(seen, 'blue while the lapping AI is within 200 m behind').toBe(true);
    } finally {
      game.dispose();
    }
  }, 240000);
});
