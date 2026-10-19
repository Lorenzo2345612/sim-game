import { describe, it, expect } from 'vitest';
import { AttackMode } from '../../../src/physics/attackMode';

describe('AttackMode', () => {
  it('AT1: activation before lap 2 is refused and activationsLeft stays 2', () => {
    const attack = new AttackMode();
    expect(attack.tryActivate(1, false, 10)).toBe(false);
    expect(attack.activationsLeft).toBe(2);
  });

  it('AT2: activation lasts [start, start+duration) with correct remaining time', () => {
    const attack = new AttackMode();
    expect(attack.tryActivate(2, false, 100)).toBe(true);
    expect(attack.mode(101)).toBe('attack');
    expect(attack.remainingS(160)).toBeCloseTo(180, 6);
    expect(attack.mode(340)).toBe('race');
    expect(attack.mode(339.999)).toBe('attack');
  });

  it('AT3: activation is refused while another one is active', () => {
    const attack = new AttackMode();
    expect(attack.tryActivate(2, false, 100)).toBe(true);
    expect(attack.tryActivate(3, false, 200)).toBe(false);
  });

  it('AT4: activations deplete after the second use', () => {
    const attack = new AttackMode();
    expect(attack.tryActivate(2, false, 100)).toBe(true);
    expect(attack.tryActivate(4, false, 400)).toBe(true);
    expect(attack.tryActivate(5, false, 700)).toBe(false);
    expect(attack.activationsLeft).toBe(0);
  });

  it('AT5: activation is refused while VSC is active', () => {
    const attack = new AttackMode();
    expect(attack.tryActivate(3, true, 50)).toBe(false);
  });
});
