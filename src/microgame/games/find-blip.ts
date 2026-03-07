import { registerMicrogame } from '../microgame-registry';

/**
 * TAP THE BLIP — Sonar-style pulsing blip. Expanding rings emanate from it.
 * Hit: particle burst. Miss: red X with shake. Limited tries shown as pips.
 */
registerMicrogame({
  id: 'find-blip',
  elementType: 'sonar-ping',
  prompt: 'TAP THE BLIP!',
  baseTime: 4,

  setup(state) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 0.1 + Math.random() * 0.3;
    state.data.bx = 0.5 + Math.cos(angle) * dist;
    state.data.by = 0.5 + Math.sin(angle) * dist;
    state.data.hitR = Math.max(0.04, 0.07 / state.speed);
    state.data.attempts = 0;
    state.data.maxAttempts = 3;
    state.data.pulseTime = 0;
    state.data.hit = false;
  },

  update(state, input, dt) {
    state.data.pulseTime = (state.data.pulseTime as number) + dt;

    if (state.data.hit) return;
    if (!input.pointerJustDown || !input.pointer) return;

    const dx = input.pointer.nx - (state.data.bx as number);
    const dy = input.pointer.ny - (state.data.by as number);
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < (state.data.hitR as number)) {
      state.data.hit = true;
      state.result = 'win';
    } else {
      state.data.attempts = (state.data.attempts as number) + 1;
      if ((state.data.attempts as number) >= (state.data.maxAttempts as number)) {
        state.result = 'lose';
      }
    }
  },

  draw(state, { ctx, w, h, colors, fx }) {
    const bx = (state.data.bx as number) * w;
    const by = (state.data.by as number) * h;
    const hitR = (state.data.hitR as number) * Math.min(w, h);
    const pulse = state.data.pulseTime as number;
    const hit = state.data.hit as boolean;
    const att = state.data.attempts as number;
    const max = state.data.maxAttempts as number;

    if (hit) {
      // Win state — burst already triggered, draw residual glow
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(bx, by, hitR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // Sonar rings expanding outward (repeating)
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const phase = ((pulse * 1.5 + i / ringCount) % 1);
      const ringR = hitR * 0.5 + phase * hitR * 2.5;
      const alpha = (1 - phase) * 0.3;
      ctx.strokeStyle = colors.primary;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Center blip (pulses)
    const blipPulse = 0.6 + 0.4 * Math.sin(pulse * 5);
    const blipR = hitR * 0.35 * (0.8 + blipPulse * 0.3);
    ctx.fillStyle = colors.primary;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = 10 * blipPulse;
    ctx.beginPath();
    ctx.arc(bx, by, blipR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outer detection ring
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(bx, by, hitR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Miss feedback (handled by click ripple from mode, but also shake)
    if (att > 0) {
      fx.shake(3);
    }

    // Tries pips
    const pipY = h - 30;
    const pipSpacing = 16;
    const pipStartX = w / 2 - (max - 1) * pipSpacing / 2;
    for (let i = 0; i < max; i++) {
      const px = pipStartX + i * pipSpacing;
      if (i < max - att) {
        ctx.fillStyle = colors.primary;
        ctx.beginPath();
        ctx.arc(px, pipY, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = colors.alert;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 4, pipY - 4); ctx.lineTo(px + 4, pipY + 4);
        ctx.moveTo(px + 4, pipY - 4); ctx.lineTo(px - 4, pipY + 4);
        ctx.stroke();
      }
    }
  },
});
