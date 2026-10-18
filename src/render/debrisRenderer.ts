import * as THREE from 'three';
import type { Quat, Vec3 } from '../core/types';
import type { DebrisKind } from '../physics/debris';

export interface DebrisRenderEntry {
  kind: DebrisKind;
  position: Vec3;
  rotation: Quat;
}

export interface DebrisRendererOptions {
  /** Template wheel node (cloned per wheel debris); wheels render as boxes when absent. */
  wheelSource?: THREE.Object3D | null;
  /** Per car wheel nodes in FL, FR, RL, RR order; hidden while that wheel is debris. */
  carWheels?: readonly (readonly THREE.Object3D[] | null)[];
  /** Wing box colour (livery primary); grey when absent. */
  wingColor?: number;
}

const WING_SIZE: Record<'frontWing' | 'rearWing', [number, number, number]> = {
  frontWing: [1.6, 0.05, 0.4],
  rearWing: [1.0, 0.3, 0.3],
};
const WING_GREY = 0x999999;

// One mesh per live debris (task 147). No Rapier import: the game layer passes poses.
export class DebrisRenderer {
  private readonly root = new THREE.Group();
  private readonly meshes: THREE.Object3D[] = [];
  private readonly kinds: DebrisKind[] = [];
  private readonly options: DebrisRendererOptions;
  private readonly wingGeo = new Map<DebrisKind | 'wheelBox', THREE.BoxGeometry>();
  private readonly wingMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Object3D, options: DebrisRendererOptions = {}) {
    this.options = options;
    this.wingMat = new THREE.MeshStandardMaterial({
      color: options.wingColor ?? WING_GREY,
      roughness: 0.6,
      metalness: 0.1,
    });
    scene.add(this.root);
  }

  sync(
    entries: readonly DebrisRenderEntry[],
    count: number,
    hidden?: (car: number, wheel: number) => boolean,
  ): void {
    while (this.meshes.length > count) this.removeMesh(this.meshes.length - 1);
    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      if (this.meshes[i] === undefined || this.kinds[i] !== entry.kind) {
        if (this.meshes[i] !== undefined) this.removeMesh(i);
        this.meshes[i] = this.createMesh(entry.kind);
        this.kinds[i] = entry.kind;
        this.root.add(this.meshes[i]);
      }
      const mesh = this.meshes[i];
      mesh.position.set(entry.position.x, entry.position.y, entry.position.z);
      mesh.quaternion.set(entry.rotation.x, entry.rotation.y, entry.rotation.z, entry.rotation.w);
    }
    const cars = this.options.carWheels;
    if (cars !== undefined && hidden !== undefined) {
      for (let car = 0; car < cars.length; car++) {
        const nodes = cars[car];
        if (nodes === null || nodes === undefined) continue;
        for (let w = 0; w < nodes.length; w++) nodes[w].visible = !hidden(car, w);
      }
    }
  }

  dispose(): void {
    while (this.meshes.length > 0) this.removeMesh(this.meshes.length - 1);
    for (const geo of this.wingGeo.values()) geo.dispose();
    this.wingGeo.clear();
    this.wingMat.dispose();
    this.root.removeFromParent();
  }

  private createMesh(kind: DebrisKind): THREE.Object3D {
    if (kind === 'wheel') {
      if (this.options.wheelSource != null) {
        // Clones share the car model's geometry/material; those stay owned by the car.
        const clone = this.options.wheelSource.clone(true);
        // The template may be the hidden wheel node itself.
        clone.traverse((o) => {
          o.visible = true;
        });
        return clone;
      }
      let geo = this.wingGeo.get('wheelBox');
      if (geo === undefined) {
        geo = new THREE.BoxGeometry(0.56, 0.56, 0.3);
        this.wingGeo.set('wheelBox', geo);
      }
      return new THREE.Mesh(geo, this.wingMat);
    }
    let geo = this.wingGeo.get(kind);
    if (geo === undefined) {
      const [sx, sy, sz] = WING_SIZE[kind];
      geo = new THREE.BoxGeometry(sx, sy, sz);
      this.wingGeo.set(kind, geo);
    }
    return new THREE.Mesh(geo, this.wingMat);
  }

  private removeMesh(index: number): void {
    const mesh = this.meshes[index];
    mesh.removeFromParent();
    // Only own meshes (wing boxes) have their geometry disposed; clones share the car's.
    if (mesh instanceof THREE.Mesh) {
      const owned = [...this.wingGeo.values()].some((g) => g === mesh.geometry);
      if (owned) mesh.geometry.dispose();
    }
    this.meshes.splice(index, 1);
    this.kinds.splice(index, 1);
  }
}
