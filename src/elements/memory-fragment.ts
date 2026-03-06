import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MemBlock { start: number; size: number; color: number; age: number; ttl: number; }

/** Memory allocation/fragmentation visualization. Canvas rendered bar of used/free regions. */
export class MemoryFragmentElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'memory-fragment',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private blocks: MemBlock[] = []; private allocTimer = 0; private allocInterval = 0.6;
  private maxBlocks = 30; private minBS = 0.02; private maxBS = 0.12; private sMult = 1; private gcFlash = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { int: 0.6, max: 30, min: 0.02, mx: 0.12 }, { int: 0.3, max: 50, min: 0.01, mx: 0.08 },
      { int: 1.0, max: 15, min: 0.05, mx: 0.20 }, { int: 0.4, max: 40, min: 0.015, mx: 0.06 },
    ];
    const p = ps[v]; this.allocInterval = p.int; this.maxBlocks = p.max; this.minBS = p.min; this.maxBS = p.mx;
    for (let i = 0; i < 5; i++) this.tryAlloc();
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w)); this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.minFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0); this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { width: cw, height: ch } = this.canvas; const ctx = this.ctx; const ed = dt * this.sMult;
    for (const b of this.blocks) b.age += ed;
    this.blocks = this.blocks.filter(b => b.age < b.ttl);
    this.allocTimer += ed;
    if (this.allocTimer >= this.allocInterval) { this.allocTimer -= this.allocInterval; this.tryAlloc(); }
    if (this.gcFlash > 0) this.gcFlash -= dt;
    const sorted = [...this.blocks].sort((a, b) => a.start - b.start);

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    const rgbs = [[pR, pG, pB], [sR, sG, sB], [(pR + sR) >> 1, (pG + sG) >> 1, (pB + sB) >> 1], [pR, pG, Math.min(255, pB + 50)]];
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = Math.max(2, cw * 0.02); const hH = ch * 0.1; const barH = Math.max(8, (ch - hH - m * 4) * 0.4);
    const barY = hH + m * 2; const barW = cw - m * 2;
    // Header
    ctx.fillStyle = pri; ctx.font = `${Math.max(6, Math.floor(hH - 2))}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('MEMORY MAP', m, m + hH / 2);
    const usedPct = this.blocks.reduce((s, b) => s + b.size, 0);
    let gaps = 0; { let pos = 0; for (const b of sorted) { if (b.start - pos > 0.005) gaps++; pos = b.start + b.size; } if (1 - pos > 0.005) gaps++; }
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(usedPct * 100)}% USED  FRAG:${gaps}`, cw - m, m + hH / 2);
    // Bar bg
    ctx.fillStyle = dim; ctx.fillRect(m, barY, barW, barH);
    // Blocks
    for (const b of sorted) {
      const bx = m + b.start * barW; const bw = b.size * barW; const rgb = rgbs[b.color % 4];
      const a = 0.3 + 0.5 * (1 - b.age / b.ttl);
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(2)})`; ctx.fillRect(bx, barY + 1, Math.max(1, bw), barH - 2);
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(a + 0.2).toFixed(2)})`; ctx.lineWidth = 0.5;
      ctx.strokeRect(bx, barY + 1, Math.max(1, bw), barH - 2);
    }
    // GC flash
    if (this.gcFlash > 0) { ctx.fillStyle = `rgba(${sR},${sG},${sB},${(this.gcFlash * 0.5).toFixed(2)})`; ctx.fillRect(m, barY, barW, barH); }
    // Address markers
    const addrFont = Math.max(6, Math.floor(hH * 0.7));
    ctx.fillStyle = dim; ctx.font = `${addrFont}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) ctx.fillText(`0x${(i * 0x4000).toString(16).toUpperCase()}`, m + (barW * i) / 4, barY + barH + 2);
    // Detail rows
    const detRowH = Math.max(4, ch * 0.04);
    const detY = barY + barH + m * 2 + addrFont + 2; const rowC = Math.min(6, Math.floor((ch - detY - m) / detRowH)); const rowSlice = 1 / Math.max(1, rowC);
    for (let r = 0; r < rowC; r++) {
      const ry = detY + r * detRowH; const rS = r * rowSlice; const rE = rS + rowSlice;
      ctx.fillStyle = bg; ctx.fillRect(m, ry, barW, detRowH - 1);
      for (const b of sorted) {
        if (b.start + b.size < rS || b.start > rE) continue;
        const cs = Math.max(b.start, rS) - rS; const ce = Math.min(b.start + b.size, rE) - rS;
        const rgb = rgbs[b.color % 4]; ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.4)`;
        ctx.fillRect(m + (cs / rowSlice) * barW, ry, Math.max(1, ((ce - cs) / rowSlice) * barW), detRowH - 1);
      }
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private tryAlloc(): void {
    if (this.blocks.length >= this.maxBlocks) return;
    const size = this.rng.float(this.minBS, this.maxBS);
    const sorted = [...this.blocks].sort((a, b) => a.start - b.start);
    let pos = 0; let start = -1;
    for (const b of sorted) { if (b.start - pos >= size) { start = pos; break; } pos = b.start + b.size; }
    if (start < 0 && 1 - pos >= size) start = pos;
    if (start < 0) return;
    this.blocks.push({ start, size, color: this.rng.int(0, 3), age: 0, ttl: this.rng.float(2, 10) });
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      const n = Math.floor(this.blocks.length / 2);
      for (let i = 0; i < n; i++) { const idx = this.rng.int(0, this.blocks.length - 1); this.blocks.splice(idx, 1); }
      this.gcFlash = 1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.5;
  }
}
