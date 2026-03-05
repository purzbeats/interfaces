import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface RBNode {
  key: number; red: boolean; left: number; right: number; parent: number;
  x: number; y: number; tx: number; ty: number; hl: number;
}

/** Red-black tree with colored nodes, rotations, and recoloring. Canvas rendered. */
export class RedBlackTreeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'red-black-tree',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture; private mesh!: THREE.Mesh;
  private ns: RBNode[] = []; private root = -1;
  private iTimer = 0; private iInterval = 1; private sMult = 1;
  private iCount = 0; private maxI = 12; private rTimer = 0; private lastK = -1; private nr = 10;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { interval: 1.0, max: 12, r: 10 }, { interval: 0.5, max: 18, r: 8 },
      { interval: 1.8, max: 8, r: 13 },  { interval: 0.6, max: 15, r: 9 },
    ];
    const p = ps[v]; this.iInterval = p.interval; this.maxI = p.max;
    this.nr = Math.min(p.r, Math.min(w, h) * 0.06);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w));
    this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { width: cw, height: ch } = this.canvas;
    const ctx = this.ctx; const ed = dt * this.sMult;
    if (this.rTimer > 0 && (this.rTimer -= ed) <= 0) { this.ns = []; this.root = -1; this.iCount = 0; this.lastK = -1; }
    this.iTimer += ed;
    if (this.iTimer >= this.iInterval && this.rTimer <= 0) {
      this.iTimer -= this.iInterval;
      if (this.iCount < this.maxI) { const k = this.rng.int(1, 99); this.rbIns(k); this.lastK = k; this.iCount++; this.lay(cw, ch); }
      else this.rTimer = this.rng.float(2, 4);
    }
    for (const n of this.ns) { n.x += (n.tx - n.x) * dt * 5; n.y += (n.ty - n.y) * dt * 5; if (n.hl > 0) n.hl -= dt; }
    ctx.clearRect(0, 0, cw, ch);
    const bg = '#' + this.palette.bg.getHexString(); const pri = '#' + this.palette.primary.getHexString();
    const sec = '#' + this.palette.secondary.getHexString(); const dim = '#' + this.palette.dim.getHexString();
    const pR = Math.floor(this.palette.primary.r * 255), pG = Math.floor(this.palette.primary.g * 255), pB = Math.floor(this.palette.primary.b * 255);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    const m = 4; const hH = Math.min(14, ch * 0.08);
    ctx.fillStyle = pri; ctx.font = `${Math.min(10, hH - 2)}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('RED-BLACK TREE', m, m + hH / 2);
    ctx.textAlign = 'right'; ctx.fillText(`N:${this.ns.length}`, cw - m, m + hH / 2);
    if (this.lastK >= 0) { ctx.fillStyle = sec; ctx.textAlign = 'center'; ctx.fillText(`INS:${this.lastK}`, cw / 2, m + hH / 2); }
    const r = this.nr;
    // edges
    for (const nd of this.ns) {
      for (const ci of [nd.left, nd.right]) {
        if (ci < 0 || ci >= this.ns.length) continue;
        const c = this.ns[ci]; ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.3)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(nd.x, nd.y + r); ctx.lineTo(c.x, c.y - r); ctx.stroke();
      }
    }
    // nodes
    for (const nd of this.ns) {
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      if (nd.red) {
        const rR = Math.min(255, pR + 120), rG = Math.max(0, pG - 60), rB = Math.max(0, pB - 60);
        ctx.fillStyle = `rgba(${rR},${rG},${rB},${nd.hl > 0 ? 0.7 : 0.5})`;
        ctx.strokeStyle = `rgba(${rR},${rG},${rB},0.9)`;
      } else {
        const dR = Math.floor(this.palette.dim.r * 255), dG = Math.floor(this.palette.dim.g * 255), dB = Math.floor(this.palette.dim.b * 255);
        ctx.fillStyle = `rgba(${dR},${dG},${dB},${nd.hl > 0 ? 0.6 : 0.35})`;
        ctx.strokeStyle = `rgba(${pR},${pG},${pB},0.6)`;
      }
      ctx.fill(); ctx.lineWidth = nd.hl > 0 ? 2 : 1; ctx.stroke();
      ctx.fillStyle = nd.red ? '#fff' : pri; ctx.font = `${Math.min(9, r * 1.2)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${nd.key}`, nd.x, nd.y);
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private rbIns(key: number): void {
    const nn: RBNode = { key, red: true, left: -1, right: -1, parent: -1, x: 0, y: 0, tx: 0, ty: 0, hl: 0.8 };
    const idx = this.ns.length; this.ns.push(nn);
    if (this.root < 0) { this.root = idx; nn.red = false; return; }
    let cur = this.root, par = -1;
    while (cur >= 0) { par = cur; cur = key < this.ns[cur].key ? this.ns[cur].left : this.ns[cur].right; }
    nn.parent = par;
    if (key < this.ns[par].key) this.ns[par].left = idx; else this.ns[par].right = idx;
    this.fix(idx);
  }

  private fix(z: number): void {
    let it = 0;
    while (z !== this.root && this.ns[z].red && it++ < 20) {
      const p = this.ns[z].parent; if (p < 0) break;
      const g = this.ns[p].parent; if (g < 0) break;
      const gn = this.ns[g]; const isLeft = p === gn.left; const u = isLeft ? gn.right : gn.left;
      if (u >= 0 && this.ns[u].red) {
        this.ns[p].red = false; this.ns[u].red = false; gn.red = true;
        this.ns[p].hl = this.ns[u].hl = gn.hl = 0.6; z = g;
      } else {
        if (isLeft && z === this.ns[p].right) { z = p; this.rot(z, true); }
        else if (!isLeft && z === this.ns[p].left) { z = p; this.rot(z, false); }
        const p2 = this.ns[z].parent; if (p2 >= 0) { this.ns[p2].red = false; const g2 = this.ns[p2].parent;
          if (g2 >= 0) { this.ns[g2].red = true; this.rot(g2, !isLeft); } } break;
      }
    }
    this.ns[this.root].red = false;
  }

  private rot(xi: number, left: boolean): void {
    const x = this.ns[xi]; const yi = left ? x.right : x.left; if (yi < 0) return;
    const y = this.ns[yi];
    if (left) { x.right = y.left; if (y.left >= 0) this.ns[y.left].parent = xi; }
    else { x.left = y.right; if (y.right >= 0) this.ns[y.right].parent = xi; }
    y.parent = x.parent;
    if (x.parent < 0) this.root = yi;
    else if (xi === this.ns[x.parent].left) this.ns[x.parent].left = yi;
    else this.ns[x.parent].right = yi;
    if (left) { y.left = xi; } else { y.right = xi; }
    x.parent = yi; x.hl = y.hl = 0.5;
  }

  private lay(cw: number, ch: number): void {
    if (this.root < 0) return;
    const m = 10; const hH = 20; const lH = Math.min(35, (ch - hH - m * 2) / 5);
    const go = (i: number, lv: number, l: number, r: number): void => {
      if (i < 0 || i >= this.ns.length) return;
      const n = this.ns[i]; const cx = (l + r) / 2;
      n.tx = cx; n.ty = hH + m + lv * lH + this.nr;
      go(n.left, lv + 1, l, cx); go(n.right, lv + 1, cx, r);
    };
    go(this.root, 0, m, cw - m);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { for (const n of this.ns) { n.red = !n.red; n.hl = 0.5; } if (this.root >= 0) this.ns[this.root].red = false; }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.5;
  }
}
