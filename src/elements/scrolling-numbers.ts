import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';

export class ScrollingNumbersElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private columns: number = 0;
  private rows: number = 0;
  private isHex: boolean = false;
  private scrollSpeeds: number[] = [];
  private scrollOffsets: number[] = [];
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 20; // 20fps for canvas (saves perf)

  build(): void {
    const { x, y, w, h } = this.px;
    const charW = 10;
    const charH = 16;
    this.columns = Math.max(2, Math.floor(w / charW));
    this.rows = Math.max(2, Math.floor(h / charH));
    this.isHex = this.rng.chance(0.5);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.columns * charW;
    this.canvas.height = this.rows * charH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    for (let c = 0; c < this.columns; c++) {
      this.scrollSpeeds.push(this.rng.float(3, 30));
      this.scrollOffsets.push(this.rng.float(0, 100));
    }

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

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
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Advance scroll offsets every frame (cheap)
    for (let c = 0; c < this.columns; c++) {
      this.scrollOffsets[c] += dt * this.scrollSpeeds[c];
    }

    // Only re-render canvas texture at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    const charW = canvas.width / this.columns;
    const charH = canvas.height / this.rows;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${Math.floor(charH * 0.8)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();
    const isGlitching = this.glitchTimer > 0;

    for (let c = 0; c < this.columns; c++) {
      for (let r = 0; r < this.rows; r++) {
        const val = Math.floor(this.scrollOffsets[c] + r * 7) % (this.isHex ? 16 : 10);
        let char = this.isHex ? val.toString(16).toUpperCase() : val.toString();

        // Glitch: random character substitution
        if (isGlitching && Math.sin((c * 13 + r * 7) * this.glitchTimer * 30) > 0.6) {
          char = String.fromCharCode(33 + ((val * 7 + c * 3) % 60));
        }

        const bright = (r + Math.floor(this.scrollOffsets[c])) % 4 === 0;
        ctx.fillStyle = isGlitching ? secondaryHex : bright ? primaryHex : dimHex;
        ctx.fillText(char, c * charW + charW / 2, r * charH + charH / 2);
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.4;
    if (action === 'glitch') {
      this.glitchTimer = 0.6;
      for (let c = 0; c < this.columns; c++) {
        this.scrollSpeeds[c] = this.rng.float(15, 80);
      }
      this.emitAudio('seekSound', 150);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
