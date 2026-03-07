import { registerMicrogame } from '../microgame-registry';

/**
 * FOLLOW THE ARROWS — Sequence of arrows shown. Press them in order.
 * Each completed arrow bursts with color and fills in. Wrong press shakes.
 * Speed bonus particles for quick completion.
 */
registerMicrogame({
  id: 'escape-maze',
  elementType: 'maze-solver',
  prompt: 'FOLLOW THE ARROWS!',
  baseTime: 5,

  setup(state) {
    const dirs = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const len = Math.min(6, 3 + Math.floor(state.speed));
    const path: string[] = [];
    for (let i = 0; i < len; i++) {
      path.push(dirs[Math.floor(Math.random() * 4)]);
    }
    state.data.path = path;
    state.data.step = 0;
    state.data.len = len;
    state.data.wrong = false;
    state.data.lastStepTime = 0; // for burst timing
  },

  update(state, input, _dt) {
    const path = state.data.path as string[];
    const step = state.data.step as number;
    const len = state.data.len as number;
    if (step >= len || state.data.wrong) return;

    const keyMap: Record<string, string> = {
      arrowup: 'arrowup', arrowdown: 'arrowdown',
      arrowleft: 'arrowleft', arrowright: 'arrowright',
      w: 'arrowup', s: 'arrowdown', a: 'arrowleft', d: 'arrowright',
    };

    // Tap quadrants
    if (input.pointerJustDown && input.pointer) {
      const dx = input.pointer.nx - 0.5;
      const dy = input.pointer.ny - 0.5;
      let dir: string;
      if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? 'arrowright' : 'arrowleft';
      } else {
        dir = dy > 0 ? 'arrowdown' : 'arrowup';
      }
      if (dir === path[step]) {
        state.data.step = step + 1;
        state.data.lastStepTime = state.totalTime - state.timeLeft;
        if (step + 1 >= len) state.result = 'win';
      } else {
        state.data.wrong = true;
        state.result = 'lose';
      }
      return;
    }

    for (const [key, dir] of Object.entries(keyMap)) {
      if (input.keysPressed.has(key)) {
        if (dir === path[step]) {
          state.data.step = step + 1;
          state.data.lastStepTime = state.totalTime - state.timeLeft;
          if (step + 1 >= len) state.result = 'win';
        } else {
          state.data.wrong = true;
          state.result = 'lose';
        }
        return;
      }
    }
  },

  draw(state, { ctx, w, h, colors, fx }) {
    const path = state.data.path as string[];
    const step = state.data.step as number;
    const len = state.data.len as number;
    const wrong = state.data.wrong as boolean;

    const arrows: Record<string, string> = {
      arrowup: '\u2191', arrowdown: '\u2193',
      arrowleft: '\u2190', arrowright: '\u2192',
    };

    const cx = w / 2;
    const spacing = Math.min(64, (w * 0.75) / len);
    const startX = cx - (len - 1) * spacing / 2;
    const cy = h * 0.45;
    const circR = 24;

    for (let i = 0; i < len; i++) {
      const ax = startX + i * spacing;
      const completed = i < step;
      const current = i === step;

      // Background circle
      if (completed) {
        // Filled completed step
        ctx.fillStyle = colors.primary;
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(ax, cy, circR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 6;
      } else if (current) {
        ctx.strokeStyle = wrong ? colors.alert : colors.secondary;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = colors.dim;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(ax, cy, circR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Arrow character
      ctx.fillStyle = completed ? colors.primary : (current ? (wrong ? colors.alert : colors.secondary) : colors.dim);
      ctx.font = `bold ${current ? 26 : 22}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arrows[path[i]], ax, cy);

      // Burst on just-completed step
      if (completed && i === step - 1) {
        fx.burst(ax, cy, colors.primary, 6, 80, 2);
        fx.ring(ax, cy, colors.primary, 40);
      }
    }
    ctx.textBaseline = 'alphabetic';

    // Wrong press effect
    if (wrong) {
      const wrongX = startX + step * spacing;
      fx.shake(8);
      fx.burst(wrongX, cy, colors.alert, 6, 60, 2);
    }

    // Progress bar
    const barW = len * spacing;
    const barX = cx - barW / 2;
    const barY = cy + circR + 20;
    ctx.fillStyle = colors.dim;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(barX, barY, barW, 4);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.primary;
    ctx.fillRect(barX, barY, barW * (step / len), 4);

    // Current step highlight arrow (bouncing below)
    if (step < len && !wrong) {
      const curX = startX + step * spacing;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(curX - 6, cy + circR + 10);
      ctx.lineTo(curX + 6, cy + circR + 10);
      ctx.lineTo(curX, cy + circR + 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Hint
    ctx.fillStyle = colors.dim;
    ctx.globalAlpha = 0.4;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ARROWS / WASD / TAP', cx, h - 16);
    ctx.globalAlpha = 1;
  },
});
