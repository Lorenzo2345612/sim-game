import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ENV_TABLE, FOG_TABLE, horizonColor, ShadowRig } from '../../../src/render/environment';

describe('ENV_TABLE', () => {
  it('maps each v2 track to its hdri base name', () => {
    expect(ENV_TABLE.monza).toBe('kloofendal_48d_partly_cloudy_puresky');
    expect(ENV_TABLE.spa).toBe('kloofendal_overcast_puresky');
    expect(ENV_TABLE.silverstone).toBe('kloofendal_overcast_puresky');
  });
});

describe('FOG_TABLE', () => {
  it('keeps per-track densities without colours (fog colour comes from the horizon)', () => {
    expect(FOG_TABLE.monza.density).toBeCloseTo(0.00055, 12);
    expect(FOG_TABLE.spa.density).toBeCloseTo(0.0011, 12);
    expect(FOG_TABLE.silverstone.density).toBeCloseTo(0.0008, 12);
    expect('color' in FOG_TABLE.monza).toBe(false);
  });
});

describe('horizonColor', () => {
  it('averages only the rows inside the ±5° band and ignores alpha', () => {
    const width = 8;
    const height = 36;
    const data = new Float32Array(width * height * 4);
    for (let r = 0; r < height; r++) {
      const lat = (0.5 - (r + 0.5) / height) * 180;
      for (let x = 0; x < width; x++) {
        const i = (r * width + x) * 4;
        if (Math.abs(lat) <= 5) {
          data[i] = 0.25;
          data[i + 1] = 0.5;
          data[i + 2] = 1.5;
        } else {
          data[i] = 9;
          data[i + 1] = 9;
          data[i + 2] = 9;
        }
        data[i + 3] = 1;
      }
    }
    const [r, g, b] = horizonColor(data, width, height);
    expect(r).toBeCloseTo(0.25, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(1.5, 6); // not clamped here; applyEnvironment clamps for fog
  });

  it('does not mutate the data and returns zeros for an empty band', () => {
    const width = 4;
    const height = 1; // single row sits at lat 0 but has no pixels filled
    const data = new Float32Array(width * height * 4);
    const copy = Float32Array.from(data);
    expect(horizonColor(data, width, height)).toEqual([0, 0, 0]);
    expect(data).toEqual(copy);
  });
});

describe('ShadowRig', () => {
  it('update moves light and target together, keeping the sun offset', () => {
    const scene = new THREE.Scene();
    const rig = new ShadowRig(scene);
    const car = { x: 50, y: 0.2, z: -30 };
    rig.update(car);
    expect(rig.light.target.position).toEqual(new THREE.Vector3(50, 0.2, -30));
    expect(rig.light.position).toEqual(new THREE.Vector3(200, 200.2, 70));
    expect(scene.children).toContain(rig.light.target);
  });

  it('shadow bias is set', () => {
    const rig = new ShadowRig(new THREE.Scene());
    expect(rig.light.shadow.bias).toBe(-0.0004);
  });

  it('setEnabled re-enables both renderer and light', () => {
    const rig = new ShadowRig(new THREE.Scene());
    const renderer = { shadowMap: { enabled: false } };
    rig.setEnabled(renderer, true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(rig.light.castShadow).toBe(true);
  });
});
