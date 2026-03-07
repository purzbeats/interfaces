import { registerMicrogame } from '../microgame-registry';

/**
 * STOP IN THE ZONE — Needle sweeps back and forth. Green zone is marked.
 * Needle has a motion trail. Zone flashes on hit. Miss shakes the screen.
 */
registerMicrogame({
  id: 'stop-needle',
  elementType: 'gauge-needle',
  prompt: 'STOP IN THE ZONE!',
  baseTime: 4,

  setup(state) {
    state.data.pos = 0;
    state.data.dir = 1;
    state.data.sweepSpeed = 0.6 + state.speed * 0.3;
    const zoneCenter = 0.25 + Math.random() * 0.5;
    const zoneHalf = Math.max(0.06, 0.12 / state.speed);
    state.data.zoneMin = zoneCenter - zoneHalf;
    state.data.zoneMax = zoneCenter + zoneHalf;
    state.data.stopped = false;
    state.data.trail = [] as number[]; // last N positions
  },

  update(state, input, dt) {
    if (state.data.stopped) return;

    let pos = state.data.pos as number;
    let dir = state.data.dir as number;
    pos += dir * (state.data.sweepSpeed as number) * dt;
    if (pos >= 1) { pos = 1; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    state.data.pos = pos;
    state.data.dir = dir;

    // Record trail
    const trail = state.data.trail as number[];
    trail.push(pos);
    if (trail.length > 8) trail.shift();

    if (input.pointerJustDown || input.keysPressed.has(' ')) {
      state.data.stopped = true;
      const inZone = pos >= (state.data.zoneMin as number) && pos <= (state.data.zoneMax as number);
      state.result = inZone ? 'win' : 'lose';
    }
  },

  draw(state, { ctx, w, h, colors, fx }) {
    const barY = h * 0.5;
    const barLeft = w * 0.1;
    const barRight = w * 0.9;
    const barW = barRight - barLeft;
    const pos = state.data.pos as number;
    const zMin = state.data.zoneMin as number;
    const zMax = state.data.zoneMax as number;
    const stopped = state.data.stopped as boolean;
    const trail = state.data.trail as number[];
    const won = state.result === 'win';
    const lost = state.result === 'lose';

    // Track
    ctx.fillStyle = colors.dim;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(barLeft, barY - 3, barW, 6);
    ctx.globalAlpha = 1;

    // Green zone
    const zoneX = barLeft + zMin * barW;
    const zoneW = (zMax - zMin) * barW;
    ctx.fillStyle = colors.primary;
    ctx.globalAlpha = won ? 0.5 : 0.15;
    ctx.fillRect(zoneX, barY - 35, zoneW, 70);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = won ? colors.primary : colors.dim;
    ctx.lineWidth = won ? 3 : 1.5;
    ctx.strokeRect(zoneX, barY - 35, zoneW, 70);

    // Zone label
    ctx.fillStyle = colors.dim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ZONE', zoneX + zoneW / 2, barY - 40);

    // Motion trail (ghost needles)
    if (!stopped) {
      for (let i = 0; i < trail.length - 1; i++) {
        const alpha = (i / trail.length) * 0.3;
        const tx = barLeft + trail[i] * barW;
        ctx.strokeStyle = colors.dim;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, barY - 30);
        ctx.lineTo(tx, barY + 30);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Needle
    const nx = barLeft + pos * barW;
    let needleColor = colors.secondary;
    if (stopped) needleColor = won ? colors.primary : colors.alert;

    ctx.strokeStyle = needleColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = needleColor;
    ctx.shadowBlur = stopped ? 10 : 0;
    ctx.beginPath();
    ctx.moveTo(nx, barY - 42);
    ctx.lineTo(nx, barY + 42);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Triangle pointer
    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.moveTo(nx - 10, barY - 46);
    ctx.lineTo(nx + 10, barY - 46);
    ctx.lineTo(nx, barY - 34);
    ctx.closePath();
    ctx.fill();

    // Result effects
    if (won) {
      fx.burst(nx, barY, colors.primary, 6, 100, 3);
    } else if (lost) {
      fx.shake(8);
    }

    if (!stopped) {
      ctx.fillStyle = colors.dim;
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TAP / SPACE', w / 2, barY + 70);
    }
  },
});
