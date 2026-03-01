import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Mission clock with large HH:MM:SS.mmm digits, blinking colon, and sweep indicator.
 * Canvas-based text rendering.
 */
export class ClockDisplayElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private sweepLine!: THREE.Line;
  private missionTime: number = 0;
  private colonVisible: boolean = true;
  private colonTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private timeScale: number = 1;
  private label: string = '';

  build(): void {
    const { x, y, w, h } = this.px;
    this.missionTime = this.rng.float(0, 86400); // random start within 24h
    this.timeScale = this.rng.pick([1, 1, 1, 10, 60]);
    this.label = this.rng.pick(['MISSION TIME', 'ELAPSED', 'T+', 'SYSTEM CLOCK', 'UTC']);

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Sweep indicator (seconds progress bar at bottom)
    const sweepGeo = new THREE.BufferGeometry();
    const sweepPos = new Float32Array([x, y + 2, 2, x, y + 2, 2]);
    sweepGeo.setAttribute('position', new THREE.BufferAttribute(sweepPos, 3));
    this.sweepLine = new THREE.Line(sweepGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.sweepLine);

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
    const { x, y, w, h } = this.px;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    this.missionTime += dt * this.timeScale;

    // Blink colon
    this.colonTimer += dt;
    if (this.colonTimer >= 0.5) {
      this.colonTimer = 0;
      this.colonVisible = !this.colonVisible;
    }

    // Sweep indicator — fraction of current second
    const secFrac = (this.missionTime % 1);
    const sweepPos = this.sweepLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    sweepPos.setX(1, x + w * secFrac);
    sweepPos.needsUpdate = true;
    (this.sweepLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Render canvas at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = this.missionTime;
    const hours = Math.floor(t / 3600) % 100;
    const mins = Math.floor((t % 3600) / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);

    const colon = this.colonVisible || this.glitchTimer > 0 ? ':' : ' ';
    const timeStr = `${String(hours).padStart(2, '0')}${colon}${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Time display with phosphor glow
    const bigSize = Math.floor(canvas.height * 0.45);
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.glitchTimer > 0) {
      const garbled = timeStr.split('').map((c, i) =>
        Math.sin(i * 17 + this.glitchTimer * 40) > 0.5
          ? String.fromCharCode(33 + ((c.charCodeAt(0) * 7) % 60))
          : c
      ).join('');
      drawGlowText(ctx, garbled, canvas.width / 2, canvas.height * 0.45, '#' + this.palette.secondary.getHexString(), 10);
    } else {
      drawGlowText(ctx, timeStr, canvas.width / 2, canvas.height * 0.45, primaryHex, 8);
    }

    // Label with subtle glow
    const smallSize = Math.floor(canvas.height * 0.15);
    ctx.font = `${smallSize}px monospace`;
    drawGlowText(ctx, this.label, canvas.width / 2, canvas.height * 0.8, dimHex, 2);

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.08, this.missionTime);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.missionTime = 0; // Reset timer on alert
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
