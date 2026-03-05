import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Random walk where each step direction is determined by successive digits of pi.
 * Digit d maps to direction d * 36 degrees (10 directions for 10 digits).
 * Shows surprisingly structured patterns in the walk.
 */
export class PiWalkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pi-walk',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private walkLine!: THREE.Line;
  private headPoint!: THREE.Points;
  private stepCount: number = 1000;
  private stepSize: number = 3;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.08;
  private walkPositions!: Float32Array;
  private headPos!: Float32Array;
  private colorMode: number = 0;
  private trailOpacity: number = 0.7;

  // First 2000 digits of pi (after decimal point)
  private static readonly PI_DIGITS =
    '14159265358979323846264338327950288419716939937510' +
    '58209749445923078164062862089986280348253421170679' +
    '82148086513282306647093844609550582231725359408128' +
    '48111745028410270193852110555964462294895493038196' +
    '44288109756659334461284756482337867831652712019091' +
    '45648566923460348610454326648213393607260249141273' +
    '72458700660631558817488152092096282925409171536436' +
    '78925903600113305305488204665213841469519415116094' +
    '33057270365759591953092186117381932611793105118548' +
    '07446237996274956735188575272489122793818301194912' +
    '98336733624406566430860213949463952247371907021798' +
    '60943702770539217176293176752384674818467669405132' +
    '00056812714526356082778577134275778960917363717872' +
    '14684409012249534301465495853710507922796892589235' +
    '42019956112129021960864034418159813629774771309960' +
    '51870721134999999837297804995105973173281609631859' +
    '50244594553469083026425223082533446850352619311881' +
    '71010003137838752886587533208381420617177669147303' +
    '59825349042875546873115956286388235378759375195778' +
    '18577805321712268066130019278766111959092164201989';

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { steps: 800, stepSize: 3, revealSpeed: 0.08, colorMode: 0, trailOpacity: 0.7 },
      { steps: 1500, stepSize: 2, revealSpeed: 0.05, colorMode: 1, trailOpacity: 0.5 },
      { steps: 500, stepSize: 5, revealSpeed: 0.12, colorMode: 2, trailOpacity: 0.8 },
      { steps: 1000, stepSize: 3, revealSpeed: 0.06, colorMode: 3, trailOpacity: 0.6 },
    ];
    const p = presets[variant];

    this.stepCount = Math.min(p.steps, PiWalkElement.PI_DIGITS.length);
    this.stepSize = p.stepSize;
    this.revealSpeed = p.revealSpeed;
    this.colorMode = p.colorMode;
    this.trailOpacity = p.trailOpacity;

    // Compute walk positions
    const rawX = new Float32Array(this.stepCount + 1);
    const rawY = new Float32Array(this.stepCount + 1);
    rawX[0] = 0;
    rawY[0] = 0;

    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    for (let i = 0; i < this.stepCount; i++) {
      const digit = parseInt(PiWalkElement.PI_DIGITS[i], 10);
      const angle = (digit / 10) * Math.PI * 2;
      rawX[i + 1] = rawX[i] + Math.cos(angle) * this.stepSize;
      rawY[i + 1] = rawY[i] + Math.sin(angle) * this.stepSize;
      minX = Math.min(minX, rawX[i + 1]);
      maxX = Math.max(maxX, rawX[i + 1]);
      minY = Math.min(minY, rawY[i + 1]);
      maxY = Math.max(maxY, rawY[i + 1]);
    }

    // Scale and center the walk
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = Math.min(w * 0.85, h * 0.85) / Math.max(rangeX, rangeY);
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const offsetX = -(minX + maxX) / 2;
    const offsetY = -(minY + maxY) / 2;

    const totalPts = this.stepCount + 1;
    this.walkPositions = new Float32Array(totalPts * 3);
    for (let i = 0; i < totalPts; i++) {
      this.walkPositions[i * 3] = centerX + (rawX[i] + offsetX) * scale;
      this.walkPositions[i * 3 + 1] = centerY + (rawY[i] + offsetY) * scale;
      this.walkPositions[i * 3 + 2] = 0;
    }

    // Walk line
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.walkPositions), 3));

    // Per-vertex colors based on pi digit
    const colors = new Float32Array(totalPts * 3);
    for (let i = 0; i < totalPts; i++) {
      const digit = i === 0 ? 3 : parseInt(PiWalkElement.PI_DIGITS[Math.min(i - 1, this.stepCount - 1)], 10);
      let col: THREE.Color;
      switch (this.colorMode) {
        case 0: // gradient along walk
          col = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, i / totalPts);
          break;
        case 1: // digit-based hue
          col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, digit / 9);
          break;
        case 2: // even/odd
          col = digit % 2 === 0 ? this.palette.primary.clone() : this.palette.secondary.clone();
          break;
        default: // prime digits highlighted
          col = [2, 3, 5, 7].includes(digit)
            ? this.palette.primary.clone()
            : this.palette.dim.clone();
          break;
      }
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.walkLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.walkLine);

    // Head point (current position indicator)
    this.headPos = new Float32Array(3);
    this.headPos[0] = this.walkPositions[0];
    this.headPos[1] = this.walkPositions[1];
    this.headPos[2] = 1;
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3));
    this.headPoint = new THREE.Points(headGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: 6,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.headPoint);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress += dt * this.revealSpeed;
    if (this.revealProgress > 1) this.revealProgress = 0; // loop

    const totalPts = this.stepCount + 1;
    const visibleCount = Math.floor(this.revealProgress * totalPts);
    this.walkLine.geometry.setDrawRange(0, visibleCount);

    // Update head position
    if (visibleCount > 0) {
      const idx = Math.min(visibleCount - 1, totalPts - 1);
      this.headPos[0] = this.walkPositions[idx * 3];
      this.headPos[1] = this.walkPositions[idx * 3 + 1];
      this.headPos[2] = 1;
      (this.headPoint.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    (this.walkLine.material as THREE.LineBasicMaterial).opacity = opacity * this.trailOpacity;
    (this.headPoint.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.revealProgress = 0;
      this.colorMode = (this.colorMode + 1) % 4;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      this.revealSpeed = 0.08 + level * 0.04;
    }
    if (level >= 5) {
      this.revealProgress = 0;
    }
  }
}
