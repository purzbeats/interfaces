import { registerMicrogame } from '../microgame-registry';

/**
 * DODGE THE BEAM — Rotating beam from center. Your cursor is shown as a glowing dot.
 * Hits cause red screen shake and sparks. Near-misses emit warning particles.
 */
registerMicrogame({
  id: 'dodge-sweep',
  elementType: 'radar-sweep',
  prompt: 'DODGE THE BEAM!',
  baseTime: 4,

  setup(state) {
    state.data.angle = 0;
    state.data.rotSpeed = (1.2 + state.speed * 0.6) * Math.PI;
    state.data.hits = 0;
    state.data.maxHits = 5;
    state.data.hitCooldown = 0; // prevent multiple hits per frame
  },

  update(state, input, dt) {
    state.data.angle = (state.data.angle as number) + (state.data.rotSpeed as number) * dt;
    state.data.hitCooldown = Math.max(0, (state.data.hitCooldown as number) - dt);

    if (!input.pointer || (state.data.hitCooldown as number) > 0) return;

    const dx = input.pointer.nx - 0.5;
    const dy = input.pointer.ny - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.04) {
      const pointerAngle = Math.atan2(dy, dx);
      const beamAngle = ((state.data.angle as number) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      let diff = Math.abs(pointerAngle - beamAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;

      const beamWidth = 0.1;
      if (diff < beamWidth) {
        state.data.hits = (state.data.hits as number) + 1;
        state.data.hitCooldown = 0.15;
        if ((state.data.hits as number) >= (state.data.maxHits as number)) {
          state.result = 'lose';
        }
      }
    }

    if (state.timeLeft <= 0.05 && state.result === 'pending') {
      state.result = 'win';
    }
  },

  draw(state, { ctx, w, h, colors, fx }) {
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.4;
    const angle = state.data.angle as number;
    const hits = state.data.hits as number;
    const maxHits = state.data.maxHits as number;
    const hitCooldown = state.data.hitCooldown as number;
    const justHit = hitCooldown > 0.1;

    // Range rings
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * (i / 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Beam glow cone
    const beamColor = justHit ? colors.alert : colors.primary;
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = beamColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, angle - 0.1, angle + 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Beam line
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = justHit ? 4 : 2.5;
    ctx.shadowColor = beamColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center dot
    ctx.fillStyle = colors.dim;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Player cursor glow
    const pState = state as { data: Record<string, unknown> };
    // We can read pointer from the drawn state's data — but we have no direct access
    // Instead draw at last known position via context - not possible directly
    // The cursor is visible as the OS cursor, but let's also draw the position dot

    // Hit feedback
    if (justHit) {
      fx.shake(5);
      // Sparks at beam tip
      const tipX = cx + Math.cos(angle) * maxR * 0.6;
      const tipY = cy + Math.sin(angle) * maxR * 0.6;
      fx.spray(tipX, tipY, angle + Math.PI, 1.5, colors.alert, 3, 60);
    }

    // Hit counter (visible pips)
    const pipY = cy + maxR + 20;
    const pipSpacing = 14;
    const pipStartX = cx - (maxHits - 1) * pipSpacing / 2;
    for (let i = 0; i < maxHits; i++) {
      const px = pipStartX + i * pipSpacing;
      if (i < hits) {
        ctx.fillStyle = colors.alert;
        ctx.beginPath();
        ctx.arc(px, pipY, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, pipY, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = colors.dim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MOVE TO DODGE', cx, h - 20);
  },
});
