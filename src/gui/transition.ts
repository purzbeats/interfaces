/** Brief fade-to-black transition for regeneration. */

let curtain: HTMLDivElement | null = null;

function ensureCurtain(): HTMLDivElement {
  if (curtain) return curtain;

  curtain = document.createElement('div');
  curtain.style.cssText = `
    position: fixed;
    inset: 0;
    background: #000;
    z-index: 9000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease-in;
  `;
  document.body.appendChild(curtain);
  return curtain;
}

/**
 * Fade to black, call the callback at peak darkness, then fade back in.
 * Total duration ~350ms (150ms fade-in + 50ms hold + 150ms fade-out).
 */
export function fadeTransition(onBlack: () => void): void {
  const el = ensureCurtain();

  // Fade in
  el.style.transition = 'opacity 0.15s ease-in';
  el.style.opacity = '1';

  setTimeout(() => {
    onBlack();

    // Small hold at full black, then fade out
    setTimeout(() => {
      el.style.transition = 'opacity 0.18s ease-out';
      el.style.opacity = '0';
    }, 50);
  }, 150);
}
