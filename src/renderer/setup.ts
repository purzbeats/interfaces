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
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Orthographic camera: coordinates map to [0, width] x [0, height]
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
  camera.position.z = 100;

  return { renderer, scene, camera };
}

export function resizeRenderer(ctx: RendererContext, width: number, height: number): void {
  ctx.renderer.setSize(width, height);
  ctx.camera.right = width;
  ctx.camera.top = height;
  ctx.camera.left = 0;
  ctx.camera.bottom = 0;
  ctx.camera.updateProjectionMatrix();
}
