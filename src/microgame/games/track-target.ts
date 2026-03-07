import { registerMicrogame } from '../microgame-registry';

/**
 * TRACK THE TARGET — Crosshair wanders. Move cursor onto it and hold to lock on.
 * Crosshair tightens as you track, progress ring fills. Burst on lock-on.
 * Trail follows the target. Shake when losing lock.
 */
registerMicrogame({
  id: 'track-target',
  elementType: 'target-lock',
  prompt: 'TRACK THE TARGET!',
  baseTime: 4,

  setup(state) {
    state.data.tx = 0.3 + Math.random() * 0.4;
    state.data.ty = 0.3 + Math.random() * 0.4;
    state.data.vx = (Math.random() - 0.5) * 0.25 * state.speed;
    state.data.vy = (Math.random() - 0.5) * 0.25 * state.speed;
    state.data.fill = 0;
    state.data.radius = 0.06;
    state.data.locked = false; // is cursor currently on target
    state.data.won = false;
  },

  update(state, input, dt) {
    let tx = state.data.tx as number;
    let ty = state.data.ty as number;
    let vx = state.data.vx as number;
    let vy = state.data.vy as number;

    tx += vx * dt;
    ty += vy * dt;
    if (tx < 0.15 || tx > 0.85) { vx = -vx; tx = Math.max(0.15, Math.min(0.85, tx)); }
    if (ty < 0.15 || ty > 0.85) { vy = -vy; ty = Math.max(0.15, Math.min(0.85, ty)); }
    // Random drift
    vx += (Math.random() - 0.5) * 0.4 * state.speed * dt;
    vy += (Math.random() - 0.5) * 0.4 * state.speed * dt;
    state.data.tx = tx; state.data.ty = ty;
    state.data.vx = vx; state.data.vy = vy;

    let fill = state.data.fill as number;
    let locked = false;
    if (input.pointer) {
      const dx = input.pointer.nx - tx;
      const dy = input.pointer.ny - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < (state.data.radius as number)) {
        fill += dt * 0.7;
        locked = true;
      } else {
        fill = Math.max(0, fill - dt * 0.4);
      }
    } else {
      fill = Math.max(0, fill - dt * 0.4);
    }
    state.data.locked = locked;
    state.data.fill = fill;
    if (fill >= 1) {
      state.data.won = true;
      state.result = 'win';
    }
  },

  draw(state, { ctx, w, h, colors, fx, time }) {
    const tx = (state.data.tx as number) * w;
    const ty = (state.data.ty as number) * h;
    const r = (state.data.radius as number) * Math.min(w, h);
    const fill = state.data.fill as number;
    const locked = state.data.locked as boolean;
    const won = state.data.won as boolean;

    // Trail behind target
    fx.trail('target', tx, ty);

    if (won) {
      // Win burst already fired by mode, just draw locked state
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    // Crosshair tightens as fill increases
    const tighten = 1 - fill * 0.4;
    const outerR = r * tighten;

    // Outer dashed circle
    ctx.strokeStyle = locked ? colors.secondary : colors.dim;
    ctx.lineWidth = locked ? 2.5 : 1.5;
    ctx.setLineDash(locked ? [] : [6, 4]);
    ctx.beginPath();
    ctx.arc(tx, ty, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cross lines (animate rotation when locked)
    const rot = locked ? time * 2 : 0;
    const cr = outerR * 1.4;
    const gap = outerR * 0.35;
    ctx.strokeStyle = locked ? colors.primary : colors.dim;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * gap, ty + Math.sin(a) * gap);
      ctx.lineTo(tx + Math.cos(a) * cr, ty + Math.sin(a) * cr);
      ctx.stroke();
    }

    // Progress ring
    if (fill > 0) {
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 4;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(tx, ty, outerR + 8, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Spark particles at progress tip
      if (locked && Math.random() < 0.3) {
        const tipAngle = -Math.PI / 2 + fill * Math.PI * 2;
        const tipX = tx + Math.cos(tipAngle) * (outerR + 8);
        const tipY = ty + Math.sin(tipAngle) * (outerR + 8);
        fx.spray(tipX, tipY, tipAngle + Math.PI, 1, colors.primary, 2, 40);
      }
    }

    // Lock text
    if (fill > 0.6) {
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = fill;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LOCKING', tx, ty + outerR + 28);
      ctx.globalAlpha = 1;
    }
  },
});
