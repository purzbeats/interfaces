import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface StackFrame { label: string; arg: number; ty: number; cy: number; alpha: number; popping: boolean; }

/** Recursive call stack visualization. Frames push/pop with animation. Canvas rendered. */
export class StackRecurseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stack-recurse',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private frames: StackFrame[] = []; private sTimer = 0; private sInterval = 0.7;
  private maxD = 8; private curD = 0; private phase: 'push' | 'pop' = 'push';
  private fn = 'fact'; private startArg = 7; private sMult = 1; private pauseT = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { fn: 'fact', d: 8, int: 0.7, arg: 7 }, { fn: 'fib', d: 10, int: 0.4, arg: 6 },
      { fn: 'pow', d: 6, int: 1.0, arg: 5 },  { fn: 'gcd', d: 12, int: 0.35, arg: 89 },
    ];
    const p = ps[v]; this.fn = p.fn; this.maxD = p.d; this.sInterval = p.int; this.startArg = p.arg;
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
    if (this.pauseT > 0) { this.pauseT -= ed; if (this.pauseT <= 0) { this.frames = []; this.curD = 0; this.phase = 'push'; } }
    this.sTimer += ed;
    if (this.sTimer >= this.sInterval && this.pauseT <= 0) {
      this.sTimer -= this.sInterval;
      if (this.phase === 'push') {
        if (this.curD < this.maxD) {
          const arg = this.fn === 'gcd' ? (this.curD === 0 ? this.startArg : Math.max(1, Math.floor(this.startArg / (this.curD + 1)))) : this.startArg - this.curD;
          this.frames.push({ label: `${this.fn}(${arg})`, arg, ty: 0, cy: -30, alpha: 0, popping: false });
          this.curD++;
        } else this.phase = 'pop';
      } else {
        if (this.frames.length > 0) this.frames[this.frames.length - 1].popping = true;
        else this.pauseT = this.rng.float(1.5, 3);
      }
    }
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.popping) { f.alpha -= dt * 3; f.cy -= dt * 60; if (f.alpha <= 0) this.frames.splice(i, 1); }
      else { f.cy += (f.ty - f.cy) * dt * 8; f.alpha = Math.min(1, f.alpha + dt * 4); }
    }

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = Math.max(2, cw * 0.02); const hH = ch * 0.1; const fH = Math.max(8, (ch - hH - m * 3) / this.maxD);
    const fW = cw - m * 4;
    // Header
    ctx.fillStyle = pri; ctx.font = `${Math.max(6, Math.floor(hH - 2))}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('CALL STACK', m, m + hH / 2);
    ctx.textAlign = 'right'; ctx.fillText(`DEPTH:${this.frames.length}/${this.maxD}`, cw - m, m + hH / 2);
    // Stack base
    const sBase = ch - m;
    ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m, sBase); ctx.lineTo(cw - m, sBase); ctx.stroke();
    ctx.fillStyle = dim; ctx.font = `${Math.max(6, Math.floor(hH * 0.7))}px monospace`; ctx.textAlign = 'left'; ctx.fillText('SP', m, sBase - hH * 0.25);
    // Frames
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i]; const baseY = sBase - (i + 1) * fH; const animY = baseY + (f.cy - f.ty);
      const a = Math.max(0, f.alpha); const isTop = i === this.frames.length - 1;
      ctx.fillStyle = (isTop && !f.popping) ? `rgba(${sR},${sG},${sB},${(a * 0.3).toFixed(2)})` : `rgba(${pR},${pG},${pB},${(a * 0.2).toFixed(2)})`;
      ctx.fillRect(m * 2, animY, fW, fH - 2);
      ctx.strokeStyle = `rgba(${pR},${pG},${pB},${(a * 0.6).toFixed(2)})`; ctx.lineWidth = 1; ctx.strokeRect(m * 2, animY, fW, fH - 2);
      ctx.fillStyle = `rgba(${pR},${pG},${pB},${a.toFixed(2)})`; ctx.font = `${Math.max(6, Math.floor(fH - 6))}px monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(f.label, m * 2 + fH * 0.2, animY + (fH - 2) / 2);
      ctx.textAlign = 'right'; ctx.fillStyle = `rgba(${pR},${pG},${pB},${(a * 0.4).toFixed(2)})`;
      ctx.font = `${Math.max(6, Math.floor(fH * 0.5))}px monospace`; ctx.fillText(`ret:0x${((i + 1) * 0x10).toString(16)}`, m * 2 + fW - m, animY + (fH - 2) / 2);
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      while (this.frames.length < this.maxD) {
        const arg = this.fn === 'gcd' ? Math.max(1, Math.floor(this.startArg / (this.curD + 1))) : this.startArg - this.curD;
        this.frames.push({ label: `${this.fn}(${arg})`, arg, ty: 0, cy: this.rng.float(-50, -20), alpha: this.rng.float(0.2, 0.8), popping: false });
        this.curD++;
      }
      this.phase = 'pop';
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.5;
  }
}
