import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Two spinning tape reels like a reel-to-reel tape recorder.
 * Reels have spokes, hubs, and a tape line connecting them.
 * Variants: small reels, large reels, with tape counter, fast-forward mode.
 */
export class TapeReelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tape-reel',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private reelLeft!: THREE.Line[];    // [outerRim, innerHub, ...spokes]
  private reelRight!: THREE.Line[];
  private tapeLine!: THREE.Line;
  private counterDots!: THREE.Points | null;

  private variant: number = 0;
  private spokeCount: number = 6;
  private reelRadius: number = 0;
  private hubRadius: number = 0;
  private leftAngle: number = 0;
  private rightAngle: number = 0;
  private leftSpeed: number = 0;
  private rightSpeed: number = 0;
  private tapePoints: number = 24;
  private fastForward: boolean = false;
  private counterValue: number = 0;
  private alertMode: boolean = false;

  private buildReel(cx: number, cy: number, outerR: number, innerR: number, spokes: number, color: THREE.Color): THREE.Line[] {
    const lines: THREE.Line[] = [];
    const segs = 64;

    // Outer rim
    const rimPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      rimPos[i * 3] = cx + Math.cos(a) * outerR;
      rimPos[i * 3 + 1] = cy + Math.sin(a) * outerR;
      rimPos[i * 3 + 2] = 1;
    }
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.BufferAttribute(rimPos, 3));
    lines.push(new THREE.Line(rimGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })));

    // Inner hub
    const hubPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      hubPos[i * 3] = cx + Math.cos(a) * innerR;
      hubPos[i * 3 + 1] = cy + Math.sin(a) * innerR;
      hubPos[i * 3 + 2] = 1;
    }
    const hubGeo = new THREE.BufferGeometry();
    hubGeo.setAttribute('position', new THREE.BufferAttribute(hubPos, 3));
    lines.push(new THREE.Line(hubGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })));

    // Spokes (pre-allocated, will update in tick)
    const spokeVerts = new Float32Array(spokes * 2 * 3);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      spokeVerts[i * 6 + 0] = cx + Math.cos(a) * innerR;
      spokeVerts[i * 6 + 1] = cy + Math.sin(a) * innerR;
      spokeVerts[i * 6 + 2] = 1;
      spokeVerts[i * 6 + 3] = cx + Math.cos(a) * outerR;
      spokeVerts[i * 6 + 4] = cy + Math.sin(a) * outerR;
      spokeVerts[i * 6 + 5] = 1;
    }
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', new THREE.BufferAttribute(spokeVerts, 3));
    lines.push(new THREE.LineSegments(spokeGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })) as unknown as THREE.Line);

    return lines;
  }

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: small reels, slow
      { reelScale: 0.22, hubratio: 0.28, spokes: 5, speedMin: 0.6, speedMax: 1.2, counter: false, ff: false },
      // 1: large reels, medium speed
      { reelScale: 0.30, hubratio: 0.25, spokes: 6, speedMin: 1.2, speedMax: 2.0, counter: false, ff: false },
      // 2: medium reels with tape counter
      { reelScale: 0.25, hubratio: 0.30, spokes: 4, speedMin: 0.8, speedMax: 1.5, counter: true, ff: false },
      // 3: fast-forward mode
      { reelScale: 0.24, hubratio: 0.26, spokes: 6, speedMin: 3.0, speedMax: 5.0, counter: false, ff: true },
    ];
    const p = presets[this.variant];

    const maxDim = Math.min(w, h);
    this.reelRadius = maxDim * p.reelScale;
    this.hubRadius = this.reelRadius * p.hubratio;
    this.spokeCount = p.spokes;
    this.fastForward = p.ff;

    // Left reel center
    const lcx = x + w * 0.28;
    const lcy = y + h * 0.52;
    // Right reel center
    const rcx = x + w * 0.72;
    const rcy = y + h * 0.52;

    // Left reel spins faster (supply reel gets smaller as tape plays)
    this.leftSpeed = this.rng.float(p.speedMin, p.speedMax) * (this.fastForward ? 2.5 : 1.0);
    this.rightSpeed = this.rng.float(p.speedMin * 0.7, p.speedMax * 0.8) * (this.fastForward ? 2.5 : 1.0);
    this.leftAngle = this.rng.float(0, Math.PI * 2);
    this.rightAngle = this.rng.float(0, Math.PI * 2);

    // Build reels
    this.reelLeft = this.buildReel(lcx, lcy, this.reelRadius, this.hubRadius, this.spokeCount, this.palette.primary);
    this.reelRight = this.buildReel(rcx, rcy, this.reelRadius, this.hubRadius, this.spokeCount, this.palette.secondary);

    for (const line of this.reelLeft) this.group.add(line);
    for (const line of this.reelRight) this.group.add(line);

    // Tape line connecting the two reels (catenary-style path)
    const tapePos = new Float32Array(this.tapePoints * 3);
    const tapeGeo = new THREE.BufferGeometry();
    tapeGeo.setAttribute('position', new THREE.BufferAttribute(tapePos, 3));
    this.tapeLine = new THREE.Line(tapeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tapeLine);

    // Optional tape counter (dots representing tape position)
    this.counterDots = null;
    if (p.counter) {
      const dotCount = 12;
      const dotPos = new Float32Array(dotCount * 3);
      // Row of dots at bottom of element
      for (let i = 0; i < dotCount; i++) {
        dotPos[i * 3] = x + w * 0.2 + (w * 0.6 / (dotCount - 1)) * i;
        dotPos[i * 3 + 1] = y + h * 0.88;
        dotPos[i * 3 + 2] = 1;
      }
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
      this.counterDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
        size: 3,
        sizeAttenuation: false,
      }));
      this.group.add(this.counterDots);
    }
  }

  private updateSpokes(lines: THREE.Line[], cx: number, cy: number, angle: number): void {
    // lines[2] is the spoke LineSegments
    const spokeObj = lines[2] as unknown as THREE.LineSegments;
    const pos = spokeObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.spokeCount; i++) {
      const a = angle + (i / this.spokeCount) * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      pos.setXYZ(i * 2, cx + cosA * this.hubRadius, cy + sinA * this.hubRadius, 1);
      pos.setXYZ(i * 2 + 1, cx + cosA * this.reelRadius, cy + sinA * this.reelRadius, 1);
    }
    pos.needsUpdate = true;
  }

  private updateRimHub(lines: THREE.Line[], cx: number, cy: number, scale: number): void {
    const segs = 64;
    // Rim is lines[0], hub is lines[1]
    for (let li = 0; li < 2; li++) {
      const r = li === 0 ? this.reelRadius * scale : this.hubRadius;
      const pos = lines[li].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pos.setXYZ(i, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1);
      }
      pos.needsUpdate = true;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const speedMul = this.alertMode ? 2.5 : 1.0;
    this.leftAngle += this.leftSpeed * speedMul * dt;
    this.rightAngle -= this.rightSpeed * speedMul * dt; // opposite direction

    this.counterValue = (this.counterValue + dt * (this.fastForward ? 0.4 : 0.12)) % 1.0;

    const lcx = x + w * 0.28;
    const lcy = y + h * 0.52;
    const rcx = x + w * 0.72;
    const rcy = y + h * 0.52;

    // Animate reel scale slightly (tape winding/unwinding)
    const leftScale = 1.0 + Math.sin(time * 0.3) * 0.05;
    const rightScale = 1.0 - Math.sin(time * 0.3) * 0.05;

    this.updateRimHub(this.reelLeft, lcx, lcy, leftScale);
    this.updateRimHub(this.reelRight, rcx, rcy, rightScale);
    this.updateSpokes(this.reelLeft, lcx, lcy, this.leftAngle);
    this.updateSpokes(this.reelRight, rcx, rcy, this.rightAngle);

    // Tape line: two straight runs from each reel to a guide post in the middle,
    // with a slight sag using catenary approximation
    const tapePos = this.tapeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sag = h * 0.08 * (this.fastForward ? 0.4 : 1.0);
    for (let i = 0; i < this.tapePoints; i++) {
      const t = i / (this.tapePoints - 1);
      const tx = lcx + (rcx - lcx) * t;
      // Catenary-ish sag: parabola shape
      const sagY = Math.sin(t * Math.PI) * sag;
      const ty = lcy + (rcy - lcy) * t + sagY;
      tapePos.setXYZ(i, tx, ty, 0.5);
    }
    tapePos.needsUpdate = true;

    // Apply opacities
    const reelSets = [this.reelLeft, this.reelRight];
    const reelOpacities = [0.85, 0.85];

    for (let ri = 0; ri < 2; ri++) {
      for (const line of reelSets[ri]) {
        (line.material as THREE.LineBasicMaterial).opacity = opacity * reelOpacities[ri];
      }
    }
    (this.tapeLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;

    if (this.counterDots) {
      const dotMat = this.counterDots.material as THREE.PointsMaterial;
      // Counter fill: dots up to counterValue index are bright, rest are dim
      const dotCount = this.counterDots.geometry.getAttribute('position').count;
      const filled = Math.floor(this.counterValue * dotCount);
      dotMat.color.copy(filled > dotCount * 0.8 ? this.palette.alert : this.palette.primary);
      dotMat.opacity = opacity * 0.7;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Reels spin in wrong directions briefly
      this.leftSpeed *= -3;
      this.rightSpeed *= -3;
      setTimeout(() => {
        this.leftSpeed = Math.abs(this.leftSpeed) / 3;
        this.rightSpeed = Math.abs(this.rightSpeed) / 3;
      }, 400);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      return;
    }
    if (level >= 4) {
      this.alertMode = true;
    }
    if (level >= 5) {
      // Max speed burst
      for (const line of this.reelLeft) {
        (line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }
}
