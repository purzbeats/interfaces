import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Bioreactor vessel HUD element with rising bubbles, rotating impeller,
 * diffuser grate, and gauge readout panel showing pH / O2 / TEMP.
 */
export class BioReactorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bio-reactor',
    meta: {
      shape: 'rectangular',
      roles: ['gauge', 'data-display'],
      moods: ['diagnostic', 'tactical'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  /* ---- sub-objects ---- */
  private vesselLines!: THREE.LineSegments;
  private bubblePoints!: THREE.Points;
  private impellerLine!: THREE.Line;
  private gaugeMesh!: THREE.Mesh;
  private diffuserLines!: THREE.LineSegments;

  /* ---- canvas / texture ---- */
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;

  /* ---- bubble pool (parallel Float32Arrays) ---- */
  private bubbleX!: Float32Array;
  private bubbleY!: Float32Array;
  private bubbleVx!: Float32Array;
  private bubbleVy!: Float32Array;
  private bubbleSize!: Float32Array;
  private bubbleActive!: Uint8Array;
  private bubbleCount: number = 60;

  /* ---- variant params ---- */
  private impellerArms: number = 2;
  private impellerRPM: number = 30;
  private riseMin: number = 30;
  private riseMax: number = 60;
  private bubbleSizeMin: number = 2;
  private bubbleSizeMax: number = 5;
  private spawnRate: number = 20;
  private thickWalls: boolean = false;

  /* ---- animation state ---- */
  private impellerAngle: number = 0;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 10;
  private gaugeCanvasW: number = 0;
  private gaugeCanvasH: number = 0;

  /* ---- intensity state ---- */
  private intensityLevel: number = 0;
  private boilOver: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { bubbles: 60,  riseMin: 30,  riseMax: 60,  arms: 2, rpm: 30,  sizeMin: 2, sizeMax: 5, thick: false, spawn: 20 },  // Standard
      { bubbles: 120, riseMin: 80,  riseMax: 120, arms: 4, rpm: 90,  sizeMin: 2, sizeMax: 4, thick: false, spawn: 50 },  // Vigorous
      { bubbles: 30,  riseMin: 20,  riseMax: 40,  arms: 2, rpm: 15,  sizeMin: 3, sizeMax: 6, thick: false, spawn: 8  },  // Gentle
      { bubbles: 80,  riseMin: 80,  riseMax: 120, arms: 3, rpm: 60,  sizeMin: 2, sizeMax: 5, thick: true,  spawn: 35 },  // Industrial
    ];
    const p = presets[variant];

    this.bubbleCount = p.bubbles;
    this.riseMin = p.riseMin;
    this.riseMax = p.riseMax;
    this.impellerArms = p.arms;
    this.impellerRPM = p.rpm;
    this.bubbleSizeMin = p.sizeMin;
    this.bubbleSizeMax = p.sizeMax;
    this.thickWalls = p.thick;
    this.spawnRate = p.spawn;

    const { x, y, w, h } = this.px;

    // ---- vessel region: left 70%, gauge: right 30% ----
    const vesselW = w * 0.7;

    // ---- 1. Vessel walls (U-shape) ----
    this.buildVessel(x, y, vesselW, h);

    // ---- 2. Bubbles (pre-allocated pool) ----
    this.buildBubbles(x, y, vesselW, h);

    // ---- 3. Impeller ----
    this.buildImpeller(x, y, vesselW, h);

    // ---- 4. Gauge readout (canvas texture) ----
    this.buildGauge(x + vesselW, y, w - vesselW, h);

    // ---- 5. Diffuser grate ----
    this.buildDiffuser(x, y, vesselW);
  }

  /* ======== BUILD helpers ======== */

  private buildVessel(vx: number, vy: number, vw: number, vh: number): void {
    const verts: number[] = [];
    const margin = 4;
    const left = vx + margin;
    const right = vx + vw - margin;
    const bottom = vy + margin;
    const top = vy + vh - margin;

    // U-shape: top-left down, across bottom, up to top-right
    // Left wall
    verts.push(left, top, 0, left, bottom, 0);
    // Bottom-left corner
    verts.push(left, bottom, 0, left + (right - left) * 0.15, bottom, 0);
    // Bottom segments
    verts.push(left + (right - left) * 0.15, bottom, 0, left + (right - left) * 0.35, bottom, 0);
    verts.push(left + (right - left) * 0.35, bottom, 0, left + (right - left) * 0.5, bottom, 0);
    verts.push(left + (right - left) * 0.5, bottom, 0, left + (right - left) * 0.65, bottom, 0);
    verts.push(left + (right - left) * 0.65, bottom, 0, left + (right - left) * 0.85, bottom, 0);
    verts.push(left + (right - left) * 0.85, bottom, 0, right, bottom, 0);
    // Right wall
    verts.push(right, bottom, 0, right, top, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.vesselLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.vesselLines);

    // Industrial variant: draw walls twice offset for thickness
    if (this.thickWalls) {
      const offset = 2;
      const thickVerts: number[] = [];
      thickVerts.push(left - offset, top, 0, left - offset, bottom - offset, 0);
      thickVerts.push(left - offset, bottom - offset, 0, right + offset, bottom - offset, 0);
      thickVerts.push(right + offset, bottom - offset, 0, right + offset, top, 0);
      const thickGeo = new THREE.BufferGeometry();
      thickGeo.setAttribute('position', new THREE.Float32BufferAttribute(thickVerts, 3));
      const thickLines = new THREE.LineSegments(thickGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(thickLines);
    }
  }

  private buildBubbles(vx: number, vy: number, vw: number, vh: number): void {
    this.bubbleX = new Float32Array(this.bubbleCount);
    this.bubbleY = new Float32Array(this.bubbleCount);
    this.bubbleVx = new Float32Array(this.bubbleCount);
    this.bubbleVy = new Float32Array(this.bubbleCount);
    this.bubbleSize = new Float32Array(this.bubbleCount);
    this.bubbleActive = new Uint8Array(this.bubbleCount);

    const margin = 8;
    const left = vx + margin;
    const right = vx + vw - margin;
    const bottom = vy + margin;

    // Spawn all inactive initially, then activate a batch
    for (let i = 0; i < this.bubbleCount; i++) {
      this.bubbleActive[i] = 0;
    }
    // Pre-spawn ~60% spread throughout the vessel
    const preSpawn = Math.floor(this.bubbleCount * 0.6);
    for (let i = 0; i < preSpawn; i++) {
      this.spawnBubble(i, left, right, bottom, vh, true);
    }

    // Points geometry
    const positions = new Float32Array(this.bubbleCount * 3);
    const colors = new Float32Array(this.bubbleCount * 3);
    const sizes = new Float32Array(this.bubbleCount);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    this.bubblePoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
      size: 3,
    }));
    this.group.add(this.bubblePoints);
  }

  private spawnBubble(
    i: number,
    left: number, right: number, bottom: number, vh: number,
    randomY: boolean = false,
  ): void {
    const diffuserCenter = (left + right) / 2;
    const spread = (right - left) * 0.4;
    this.bubbleX[i] = diffuserCenter + this.rng.float(-spread, spread);
    this.bubbleY[i] = randomY ? bottom + this.rng.float(0, vh * 0.7) : bottom + this.rng.float(0, vh * 0.05);
    this.bubbleVx[i] = this.rng.float(-8, 8);
    this.bubbleVy[i] = this.rng.float(this.riseMin, this.riseMax);
    this.bubbleSize[i] = this.rng.float(this.bubbleSizeMin, this.bubbleSizeMax);
    this.bubbleActive[i] = 1;
  }

  private buildImpeller(vx: number, vy: number, vw: number, vh: number): void {
    // Pre-allocate: center + arm tip for each arm (2 vertices per arm)
    const maxVerts = this.impellerArms * 2 * 3;
    const positions = new Float32Array(maxVerts);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.impellerLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.impellerLine);

    // Set initial angle
    this.impellerAngle = this.rng.float(0, Math.PI * 2);
  }

  private buildGauge(gx: number, gy: number, gw: number, gh: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.gaugeCanvasW = Math.floor(gw * dpr);
    this.gaugeCanvasH = Math.floor(gh * dpr);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gaugeCanvasW;
    this.canvas.height = this.gaugeCanvasH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(gw, gh);
    this.gaugeMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.gaugeMesh.position.set(gx + gw / 2, gy + gh / 2, 1);
    this.group.add(this.gaugeMesh);
  }

  private buildDiffuser(vx: number, vy: number, vw: number): void {
    const margin = 8;
    const left = vx + margin;
    const right = vx + vw - margin;
    const bottom = vy + margin;
    const grateY = bottom + 4;

    const lineCount = 4;
    const totalSpan = (right - left) * 0.6;
    const startX = left + (right - left) * 0.2;
    const segLen = totalSpan / (lineCount + 1);

    const verts: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const sx = startX + segLen * (i + 0.5);
      const ex = sx + segLen * 0.6;
      verts.push(sx, grateY, 0, ex, grateY, 0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.diffuserLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.diffuserLines);
  }

  /* ======== UPDATE ======== */

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const vesselW = w * 0.7;
    const margin = 8;
    const left = x + margin;
    const right = x + vesselW - margin;
    const bottom = y + margin;
    const liquidSurface = y + h * 0.85; // bubbles disappear near top

    // ---- Update bubbles ----
    this.updateBubbles(dt, left, right, bottom, h, liquidSurface);

    // ---- Update impeller ----
    this.updateImpeller(dt, x, y, vesselW, h);

    // ---- Update gauge readout ----
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderGauge(time);
    }

    // ---- Set opacities ----
    (this.vesselLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.bubblePoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.impellerLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.gaugeMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.diffuserLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  private updateBubbles(
    dt: number,
    left: number, right: number, bottom: number,
    vh: number, liquidSurface: number,
  ): void {
    const positions = this.bubblePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.bubblePoints.geometry.getAttribute('color') as THREE.BufferAttribute;

    const primary = this.boilOver ? this.palette.alert : this.palette.primary;
    let activeCount = 0;

    // Spawn new bubbles
    const effectiveRate = this.spawnRate * (1 + this.intensityLevel * 0.3);
    const toSpawn = Math.floor(effectiveRate * dt + (this.rng.chance(effectiveRate * dt % 1) ? 1 : 0));
    let spawned = 0;

    for (let i = 0; i < this.bubbleCount; i++) {
      if (this.bubbleActive[i]) {
        // Sinusoidal horizontal wobble
        this.bubbleX[i] += Math.sin(this.bubbleY[i] * 0.05 + this.bubbleVx[i]) * 15 * dt;
        this.bubbleY[i] += this.bubbleVy[i] * dt;

        // Clamp horizontal to vessel bounds
        if (this.bubbleX[i] < left) this.bubbleX[i] = left;
        if (this.bubbleX[i] > right) this.bubbleX[i] = right;

        // Check if bubble reached surface
        if (this.bubbleY[i] >= liquidSurface) {
          // Respawn at bottom
          if (this.boilOver) {
            // Boil-over: spawn everywhere
            this.bubbleX[i] = left + this.rng.float(0, right - left);
            this.bubbleY[i] = bottom + this.rng.float(0, (liquidSurface - bottom) * 0.8);
            this.bubbleVy[i] = this.rng.float(this.riseMin * 1.5, this.riseMax * 2);
          } else {
            this.spawnBubble(i, left, right, bottom, vh * 0.7);
          }
        }

        // Color with slight per-bubble variation
        const variation = 0.85 + (i % 7) * 0.025;
        colors.setXYZ(i, primary.r * variation, primary.g * variation, primary.b * variation);
        positions.setXYZ(i, this.bubbleX[i], this.bubbleY[i], 1);
        activeCount++;
      } else if (spawned < toSpawn) {
        // Spawn in inactive slot
        this.spawnBubble(i, left, right, bottom, vh * 0.7, this.boilOver);
        positions.setXYZ(i, this.bubbleX[i], this.bubbleY[i], 1);
        colors.setXYZ(i, primary.r, primary.g, primary.b);
        spawned++;
        activeCount++;
      } else {
        // Inactive: hide offscreen
        positions.setXYZ(i, 0, 0, -10);
        colors.setXYZ(i, 0, 0, 0);
      }
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;

    // Use setDrawRange so inactive bubbles at end aren't drawn
    this.bubblePoints.geometry.setDrawRange(0, this.bubbleCount);
  }

  private updateImpeller(dt: number, vx: number, vy: number, vw: number, vh: number): void {
    const effectiveRPM = this.impellerRPM * (1 + this.intensityLevel * 0.2);
    const radiansPerSec = (effectiveRPM / 60) * Math.PI * 2;
    this.impellerAngle += radiansPerSec * dt;

    const cx = vx + vw / 2;
    const cy = vy + vh / 2;
    const armLen = Math.min(vw, vh) * 0.2;

    const pos = this.impellerLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    let idx = 0;
    for (let a = 0; a < this.impellerArms; a++) {
      const angle = this.impellerAngle + (a * Math.PI * 2) / this.impellerArms;
      const tipX = cx + Math.cos(angle) * armLen;
      const tipY = cy + Math.sin(angle) * armLen;
      // Center to tip
      pos.setXYZ(idx++, cx, cy, 1);
      pos.setXYZ(idx++, tipX, tipY, 1);
    }
    pos.needsUpdate = true;
  }

  private renderGauge(time: number): void {
    const { ctx, canvas, gaugeCanvasW: cw, gaugeCanvasH: ch } = this;
    ctx.clearRect(0, 0, cw, ch);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();

    const fontSize = Math.max(8, Math.floor(ch * 0.06));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';

    // Cycling gauge values
    const cycle = time * 0.3;
    const ph = (7.1 + Math.sin(cycle) * 0.3).toFixed(1);
    const o2 = Math.floor(92 + Math.sin(cycle * 1.3) * 7);
    const temp = (37.0 + Math.sin(cycle * 0.7) * 0.5).toFixed(1);

    const isAlert = this.boilOver;
    const valueColor = isAlert ? alertHex : primaryHex;
    const labelColor = dimHex;

    const lineHeight = fontSize * 2.2;
    const labelX = cw * 0.08;
    const valueX = cw * 0.08;
    let yPos = ch * 0.12;

    // Title
    drawGlowText(ctx, 'BIOREACTOR', labelX, yPos, dimHex, 3);
    yPos += lineHeight * 1.2;

    // pH
    drawGlowText(ctx, 'pH', labelX, yPos, labelColor, 2);
    yPos += fontSize * 1.2;
    drawGlowText(ctx, isAlert ? 'ERR' : ph, valueX, yPos, valueColor, 4);
    yPos += lineHeight;

    // O2
    drawGlowText(ctx, `O\u2082 %`, labelX, yPos, labelColor, 2);
    yPos += fontSize * 1.2;
    drawGlowText(ctx, isAlert ? '!!!' : `${o2}`, valueX, yPos, valueColor, 4);
    yPos += lineHeight;

    // TEMP
    drawGlowText(ctx, `TEMP \u00B0C`, labelX, yPos, labelColor, 2);
    yPos += fontSize * 1.2;
    drawGlowText(ctx, isAlert ? 'HI' : temp, valueX, yPos, valueColor, 4);
    yPos += lineHeight;

    // Status line
    const status = isAlert ? 'BOIL-OVER' : 'NOMINAL';
    drawGlowText(ctx, status, labelX, yPos, isAlert ? alertHex : dimHex, isAlert ? 6 : 2);

    // Scanlines
    applyScanlines(ctx, canvas, 0.1, time);

    this.texture.needsUpdate = true;
  }

  /* ======== INTENSITY ======== */

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.boilOver = false;
      return;
    }

    if (level >= 5) {
      this.boilOver = true;
      // Activate all bubbles for boil-over
      const { x, y, w, h } = this.px;
      const vesselW = w * 0.7;
      const margin = 8;
      const left = x + margin;
      const right = x + vesselW - margin;
      const bottom = y + margin;
      for (let i = 0; i < this.bubbleCount; i++) {
        if (!this.bubbleActive[i]) {
          this.spawnBubble(i, left, right, bottom, h * 0.7, true);
        }
        // Speed up existing bubbles
        this.bubbleVy[i] = this.rng.float(this.riseMin * 1.5, this.riseMax * 2);
      }
    } else {
      this.boilOver = false;
    }
  }

  /* ======== DISPOSE ======== */

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
