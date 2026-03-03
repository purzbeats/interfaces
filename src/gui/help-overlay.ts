/** Translucent keyboard shortcut overlay toggled with ? key. */

let overlay: HTMLDivElement | null = null;
let visible = false;

const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause / Play'],
  ['R', 'Regenerate (new seed)'],
  ['Backspace', 'Restart current'],
  ['L', 'Toggle loop mode'],
  ['M', 'Mute / Unmute'],
  ['F', 'Fullscreen'],
  ['S', 'Screenshot'],
  ['V', 'Record video'],
  ['G', 'Showcase mode'],
  ['B', 'Gallery mode'],
  ['H', 'Toggle settings panel'],
  ['1–5', 'Intensity (tap or hold)'],
  ['+/−', 'Adjust overscan padding'],
  ['Shift+Arrow', 'Nudge canvas offset'],
  ['?', 'This help'],
];

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease-out;
    pointer-events: auto;
    cursor: pointer;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    font-family: 'Courier New', monospace;
    color: #aaffaa;
    max-width: 400px;
    width: 90%;
  `;

  const title = document.createElement('div');
  title.textContent = 'Keyboard Shortcuts';
  title.style.cssText = `
    font-size: 14px;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 16px;
    text-align: center;
    border-bottom: 1px solid rgba(170, 255, 170, 0.3);
    padding-bottom: 10px;
  `;
  card.appendChild(title);

  for (const [key, desc] of SHORTCUTS) {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 12px;
    `;

    const keyEl = document.createElement('span');
    keyEl.textContent = key;
    keyEl.style.cssText = `
      background: rgba(170, 255, 170, 0.12);
      border: 1px solid rgba(170, 255, 170, 0.25);
      padding: 2px 8px;
      min-width: 70px;
      text-align: center;
      flex-shrink: 0;
    `;

    const descEl = document.createElement('span');
    descEl.textContent = desc;
    descEl.style.cssText = `
      color: rgba(170, 255, 170, 0.7);
      margin-left: 16px;
      text-align: right;
      flex: 1;
    `;

    row.appendChild(keyEl);
    row.appendChild(descEl);
    card.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.textContent = 'Press ? or click to close';
  hint.style.cssText = `
    font-size: 11px;
    color: rgba(170, 255, 170, 0.4);
    text-align: center;
    margin-top: 16px;
  `;
  card.appendChild(hint);

  el.appendChild(card);

  // Click anywhere to close
  el.addEventListener('click', () => toggleHelp());

  document.body.appendChild(el);
  return el;
}

export function toggleHelp(): void {
  if (!overlay) overlay = createOverlay();

  visible = !visible;
  if (visible) {
    overlay.style.display = 'flex';
    // Force reflow for transition
    overlay.offsetHeight;
    overlay.style.opacity = '1';
  } else {
    overlay.style.opacity = '0';
    setTimeout(() => {
      if (overlay && !visible) overlay.style.display = 'none';
    }, 200);
  }
}

export function isHelpVisible(): boolean {
  return visible;
}
