import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface LLNode { value: number; x: number; tx: number; y: number; ty: number; alpha: number; hl: number; }

/** Linked list visualization with insert, delete, reverse animations. Canvas rendered. */
export class LinkedListOpElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'linked-list-op',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private nodes: LLNode[] = []; private opTimer = 0; private opInterval = 1.5;
  private maxN = 8; private nextVal = 0; private nW = 40; private nH = 24;
  private sMult = 1; private opLabel = ''; private lblTimer = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { interval: 1.5, max: 8, nW: 40, nH: 24 }, { interval: 0.8, max: 12, nW: 32, nH: 20 },
      { interval: 2.5, max: 5, nW: 50, nH: 30 }, { interval: 0.6, max: 10, nW: 36, nH: 22 },
    ];
    const p = ps[v]; this.opInterval = p.interval; this.maxN = p.max;
    this.nW = Math.min(p.nW, (w - 20) / (p.max + 1)); this.nH = Math.min(p.nH, h * 0.25);
    for (let i = 0; i < Math.min(4, this.maxN); i++) this.nodes.push({ value: this.nextVal++, x: 0, tx: 0, y: 0, ty: 0, alpha: 0, hl: 0.8 });
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w)); this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0); this.group.add(this.mesh);
    this.layout();
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { width: cw, height: ch } = this.canvas; const ctx = this.ctx;
    this.opTimer += dt * this.sMult;
    if (this.opTimer >= this.opInterval) { this.opTimer -= this.opInterval; this.doOp(); }
    if (this.lblTimer > 0) this.lblTimer -= dt;
    for (const n of this.nodes) { n.x += (n.tx - n.x) * dt * 6; n.y += (n.ty - n.y) * dt * 6; n.alpha = Math.min(1, n.alpha + dt * 4); if (n.hl > 0) n.hl -= dt; }

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = 4; const hH = Math.min(14, ch * 0.1);
    ctx.fillStyle = pri; ctx.font = `${Math.min(10, hH - 2)}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('LINKED LIST', m, m + hH / 2);
    ctx.textAlign = 'right'; ctx.fillText(`LEN:${this.nodes.length}`, cw - m, m + hH / 2);
    if (this.lblTimer > 0 && this.opLabel) { ctx.fillStyle = sec; ctx.textAlign = 'center'; ctx.fillText(this.opLabel, cw / 2, m + hH / 2); }
    // HEAD label
    if (this.nodes.length > 0) {
      const f = this.nodes[0]; ctx.fillStyle = dim; ctx.font = `${Math.min(8, 9)}px monospace`; ctx.textAlign = 'center';
      ctx.fillText('HEAD', f.x + this.nW / 2, f.y - 8);
    }
    // Arrows
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i], b = this.nodes[i + 1]; const sx = a.x + this.nW; const sy = a.y + this.nH / 2; const ex = b.x; const ey = b.y + this.nH / 2;
      ctx.strokeStyle = `rgba(${pR},${pG},${pB},${(Math.min(a.alpha, b.alpha) * 0.6).toFixed(2)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      const an = Math.atan2(ey - sy, ex - sx);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 5 * Math.cos(an - 0.4), ey - 5 * Math.sin(an - 0.4));
      ctx.moveTo(ex, ey); ctx.lineTo(ex - 5 * Math.cos(an + 0.4), ey - 5 * Math.sin(an + 0.4)); ctx.stroke();
    }
    // NULL
    if (this.nodes.length > 0) {
      const l = this.nodes[this.nodes.length - 1]; ctx.fillStyle = dim; ctx.font = `${Math.min(8, 9)}px monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('NULL', l.x + this.nW + 6, l.y + this.nH / 2);
    }
    // Node boxes
    for (const n of this.nodes) {
      const a = n.alpha; const hl = n.hl > 0;
      ctx.fillStyle = hl ? `rgba(${sR},${sG},${sB},${(a * 0.35).toFixed(2)})` : `rgba(${pR},${pG},${pB},${(a * 0.2).toFixed(2)})`;
      ctx.fillRect(n.x, n.y, this.nW, this.nH);
      ctx.strokeStyle = `rgba(${pR},${pG},${pB},${(a * 0.7).toFixed(2)})`; ctx.lineWidth = hl ? 2 : 1;
      ctx.strokeRect(n.x, n.y, this.nW, this.nH);
      const dv = n.x + this.nW * 0.65; ctx.beginPath(); ctx.moveTo(dv, n.y); ctx.lineTo(dv, n.y + this.nH); ctx.stroke();
      ctx.fillStyle = `rgba(${pR},${pG},${pB},${a.toFixed(2)})`; ctx.font = `${Math.min(10, this.nH - 6)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${n.value}`, n.x + this.nW * 0.325, n.y + this.nH / 2);
      ctx.beginPath(); ctx.arc(dv + (this.nW * 0.35) / 2, n.y + this.nH / 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pR},${pG},${pB},${(a * 0.5).toFixed(2)})`; ctx.fill();
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private layout(): void {
    const cw = this.canvas ? this.canvas.width : this.px.w; const ch = this.canvas ? this.canvas.height : this.px.h;
    const sp = Math.min(this.nW + 16, (cw - 16) / Math.max(1, this.nodes.length));
    const by = 20 + (ch - 20) / 2 - this.nH / 2;
    for (let i = 0; i < this.nodes.length; i++) { this.nodes[i].tx = 8 + i * sp; this.nodes[i].ty = by; }
  }

  private doOp(): void {
    const op = this.rng.int(0, 4);
    if (op === 0 && this.nodes.length < this.maxN) {
      const nd: LLNode = { value: this.nextVal++, x: -this.nW, tx: 0, y: this.px.h / 2, ty: 0, alpha: 0, hl: 0.8 };
      this.nodes.unshift(nd); this.layout(); this.opLabel = 'INS HEAD'; this.lblTimer = 1.2;
    } else if (op === 1 && this.nodes.length < this.maxN) {
      const nd: LLNode = { value: this.nextVal++, x: this.px.w, tx: 0, y: this.px.h / 2, ty: 0, alpha: 0, hl: 0.8 };
      this.nodes.push(nd); this.layout(); this.opLabel = 'INS TAIL'; this.lblTimer = 1.2;
    } else if (op === 2 && this.nodes.length > 2) {
      this.nodes.shift(); this.layout(); this.opLabel = 'DEL HEAD'; this.lblTimer = 1.2;
    } else if (op === 3 && this.nodes.length > 2) {
      const i = this.rng.int(1, this.nodes.length - 1); this.nodes.splice(i, 1); this.layout(); this.opLabel = `DEL[${i}]`; this.lblTimer = 1.2;
    } else if (this.nodes.length >= 2) {
      this.nodes.reverse(); this.layout(); for (const n of this.nodes) n.hl = 0.6; this.opLabel = 'REVERSE'; this.lblTimer = 1.2;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { for (const n of this.nodes) { n.value = this.rng.int(0, 99); n.hl = 0.5; } this.opLabel = 'CORRUPT'; this.lblTimer = 1; }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.4;
  }
}
