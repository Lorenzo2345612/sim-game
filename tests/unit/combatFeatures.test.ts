import { describe, it, expect } from 'vitest';
import { NeuralFeatures, type NeuralCarState } from '../../src/ai/neuralFeatures';
import { N_IN, N_IN_V1 } from '../../src/ai/neuralPolicy';

// Straight 600 m along -Z, then a right-hand 90 degree turn (x grows to the right of travel along -Z... heading -Z, right = +X).
const CL: [number, number][] = [];
for (let i = 0; i <= 60; i++) CL.push([0, -10 * i]);
for (let i = 1; i <= 30; i++) { const a = (i / 30) * (Math.PI / 2); CL.push([60 * (1 - Math.cos(a)), -600 - 60 * Math.sin(a)]); }
for (let i = 1; i <= 60; i++) CL.push([60 + 10 * i, -660]);
for (let i = 1; i <= 60; i++) CL.push([660, -660 + 10 * i]);
for (let i = 1; i <= 60; i++) CL.push([660 - 10 * i, 0]);
const HW = new Array<number>(CL.length).fill(6);

function state(over: Partial<NeuralCarState>, zOff = 0): NeuralCarState {
  return {
    position: { x: 0, y: 0, z: zOff }, rotation: { x: 0, y: 0, z: 0, w: 1 }, forwardSpeed: 40,
    linvel: { x: 0, y: 0, z: -40 }, angvel: { x: 0, y: 0, z: 0 }, progress: { index: 0, distance: -zOff, lateral: 0 },
    fuelMassKg: 10, tempFrontC: 90, tempRearC: 90, optTempC: 90, tempWindowC: 30, wearMean: 0, offWheels: 0, compoundGrip: 0, others: [],
    ...over,
  };
}
const car = (x: number, z: number, vz = -40) => ({ position: { x, y: 0, z }, linvel: { x: 0, y: 0, z: vz } });
const C = N_IN_V1; // ovL, ovR, behindClose, behindClosing, corner, brakeDist, attackerInside, targetInside

describe('combat features', () => {
  const f = new NeuralFeatures(CL, HW, HW);
  const out = new Float64Array(N_IN);
  it('zero traffic: only corner and braking cues', () => {
    f.fill(out, state({}));
    for (const k of [0, 1, 2, 3, 6, 7]) expect(out[C + k]).toBe(0);
    for (let i = 0; i < N_IN; i++) expect(Number.isFinite(out[i])).toBe(true);
  });
  it('overlap and sides, car faces -Z so right is +X', () => {
    f.fill(out, state({ others: [car(3, 0)] }));
    expect(out[C + 1]).toBeCloseTo(1, 9);
    expect(out[C]).toBe(0);
    f.fill(out, state({ others: [car(-3, -3)] }));
    expect(out[C]).toBeCloseTo(0.5, 9);
  });
  it('car behind: closeness and closing speed', () => {
    f.fill(out, state({ others: [car(0, 15, -50)] }));
    expect(out[C + 2]).toBeCloseTo(0.5, 9);
    expect(out[C + 3]).toBeCloseTo(0.5, 9);
  });
  it('corner is signed (right turn > 0) and sees 150 m ahead', () => {
    f.fill(out, state({ progress: { index: 52, distance: 520, lateral: 0 } }, 0));
    expect(out[C + 4]).toBeGreaterThan(0);
    f.fill(out, state({ progress: { index: 10, distance: 100, lateral: 0 } }));
    expect(out[C + 4]).toBe(0);
    expect(out[C + 5]).toBeGreaterThanOrEqual(0);
    expect(out[C + 5]).toBeLessThanOrEqual(1);
  });
  it('attacker/target inside flip with the corner side', () => {
    const s = (others: ReturnType<typeof car>[]) => state({ progress: { index: 52, distance: 520, lateral: 0 }, position: { x: 0, y: 0, z: -520 }, others });
    f.fill(out, s([car(2, -505)]));
    expect(out[C + 6]).toBeGreaterThan(0); // right turn, attacker on the right = inside
    f.fill(out, s([car(-2, -505)]));
    expect(out[C + 6]).toBeLessThan(0);
    f.fill(out, s([car(-2, -535)]));
    expect(out[C + 7]).toBeGreaterThan(0); // car ahead sits left, I am inside on the right
  });
});
