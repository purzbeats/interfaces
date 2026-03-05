import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface LatticePoint {
  baseX: number;
  baseY: number;
  isVacancy: boolean;
  isInterstitial: boolean;
  displaceX: number;
  displaceY: number;
}

/**
 * Crystal lattice with point defects (vacancies, interstitials) and dislocations.
 * Regular grid of points with some missing or displaced. Animated strain waves.
 */
export class CrystalDefectElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'crystal-defect',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private pointsMesh!: THREE.Points;
  private bondMesh!: THREE.LineSegments;
  private lattice: LatticePoint[] = [];
  private cols: number = 0;
  private rows: number = 0;
  private spacing: number = 0;
  private originX: number = 0;
  private originY: number = 0;
  private vacancyRate: number = 0;
  private interstitialRate: number = 0;
  private strainSpeed: number = 0;
  private strainAmp: number = 0;
  private dislocationRow: number = -1;
  private dislocationOffset: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { spacing: 16, vacancy: 0.05, interstitial: 0.03, strainSpd: 0.5, strainA: 3, ptSize: 3 },
      { spacing: 10, vacancy: 0.08, interstitial: 0.05, strainSpd: 1.0, strainA: 2, ptSize: 2 },
      { spacing: 22, vacancy: 0.03, interstitial: 0.02, strainSpd: 0.3, strainA: 5, ptSize: 4 },
      { spacing: 14, vacancy: 0.12, interstitial: 0.08, strainSpd: 0.8, strainA: 4, ptSize: 3 },
    ];
    const p = presets[variant];
    this.spacing = p.spacing;
    this.vacancyRate = p.vacancy;
    this.interstitialRate = p.interstitial;
    this.strainSpeed = p.strainSpd;
    this.strainAmp = p.strainA;

    this.cols = Math.floor(w / this.spacing);
    this.rows = Math.floor(h / this.spacing);
    this.originX = x + (w - (this.cols - 1) * this.spacing) / 2;
    this.originY = y + (h - (this.rows - 1) * this.spacing) / 2;
    this.dislocationRow = Math.floor(this.rows / 2);

    // Generate lattice
    this.lattice = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const bx = this.originX + c * this.spacing;
        const by = this.originY + r * this.spacing;
        const isVac = this.rng.chance(this.vacancyRate);
        const isInter = !isVac && this.rng.chance(this.interstitialRate);
        this.lattice.push({
          baseX: bx,
          baseY: by,
          isVacancy: isVac,
          isInterstitial: isInter,
          displaceX: isInter ? this.rng.float(-this.spacing * 0.3, this.spacing * 0.3) : 0,
          displaceY: isInter ? this.rng.float(-this.spacing * 0.3, this.spacing * 0.3) : 0,
        });
      }
    }

    // Add extra interstitial atoms between lattice sites
    const extraCount = Math.floor(this.rows * this.cols * this.interstitialRate);
    for (let i = 0; i < extraCount; i++) {
      const bx = this.originX + this.rng.float(0, (this.cols - 1) * this.spacing);
      const by = this.originY + this.rng.float(0, (this.rows - 1) * this.spacing);
      this.lattice.push({
        baseX: bx, baseY: by,
        isVacancy: false, isInterstitial: true,
        displaceX: this.rng.float(-2, 2),
        displaceY: this.rng.float(-2, 2),
      });
    }

    // Points for atoms
    const totalPts = this.lattice.length;
    const ptPositions = new Float32Array(totalPts * 3);
    const ptColors = new Float32Array(totalPts * 3);
    for (let i = 0; i < totalPts; i++) {
      const lp = this.lattice[i];
      ptPositions[i * 3] = lp.baseX + lp.displaceX;
      ptPositions[i * 3 + 1] = lp.baseY + lp.displaceY;
      ptPositions[i * 3 + 2] = 0;
      if (lp.isVacancy) {
        ptColors[i * 3] = this.palette.dim.r;
        ptColors[i * 3 + 1] = this.palette.dim.g;
        ptColors[i * 3 + 2] = this.palette.dim.b;
      } else if (lp.isInterstitial) {
        ptColors[i * 3] = this.palette.secondary.r;
        ptColors[i * 3 + 1] = this.palette.secondary.g;
        ptColors[i * 3 + 2] = this.palette.secondary.b;
      } else {
        ptColors[i * 3] = this.palette.primary.r;
        ptColors[i * 3 + 1] = this.palette.primary.g;
        ptColors[i * 3 + 2] = this.palette.primary.b;
      }
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPositions, 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(ptColors, 3));
    this.pointsMesh = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      vertexColors: true,
      size: p.ptSize,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Bonds (horizontal + vertical between non-vacant neighbors)
    const bondSegs: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const lp = this.lattice[idx];
        if (lp.isVacancy) continue;
        // Right neighbor
        if (c + 1 < this.cols) {
          const rIdx = r * this.cols + c + 1;
          if (!this.lattice[rIdx].isVacancy) {
            bondSegs.push(idx, rIdx);
          }
        }
        // Below neighbor
        if (r + 1 < this.rows) {
          const bIdx = (r + 1) * this.cols + c;
          if (!this.lattice[bIdx].isVacancy) {
            bondSegs.push(idx, bIdx);
          }
        }
      }
    }
    const bondPositions = new Float32Array(bondSegs.length * 3);
    for (let i = 0; i < bondSegs.length; i++) {
      const lp = this.lattice[bondSegs[i]];
      bondPositions[i * 3] = lp.baseX + lp.displaceX;
      bondPositions[i * 3 + 1] = lp.baseY + lp.displaceY;
      bondPositions[i * 3 + 2] = 0;
    }
    const bondGeo = new THREE.BufferGeometry();
    bondGeo.setAttribute('position', new THREE.BufferAttribute(bondPositions, 3));
    this.bondMesh = new THREE.LineSegments(bondGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.bondMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Animate strain wave
    const ptPos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.lattice.length; i++) {
      const lp = this.lattice[i];
      if (lp.isVacancy) {
        ptPos.setXYZ(i, lp.baseX, lp.baseY, -1); // hide behind
        continue;
      }
      // Strain wave: displacement based on distance from dislocation
      const row = i < this.rows * this.cols ? Math.floor(i / this.cols) : -1;
      let strainDx = 0;
      let strainDy = 0;
      if (row >= 0) {
        const dist = row - this.dislocationRow;
        const wave = Math.sin(time * this.strainSpeed * Math.PI * 2 + dist * 0.5);
        strainDx = wave * this.strainAmp / (1 + Math.abs(dist) * 0.5);
        // Dislocation offset: half-plane shift
        this.dislocationOffset = Math.sin(time * this.strainSpeed * 0.3) * this.spacing * 0.3;
        if (row > this.dislocationRow) {
          strainDx += this.dislocationOffset;
        }
      }

      ptPos.setXYZ(i,
        lp.baseX + lp.displaceX + strainDx,
        lp.baseY + lp.displaceY + strainDy,
        0,
      );
    }
    ptPos.needsUpdate = true;

    // Update bond positions to match
    const bondPos = this.bondMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bondPos.count; i++) {
      // Re-derive from point positions (bonds stored as index pairs in build)
      // For efficiency, just shift bonds by the same strain
      const bx = bondPos.getX(i);
      const by = bondPos.getY(i);
      // Find closest lattice point row
      const approxRow = Math.round((by - this.originY) / this.spacing);
      let strainDx = 0;
      if (approxRow >= 0 && approxRow < this.rows) {
        const dist = approxRow - this.dislocationRow;
        const wave = Math.sin(time * this.strainSpeed * Math.PI * 2 + dist * 0.5);
        strainDx = wave * this.strainAmp / (1 + Math.abs(dist) * 0.5);
        if (approxRow > this.dislocationRow) {
          strainDx += this.dislocationOffset;
        }
      }
      // Shift from base position (stored positions are base + displace)
      bondPos.setX(i, bx + strainDx * dt * 0.5);
    }
    bondPos.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.bondMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomly flip some vacancies
      for (let i = 0; i < this.lattice.length; i++) {
        if (this.rng.chance(0.05)) {
          this.lattice[i].isVacancy = !this.lattice[i].isVacancy;
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.strainAmp = 3 + level * 1.5;
      this.strainSpeed = 0.5 + level * 0.2;
    }
  }
}
