import { registerMicrogame } from '../microgame-registry';

/**
 * MATCH THE WAVE — Target wave shown above, yours below. Adjust frequency with
 * arrows/tap. Waves glow as they converge. On match they merge and pulse.
 */
registerMicrogame({
  id: 'match-wave',
  elementType: 'waveform',
  prompt: 'MATCH THE WAVE!',
  baseTime: 5,

  setup(state) {
    const target = 1.5 + Math.random() * 3;
    state.data.targetFreq = target;
    state.data.playerFreq = target + (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 2);
    state.data.tolerance = Math.max(0.25, 0.4 / state.speed);
    state.data.adjustSpeed = 2.0;
    state.data.matchTime = 0;
    state.data.won = false;
    state.data.adjustDir = 0; // -1 left, 0 none, 1 right — for visual feedback
  },

  update(state, input, dt) {
    if (state.data.won) return;

    let freq = state.data.playerFreq as number;
    const speed = state.data.adjustSpeed as number;
    let dir = 0;

    if (input.keysDown.has('arrowleft') || input.keysDown.has('a')) { freq -= speed * dt; dir = -1; }
    if (input.keysDown.has('arrowright') || input.keysDown.has('d')) { freq += speed * dt; dir = 1; }

    if (input.pointerDown && input.pointer) {
      if (input.pointer.nx < 0.35) { freq -= speed * dt; dir = -1; }
      else if (input.pointer.nx > 0.65) { freq += speed * dt; dir = 1; }
    }

    freq = Math.max(0.5, Math.min(6, freq));
    state.data.playerFreq = freq;
    state.data.adjustDir = dir;

    const diff = Math.abs(freq - (state.data.targetFreq as number));
    const tol = state.data.tolerance as number;
    if (diff < tol) {
      state.data.matchTime = (state.data.matchTime as number) + dt;
      if ((state.data.matchTime as number) >= 0.3) {
        state.data.won = true;
        state.result = 'win';
      }
    } else {
      state.data.matchTime = Math.max(0, (state.data.matchTime as number) - dt * 2);
    }
  },

  draw(state, { ctx, w, h, colors, fx, time }) {
    const targetFreq = state.data.targetFreq as number;
    const playerFreq = state.data.playerFreq as number;
    const tolerance = state.data.tolerance as number;
    const diff = Math.abs(playerFreq - targetFreq);
    const closeness = Math.max(0, 1 - diff / 3); // 0-1 how close
    const matched = diff < tolerance;
    const won = state.data.won as boolean;
    const dir = state.data.adjustDir as number;

    const waveW = w * 0.7;
    const waveX = (w - waveW) / 2;
    const amp = h * 0.06;

    // If won, merge waves into center
    const targetY = won ? h * 0.45 : h * 0.32;
    const playerY = won ? h * 0.45 : h * 0.62;

    // Draw waveform helper
    const drawWave = (freq: number, cy: number, color: string, glow: boolean) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 + closeness * 10;
      }
      ctx.beginPath();
      for (let i = 0; i <= waveW; i++) {
        const x = waveX + i;
        const y = cy + Math.sin((i / waveW) * freq * Math.PI * 2 + time * 2) * amp;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    // Labels
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    if (!won) {
      ctx.fillStyle = colors.dim;
      ctx.fillText('TARGET', waveX, targetY - amp - 8);
      ctx.fillStyle = matched ? colors.primary : colors.secondary;
      ctx.fillText('YOURS', waveX, playerY - amp - 8);
    }

    // Target wave
    drawWave(targetFreq, targetY, colors.dim, false);

    // Player wave (glows as it gets closer)
    const pColor = matched ? colors.primary : colors.secondary;
    drawWave(playerFreq, playerY, pColor, closeness > 0.5);

    // Direction arrows (pulse when active)
    const arrowAlpha = dir !== 0 ? 0.9 : 0.3;
    ctx.globalAlpha = arrowAlpha;
    ctx.fillStyle = dir === -1 ? colors.secondary : colors.dim;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u25C0', w * 0.08, playerY);
    ctx.fillStyle = dir === 1 ? colors.secondary : colors.dim;
    ctx.fillText('\u25B6', w * 0.92, playerY);
    ctx.globalAlpha = 1;

    // Adjustment sparks
    if (dir !== 0) {
      const sx = dir < 0 ? waveX : waveX + waveW;
      fx.spray(sx, playerY, dir < 0 ? Math.PI : 0, 0.5, colors.secondary, 1, 30);
    }

    // Match indicator with progress
    if (matched && !won) {
      const matchProg = (state.data.matchTime as number) / 0.3;
      ctx.fillStyle = colors.primary;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.5 + matchProg * 0.5;
      ctx.fillText('LOCKING...', w / 2, h * 0.8);
      ctx.globalAlpha = 1;

      // Progress bar
      const pbW = 100;
      ctx.fillStyle = colors.dim;
      ctx.fillRect(w / 2 - pbW / 2, h * 0.83, pbW, 3);
      ctx.fillStyle = colors.primary;
      ctx.fillRect(w / 2 - pbW / 2, h * 0.83, pbW * matchProg, 3);
    }

    if (won) {
      fx.burst(w / 2, h * 0.45, colors.primary, 8, 60, 2);
    }

    // Hint
    if (!won) {
      ctx.fillStyle = colors.dim;
      ctx.globalAlpha = 0.4;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u2190 / \u2192  or  TAP SIDES', w / 2, h - 16);
      ctx.globalAlpha = 1;
    }
  },
});
