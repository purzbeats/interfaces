import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface HashItem { key: number; alpha: number; hl: number; }

/** Hash table with collision chains. Animate insertions into buckets. Canvas rendered. */
export class HashCollisionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hash-collision',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private bucketCount = 7; private buckets: HashItem[][] = [];
  private iTimer = 0; private iInterval = 0.8; private maxItems = 20; private total = 0;
  private sMult = 1; private lastK = -1; private lastB = -1; private rTimer = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { b: 7, int: 0.8, max: 20 }, { b: 11, int: 0.4, max: 35 },
      { b: 5, int: 1.5, max: 12 }, { b: 8, int: 0.5, max: 28 },
    ];
    const p = ps[v]; this.bucketCount = p.b; this.iInterval = p.int; this.maxItems = p.max;
    this.buckets = []; for (let i = 0; i < this.bucketCount; i++) this.buckets.push([]);
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
    if (this.rTimer > 0 && (this.rTimer -= ed) <= 0) { for (const b of this.buckets) b.length = 0; this.total = 0; this.lastK = -1; this.lastB = -1; }
    this.iTimer += ed;
    if (this.iTimer >= this.iInterval && this.rTimer <= 0) {
      this.iTimer -= this.iInterval;
      if (this.total < this.maxItems) {
        const k = this.rng.int(0, 999); const b = k % this.bucketCount;
        this.buckets[b].push({ key: k, alpha: 0, hl: 1 }); this.total++; this.lastK = k; this.lastB = b;
      } else this.rTimer = this.rng.float(2, 4);
    }
    for (const b of this.buckets) for (const it of b) { it.alpha = Math.min(1, it.alpha + dt * 4); if (it.hl > 0) it.hl -= dt * 2; }

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = 4; const hH = Math.min(14, ch * 0.08);
    ctx.fillStyle = pri; ctx.font = `${Math.min(10, hH - 2)}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('HASH TABLE', m, m + hH / 2);
    ctx.textAlign = 'right'; ctx.fillText(`LF:${(this.total / this.bucketCount).toFixed(2)} N:${this.total}`, cw - m, m + hH / 2);
    if (this.lastK >= 0) { ctx.fillStyle = sec; ctx.textAlign = 'center'; ctx.font = `${Math.min(9, hH - 3)}px monospace`;
      ctx.fillText(`h(${this.lastK})=${this.lastK}%${this.bucketCount}=${this.lastB}`, cw / 2, m + hH + 8); }
    const topY = hH + m * 2 + 14; const bW = Math.min(40, (cw - m * 2) / this.bucketCount - 4);
    const sp = (cw - m * 2) / this.bucketCount; const itH = Math.min(16, (ch - topY) / 8);
    for (let b = 0; b < this.bucketCount; b++) {
      const bx = m + b * sp; const by = topY; const isAct = b === this.lastB;
      ctx.fillStyle = isAct ? `rgba(${sR},${sG},${sB},0.3)` : `rgba(${pR},${pG},${pB},0.1)`;
      ctx.fillRect(bx, by, bW, itH); ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.5)`; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bW, itH);
      ctx.fillStyle = pri; ctx.font = `${Math.min(9, itH - 4)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`[${b}]`, bx + bW / 2, by + itH / 2);
      const chain = this.buckets[b];
      for (let i = 0; i < chain.length; i++) {
        const it = chain[i]; const iy = by + (i + 1) * (itH + 2); const a = it.alpha;
        // Arrow
        ctx.strokeStyle = `rgba(${pR},${pG},${pB},${(a * 0.4).toFixed(2)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + bW / 2, iy - 2); ctx.lineTo(bx + bW / 2, iy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + bW / 2 - 3, iy - 3); ctx.lineTo(bx + bW / 2, iy); ctx.lineTo(bx + bW / 2 + 3, iy - 3); ctx.stroke();
        // Box
        const hl = it.hl > 0;
        ctx.fillStyle = hl ? `rgba(${sR},${sG},${sB},${(a * 0.35).toFixed(2)})` : `rgba(${pR},${pG},${pB},${(a * 0.2).toFixed(2)})`;
        ctx.fillRect(bx, iy, bW, itH);
        ctx.strokeStyle = `rgba(${pR},${pG},${pB},${(a * 0.6).toFixed(2)})`; ctx.lineWidth = hl ? 1.5 : 0.5; ctx.strokeRect(bx, iy, bW, itH);
        ctx.fillStyle = `rgba(${pR},${pG},${pB},${a.toFixed(2)})`; ctx.font = `${Math.min(8, itH - 4)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${it.key}`, bx + bW / 2, iy + itH / 2);
      }
      if (chain.length > 0) { const ny = by + (chain.length + 1) * (itH + 2);
        if (ny < ch - m) { ctx.fillStyle = dim; ctx.font = `${Math.min(7, 8)}px monospace`; ctx.textAlign = 'center'; ctx.fillText('nil', bx + bW / 2, ny); } }
    }
    let coll = 0; for (const b of this.buckets) if (b.length > 1) coll += b.length - 1;
    ctx.fillStyle = dim; ctx.font = `${Math.min(8, 9)}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`COLLISIONS:${coll}`, m, ch - m);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      const all: HashItem[] = []; for (const b of this.buckets) { all.push(...b); b.length = 0; }
      for (const it of all) { it.hl = 0.8; this.buckets[this.rng.int(0, this.bucketCount - 1)].push(it); }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.5;
  }
}
