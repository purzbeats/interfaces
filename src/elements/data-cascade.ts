import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Matrix-style cascading data columns with horizontal scan bands.
 * Characters rain downward at different speeds per column.
 */
export class DataCascadeElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private scanBands!: THREE.LineSegments;
  private columns: number = 0;
  private rows: number = 0;
  private drops: number[] = [];
  private speeds: number[] = [];
  private chars: string = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF';
  private renderAccum: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const charSize = Math.max(10, Math.floor(Math.min(w, h) / 50));
    this.columns = Math.max(3, Math.floor(w / charSize));
    this.rows = Math.max(3, Math.floor(h / charSize));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.columns * charSize;
    this.canvas.height = this.rows * charSize;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    for (let c = 0; c < this.columns; c++) {
      this.drops.push(this.rng.float(-this.rows, 0));
      this.speeds.push(this.rng.float(4, 18));
    }

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Horizontal scan bands
    const bandVerts: number[] = [];
    const bandCount = this.rng.int(2, 5);
    for (let i = 0; i < bandCount; i++) {
      const by = y + (h / (bandCount + 1)) * (i + 1);
      bandVerts.push(x, by, 2, x + w, by, 2);
    }
    const bandGeo = new THREE.BufferGeometry();
    bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bandVerts, 3));
    this.scanBands = new THREE.LineSegments(bandGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scanBands);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Advance drops
    for (let c = 0; c < this.columns; c++) {
      this.drops[c] += dt * this.speeds[c];
      if (this.drops[c] > this.rows + 5) {
        this.drops[c] = this.rng.float(-8, -2);
        this.speeds[c] = this.rng.float(4, 18);
      }
    }

    // Render at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 18) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;

    // Scan bands oscillate
    const bandOpacity = opacity * (0.1 + Math.sin(time * 2) * 0.08);
    (this.scanBands.material as THREE.LineBasicMaterial).opacity = bandOpacity;
  }

  private renderCanvas(_time: number): void {
    const { ctx, canvas } = this;
    const charW = canvas.width / this.columns;
    const charH = canvas.height / this.rows;

    // Fade existing content (trail effect)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${Math.floor(charH * 0.85)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const isGlitching = this.glitchTimer > 0;

    for (let c = 0; c < this.columns; c++) {
      const headRow = Math.floor(this.drops[c]);
      if (headRow < 0 || headRow >= this.rows) continue;

      // Head character — brightest
      const ch = this.chars[Math.floor(Math.random() * this.chars.length)];
      ctx.fillStyle = isGlitching ? ('#' + this.palette.alert.getHexString()) : primaryHex;
      ctx.fillText(ch, c * charW + charW / 2, headRow * charH + charH / 2);

      // Trail — dimmer characters behind the head
      for (let t = 1; t < 6; t++) {
        const trailRow = headRow - t;
        if (trailRow < 0 || trailRow >= this.rows) continue;
        const trailCh = this.chars[Math.floor(Math.random() * this.chars.length)];
        ctx.fillStyle = dimHex;
        ctx.globalAlpha = 0.6 - t * 0.08;
        ctx.fillText(trailCh, c * charW + charW / 2, trailRow * charH + charH / 2);
        ctx.globalAlpha = 1;
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let c = 0; c < this.columns; c++) {
        this.speeds[c] = this.rng.float(15, 40);
      }
      this.emitAudio('seekSound', 120);
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
