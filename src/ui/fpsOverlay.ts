export interface FrameStats {
  fps: number;
  drawCalls: number;
}

export class FpsOverlay {
  readonly element: HTMLElement;
  private visible = false;
  private readonly keyTarget: EventTarget;
  private readonly onKeydown: (ev: Event) => void;

  constructor(parent: HTMLElement, keyTarget: EventTarget) {
    this.keyTarget = keyTarget;
    this.element = parent.ownerDocument.createElement('div');
    this.element.id = 'fps-overlay';
    this.element.style.display = 'none';
    parent.appendChild(this.element);
    this.onKeydown = (ev: Event): void => {
      if ((ev as KeyboardEvent).key !== 'F3') return;
      ev.preventDefault();
      this.visible = !this.visible;
      this.element.style.display = this.visible ? 'block' : 'none';
    };
    keyTarget.addEventListener('keydown', this.onKeydown);
  }

  update(stats: FrameStats): void {
    this.element.textContent = `${Math.round(stats.fps)} FPS | ${stats.drawCalls} draw calls`;
  }

  dispose(): void {
    this.keyTarget.removeEventListener('keydown', this.onKeydown);
    this.element.remove();
  }
}
