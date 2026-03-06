import * as THREE from 'three';
import { SeededRandom } from '../random';
import { createRegion } from '../layout/region';
import { createElement } from '../elements/registry';
import type { Palette } from '../color/palettes';

const THUMB_W = 120;
const THUMB_H = 72;
const BATCH_SIZE = 4;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Renders small thumbnails of element types in batches using an offscreen
 * WebGLRenderTarget. Call processBatch() once per frame from the editor's
 * update loop; it returns true while work remains.
 */
export class ThumbnailGenerator {
  private renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private thumbScene: THREE.Scene;
  private thumbCamera: THREE.OrthographicCamera;
  private palette: Palette;
  private queue: string[];
  private thumbnails: Map<string, string> = new Map();
  private onBatch: () => void;
  private disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    palette: Palette,
    types: string[],
    onBatch: () => void,
  ) {
    this.renderer = renderer;
    this.palette = palette;
    this.queue = [...types];
    this.onBatch = onBatch;

    this.target = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H);
    this.thumbScene = new THREE.Scene();
    this.thumbScene.background = palette.bg.clone();
    this.thumbCamera = new THREE.OrthographicCamera(0, THUMB_W, THUMB_H, 0, -1000, 1000);
    this.thumbCamera.position.z = 100;
  }

  /** Process one batch. Returns true if more work remains. */
  processBatch(): boolean {
    if (this.disposed || this.queue.length === 0) return false;

    const prevTarget = this.renderer.getRenderTarget();
    const batch = this.queue.splice(0, BATCH_SIZE);

    for (const type of batch) {
      this.renderOne(type);
    }

    this.renderer.setRenderTarget(prevTarget);
    this.onBatch();
    return this.queue.length > 0;
  }

  private renderOne(type: string): void {
    const w = THUMB_W;
    const h = THUMB_H;
    const rng = new SeededRandom(hashStr(type));
    const region = createRegion('thumb', 0, 0, 1, 1, 0.02);

    let element;
    try {
      element = createElement(type, region, this.palette, rng, w, h);
    } catch {
      return;
    }

    this.thumbScene.add(element.group);
    element.group.visible = true;
    element.stateMachine.transition('active');

    // Simulate a few frames so the element has content
    for (let i = 0; i < 5; i++) {
      try {
        element.tick(0.033, 0.5 + i * 0.033);
      } catch {
        break;
      }
    }

    // Render to offscreen target
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.thumbScene, this.thumbCamera);

    // Read pixels (WebGL is bottom-up, so flip Y when writing to canvas)
    const pixels = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, w, h, pixels);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(w, h);
    for (let srcY = 0; srcY < h; srcY++) {
      const dstY = h - 1 - srcY;
      const srcOff = srcY * w * 4;
      const dstOff = dstY * w * 4;
      imgData.data.set(pixels.subarray(srcOff, srcOff + w * 4), dstOff);
    }
    ctx.putImageData(imgData, 0, 0);

    this.thumbnails.set(type, canvas.toDataURL('image/jpeg', 0.7));

    // Cleanup
    element.dispose();
    this.thumbScene.remove(element.group);
  }

  get(type: string): string | undefined {
    return this.thumbnails.get(type);
  }

  get remaining(): number {
    return this.queue.length;
  }

  get total(): number {
    return this.thumbnails.size + this.queue.length;
  }

  dispose(): void {
    this.disposed = true;
    this.target.dispose();
    this.queue = [];
  }
}
