import * as THREE from 'three';

export interface RendererContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}

export function createRenderer(width: number, height: number): RendererContext {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = true;
  renderer.localClippingEnabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Orthographic camera: coordinates map to [0, width] x [0, height]
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
  camera.position.z = 100;

  return { renderer, scene, camera };
}

export function resizeRenderer(ctx: RendererContext, width: number, height: number): void {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  ctx.renderer.setSize(w, h);
  ctx.camera.right = w;
  ctx.camera.top = h;
  ctx.camera.left = 0;
  ctx.camera.bottom = 0;
  ctx.camera.updateProjectionMatrix();
}
