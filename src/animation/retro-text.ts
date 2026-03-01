/**
 * Shared retro CRT text rendering utilities.
 * Apply phosphor glow, scanline interference, and per-character brightness variation
 * to canvas-based text elements for an authentic 1980s terminal look.
 */

/** Apply scanline darkening to an existing canvas — call after all text is drawn. */
export function applyScanlines(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  intensity: number = 0.12,
  time: number = 0
): void {
  const lineSpacing = 3; // every 3px
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(0,0,0,${intensity})`;
  for (let y = 0; y < canvas.height; y += lineSpacing) {
    ctx.fillRect(0, y, canvas.width, 1);
  }
  // Rolling interference band
  const bandY = ((time * 40) % (canvas.height + 20)) - 10;
  ctx.fillStyle = `rgba(0,0,0,${intensity * 0.5})`;
  ctx.fillRect(0, bandY, canvas.width, 4);
  ctx.restore();
}

/** Draw text with phosphor glow — renders text twice with bloom. */
export function drawGlowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  glowBlur: number = 6
): void {
  // First pass: glow
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowBlur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  // Second pass: sharp text on top
  ctx.shadowBlur = glowBlur * 0.3;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * Draw text with per-character brightness variation and slight positional jitter.
 * Simulates phosphor unevenness and beam instability.
 */
export function drawJitteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  time: number,
  jitterAmount: number = 0.5,
  glowBlur: number = 6
): void {
  ctx.save();
  const metrics = ctx.measureText('M');
  const charW = metrics.width;

  ctx.shadowColor = color;
  ctx.textAlign = 'left';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Per-character brightness oscillation (different phase per char)
    const brightHash = Math.sin(i * 7.3 + time * 2.1) * 0.5 + 0.5;
    const brightness = 0.7 + brightHash * 0.3;

    // Slight y-jitter (beam instability)
    const jy = Math.sin(i * 13.7 + time * 5.3) * jitterAmount;

    // Parse color and apply brightness
    ctx.globalAlpha = brightness;
    ctx.shadowBlur = glowBlur * brightness;
    ctx.fillStyle = color;
    ctx.fillText(ch, x + i * charW, y + jy);
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
}
