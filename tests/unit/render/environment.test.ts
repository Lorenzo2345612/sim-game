import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createScene } from '../../../src/render/sceneSetup';
import { FOG_TABLE, applyEnvironment, ShadowRig } from '../../../src/render/environment';

describe('applyEnvironment', () => {
  it('unknown track id falls back to monza fog', () => {
    const { scene } = createScene();
    applyEnvironment(scene, 'nurburgring');
    const fog = scene.fog as THREE.FogExp2;
    expect(fog).toBeInstanceOf(THREE.FogExp2);
    expect(fog.color.getHexString()).toBe(FOG_TABLE.monza.color.slice(1));
    expect(fog.density).toBe(FOG_TABLE.monza.density);
  });

  it('calling twice leaves exactly one sky', () => {
    const { scene } = createScene();
    applyEnvironment(scene, 'monza');
    applyEnvironment(scene, 'spa');
    const skies = scene.children.filter((c) => c instanceof Sky);
    expect(skies).toHaveLength(1);
    expect(scene.getObjectByName('sky')).toBe(skies[0]);
  });

  it('sky is scaled and background is cleared', () => {
    const { scene } = createScene();
    applyEnvironment(scene, 'silverstone');
    const sky = scene.getObjectByName('sky') as THREE.Mesh;
    expect(sky.scale.x).toBe(4500);
    expect(scene.background).toBeNull();
  });
});

describe('ShadowRig', () => {
  it('update moves light and target together, keeping the sun offset', () => {
    const { scene } = createScene();
    const rig = new ShadowRig(scene);
    const car = { x: 50, y: 0.2, z: -30 };
    rig.update(car);
    expect(rig.light.target.position).toEqual(new THREE.Vector3(50, 0.2, -30));
    expect(rig.light.position).toEqual(new THREE.Vector3(200, 200.2, 70));
    expect(scene.children).toContain(rig.light.target);
  });

  it('shadow bias is set', () => {
    const { scene } = createScene();
    const rig = new ShadowRig(scene);
    expect(rig.light.shadow.bias).toBe(-0.0004);
  });

  it('setEnabled re-enables both renderer and light', () => {
    const { scene } = createScene();
    const rig = new ShadowRig(scene);
    const renderer = { shadowMap: { enabled: false } };
    rig.setEnabled(renderer, true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(rig.light.castShadow).toBe(true);
  });
});
