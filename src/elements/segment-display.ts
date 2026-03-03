import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Seven-segment LED-style 3-4 digit counter.
 * Pure geometry (LineSegments for each segment), spring-driven value.
 */
export class SegmentDisplayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'segment-display',
    meta: { shape: 'rectangular', roles: ['text', 'gauge'], moods: ['tactical'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small', 'needs-medium'] },
  };
  private digitSegments: THREE.LineSegments[] = [];
  private borderLines!: THREE.LineSegments;
  private digitCount: number = 0;
  private value: number = 0;
  private targetValue: number = 0;
  private velocity: number = 0;
  private cycleTimer: number = 0;
  private maxValue: number = 0;
  private label: string = '';
  private labelLines!: THREE.LineSegments;
  private cycleTime: number = 2;
  private springK: number = 8;

  // Seven-segment map: segments 0-6 correspond to standard layout
  // Segment positions relative to digit bounds:
  //  0: top, 1: top-right, 2: bottom-right, 3: bottom
  //  4: bottom-left, 5: top-left, 6: middle
  private static readonly DIGIT_MAP: boolean[][] = [
    [true,  true,  true,  true,  true,  true,  false], // 0
    [false, true,  true,  false, false, false, false], // 1
    [true,  true,  false, true,  true,  false, true],  // 2
    [true,  true,  true,  true,  false, false, true],  // 3
    [false, true,  true,  false, false, true,  true],  // 4
    [true,  false, true,  true,  false, true,  true],  // 5
    [true,  false, true,  true,  true,  true,  true],  // 6
    [true,  true,  true,  false, false, false, false], // 7
    [true,  true,  true,  true,  true,  true,  true],  // 8
    [true,  true,  true,  true,  false, true,  true],  // 9
  ];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { digitPicks: null, cycleTime: 2, springK: 8, labels: ['COUNT', 'RATE', 'FREQ', 'LEVEL', 'LOAD', 'RPM', 'TEMP'] },  // Standard (auto from width)
      { digitPicks: [5, 6], cycleTime: 0.8, springK: 15, labels: ['COUNT', 'FREQ', 'RPM'] },                                // Dense (more digits, fast)
      { digitPicks: [2, 3], cycleTime: 4, springK: 3, labels: ['LEVEL', 'TEMP'] },                                           // Minimal (few digits, slow spring)
      { digitPicks: [3, 4], cycleTime: 1.2, springK: 25, labels: ['FLUX', 'SYNC', 'VOLT'] },                                 // Exotic (stiff spring, snappy)
    ];
    const p = presets[variant];
    this.cycleTime = p.cycleTime;
    this.springK = p.springK;

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.digitCount = p.digitPicks ? this.rng.pick(p.digitPicks) : (w > 100 ? 4 : 3);
    this.maxValue = Math.pow(10, this.digitCount) - 1;
    this.targetValue = this.rng.float(0, this.maxValue);
    this.value = this.targetValue;
    this.label = this.rng.pick(p.labels);

    const padding = w * 0.05;
    const digitSpacing = w * 0.04;
    const totalSpacing = digitSpacing * (this.digitCount - 1);
    const digitW = (w - padding * 2 - totalSpacing) / this.digitCount;
    const digitH = h * 0.7;
    const startY = y + (h - digitH) * 0.35;

    // Create 7-segment geometry for each digit
    for (let d = 0; d < this.digitCount; d++) {
      const dx = x + padding + (digitW + digitSpacing) * d;
      const segments = this.createDigitGeometry(dx, startY, digitW, digitH);
      this.digitSegments.push(segments);
      this.group.add(segments);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);

    // Label at bottom
    const labelY = startY + digitH + 4;
    const labelVerts: number[] = [];
    // Simple underline as label marker
    labelVerts.push(x + padding, labelY, 0, x + w - padding, labelY, 0);
    const labelGeo = new THREE.BufferGeometry();
    labelGeo.setAttribute('position', new THREE.Float32BufferAttribute(labelVerts, 3));
    this.labelLines = new THREE.LineSegments(labelGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.labelLines);
  }

  private createDigitGeometry(dx: number, dy: number, dw: number, dh: number): THREE.LineSegments {
    const sw = dw * 0.15; // segment width offset
    const halfH = dh / 2;
    // 7 segments, each segment = 2 vertices = 6 floats, total 42 floats
    const verts = new Float32Array(7 * 6);

    // Segment 0 - top horizontal
    verts.set([dx + sw, dy + dh, 1, dx + dw - sw, dy + dh, 1], 0);
    // Segment 1 - top right vertical
    verts.set([dx + dw, dy + halfH + sw, 1, dx + dw, dy + dh - sw, 1], 6);
    // Segment 2 - bottom right vertical
    verts.set([dx + dw, dy + sw, 1, dx + dw, dy + halfH - sw, 1], 12);
    // Segment 3 - bottom horizontal
    verts.set([dx + sw, dy, 1, dx + dw - sw, dy, 1], 18);
    // Segment 4 - bottom left vertical
    verts.set([dx, dy + sw, 1, dx, dy + halfH - sw, 1], 24);
    // Segment 5 - top left vertical
    verts.set([dx, dy + halfH + sw, 1, dx, dy + dh - sw, 1], 30);
    // Segment 6 - middle horizontal
    verts.set([dx + sw, dy + halfH, 1, dx + dw - sw, dy + halfH, 1], 36);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Cycle target
    this.cycleTimer += dt;
    if (this.cycleTimer > this.cycleTime) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0, this.maxValue);
    }

    // Spring physics
    const force = (this.targetValue - this.value) * this.springK;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-3 * dt);
    this.value += this.velocity * dt;
    this.value = Math.max(0, Math.min(this.maxValue * 1.1, this.value));

    // Extract digits and update segments
    const displayVal = Math.round(Math.max(0, Math.min(this.maxValue, this.value)));
    const digits = String(displayVal).padStart(this.digitCount, '0').split('').map(Number);

    for (let d = 0; d < this.digitCount; d++) {
      const digit = this.glitchTimer > 0
        ? Math.floor(Math.abs(Math.sin(d * 17 + this.glitchTimer * 40)) * 10)
        : digits[d];
      const map = SegmentDisplayElement.DIGIT_MAP[digit % 10];
      const mat = this.digitSegments[d].material as THREE.LineBasicMaterial;

      // We can't selectively hide segments in a single LineSegments,
      // so we use per-vertex color approach: move off-segments offscreen
      // Actually, simpler: set opacity and redraw all as dim when off
      mat.opacity = opacity * 0.8;
      mat.color.copy(this.glitchTimer > 0 ? this.palette.secondary : this.palette.primary);

      // Update segment visibility by modifying vertex positions
      const pos = this.digitSegments[d].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s < 7; s++) {
        if (!map[s]) {
          // Move off segment to same point (invisible line)
          const x1 = pos.getX(s * 2);
          const y1 = pos.getY(s * 2);
          pos.setXY(s * 2 + 1, x1, y1);
        }
      }
      pos.needsUpdate = true;
    }

    // Need to rebuild non-hidden segments each frame since we collapsed them
    this.rebuildDigitPositions();

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.labelLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  private rebuildDigitPositions(): void {
    const { x, y, w, h } = this.px;
    const padding = w * 0.05;
    const digitSpacing = w * 0.04;
    const totalSpacing = digitSpacing * (this.digitCount - 1);
    const digitW = (w - padding * 2 - totalSpacing) / this.digitCount;
    const digitH = h * 0.7;
    const startY = y + (h - digitH) * 0.35;
    const sw = digitW * 0.15;
    const halfH = digitH / 2;

    const displayVal = Math.round(Math.max(0, Math.min(this.maxValue, this.value)));
    const digits = String(displayVal).padStart(this.digitCount, '0').split('').map(Number);

    for (let d = 0; d < this.digitCount; d++) {
      const digit = this.glitchTimer > 0
        ? Math.floor(Math.abs(Math.sin(d * 17 + this.glitchTimer * 40)) * 10)
        : digits[d];
      const map = SegmentDisplayElement.DIGIT_MAP[digit % 10];
      const dx = x + padding + (digitW + digitSpacing) * d;
      const dy = startY;

      const pos = this.digitSegments[d].geometry.getAttribute('position') as THREE.BufferAttribute;

      // Segment 0 - top horizontal
      if (map[0]) { pos.setXY(0, dx + sw, dy + digitH); pos.setXY(1, dx + digitW - sw, dy + digitH); }
      else { pos.setXY(0, dx + sw, dy + digitH); pos.setXY(1, dx + sw, dy + digitH); }
      // Segment 1 - top right vertical
      if (map[1]) { pos.setXY(2, dx + digitW, dy + halfH + sw); pos.setXY(3, dx + digitW, dy + digitH - sw); }
      else { pos.setXY(2, dx + digitW, dy + halfH + sw); pos.setXY(3, dx + digitW, dy + halfH + sw); }
      // Segment 2 - bottom right vertical
      if (map[2]) { pos.setXY(4, dx + digitW, dy + sw); pos.setXY(5, dx + digitW, dy + halfH - sw); }
      else { pos.setXY(4, dx + digitW, dy + sw); pos.setXY(5, dx + digitW, dy + sw); }
      // Segment 3 - bottom horizontal
      if (map[3]) { pos.setXY(6, dx + sw, dy); pos.setXY(7, dx + digitW - sw, dy); }
      else { pos.setXY(6, dx + sw, dy); pos.setXY(7, dx + sw, dy); }
      // Segment 4 - bottom left vertical
      if (map[4]) { pos.setXY(8, dx, dy + sw); pos.setXY(9, dx, dy + halfH - sw); }
      else { pos.setXY(8, dx, dy + sw); pos.setXY(9, dx, dy + sw); }
      // Segment 5 - top left vertical
      if (map[5]) { pos.setXY(10, dx, dy + halfH + sw); pos.setXY(11, dx, dy + digitH - sw); }
      else { pos.setXY(10, dx, dy + halfH + sw); pos.setXY(11, dx, dy + halfH + sw); }
      // Segment 6 - middle horizontal
      if (map[6]) { pos.setXY(12, dx + sw, dy + halfH); pos.setXY(13, dx + digitW - sw, dy + halfH); }
      else { pos.setXY(12, dx + sw, dy + halfH); pos.setXY(13, dx + sw, dy + halfH); }

      pos.needsUpdate = true;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.targetValue = this.maxValue;
    }
    this.velocity += level * (level >= 3 ? 200 : 100);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocity += this.maxValue * 0.3;
    }
    if (action === 'alert') {
      this.targetValue = this.maxValue;
      this.pulseTimer = 2.0;
    }
  }
}
