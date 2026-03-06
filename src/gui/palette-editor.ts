import { getPalette, paletteNames } from '../color/palettes';
import {
  saveCustomPalette,
  deleteCustomPalette,
  isBuiltinPalette,
  type CustomPaletteData,
} from '../color/custom-palettes';

type OnChange = (paletteName: string) => void;
type OnRefresh = () => void;

interface PaletteEditorOptions {
  currentPalette: string;
  onChange: OnChange;
  onRefreshList: OnRefresh;
}

const FIELDS: { key: keyof Omit<CustomPaletteData, 'name'>; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'dim', label: 'Dim' },
  { key: 'alert', label: 'Alert' },
];

let overlay: HTMLDivElement | null = null;
let visible = false;

function colorToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function createOverlay(opts: PaletteEditorOptions): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.85);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.2s ease-out;
    pointer-events: auto;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    font-family: 'Courier New', monospace;
    color: #aaffaa;
    background: rgba(10, 10, 10, 0.95);
    border: 1px solid rgba(170, 255, 170, 0.25);
    padding: 24px;
    max-width: 420px;
    width: 90%;
  `;

  // Title
  const title = document.createElement('div');
  title.textContent = 'Palette Editor';
  title.style.cssText = `
    font-size: 14px; letter-spacing: 2px; text-transform: uppercase;
    margin-bottom: 16px; text-align: center;
    border-bottom: 1px solid rgba(170, 255, 170, 0.3);
    padding-bottom: 10px;
  `;
  card.appendChild(title);

  // Load current palette values
  const pal = getPalette(opts.currentPalette);
  const values: Record<string, string> = {
    bg: colorToHex(pal.bg),
    primary: colorToHex(pal.primary),
    secondary: colorToHex(pal.secondary),
    dim: colorToHex(pal.dim),
    alert: colorToHex(pal.alert),
  };

  // Name input
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex; align-items:center; margin-bottom:14px; gap:10px;';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name';
  nameLabel.style.cssText = 'font-size:12px; color:rgba(170,255,170,0.7); min-width:80px;';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = isBuiltinPalette(opts.currentPalette)
    ? ''
    : opts.currentPalette;
  nameInput.placeholder = 'my-palette';
  nameInput.style.cssText = `
    flex:1; background:#111; border:1px solid rgba(170,255,170,0.25);
    color:#aaffaa; font-family:inherit; font-size:12px; padding:4px 8px;
    outline:none;
  `;
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  card.appendChild(nameRow);

  // Color fields
  const pickers: Record<string, HTMLInputElement> = {};
  const hexInputs: Record<string, HTMLInputElement> = {};

  for (const { key, label } of FIELDS) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; margin-bottom:8px; gap:10px;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:12px; color:rgba(170,255,170,0.7); min-width:80px;';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = values[key];
    picker.style.cssText = `
      width:40px; height:28px; border:1px solid rgba(170,255,170,0.25);
      background:none; cursor:pointer; padding:0;
    `;
    pickers[key] = picker;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = values[key];
    hexInput.maxLength = 7;
    hexInput.style.cssText = `
      width:75px; background:#111; border:1px solid rgba(170,255,170,0.25);
      color:#aaffaa; font-family:inherit; font-size:12px; padding:4px 6px;
      outline:none;
    `;
    hexInputs[key] = hexInput;

    // Sync picker -> hex
    picker.addEventListener('input', () => {
      hexInput.value = picker.value;
      values[key] = picker.value;
      updatePreview();
    });

    // Sync hex -> picker
    hexInput.addEventListener('input', () => {
      const v = hexInput.value;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        picker.value = v;
        values[key] = v;
        updatePreview();
      }
    });

    row.appendChild(lbl);
    row.appendChild(picker);
    row.appendChild(hexInput);
    card.appendChild(row);
  }

  // Preview strip
  const previewContainer = document.createElement('div');
  previewContainer.style.cssText = `
    display:flex; height:24px; margin:16px 0; border:1px solid rgba(170,255,170,0.25);
    overflow:hidden;
  `;
  const previewSwatches: Record<string, HTMLDivElement> = {};
  for (const { key } of FIELDS) {
    const swatch = document.createElement('div');
    swatch.style.cssText = `flex:1; background:${values[key]};`;
    previewSwatches[key] = swatch;
    previewContainer.appendChild(swatch);
  }
  card.appendChild(previewContainer);

  function updatePreview() {
    for (const { key } of FIELDS) {
      previewSwatches[key].style.background = values[key];
    }
  }

  // Error message
  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = `
    font-size:11px; color:#ff5555; text-align:center;
    min-height:16px; margin-bottom:8px;
  `;
  card.appendChild(errorMsg);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:8px; justify-content:center;';

  function makeBtn(text: string, accent: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    const bg = accent ? 'rgba(170,255,170,0.15)' : 'rgba(170,255,170,0.05)';
    const hoverBg = accent ? 'rgba(170,255,170,0.25)' : 'rgba(170,255,170,0.12)';
    btn.style.cssText = `
      background:${bg}; border:1px solid rgba(170,255,170,0.3);
      color:#aaffaa; font-family:inherit; font-size:12px;
      padding:6px 16px; cursor:pointer;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseleave', () => { btn.style.background = bg; });
    return btn;
  }

  const saveBtn = makeBtn('Save', true);
  const deleteBtn = makeBtn('Delete', false);
  const cancelBtn = makeBtn('Cancel', false);

  // Only show delete for custom palettes
  if (!isBuiltinPalette(opts.currentPalette)) {
    btnRow.appendChild(deleteBtn);
  }
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  card.appendChild(btnRow);

  // Actions
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!name) {
      errorMsg.textContent = 'Please enter a palette name.';
      return;
    }
    if (isBuiltinPalette(name)) {
      errorMsg.textContent = 'Cannot overwrite a built-in palette.';
      return;
    }
    saveCustomPalette({
      name,
      bg: values.bg,
      primary: values.primary,
      secondary: values.secondary,
      dim: values.dim,
      alert: values.alert,
    });
    opts.onRefreshList();
    opts.onChange(name);
    closePaletteEditor();
  });

  deleteBtn.addEventListener('click', () => {
    const name = opts.currentPalette;
    if (isBuiltinPalette(name)) return;
    deleteCustomPalette(name);
    opts.onRefreshList();
    opts.onChange('phosphor-green');
    closePaletteEditor();
  });

  cancelBtn.addEventListener('click', () => {
    closePaletteEditor();
  });

  // Close on backdrop click
  el.addEventListener('click', (e) => {
    if (e.target === el) closePaletteEditor();
  });

  // Stop keyboard events from reaching the engine
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });

  el.appendChild(card);
  document.body.appendChild(el);
  return el;
}

export function openPaletteEditor(opts: PaletteEditorOptions): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  overlay = createOverlay(opts);
  visible = true;
  overlay.style.display = 'flex';
  overlay.offsetHeight; // force reflow
  overlay.style.opacity = '1';
}

export function closePaletteEditor(): void {
  if (!overlay) return;
  visible = false;
  overlay.style.opacity = '0';
  const el = overlay;
  setTimeout(() => {
    el.remove();
    if (overlay === el) overlay = null;
  }, 200);
}

export function isPaletteEditorVisible(): boolean {
  return visible;
}
