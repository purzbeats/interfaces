import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Vertical speed/altitude tape display like a fighter HUD.
 * Scrolling tick LineSegments + canvas labels + fixed center reference marker.
 */
export class FlightLadderElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private centerMarker!: THREE.LineSegments;
  private altitude: number = 0;
  private altitudeTarget: number = 0;
  private altitudeVel: number = 0;
  private speed: number = 0;
  private speedTarget: number = 0;
  private speedVel: number = 0;
  private driftTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.altitude = this.rng.float(5000, 40000);
    this.altitudeTarget = this.altitude;
    this.speed = this.rng.float(200, 600);
    this.speedTarget = this.speed;

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

    // Center reference marker
    const markerVerts = new Float32Array([
      x + w * 0.45, y + h / 2, 2, x + w * 0.48, y + h / 2, 2,
      x + w * 0.52, y + h / 2, 2, x + w * 0.55, y + h / 2, 2,
    ]);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(markerVerts, 3));
    this.centerMarker = new THREE.LineSegments(markerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.centerMarker);
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Drift targets
    this.driftTimer += dt;
    if (this.driftTimer > 3) {
      this.driftTimer = 0;
      this.altitudeTarget += this.rng.float(-2000, 2000);
      this.altitudeTarget = Math.max(0, Math.min(50000, this.altitudeTarget));
      this.speedTarget += this.rng.float(-50, 50);
      this.speedTarget = Math.max(100, Math.min(800, this.speedTarget));
    }

    // Spring physics
    this.altitudeVel += (this.altitudeTarget - this.altitude) * 2 * dt;
    this.altitudeVel *= Math.exp(-1.5 * dt);
    this.altitude += this.altitudeVel * dt;

    this.speedVel += (this.speedTarget - this.speed) * 2 * dt;
    this.speedVel *= Math.exp(-1.5 * dt);
    this.speed += this.speedVel * dt;

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.centerMarker.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const fontSize = Math.max(8, Math.floor(canvas.height * 0.06));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    const halfH = canvas.height / 2;
    const tickSpacing = canvas.height * 0.1;

    // Left tape: Speed
    const speedStep = 20;
    const speedBase = Math.floor(this.speed / speedStep) * speedStep;
    const speedOffset = ((this.speed % speedStep) / speedStep) * tickSpacing;

    ctx.textAlign = 'right';
    for (let i = -6; i <= 6; i++) {
      const ty = halfH + i * tickSpacing + speedOffset;
      const val = speedBase - i * speedStep;
      if (ty < 0 || ty > canvas.height) continue;
      ctx.strokeStyle = dimHex;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.02, ty);
      ctx.lineTo(canvas.width * 0.08, ty);
      ctx.stroke();
      drawGlowText(ctx, String(Math.round(val)), canvas.width * 0.2, ty, dimHex, 2);
    }
    drawGlowText(ctx, 'KTS', canvas.width * 0.2, canvas.height * 0.05, dimHex, 2);

    // Right tape: Altitude
    const altStep = 500;
    const altBase = Math.floor(this.altitude / altStep) * altStep;
    const altOffset = ((this.altitude % altStep) / altStep) * tickSpacing;

    ctx.textAlign = 'left';
    for (let i = -6; i <= 6; i++) {
      const ty = halfH + i * tickSpacing + altOffset;
      const val = altBase - i * altStep;
      if (ty < 0 || ty > canvas.height) continue;
      ctx.strokeStyle = dimHex;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.92, ty);
      ctx.lineTo(canvas.width * 0.98, ty);
      ctx.stroke();
      drawGlowText(ctx, String(Math.round(val)), canvas.width * 0.75, ty, dimHex, 2);
    }
    drawGlowText(ctx, 'ALT', canvas.width * 0.75, canvas.height * 0.05, dimHex, 2);

    // Center readouts
    ctx.textAlign = 'center';
    drawGlowText(ctx, Math.round(this.speed).toString(), canvas.width * 0.25, halfH, primaryHex, 6);
    drawGlowText(ctx, Math.round(this.altitude).toString(), canvas.width * 0.75, halfH, primaryHex, 6);

    applyScanlines(ctx, canvas, 0.06, this.altitude * 0.001);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.altitudeTarget = 0;
      this.speedTarget = 100;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
