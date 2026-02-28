import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

export function createBloomPass(
  width: number,
  height: number,
  strength: number,
  radius: number,
  threshold: number
): UnrealBloomPass {
  return new UnrealBloomPass(
    new THREE.Vector2(width, height),
    strength,
    radius,
    threshold
  );
}
