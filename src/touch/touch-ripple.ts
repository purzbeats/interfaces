/** CSS-based touch ripple overlay. GPU-composited, zero WebGL cost. */

const ANIMATION_NAME = 'touch-ripple-expand';

function intensityColor(level: number): string {
  // green → yellow → red heat map for levels 1–5
  const t = Math.max(0, Math.min(1, (level - 1) / 4));
  const r = Math.round(51 + t * 204);
  const g = Math.round(255 - t * 155);
  const b = Math.round(102 - t * 80);
  return `rgb(${r},${g},${b})`;
}

export class TouchRipple {
  private container: HTMLDivElement;
  private styleEl: HTMLStyleElement;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      @keyframes ${ANIMATION_NAME} {
        from { transform: scale(0); opacity: 0.7; }
        to   { transform: scale(1); opacity: 0; }
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: '940',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    document.body.appendChild(this.container);
  }

  /** Spawn a one-shot expanding ring at the given screen coordinates. */
  spawn(clientX: number, clientY: number, intensity: number): void {
    const size = 60 + intensity * 20;
    const color = intensityColor(intensity);
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute',
      left: `${clientX - size / 2}px`,
      top: `${clientY - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      border: `2px solid ${color}`,
      boxSizing: 'border-box',
      animation: `${ANIMATION_NAME} 500ms ease-out forwards`,
      willChange: 'transform, opacity',
    });
    ring.addEventListener('animationend', () => ring.remove());
    this.container.appendChild(ring);
  }

  /** Spawn a sustained ring that grows while held. Returns a stop handle. */
  spawnSustain(clientX: number, clientY: number): { stop(): void } {
    const ring = document.createElement('div');
    const color = intensityColor(3);
    Object.assign(ring.style, {
      position: 'absolute',
      left: `${clientX}px`,
      top: `${clientY}px`,
      width: '0px',
      height: '0px',
      borderRadius: '50%',
      border: `2px solid ${color}`,
      boxSizing: 'border-box',
      transform: 'translate(-50%, -50%)',
      transition: 'width 2s ease-out, height 2s ease-out, opacity 0.3s ease',
      opacity: '0.6',
      willChange: 'width, height, opacity',
    });
    this.container.appendChild(ring);

    // Trigger grow on next frame
    requestAnimationFrame(() => {
      ring.style.width = '300px';
      ring.style.height = '300px';
    });

    return {
      stop() {
        ring.style.opacity = '0';
        ring.addEventListener('transitionend', () => ring.remove(), { once: true });
        // Safety cleanup
        setTimeout(() => ring.remove(), 500);
      },
    };
  }

  destroy(): void {
    this.container.remove();
    this.styleEl.remove();
  }
}
