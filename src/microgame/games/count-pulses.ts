import { registerMicrogame } from '../microgame-registry';

/**
 * COUNT THE PULSES — Dramatic expanding shockwaves flash on screen. Count them,
 * then press the matching number key. Each pulse is a big visible event.
 */
registerMicrogame({
  id: 'count-pulses',
  elementType: 'heart-monitor',
  prompt: 'COUNT THE PULSES!',
  baseTime: 5,

  setup(state) {
    const target = 2 + Math.floor(Math.random() * 4); // 2-5
    state.data.targetCount = target;
    state.data.emitted = 0;
    state.data.timer = 0;
    state.data.interval = Math.max(0.4, 0.6 / state.speed);
    state.data.showPhase = true;
    state.data.flashIntensity = 0;
    state.data.answered = false;
    state.data.answerKey = -1;
  },

  update(state, input, dt) {
    if (state.data.answered) return;

    const interval = state.data.interval as number;
    const target = state.data.targetCount as number;

    state.data.flashIntensity = Math.max(0, (state.data.flashIntensity as number) - dt * 3);

    if (state.data.showPhase) {
      state.data.timer = (state.data.timer as number) + dt;
      if ((state.data.timer as number) >= interval && (state.data.emitted as number) < target) {
        state.data.timer = 0;
        state.data.emitted = (state.data.emitted as number) + 1;
        state.data.flashIntensity = 1;
      }
      if ((state.data.emitted as number) >= target && (state.data.timer as number) > 0.5) {
        state.data.showPhase = false;
      }
    } else {
      for (let n = 1; n <= 9; n++) {
        if (input.keysPressed.has(String(n))) {
          state.data.answered = true;
          state.data.answerKey = n;
          state.result = n === target ? 'win' : 'lose';
          return;
        }
      }
    }
  },

  draw(state, { ctx, w, h, colors, fx }) {
    const emitted = state.data.emitted as number;
    const target = state.data.targetCount as number;
    const flash = state.data.flashIntensity as number;
    const showPhase = state.data.showPhase as boolean;
    const answered = state.data.answered as boolean;

    const cx = w / 2;
    const cy = h * 0.4;

    // Dramatic pulse shockwave
    if (flash > 0) {
      // Expanding ring
      const ringR = 20 + (1 - flash) * 80;
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 3;
      ctx.globalAlpha = flash * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Bright center flash
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = flash * 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, 15 + flash * 25, 0, Math.PI * 2);
      ctx.fill();

      // Glow
      ctx.globalAlpha = flash * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, 50 + flash * 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Particles on pulse
      if (flash > 0.9) {
        fx.burst(cx, cy, colors.primary, 8, 120, 3);
        fx.shake(3);
      }
    }

    // Pulse count dots
    const dotSpacing = 32;
    const dotsX = cx - (target - 1) * dotSpacing / 2;
    for (let i = 0; i < target; i++) {
      const dx = dotsX + i * dotSpacing;
      const dy = cy + 90;
      if (i < emitted) {
        ctx.fillStyle = colors.primary;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(dx, dy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Phase text
    if (showPhase) {
      ctx.fillStyle = colors.dim;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WATCH...', cx, h * 0.72);
    } else if (!answered) {
      ctx.fillStyle = colors.secondary;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('HOW MANY?', cx, h * 0.65);

      // Number key options
      ctx.font = '16px monospace';
      const optSpacing = 36;
      const optStart = cx - 4 * optSpacing / 2;
      for (let n = 1; n <= 5; n++) {
        const ox = optStart + (n - 1) * optSpacing;
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ox, h * 0.74, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = colors.dim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), ox, h * 0.74);
      }
      ctx.textBaseline = 'alphabetic';
    } else {
      const correct = state.result === 'win';
      ctx.fillStyle = correct ? colors.primary : colors.alert;
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      if (correct) {
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 10;
        ctx.fillText('CORRECT!', cx, h * 0.68);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillText(`IT WAS ${target}`, cx, h * 0.68);
        fx.shake(5);
      }
    }
  },
});
