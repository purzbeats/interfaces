import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Dalí-esque melting clock — standard clock face that progressively droops
 * downward, then resets. Tick marks elongate, hands bend at endpoints.
 */
export class ClockMeltElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'clock-melt',
    meta: { shape: 'radial', roles: ['decorative', 'data-display'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'bass' },
  };
  private faceLine!: THREE.Line;
  private markLines!: THREE.LineSegments;
  private handLines!: THREE.LineSegments;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  // Base positions for droop displacement
  private faceBaseY: Float32Array = new Float32Array(0);
  private markBaseX: Float32Array = new Float32Array(0);
  private markBaseY: Float32Array = new Float32Array(0);
  private faceBaseX: Float32Array = new Float32Array(0);
  // Melt state
  private meltProgress: number = 0;
  private meltMax: number = 0;
  private meltSpeed: number = 0;
  private meltCycleDuration: number = 0;
  private cycleTimer: number = 0;
  private melting: boolean = true;
  private hFragmented: boolean = false;
  // Clock time
  private clockTime: number = 0;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { meltMax: 0.6,  meltSpeed: 0.08, cycleMin: 8,  cycleMax: 16, fragmented: false }, // Classic Melt
      { meltMax: 0.9,  meltSpeed: 0.20, cycleMin: 4,  cycleMax: 8,  fragmented: false }, // Rapid Decay
      { meltMax: 0.4,  meltSpeed: 0.03, cycleMin: 15, cycleMax: 25, fragmented: false }, // Slow Ooze
      { meltMax: 0.7,  meltSpeed: 0.12, cycleMin: 6,  cycleMax: 12, fragmented: true },  // Fragmented
    ];
    const p = presets[variant];

    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.40;
    this.meltMax = p.meltMax * this.radius;
    this.meltSpeed = p.meltSpeed;
    this.meltCycleDuration = this.rng.float(p.cycleMin, p.cycleMax);
    this.hFragmented = p.fragmented;
    this.clockTime = this.rng.float(0, 43200); // random starting time

    // Clock face circle — 64 segments
    const faceSegs = 64;
    const facePos = new Float32Array((faceSegs + 1) * 3);
    this.faceBaseX = new Float32Array(faceSegs + 1);
    this.faceBaseY = new Float32Array(faceSegs + 1);
    for (let i = 0; i <= faceSegs; i++) {
      const a = (i / faceSegs) * Math.PI * 2;
      const px = this.cx + Math.cos(a) * this.radius;
      const py = this.cy + Math.sin(a) * this.radius;
      facePos[i * 3] = px;
      facePos[i * 3 + 1] = py;
      facePos[i * 3 + 2] = 0;
      this.faceBaseX[i] = px;
      this.faceBaseY[i] = py;
    }
    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', new THREE.BufferAttribute(facePos, 3));
    this.faceLine = new THREE.Line(faceGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.faceLine);

    // 12 hour markers — each is 2 vertices (inner to outer)
    const markVerts = new Float32Array(12 * 2 * 3);
    this.markBaseX = new Float32Array(24);
    this.markBaseY = new Float32Array(24);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const isMajor = i % 3 === 0;
      const innerR = this.radius * (isMajor ? 0.80 : 0.88);
      const outerR = this.radius * 0.95;
      const ix = this.cx + Math.cos(a) * innerR;
      const iy = this.cy + Math.sin(a) * innerR;
      const ox = this.cx + Math.cos(a) * outerR;
      const oy = this.cy + Math.sin(a) * outerR;
      markVerts[i * 6] = ix;
      markVerts[i * 6 + 1] = iy;
      markVerts[i * 6 + 2] = 0;
      markVerts[i * 6 + 3] = ox;
      markVerts[i * 6 + 4] = oy;
      markVerts[i * 6 + 5] = 0;
      this.markBaseX[i * 2] = ix;
      this.markBaseY[i * 2] = iy;
      this.markBaseX[i * 2 + 1] = ox;
      this.markBaseY[i * 2 + 1] = oy;
    }
    const markGeo = new THREE.BufferGeometry();
    markGeo.setAttribute('position', new THREE.BufferAttribute(markVerts, 3));
    this.markLines = new THREE.LineSegments(markGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.markLines);

    // 3 clock hands — hour, minute, second (each 2 vertices: center to tip)
    const handVerts = new Float32Array(6 * 3);
    const handGeo = new THREE.BufferGeometry();
    handGeo.setAttribute('position', new THREE.BufferAttribute(handVerts, 3));
    this.handLines = new THREE.LineSegments(handGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.handLines);
  }

  private droop(baseY: number, baseX: number): [number, number] {
    // Vertices below center droop more
    const relY = (baseY - this.cy) / this.radius;
    const droopFactor = Math.max(0, relY + 0.3);
    const yDisp = this.meltProgress * this.meltMax * droopFactor;

    let xDisp = 0;
    if (this.hFragmented) {
      const relX = (baseX - this.cx) / this.radius;
      xDisp = this.meltProgress * this.meltMax * 0.3 * relX * droopFactor;
    }

    return [baseX + xDisp, baseY + yDisp];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.clockTime += dt;

    // Melt cycle
    this.cycleTimer += dt;
    if (this.melting) {
      this.meltProgress = Math.min(1, this.meltProgress + this.meltSpeed * dt);
      if (this.cycleTimer >= this.meltCycleDuration) {
        // Snap back
        this.meltProgress = 0;
        this.cycleTimer = 0;
        this.meltCycleDuration = this.rng.float(4, 20);
      }
    }

    // Apply droop to clock face
    const facePos = this.faceLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.faceBaseX.length; i++) {
      const [dx, dy] = this.droop(this.faceBaseY[i], this.faceBaseX[i]);
      facePos.setXY(i, dx, dy);
    }
    facePos.needsUpdate = true;

    // Apply droop to hour markers
    const markPos = this.markLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.markBaseX.length; i++) {
      const [dx, dy] = this.droop(this.markBaseY[i], this.markBaseX[i]);
      markPos.setXY(i, dx, dy);
    }
    markPos.needsUpdate = true;

    // Clock hands with droop
    const handPos = this.handLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const t = this.clockTime;
    const secAngle = ((t % 60) / 60) * Math.PI * 2 - Math.PI / 2;
    const minAngle = ((t % 3600) / 3600) * Math.PI * 2 - Math.PI / 2;
    const hourAngle = ((t % 43200) / 43200) * Math.PI * 2 - Math.PI / 2;

    const hands = [
      { angle: hourAngle, len: this.radius * 0.5 },
      { angle: minAngle,  len: this.radius * 0.7 },
      { angle: secAngle,  len: this.radius * 0.85 },
    ];

    for (let h = 0; h < 3; h++) {
      const { angle, len } = hands[h];
      // Origin droops from center
      const [ox, oy] = this.droop(this.cy, this.cx);
      // Tip position before droop
      const tipBaseX = this.cx + Math.cos(angle) * len;
      const tipBaseY = this.cy + Math.sin(angle) * len;
      const [tx, ty] = this.droop(tipBaseY, tipBaseX);

      handPos.setXYZ(h * 2,     ox, oy, 1);
      handPos.setXYZ(h * 2 + 1, tx, ty, 1);
    }
    handPos.needsUpdate = true;

    // Colors & opacity
    (this.faceLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.markLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.handLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

    // Alert color for second hand when melting heavily
    if (this.meltProgress > 0.5) {
      (this.handLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    } else {
      (this.handLines.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.meltSpeed += level * 0.02;
    if (level >= 5) {
      this.meltProgress = 1;
      setTimeout(() => { this.meltProgress = 0; }, 1500);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.meltProgress = Math.min(1, this.meltProgress + 0.3);
    }
    if (action === 'alert') {
      this.meltProgress = 1;
      this.pulseTimer = 2.0;
    }
  }
}
