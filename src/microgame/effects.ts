/**
 * Lightweight visual effects system for microgames.
 * Manages particles, screen shake, interaction ripples, and trails.
 * Games call methods to spawn effects; the system renders and ages them.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'circle' | 'square' | 'ring';
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  color: string;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

export class MicrogameEffects {
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private trails: Map<string, TrailPoint[]> = new Map();

  // Screen shake
  private shakeIntensity = 0;
  private shakeDecay = 8;
  shakeOffsetX = 0;
  shakeOffsetY = 0;

  // Win/lose burst state
  private burstQueue: { x: number; y: number; color: string; count: number }[] = [];

  clear(): void {
    this.particles = [];
    this.ripples = [];
    this.trails.clear();
    this.shakeIntensity = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.burstQueue = [];
  }

  /** Spawn a burst of particles at (x, y) in pixel coords */
  burst(x: number, y: number, color: string, count = 12, speed = 200, size = 3): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = speed * (0.5 + Math.random() * 0.8);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.4 + Math.random() * 0.3,
        size: size * (0.5 + Math.random()),
        color,
        type: Math.random() > 0.5 ? 'circle' : 'square',
      });
    }
  }

  /** Spawn a directed spray of particles */
  spray(x: number, y: number, angle: number, spread: number, color: string, count = 6, speed = 150): void {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const spd = speed * (0.3 + Math.random());
      this.particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 0.3 + Math.random() * 0.2,
        maxLife: 0.3 + Math.random() * 0.2,
        size: 2 + Math.random() * 2,
        color,
        type: 'circle',
      });
    }
  }

  /** Spawn a single expanding ring at (x, y) */
  ring(x: number, y: number, color: string, maxRadius = 60): void {
    this.ripples.push({ x, y, radius: 0, maxRadius, life: 1, color });
  }

  /** Spawn an interaction ripple (called on every click/tap) */
  clickRipple(x: number, y: number, color: string): void {
    this.ripples.push({ x, y, radius: 0, maxRadius: 40, life: 1, color });
    // Small particle pop
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * 60,
        vy: Math.sin(angle) * 60,
        life: 0.2,
        maxLife: 0.2,
        size: 2,
        color,
        type: 'circle',
      });
    }
  }

  /** Trigger screen shake */
  shake(intensity: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  /** Record a trail point for a named object */
  trail(id: string, x: number, y: number): void {
    if (!this.trails.has(id)) this.trails.set(id, []);
    const t = this.trails.get(id)!;
    t.push({ x, y, age: 0 });
    // Limit trail length
    if (t.length > 30) t.shift();
  }

  /** Win celebration: big burst + rings */
  winBurst(x: number, y: number, color: string): void {
    this.burst(x, y, color, 24, 300, 4);
    this.ring(x, y, color, 100);
    this.ring(x, y, color, 160);
    this.shake(6);
  }

  /** Lose effect: red shake + sparse particles */
  loseBurst(x: number, y: number, color: string): void {
    this.burst(x, y, color, 8, 100, 3);
    this.shake(10);
  }

  /** Update all effects (call once per frame) */
  update(dt: number): void {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt; // light gravity
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life -= dt * 2.5;
      r.radius += (r.maxRadius - r.radius) * dt * 6;
      if (r.life <= 0) {
        this.ripples.splice(i, 1);
      }
    }

    // Trails
    for (const [, points] of this.trails) {
      for (let i = points.length - 1; i >= 0; i--) {
        points[i].age += dt;
        if (points[i].age > 0.5) {
          points.splice(i, 1);
        }
      }
    }

    // Shake
    if (this.shakeIntensity > 0.1) {
      this.shakeOffsetX = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeOffsetY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
    } else {
      this.shakeIntensity = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  /** Render all effects to a canvas context */
  draw(ctx: CanvasRenderingContext2D): void {
    // Apply shake offset
    if (this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0) {
      ctx.save();
      ctx.translate(this.shakeOffsetX, this.shakeOffsetY);
    }

    // Trails
    for (const [, points] of this.trails) {
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        const alpha = Math.max(0, 1 - p.age * 3);
        ctx.strokeStyle = `rgba(51, 255, 102, ${alpha * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Ripples
    for (const r of this.ripples) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = r.life * 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.type === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;

    if (this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0) {
      ctx.restore();
    }
  }
}
