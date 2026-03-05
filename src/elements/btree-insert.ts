import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface BNode { keys: number[]; children: number[]; x: number; y: number; tx: number; ty: number; hl: number; }

/** B-tree insertion with node splits. Canvas rendered with key boxes and child edges. */
export class BtreeInsertElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'btree-insert',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private ns: BNode[] = []; private root = -1; private order = 3;
  private iTimer = 0; private iInterval = 1.2; private sMult = 1;
  private iCount = 0; private maxI = 15; private rTimer = 0; private lastK = -1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { order: 3, interval: 1.2, max: 15 }, { order: 4, interval: 0.7, max: 20 },
      { order: 3, interval: 2.0, max: 10 }, { order: 5, interval: 0.5, max: 25 },
    ];
    const p = ps[v]; this.order = p.order; this.iInterval = p.interval; this.maxI = p.max;
    this.ns = []; this.root = -1;
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
    if (this.rTimer > 0 && (this.rTimer -= ed) <= 0) { this.ns = []; this.root = -1; this.iCount = 0; this.lastK = -1; }
    this.iTimer += ed;
    if (this.iTimer >= this.iInterval && this.rTimer <= 0) {
      this.iTimer -= this.iInterval;
      if (this.iCount < this.maxI) {
        const k = this.rng.int(1, 99); this.ins(k); this.lastK = k; this.iCount++; this.lay(cw, ch);
      } else { this.rTimer = this.rng.float(2, 4); this.iCount = 0; }
    }
    for (const n of this.ns) { n.x += (n.tx - n.x) * dt * 5; n.y += (n.ty - n.y) * dt * 5; if (n.hl > 0) n.hl -= dt; }

    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    const sR = Math.floor(this.palette.secondary.r * 255), sG = Math.floor(this.palette.secondary.g * 255), sB = Math.floor(this.palette.secondary.b * 255);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = 4; const hH = Math.min(14, ch * 0.08);
    ctx.fillStyle = pri; ctx.font = `${Math.min(10, hH - 2)}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`B-TREE (ORD ${this.order})`, m, m + hH / 2);
    if (this.lastK >= 0) { ctx.textAlign = 'right'; ctx.fillStyle = sec; ctx.fillText(`INS:${this.lastK}`, cw - m, m + hH / 2); }
    const kW = Math.min(20, (cw - 20) / (this.order + 1)); const nH = Math.min(20, ch * 0.12);
    // edges
    for (const nd of this.ns) {
      if (!nd.children.length) continue;
      const pcx = nd.x + (nd.keys.length * kW) / 2; const pby = nd.y + nH;
      for (const ci of nd.children) {
        if (ci < 0 || ci >= this.ns.length) continue;
        const c = this.ns[ci]; ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.4)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pcx, pby); ctx.lineTo(c.x + (c.keys.length * kW) / 2, c.y); ctx.stroke();
      }
    }
    // nodes
    for (const nd of this.ns) {
      const nw = nd.keys.length * kW; const hl = nd.hl > 0;
      ctx.fillStyle = hl ? `rgba(${sR},${sG},${sB},0.3)` : `rgba(${pR},${pG},${pB},0.15)`;
      ctx.fillRect(nd.x, nd.y, nw, nH);
      ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.6)`; ctx.lineWidth = hl ? 2 : 1; ctx.strokeRect(nd.x, nd.y, nw, nH);
      for (let k = 0; k < nd.keys.length; k++) {
        const kx = nd.x + k * kW;
        if (k > 0) { ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.3)`; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(kx, nd.y); ctx.lineTo(kx, nd.y + nH); ctx.stroke(); }
        ctx.fillStyle = pri; ctx.font = `${Math.min(10, nH - 6)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${nd.keys[k]}`, kx + kW / 2, nd.y + nH / 2);
      }
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private ins(key: number): void {
    if (this.root < 0) { this.ns.push({ keys: [key], children: [], x: 0, y: 0, tx: 0, ty: 0, hl: 0.8 }); this.root = 0; return; }
    this.insNode(this.root, key);
    if (this.ns[this.root].keys.length >= this.order) this.splitRoot();
  }

  private insNode(i: number, key: number): void {
    const nd = this.ns[i]; nd.hl = 0.6;
    if (!nd.children.length) { let p = 0; while (p < nd.keys.length && nd.keys[p] < key) p++; nd.keys.splice(p, 0, key); return; }
    let p = 0; while (p < nd.keys.length && nd.keys[p] < key) p++;
    this.insNode(nd.children[p], key);
    if (this.ns[nd.children[p]].keys.length >= this.order) this.splitChild(i, p);
  }

  private splitChild(pi: number, cp: number): void {
    const par = this.ns[pi]; const ch = this.ns[par.children[cp]];
    const mi = Math.floor(ch.keys.length / 2); const mk = ch.keys[mi];
    const rn: BNode = { keys: ch.keys.splice(mi + 1), children: ch.children.length ? ch.children.splice(mi + 1) : [],
      x: ch.x + 40, y: ch.y, tx: ch.x + 40, ty: ch.y, hl: 0.8 };
    ch.keys.splice(mi, 1);
    const ni = this.ns.length; this.ns.push(rn);
    par.keys.splice(cp, 0, mk); par.children.splice(cp + 1, 0, ni); par.hl = 0.8;
  }

  private splitRoot(): void {
    const nd = this.ns[this.root]; const mi = Math.floor(nd.keys.length / 2); const mk = nd.keys[mi];
    const ln: BNode = { keys: nd.keys.slice(0, mi), children: nd.children.length ? nd.children.slice(0, mi + 1) : [],
      x: nd.x, y: nd.y + 30, tx: nd.x, ty: nd.y + 30, hl: 0.8 };
    const rn: BNode = { keys: nd.keys.slice(mi + 1), children: nd.children.length ? nd.children.slice(mi + 1) : [],
      x: nd.x + 40, y: nd.y + 30, tx: nd.x + 40, ty: nd.y + 30, hl: 0.8 };
    const li = this.ns.length; this.ns.push(ln); const ri = this.ns.length; this.ns.push(rn);
    nd.keys = [mk]; nd.children = [li, ri]; nd.hl = 0.8;
  }

  private lay(cw: number, ch: number): void {
    if (this.root < 0) return;
    const m = 10; const hH = 20; const lH = Math.min(40, (ch - hH - m * 2) / 4);
    const kW = Math.min(20, (cw - 20) / (this.order + 1));
    const go = (i: number, lv: number, l: number, r: number): void => {
      if (i < 0 || i >= this.ns.length) return;
      const n = this.ns[i]; const cx = (l + r) / 2;
      n.tx = cx - (n.keys.length * kW) / 2; n.ty = hH + m + lv * lH;
      if (n.children.length) { const cW = (r - l) / n.children.length;
        for (let c = 0; c < n.children.length; c++) go(n.children[c], lv + 1, l + c * cW, l + (c + 1) * cW); }
    };
    go(this.root, 0, m, cw - m);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { for (const n of this.ns) { for (let k = 0; k < n.keys.length; k++) n.keys[k] = this.rng.int(0, 99); n.hl = 0.5; } }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.5;
  }
}
