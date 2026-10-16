import * as THREE from 'three';
import type { Quat, Vec3 } from '../core/types';

export const MIRROR_FOV = 50;
export const MIRROR_WIDTH = 512;
export const MIRROR_HEIGHT = 128;
const MIRROR_NEAR = 0.3;

const poseQuat = new THREE.Quaternion();
const poseOffset = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

/** Mirror pose behind the car (local +Z): 1.0 m up, 0.5 m back, looking rearwards. Writes `out`, mutates nothing else. */
export function mirrorCameraPose(carPos: Vec3, carQuat: Quat, out: { position: THREE.Vector3; forward: THREE.Vector3 }): void {
  poseQuat.set(carQuat.x, carQuat.y, carQuat.z, carQuat.w);
  poseOffset.set(0, 1.0, 0.5).applyQuaternion(poseQuat);
  out.position.set(carPos.x + poseOffset.x, carPos.y + poseOffset.y, carPos.z + poseOffset.z);
  out.forward.set(0, 0, 1).applyQuaternion(poseQuat);
}

// Three renders off the default framebuffer in the linear working space with no tone
// mapping, so the readback bytes need the sRGB transfer function before the 2d canvas.
const SRGB_BYTE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  SRGB_BYTE[i] = Math.round(s * 255);
}

/** Rear-view mirror: one extra camera rendered into an offscreen target, blitted to a DOM canvas. */
export class VirtualMirror {
  readonly element: HTMLCanvasElement;
  /** Mirror render count for renderStats().mirrorRenders. */
  renders = 0;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pixels: Uint8Array;
  private readonly image: ImageData;
  private readonly pose = { position: new THREE.Vector3(), forward: new THREE.Vector3() };

  constructor(parent: HTMLElement, far: number) {
    const doc = parent.ownerDocument;
    this.element = doc.createElement('canvas');
    this.element.id = 'mirror';
    this.element.width = MIRROR_WIDTH;
    this.element.height = MIRROR_HEIGHT;
    const s = this.element.style;
    s.position = 'fixed';
    s.top = '12px';
    s.left = '50%';
    s.width = `${MIRROR_WIDTH}px`;
    s.height = `${MIRROR_HEIGHT}px`;
    s.transform = 'translateX(-50%) scaleX(-1)';
    s.pointerEvents = 'none';
    s.zIndex = '10';
    s.display = 'none';
    parent.appendChild(this.element);

    const ctx = this.element.getContext('2d');
    if (!ctx) throw new Error('mirror: 2d context unavailable');
    this.ctx = ctx;
    this.camera = new THREE.PerspectiveCamera(MIRROR_FOV, MIRROR_WIDTH / MIRROR_HEIGHT, MIRROR_NEAR, far);
    this.target = new THREE.WebGLRenderTarget(MIRROR_WIDTH, MIRROR_HEIGHT);
    this.pixels = new Uint8Array(MIRROR_WIDTH * MIRROR_HEIGHT * 4);
    this.image = this.ctx.createImageData(MIRROR_WIDTH, MIRROR_HEIGHT);
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? 'block' : 'none';
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, carPos: Vec3, carQuat: Quat): void {
    mirrorCameraPose(carPos, carQuat, this.pose);
    this.camera.position.copy(this.pose.position);
    this.camera.lookAt(lookTarget.copy(this.pose.position).add(this.pose.forward));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.readRenderTargetPixels(this.target, 0, 0, MIRROR_WIDTH, MIRROR_HEIGHT, this.pixels);
    this.blit();
    this.renders++;
  }

  // readRenderTargetPixels returns rows bottom-up; the canvas wants them top-down.
  private blit(): void {
    const src = this.pixels;
    const dst = this.image.data;
    for (let y = 0; y < MIRROR_HEIGHT; y++) {
      const s0 = (MIRROR_HEIGHT - 1 - y) * MIRROR_WIDTH * 4;
      const d0 = y * MIRROR_WIDTH * 4;
      for (let x = 0; x < MIRROR_WIDTH; x++) {
        const s = s0 + x * 4;
        const d = d0 + x * 4;
        dst[d] = SRGB_BYTE[src[s]];
        dst[d + 1] = SRGB_BYTE[src[s + 1]];
        dst[d + 2] = SRGB_BYTE[src[s + 2]];
        dst[d + 3] = 255;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  dispose(): void {
    this.target.dispose();
    this.element.remove();
    this.element.width = 0;
    this.element.height = 0;
  }
}
