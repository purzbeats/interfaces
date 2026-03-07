import { registerMicrogame } from '../microgame-registry';

/**
 * MASH TO FILL — Big ring gauge. Each tap bounces the ring and sprays particles.
 * Ring pulses on impact. Burst on completion.
 */
registerMicrogame({
  id: 'fill-gauge',
  elementType: 'ring-gauge',
  prompt: 'MASH TO FILL!',
  baseTime: 3.5,

  setup(state) {
    state.data.fill = 0;
    state.data.drainRate = 0.12 * state.speed;
    state.data.tapBoost = 0.09;
    state.data.ringScale = 1; // bounces on tap
    state.data.won = false;
  },

  update(state, input, dt) {
    let fill = state.data.fill as number;
    let ringScale = state.data.ringScale as number;

    fill = Math.max(0, fill - (state.data.drainRate as number) * dt);

    // Ring bounce decay
    ringScale += (1 - ringScale) * dt * 10;

    if (input.pointerJustDown || input.keysPressed.has(' ')) {
      fill = Math.min(1, fill + (state.data.tapBoost as number));
      ringScale = 1.08; // bounce outward
    }

    state.data.fill = fill;
    state.data.ringScale = ringScale;

    if (fill >= 1 && !state.data.won) {
      state.data.won = true;
      state.result = 'win';
    }
  },

  draw(state, { ctx, w, h, colors, fx, time }) {
    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.25;
    const fill = state.data.fill as number;
    const scale = state.data.ringScale as number;
    const r = baseR * scale;
    const won = state.data.won as boolean;

    if (won) {
      // Post-win: draw filled ring glowing
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 14;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      return;
    }

    // Background ring
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Fill arc
    const fillColor = fill > 0.85 ? colors.alert : colors.primary;
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = fill > 0.7 ? 12 : 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.shadowBlur = 0;

    // Tip particles when filling
    if (fill > 0.05 && scale > 1.01) {
      const tipAngle = -Math.PI / 2 + fill * Math.PI * 2;
      const tipX = cx + Math.cos(tipAngle) * r;
      const tipY = cy + Math.sin(tipAngle) * r;
      fx.burst(tipX, tipY, fillColor, 4, 80, 2);
    }

    // Percentage text (pulses with ring)
    const fontSize = Math.round(r * 0.4 * scale);
    ctx.fillStyle = colors.primary;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(fill * 100)}%`, cx, cy);

    // Pulsing hint
    const hintAlpha = 0.3 + 0.2 * Math.sin(time * 6);
    ctx.globalAlpha = hintAlpha;
    ctx.fillStyle = colors.dim;
    ctx.font = '14px monospace';
    ctx.fillText('TAP / SPACE', cx, cy + r + 30);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  },
});
