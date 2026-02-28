import * as THREE from 'three';

const _tmp = new THREE.Color();

export function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().copy(a).lerp(b, t);
}

export function dimColor(color: THREE.Color, amount: number): THREE.Color {
  return new THREE.Color().copy(color).multiplyScalar(1 - amount);
}

export function brightenColor(color: THREE.Color, amount: number): THREE.Color {
  _tmp.copy(color);
  _tmp.r = Math.min(1, _tmp.r + amount);
  _tmp.g = Math.min(1, _tmp.g + amount);
  _tmp.b = Math.min(1, _tmp.b + amount);
  return new THREE.Color().copy(_tmp);
}

export function colorWithAlpha(color: THREE.Color, alpha: number): { color: THREE.Color; opacity: number } {
  return { color: new THREE.Color().copy(color), opacity: alpha };
}
