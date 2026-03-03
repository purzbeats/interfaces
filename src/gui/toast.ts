/** Lightweight toast notification for keyboard shortcut feedback. */

let container: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let label: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container) return container;

  container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    pointer-events: none;
  `;

  label = document.createElement('div');
  label.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 13px;
    color: #aaffaa;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(170, 255, 170, 0.3);
    padding: 6px 14px;
    letter-spacing: 1px;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.15s ease-out;
    white-space: nowrap;
  `;
  container.appendChild(label);
  document.body.appendChild(container);

  return container;
}

/**
 * Show a brief toast message. Auto-hides after `duration` ms.
 * Subsequent calls replace the current toast.
 */
export function showToast(message: string, duration: number = 1200): void {
  ensureContainer();
  if (!label) return;

  label.textContent = message;
  label.style.opacity = '1';

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (label) label.style.opacity = '0';
    hideTimer = null;
  }, duration);
}
