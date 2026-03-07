import { registerMicrogame } from '../microgame-registry';

/**
 * HOLD IN THE ZONE — Vertical gauge with safe zone. Hold to raise, release to drop.
 * Level marker has physics wobble. Zone emits particles when you're in it.
 * Progress bar fills as you hold in zone.
 */
registerMicrogame({
  id: 'hold-level',
  elementType: 'depth-gauge',
  prompt: 'HOLD IN THE ZONE!',
  baseTime: 4,

  setup(state) {
    state.data.level = 0.2;
    state.data.velocity = 0; // for physics feel
    state.data.zoneMin = 0.45;
    state.data.zoneMax = 0.65;
    state.data.inZoneTime = 0;
    state.data.requiredTime = 1.2 / state.speed;
    state.data.won = false;
  },

  update(state, input, dt) {
    if (state.data.won) return;

    let level = state.data.level as number;
    let vel = state.data.velocity as number;

    // Physics-based movement (acceleration, not direct position)
    const accel = (input.pointerDown || input.keysDown.has(' ')) ? 2.5 : -2.0;
    vel += accel * state.speed * dt;
    vel *= 0.92; // damping
    level += vel * dt;

    // Clamp with bounce
    if (level > 1) { level = 1; vel = -vel * 0.3; }
    if (level < 0) { level = 0; vel = -vel * 0.3; }

    state.data.level = level;
    state.data.velocity = vel;

    const zMin = state.data.zoneMin as number;
    const zMax = state.data.zoneMax as number;
    const inZone = level >= zMin && level <= zMax;

    if (inZone) {
      state.data.inZoneTime = (state.data.inZoneTime as number) + dt;
    }

    const required = state.data.requiredTime as number;
    if ((state.data.inZoneTime as number) >= required) {
      state.data.won = true;
      state.result = 'win';
    }

    if (state.timeLeft <= 0.05 && state.result === 'pending') {
      state.result = (state.data.inZoneTime as number) >= required ? 'win' : 'lose';
    }
  },

  draw(state, { ctx, w, h, colors, fx, time }) {
    const level = state.data.level as number;
    const vel = state.data.velocity as number;
    const zMin = state.data.zoneMin as number;
    const zMax = state.data.zoneMax as number;
    const inZoneTime = state.data.inZoneTime as number;
    const required = state.data.requiredTime as number;
    const inZone = level >= zMin && level <= zMax;
    const won = state.data.won as boolean;

    const barX = w * 0.43;
    const barW = w * 0.14;
    const barTop = h * 0.12;
    const barBot = h * 0.82;
    const barH = barBot - barTop;

    // Gauge track
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(barX, barTop, barW, barH);
    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barTop, barW, barH);

    // Tick marks
    for (let i = 0; i <= 10; i++) {
      const ty = barBot - (i / 10) * barH;
      const tw = i % 5 === 0 ? 8 : 4;
      ctx.strokeStyle = colors.dim;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(barX - tw, ty);
      ctx.lineTo(barX, ty);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Safe zone
    const zoneTop = barBot - zMax * barH;
    const zoneBot = barBot - zMin * barH;
    const zoneGlow = inZone ? 0.3 + 0.1 * Math.sin(time * 6) : 0.1;
    ctx.fillStyle = inZone ? colors.primary : colors.dim;
    ctx.globalAlpha = zoneGlow;
    ctx.fillRect(barX - 6, zoneTop, barW + 12, zoneBot - zoneTop);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = inZone ? colors.primary : colors.dim;
    ctx.lineWidth = inZone ? 2 : 1;
    ctx.strokeRect(barX - 6, zoneTop, barW + 12, zoneBot - zoneTop);

    // Zone particles when in zone
    if (inZone && !won && Math.random() < 0.4) {
      const py = zoneTop + Math.random() * (zoneBot - zoneTop);
      fx.spray(barX + barW + 10, py, 0, 0.8, colors.primary, 1, 20);
    }

    // Fill level
    const fillH = level * barH;
    ctx.fillStyle = inZone ? colors.primary : colors.secondary;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(barX + 2, barBot - fillH, barW - 4, fillH);
    ctx.globalAlpha = 1;

    // Level marker with velocity-based tilt
    const ly = barBot - level * barH;
    const tilt = vel * 3; // visual tilt from velocity
    ctx.strokeStyle = inZone ? colors.primary : colors.secondary;
    ctx.lineWidth = 3;
    ctx.shadowColor = inZone ? colors.primary : 'transparent';
    ctx.shadowBlur = inZone ? 8 : 0;
    ctx.beginPath();
    ctx.moveTo(barX - 12, ly + tilt);
    ctx.lineTo(barX + barW + 12, ly - tilt);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Marker dot
    ctx.fillStyle = inZone ? colors.primary : colors.secondary;
    ctx.beginPath();
    ctx.arc(barX + barW / 2, ly, 5, 0, Math.PI * 2);
    ctx.fill();

    // Progress arc (right side)
    const progress = Math.min(1, inZoneTime / required);
    const arcCx = barX + barW + 40;
    const arcCy = (barTop + barBot) / 2;
    const arcR = 20;

    ctx.strokeStyle = colors.dim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(arcCx, arcCy, arcR, 0, Math.PI * 2);
    ctx.stroke();

    if (progress > 0) {
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(arcCx, arcCy, arcR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = colors.primary;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(progress * 100)}%`, arcCx, arcCy + 4);

    // Win burst
    if (won) {
      fx.burst(barX + barW / 2, ly, colors.primary, 10, 100, 3);
    }

    // Hint
    ctx.fillStyle = colors.dim;
    ctx.globalAlpha = 0.4;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HOLD SPACE / TAP', w / 2, h - 12);
    ctx.globalAlpha = 1;
  },
});
