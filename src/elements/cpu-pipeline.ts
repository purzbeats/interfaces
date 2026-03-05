import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Instruction { stage: number; color: number; stall: boolean; stallTimer: number; id: number; }

/** CPU instruction pipeline visualization. 4-5 stages with bubbles/stalls. Canvas rendered. */
export class CpuPipelineElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cpu-pipeline',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private stageCount = 5; private stageNames = ['IF', 'ID', 'EX', 'MEM', 'WB'];
  private insts: Instruction[] = []; private cycleTimer = 0; private cycleInterval = 0.8;
  private nextId = 0; private maxInst = 8; private stallChance = 0.15; private sMult = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { stages: 5, cycle: 0.8, max: 8, stall: 0.15 }, { stages: 5, cycle: 0.4, max: 12, stall: 0.25 },
      { stages: 4, cycle: 1.2, max: 6, stall: 0.08 }, { stages: 5, cycle: 0.5, max: 10, stall: 0.35 },
    ];
    const p = ps[v]; this.stageCount = p.stages; this.cycleInterval = p.cycle; this.maxInst = p.max; this.stallChance = p.stall;
    if (p.stages === 4) this.stageNames = ['IF', 'ID', 'EX', 'WB'];
    for (let i = 0; i < Math.min(this.stageCount, 3); i++)
      this.insts.push({ stage: i, color: this.rng.int(0, 3), stall: false, stallTimer: 0, id: this.nextId++ });
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w)); this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0); this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { width: cw, height: ch } = this.canvas; const ctx = this.ctx;
    this.cycleTimer += dt * this.sMult;
    if (this.cycleTimer >= this.cycleInterval) { this.cycleTimer -= this.cycleInterval; this.advance(); }

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    const dR = Math.floor(this.palette.dim.r * 255), dG = Math.floor(this.palette.dim.g * 255), dB = Math.floor(this.palette.dim.b * 255);
    const rgbs = [[pR, pG, pB], [sR, sG, sB], [dR, dG, dB], [pR, pG, pB]];
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = 4; const hH = Math.min(18, ch * 0.12); const sW = (cw - m * 2) / this.stageCount;
    const rowH = Math.max(12, (ch - hH - m * 3) / this.maxInst);
    // Headers
    ctx.font = `${Math.min(11, hH - 2)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let s = 0; s < this.stageCount; s++) {
      const sx = m + s * sW; ctx.fillStyle = dim; ctx.fillRect(sx + 1, m, sW - 2, hH);
      ctx.fillStyle = pri; ctx.fillText(this.stageNames[s], sx + sW / 2, m + hH / 2);
    }
    // Grid
    ctx.strokeStyle = dim; ctx.lineWidth = 0.5;
    for (let s = 0; s <= this.stageCount; s++) { const lx = m + s * sW; ctx.beginPath(); ctx.moveTo(lx, m); ctx.lineTo(lx, ch - m); ctx.stroke(); }
    // Instructions by stage
    const byS: Instruction[][] = Array.from({ length: this.stageCount }, () => []);
    for (const inst of this.insts) if (inst.stage >= 0 && inst.stage < this.stageCount) byS[inst.stage].push(inst);
    for (let s = 0; s < this.stageCount; s++) {
      const sx = m + s * sW;
      for (let r = 0; r < byS[s].length; r++) {
        const inst = byS[s][r]; const iy = hH + m * 2 + r * rowH; const rgb = rgbs[inst.color % 4];
        if (inst.stall) {
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.15)`; ctx.fillRect(sx + 3, iy, sW - 6, rowH - 2);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.4)`; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(sx + 5, iy + 2); ctx.lineTo(sx + sW - 5, iy + rowH - 4);
          ctx.moveTo(sx + sW - 5, iy + 2); ctx.lineTo(sx + 5, iy + rowH - 4); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`; ctx.fillRect(sx + 3, iy, sW - 6, rowH - 2);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`; ctx.lineWidth = 1; ctx.strokeRect(sx + 3, iy, sW - 6, rowH - 2);
        }
        ctx.fillStyle = pri; ctx.font = `${Math.min(9, rowH - 4)}px monospace`; ctx.textAlign = 'center';
        ctx.fillText(`I${inst.id}`, sx + sW / 2, iy + rowH / 2);
      }
    }
    // Utilization bar
    const barY = ch - m - 6; const active = this.insts.filter(i => !i.stall).length;
    ctx.fillStyle = dim; ctx.fillRect(m, barY, cw - m * 2, 4);
    ctx.fillStyle = pri; ctx.fillRect(m, barY, (cw - m * 2) * Math.min(1, active / this.stageCount), 4);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private advance(): void {
    this.insts = this.insts.filter(i => i.stage < this.stageCount);
    for (const inst of this.insts) {
      if (inst.stall) { inst.stallTimer--; if (inst.stallTimer <= 0) inst.stall = false; continue; }
      inst.stage++;
      if (inst.stage < this.stageCount && this.rng.next() < this.stallChance) { inst.stall = true; inst.stallTimer = this.rng.int(1, 3); }
    }
    if (!this.insts.some(i => i.stage === 0) && this.insts.length < this.maxInst)
      this.insts.push({ stage: 0, color: this.rng.int(0, 3), stall: false, stallTimer: 0, id: this.nextId++ });
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { for (const inst of this.insts) { inst.stall = true; inst.stallTimer = this.rng.int(2, 5); } }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.4;
  }
}
