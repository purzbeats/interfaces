import { registerMicrogame } from '../microgame-registry';

/**
 * TAP THE TALLEST — Bars displayed with clear heights. Hover highlights.
 * Correct pick: bar shoots up with burst. Wrong: bar flashes red, correct one pulses.
 */
registerMicrogame({
  id: 'find-tallest',
  elementType: 'sorting-bars',
  prompt: 'TAP THE TALLEST!',
  baseTime: 3,

  setup(state) {
    const count = 5 + Math.floor(state.speed);
    const heights: number[] = [];
    for (let i = 0; i < count; i++) {
      heights.push(0.15 + Math.random() * 0.85);
    }
    const maxIdx = Math.floor(Math.random() * count);
    heights[maxIdx] = 1;
    for (let i = 0; i < count; i++) {
      if (i !== maxIdx && heights[i] > 0.9) heights[i] = 0.85;
    }
    state.data.heights = heights;
    state.data.tallestIdx = maxIdx;
    state.data.count = count;
    state.data.answered = false;
    state.data.chosenIdx = -1;
    state.data.hoverIdx = -1;
    state.data.resultTimer = 0;
  },

  update(state, input, dt) {
    if (state.data.answered) {
      state.data.resultTimer = (state.data.resultTimer as number) + dt;
      return;
    }

    const count = state.data.count as number;
    const margin = 0.1;
    const usable = 1 - margin * 2;

    // Hover detection
    if (input.pointer) {
      const relX = (input.pointer.nx - margin) / usable;
      if (relX >= 0 && relX <= 1) {
        state.data.hoverIdx = Math.min(count - 1, Math.floor(relX * count));
      } else {
        state.data.hoverIdx = -1;
      }
    } else {
      state.data.hoverIdx = -1;
    }

    if (!input.pointerJustDown || !input.pointer) return;

    const relX = (input.pointer.nx - margin) / usable;
    if (relX < 0 || relX > 1) return;

    const idx = Math.min(count - 1, Math.floor(relX * count));
    state.data.answered = true;
    state.data.chosenIdx = idx;
    state.result = idx === (state.data.tallestIdx as number) ? 'win' : 'lose';
  },

  draw(state, { ctx, w, h, colors, fx, time }) {
    const heights = state.data.heights as number[];
    const count = state.data.count as number;
    const tallest = state.data.tallestIdx as number;
    const answered = state.data.answered as boolean;
    const chosen = state.data.chosenIdx as number;
    const hover = state.data.hoverIdx as number;
    const resultT = state.data.resultTimer as number;

    const margin = w * 0.1;
    const usable = w - margin * 2;
    const gap = 4;
    const barW = (usable - gap * (count - 1)) / count;
    const maxBarH = h * 0.5;
    const baseY = h * 0.75;

    for (let i = 0; i < count; i++) {
      const bx = margin + i * (barW + gap);
      let bh = heights[i] * maxBarH;

      // Win animation: correct bar grows
      if (answered && i === tallest && state.result === 'win') {
        bh += Math.min(30, resultT * 60);
      }

      let color = colors.dim;
      if (answered) {
        if (i === tallest) {
          color = colors.primary;
        } else if (i === chosen) {
          color = colors.alert;
        }
      } else if (i === hover) {
        color = colors.secondary;
      }

      // Bar fill
      ctx.fillStyle = color;
      ctx.globalAlpha = (i === hover && !answered) ? 0.8 : 0.5;
      ctx.fillRect(bx, baseY - bh, barW, bh);
      ctx.globalAlpha = 1;

      // Bar outline
      ctx.strokeStyle = color;
      ctx.lineWidth = (i === hover && !answered) ? 2 : 1;
      ctx.strokeRect(bx, baseY - bh, barW, bh);
    }

    // Result effects (fire once)
    if (answered && resultT < 0.05) {
      const barCx = margin + chosen * (barW + gap) + barW / 2;
      if (state.result === 'win') {
        fx.burst(barCx, baseY - heights[chosen] * maxBarH, colors.primary, 16, 150, 3);
        fx.ring(barCx, baseY - heights[chosen] * maxBarH, colors.primary, 80);
      } else {
        fx.shake(6);
        // Highlight correct one
        const correctCx = margin + tallest * (barW + gap) + barW / 2;
        fx.ring(correctCx, baseY - maxBarH, colors.primary, 60);
      }
    }

    // Correct answer indicator after wrong pick
    if (answered && state.result === 'lose') {
      const correctCx = margin + tallest * (barW + gap) + barW / 2;
      const pulse = 0.5 + 0.5 * Math.sin(time * 8);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 2;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(correctCx, baseY + 8);
      ctx.lineTo(correctCx - 10, baseY + 22);
      ctx.lineTo(correctCx + 10, baseY + 22);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
});
