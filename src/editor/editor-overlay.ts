import type { EditorRegion, EditorLayout } from './editor-layout';
import { elementTypes } from '../elements/registry';
import { getMeta } from '../elements/tags';
import { paletteNames } from '../color/palettes';

/* ---------- Types ---------- */

export interface OverlayCallbacks {
  onNewLayout: () => void;
  onSaveLayout: () => void;
  onLoadLayout: () => void;
  onExportLayout: () => void;
  onImportLayout: () => void;
  onClearLayout: () => void;
  onTogglePerform: () => void;
  onExitEditor: () => void;
  onPaletteElementClick: (elementType: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onToggleGrid: () => void;
  onSwapType: (newType: string) => void;
  onUpdateRegion: (x: number, y: number, w: number, h: number) => void;
  onRenameLayout: (name: string) => void;
  onChangePalette: (palette: string) => void;
  onPanelResize: () => void;
}

type FilterTag = string | null;

/* ---------- Style constants ---------- */

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const ACCENT = '#33ff66';
const ACCENT_DIM = 'rgba(51, 255, 102, 0.4)';
const ACCENT_BG = 'rgba(51, 255, 102, 0.08)';
const ACCENT_BORDER = 'rgba(51, 255, 102, 0.25)';
const BG_PANEL = 'rgba(0, 0, 0, 0.88)';
export const EDITOR_TOOLBAR_H = 40;
export const EDITOR_PANEL_H = 140;

const TILE_W = 108;

/* ---------- Custom scrollbar styles ---------- */

const SCROLLBAR_CSS = `
#editor-tile-scroll::-webkit-scrollbar {
  height: 6px;
}
#editor-tile-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
}
#editor-tile-scroll::-webkit-scrollbar-thumb {
  background: rgba(51, 255, 102, 0.25);
  border-radius: 3px;
}
#editor-tile-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(51, 255, 102, 0.45);
}
#editor-tile-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(51, 255, 102, 0.25) rgba(0, 0, 0, 0.3);
}
`;

/* ---------- Tag data ---------- */

const SHAPE_TAGS = ['rectangular', 'linear', 'radial'] as const;
const ROLE_TAGS = ['gauge', 'scanner', 'data-display', 'text', 'decorative'] as const;
const MOOD_TAGS = ['tactical', 'diagnostic', 'ambient'] as const;

function matchesTag(type: string, tag: string): boolean {
  const meta = getMeta(type);
  if (!meta) return false;
  return (
    meta.shape === tag ||
    meta.roles.includes(tag as any) ||
    meta.moods.includes(tag as any)
  );
}

/* ---------- Helpers ---------- */

function btn(label: string, action: () => void, extra?: Record<string, string>): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    background: ACCENT_BG,
    border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT,
    fontFamily: FONT,
    fontSize: '10px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '2px',
    whiteSpace: 'nowrap',
    ...extra,
  });
  b.addEventListener('click', action);
  b.addEventListener('mouseenter', () => { b.style.background = 'rgba(51, 255, 102, 0.2)'; });
  b.addEventListener('mouseleave', () => { b.style.background = extra?.background ?? ACCENT_BG; });
  return b;
}

function numInput(value: number, onChange: () => void, id?: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = '1';
  inp.min = '0';
  inp.max = '100';
  inp.value = Math.round(value * 100).toString();
  if (id) inp.id = id;
  Object.assign(inp.style, {
    width: '46px',
    background: '#111',
    border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT,
    fontFamily: FONT,
    fontSize: '10px',
    padding: '2px 4px',
    borderRadius: '2px',
    textAlign: 'right',
  });
  inp.addEventListener('change', onChange);
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return inp;
}

/* ---------- EditorOverlay class ---------- */

export class EditorOverlay {
  private root: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private hamburgerMenu: HTMLDivElement;
  private bottomPanel: HTMLDivElement;
  private paletteView!: HTMLDivElement;
  private inspectorView!: HTMLDivElement;
  private tileScroll!: HTMLDivElement;
  private handlesContainer: HTMLDivElement;
  private gridOverlay: HTMLDivElement;
  private contextMenuEl: HTMLDivElement;
  private helpDialog: HTMLDivElement;
  private callbacks: OverlayCallbacks;

  private allTypes: string[];
  private filteredTypes: string[];
  private activeFilter: FilterTag = null;
  private searchQuery: string = '';
  private _performMode: boolean = false;
  private _gridVisible: boolean = false;
  private _panelVisible: boolean = true;
  private panelMode: 'palette' | 'inspector' = 'palette';

  // Toolbar widgets
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private paletteSelect!: HTMLSelectElement;
  private layoutNameEl!: HTMLSpanElement;
  private statusTextEl!: HTMLSpanElement;
  private countLabel!: HTMLSpanElement;

  // Inspector inputs
  private propTypeSelect!: HTMLSelectElement;
  private propXInput!: HTMLInputElement;
  private propYInput!: HTMLInputElement;
  private propWInput!: HTMLInputElement;
  private propHInput!: HTMLInputElement;

  // Tile element cache (for thumbnail updates)
  private tileElements: Map<string, HTMLDivElement> = new Map();

  // Thumbnail getter — set by editor
  getThumbnail: ((type: string) => string | undefined) | null = null;

  /**
   * EditorMode sets this callback for drag operations.
   */
  onPointerDownOutside: ((e: PointerEvent) => void) | null = null;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
    this.allTypes = elementTypes().filter(t => t !== 'panel' && t !== 'separator');
    this.filteredTypes = this.allTypes;

    // Root
    this.root = document.createElement('div');
    this.root.id = 'editor-overlay';
    Object.assign(this.root.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '900', pointerEvents: 'none', fontFamily: FONT, color: '#fff',
    });

    this.toolbar = this.buildToolbar();
    this.hamburgerMenu = this.buildHamburgerMenu();
    this.bottomPanel = this.buildBottomPanel();
    this.handlesContainer = this.buildHandlesContainer();
    this.gridOverlay = this.buildGridOverlay();
    this.contextMenuEl = this.buildContextMenu();
    this.helpDialog = this.buildHelpDialog();

    this.root.append(
      this.toolbar, this.hamburgerMenu, this.bottomPanel,
      this.handlesContainer, this.gridOverlay, this.contextMenuEl, this.helpDialog,
    );
    document.body.appendChild(this.root);
    this.root.style.display = 'none';

    // Inject custom scrollbar styles
    if (!document.getElementById('editor-scrollbar-css')) {
      const style = document.createElement('style');
      style.id = 'editor-scrollbar-css';
      style.textContent = SCROLLBAR_CSS;
      document.head.appendChild(style);
    }

    this.populatePalette();
  }

  /* ==================== PUBLIC API ==================== */

  show(): void {
    this.root.style.display = '';
    this._performMode = false;
    this.panelMode = 'palette';
    this.showEditUI();
    this.hideMobileToolbar();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.clearHandles();
    this.hideHamburger();
    this.hideContextMenu();
    this.showMobileToolbar();
  }

  /** Make toolbar/panel translucent so the user can see and place elements behind them. */
  setDragTranslucent(translucent: boolean): void {
    const opacity = translucent ? '0.35' : '1';
    const events = translucent ? 'none' : 'auto';
    this.toolbar.style.opacity = opacity;
    this.toolbar.style.pointerEvents = events;
    this.bottomPanel.style.opacity = opacity;
    this.bottomPanel.style.pointerEvents = events;
  }

  private hideMobileToolbar(): void {
    const mt = document.getElementById('mobile-toolbar');
    if (mt) mt.style.display = 'none';
  }

  private showMobileToolbar(): void {
    const mt = document.getElementById('mobile-toolbar');
    if (mt) mt.style.display = '';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  get bottomPanelHeight(): number {
    return this._panelVisible && !this._performMode ? EDITOR_PANEL_H : 0;
  }

  /* ---------- Perform mode ---------- */

  enterPerformMode(): void {
    this._performMode = true;
    this.toolbar.style.display = 'none';
    this.bottomPanel.style.display = 'none';
    this.gridOverlay.style.display = 'none';
    this.clearHandles();
    this.hideContextMenu();
    this.hideHamburger();
  }

  exitPerformMode(): void {
    this._performMode = false;
    this.showEditUI();
  }

  get isPerformMode(): boolean {
    return this._performMode;
  }

  private showEditUI(): void {
    this.toolbar.style.display = '';
    this.bottomPanel.style.display = this._panelVisible ? '' : 'none';
    if (this._gridVisible) this.gridOverlay.style.display = '';
  }

  /* ---------- Panel toggle ---------- */

  togglePanel(): void {
    this._panelVisible = !this._panelVisible;
    if (!this._performMode) {
      this.bottomPanel.style.display = this._panelVisible ? '' : 'none';
      this.callbacks.onPanelResize();
    }
  }

  /* ---------- Grid overlay ---------- */

  toggleGrid(): void {
    this._gridVisible = !this._gridVisible;
    this.gridOverlay.style.display = this._gridVisible && !this._performMode ? '' : 'none';
  }

  get gridVisible(): boolean {
    return this._gridVisible;
  }

  updateGridPosition(canvasRect: DOMRect): void {
    Object.assign(this.gridOverlay.style, {
      left: `${canvasRect.left}px`, top: `${canvasRect.top}px`,
      width: `${canvasRect.width}px`, height: `${canvasRect.height}px`,
    });
  }

  /* ---------- Status ---------- */

  updateStatus(layout: EditorLayout, snapOn: boolean, undoCount: number = 0, redoCount: number = 0): void {
    this.statusTextEl.id = 'editor-status-text';
    const c = layout.regions.length;
    this.statusTextEl.textContent = `${c} el${c !== 1 ? 's' : ''} \u00b7 Snap ${snapOn ? 'On' : 'Off'}`;
    this.layoutNameEl.id = 'editor-layout-name';
    this.layoutNameEl.textContent = layout.name;
    this.undoBtn.style.opacity = undoCount > 0 ? '1' : '0.3';
    this.redoBtn.style.opacity = redoCount > 0 ? '1' : '0.3';
  }

  setPalette(name: string): void {
    this.paletteSelect.value = name;
  }

  /* ---------- Properties / Inspector ---------- */

  showProperties(region: EditorRegion): void {
    this.panelMode = 'inspector';
    this.paletteView.style.display = 'none';
    this.inspectorView.style.display = '';
    this.propTypeSelect.value = region.elementType;
    this.propXInput.value = Math.round(region.x * 100).toString();
    this.propYInput.value = Math.round(region.y * 100).toString();
    this.propWInput.value = Math.round(region.width * 100).toString();
    this.propHInput.value = Math.round(region.height * 100).toString();
  }

  hideProperties(): void {
    this.panelMode = 'palette';
    this.paletteView.style.display = '';
    this.inspectorView.style.display = 'none';
  }

  updatePropertiesPosition(region: EditorRegion): void {
    this.propXInput.value = Math.round(region.x * 100).toString();
    this.propYInput.value = Math.round(region.y * 100).toString();
    this.propWInput.value = Math.round(region.width * 100).toString();
    this.propHInput.value = Math.round(region.height * 100).toString();
  }

  /* ---------- Thumbnails ---------- */

  refreshThumbnails(): void {
    if (!this.getThumbnail) return;
    for (const [type, tile] of this.tileElements) {
      const url = this.getThumbnail(type);
      if (!url) continue;
      const img = tile.querySelector('img') as HTMLImageElement | null;
      const ph = tile.querySelector('.ph') as HTMLElement | null;
      if (img && !img.src) {
        img.src = url;
        img.style.display = '';
        if (ph) ph.style.display = 'none';
      }
    }
  }

  /* ---------- Handles ---------- */

  clearHandles(): void {
    this.handlesContainer.innerHTML = '';
  }

  showHandles(region: EditorRegion, canvasRect: DOMRect): void {
    this.clearHandles();
    const left = canvasRect.left + region.x * canvasRect.width;
    const top = canvasRect.top + (1 - region.y - region.height) * canvasRect.height;
    const w = region.width * canvasRect.width;
    const h = region.height * canvasRect.height;

    // Outline (move target)
    const outline = document.createElement('div');
    outline.dataset.editorOutline = region.id;
    Object.assign(outline.style, {
      position: 'fixed', left: `${left}px`, top: `${top}px`,
      width: `${w}px`, height: `${h}px`,
      border: `2px solid ${ACCENT}`, boxSizing: 'border-box',
      pointerEvents: 'auto', cursor: 'move', zIndex: '910',
    });
    outline.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault(); this.onPointerDownOutside?.(e);
    });
    outline.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.showContextMenu(e.clientX, e.clientY);
    });
    this.handlesContainer.appendChild(outline);

    // Type label
    const label = document.createElement('div');
    label.textContent = region.elementType;
    Object.assign(label.style, {
      position: 'fixed', left: `${left}px`, top: `${top - 16}px`,
      fontSize: '9px', color: ACCENT, textTransform: 'uppercase',
      pointerEvents: 'none', zIndex: '915',
      textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    });
    this.handlesContainer.appendChild(label);

    // Dimension label
    const dim = document.createElement('div');
    dim.textContent = `${Math.round(region.width * 100)}% \u00d7 ${Math.round(region.height * 100)}%`;
    Object.assign(dim.style, {
      position: 'fixed', left: `${left}px`, top: `${top + h + 2}px`,
      fontSize: '8px', color: ACCENT_DIM, pointerEvents: 'none', zIndex: '915',
    });
    this.handlesContainer.appendChild(dim);

    // 8 handles
    const sz = 10, half = sz / 2;
    const positions = [
      { id: 'nw', cx: left, cy: top, cur: 'nwse-resize' },
      { id: 'n', cx: left + w / 2, cy: top, cur: 'ns-resize' },
      { id: 'ne', cx: left + w, cy: top, cur: 'nesw-resize' },
      { id: 'e', cx: left + w, cy: top + h / 2, cur: 'ew-resize' },
      { id: 'se', cx: left + w, cy: top + h, cur: 'nwse-resize' },
      { id: 's', cx: left + w / 2, cy: top + h, cur: 'ns-resize' },
      { id: 'sw', cx: left, cy: top + h, cur: 'nesw-resize' },
      { id: 'w', cx: left, cy: top + h / 2, cur: 'ew-resize' },
    ];
    for (const p of positions) {
      const handle = document.createElement('div');
      handle.dataset.editorHandle = p.id;
      handle.dataset.editorRegion = region.id;
      Object.assign(handle.style, {
        position: 'fixed', left: `${p.cx - half}px`, top: `${p.cy - half}px`,
        width: `${sz}px`, height: `${sz}px`,
        background: ACCENT, border: '1px solid #000', boxSizing: 'border-box',
        cursor: p.cur, pointerEvents: 'auto', zIndex: '920',
      });
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); this.onPointerDownOutside?.(e);
      });
      this.handlesContainer.appendChild(handle);
    }
  }

  showGhostRect(canvasRect: DOMRect, x: number, y: number, w: number, h: number): void {
    let ghost = this.handlesContainer.querySelector('#editor-ghost') as HTMLDivElement | null;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'editor-ghost';
      Object.assign(ghost.style, {
        position: 'fixed', border: `2px dashed ${ACCENT}`,
        background: 'rgba(51, 255, 102, 0.05)', boxSizing: 'border-box',
        pointerEvents: 'none', zIndex: '905',
      });
      this.handlesContainer.appendChild(ghost);
    }
    Object.assign(ghost.style, {
      left: `${canvasRect.left + x * canvasRect.width}px`,
      top: `${canvasRect.top + (1 - y - h) * canvasRect.height}px`,
      width: `${w * canvasRect.width}px`,
      height: `${h * canvasRect.height}px`,
      display: '',
    });
  }

  hideGhostRect(): void {
    const ghost = this.handlesContainer.querySelector('#editor-ghost') as HTMLDivElement | null;
    if (ghost) ghost.style.display = 'none';
  }

  /* ---------- Context menu ---------- */

  showContextMenu(clientX: number, clientY: number): void {
    Object.assign(this.contextMenuEl.style, { left: `${clientX}px`, top: `${clientY}px`, display: '' });
    const close = (e: Event) => {
      if (!this.contextMenuEl.contains(e.target as Node)) this.hideContextMenu();
      document.removeEventListener('pointerdown', close, true);
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  hideContextMenu(): void {
    this.contextMenuEl.style.display = 'none';
  }

  /* ---------- Help dialog ---------- */

  showHelp(): void { this.helpDialog.style.display = 'flex'; }
  hideHelp(): void { this.helpDialog.style.display = 'none'; }
  get helpVisible(): boolean { return this.helpDialog.style.display !== 'none'; }

  /* ---------- Hamburger ---------- */

  private hideHamburger(): void { this.hamburgerMenu.style.display = 'none'; }

  /* ==================== DOM BUILDERS ==================== */

  /* ---------- Toolbar ---------- */

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      height: `${EDITOR_TOOLBAR_H}px`,
      background: 'linear-gradient(to bottom, rgba(0,0,0,0.92), rgba(8,12,8,0.95))',
      borderBottom: `1px solid ${ACCENT_BORDER}`,
      boxShadow: '0 2px 12px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(51,255,102,0.06)',
      display: 'flex', alignItems: 'center', gap: '4px', padding: '0 10px',
      pointerEvents: 'auto', zIndex: '950',
      transition: 'opacity 0.15s',
    });

    // Hamburger
    const hamburger = btn('\u2261', () => {
      this.hamburgerMenu.style.display = this.hamburgerMenu.style.display === 'none' ? '' : 'none';
    }, { fontSize: '16px', padding: '2px 8px', lineHeight: '1' });
    hamburger.title = 'Menu';
    bar.appendChild(hamburger);

    this.sep(bar);

    // Undo / Redo
    this.undoBtn = btn('\u21B6', this.callbacks.onUndo);
    this.undoBtn.title = 'Undo (Ctrl+Z)';
    this.undoBtn.style.opacity = '0.3';
    bar.appendChild(this.undoBtn);
    this.redoBtn = btn('\u21B7', this.callbacks.onRedo);
    this.redoBtn.title = 'Redo (Ctrl+Y)';
    this.redoBtn.style.opacity = '0.3';
    bar.appendChild(this.redoBtn);

    this.sep(bar);

    // Grid
    const gridBtn = btn('Grid', () => this.callbacks.onToggleGrid());
    gridBtn.title = 'Toggle grid (G)';
    bar.appendChild(gridBtn);

    // Palette selector
    const palLabel = document.createElement('span');
    palLabel.textContent = 'Pal:';
    Object.assign(palLabel.style, { fontSize: '9px', color: ACCENT_DIM, marginLeft: '4px' });
    bar.appendChild(palLabel);
    this.paletteSelect = document.createElement('select');
    this.paletteSelect.id = 'editor-palette-select';
    Object.assign(this.paletteSelect.style, {
      background: '#111', border: `1px solid ${ACCENT_BORDER}`,
      color: ACCENT, fontFamily: FONT, fontSize: '9px',
      padding: '3px 4px', cursor: 'pointer', borderRadius: '2px', maxWidth: '120px',
    });
    for (const n of paletteNames()) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      this.paletteSelect.appendChild(o);
    }
    this.paletteSelect.addEventListener('change', () => this.callbacks.onChangePalette(this.paletteSelect.value));
    bar.appendChild(this.paletteSelect);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Status
    this.statusTextEl = document.createElement('span');
    Object.assign(this.statusTextEl.style, { fontSize: '9px', color: ACCENT_DIM, marginRight: '6px' });
    bar.appendChild(this.statusTextEl);

    // Layout name (click to rename)
    this.layoutNameEl = document.createElement('span');
    Object.assign(this.layoutNameEl.style, {
      fontSize: '10px', color: ACCENT, cursor: 'pointer',
      borderBottom: `1px dashed ${ACCENT_BORDER}`, padding: '0 4px',
    });
    this.layoutNameEl.addEventListener('click', () => this.startNameEdit());
    bar.appendChild(this.layoutNameEl);

    this.sep(bar);

    // Help
    const helpBtn = btn('?', () => this.showHelp(), { fontWeight: 'bold' });
    helpBtn.title = 'Shortcuts (?)';
    bar.appendChild(helpBtn);

    // Perform
    bar.appendChild(btn('Perform', this.callbacks.onTogglePerform));
    bar.appendChild(btn('Exit', this.callbacks.onExitEditor));

    return bar;
  }

  private sep(parent: HTMLElement): void {
    const s = document.createElement('div');
    Object.assign(s.style, { width: '1px', height: '20px', background: ACCENT_BORDER, margin: '0 4px' });
    parent.appendChild(s);
  }

  /* ---------- Hamburger menu ---------- */

  private buildHamburgerMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'fixed', top: `${EDITOR_TOOLBAR_H}px`, left: '8px',
      background: 'rgba(10,10,10,0.95)', border: `1px solid ${ACCENT_BORDER}`,
      minWidth: '160px', pointerEvents: 'auto', zIndex: '960',
      padding: '4px 0', display: 'none',
    });

    const item = (label: string, action: () => void) => {
      const d = document.createElement('div');
      d.textContent = label;
      Object.assign(d.style, {
        padding: '6px 14px', fontSize: '10px', cursor: 'pointer',
        color: '#ddd', letterSpacing: '0.5px',
      });
      d.addEventListener('mouseenter', () => { d.style.background = 'rgba(51,255,102,0.1)'; });
      d.addEventListener('mouseleave', () => { d.style.background = 'none'; });
      d.addEventListener('click', () => { this.hideHamburger(); action(); });
      menu.appendChild(d);
    };

    item('New Layout', this.callbacks.onNewLayout);
    item('Save Layout (Ctrl+S)', this.callbacks.onSaveLayout);
    item('Load Layout', this.callbacks.onLoadLayout);
    this.menuSep(menu);
    item('Export JSON', this.callbacks.onExportLayout);
    item('Import JSON', this.callbacks.onImportLayout);
    this.menuSep(menu);
    item('Clear All', this.callbacks.onClearLayout);
    item('Toggle Panel (P)', () => this.togglePanel());

    return menu;
  }

  private menuSep(parent: HTMLElement): void {
    const s = document.createElement('div');
    Object.assign(s.style, { borderTop: `1px solid ${ACCENT_BORDER}`, margin: '3px 8px' });
    parent.appendChild(s);
  }

  /* ---------- Bottom panel ---------- */

  private buildBottomPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      height: `${EDITOR_PANEL_H}px`,
      background: 'linear-gradient(to bottom, rgba(8,12,8,0.95), rgba(0,0,0,0.92))',
      borderTop: `1px solid ${ACCENT_BORDER}`,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(51,255,102,0.06)',
      pointerEvents: 'auto', zIndex: '940',
      display: 'flex', flexDirection: 'column',
      transition: 'opacity 0.15s',
    });

    this.paletteView = this.buildPaletteView();
    this.inspectorView = this.buildInspectorView();
    this.inspectorView.style.display = 'none';

    panel.appendChild(this.paletteView);
    panel.appendChild(this.inspectorView);
    return panel;
  }

  /* --- Palette view --- */

  private buildPaletteView(): HTMLDivElement {
    const view = document.createElement('div');
    Object.assign(view.style, { display: 'flex', flexDirection: 'column', height: '100%' });

    // Header row
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '5px 12px', borderBottom: `1px solid rgba(51,255,102,0.12)`,
      flexShrink: '0', background: 'rgba(0,0,0,0.2)',
    });

    // Search
    const search = document.createElement('input');
    search.id = 'editor-palette-search';
    search.type = 'text';
    search.placeholder = '\u{1F50D} Search elements...';
    Object.assign(search.style, {
      width: '200px', background: 'rgba(0,0,0,0.4)', border: `1px solid rgba(51,255,102,0.15)`,
      color: ACCENT, fontFamily: FONT, fontSize: '10px',
      padding: '5px 10px', borderRadius: '3px', outline: 'none',
      transition: 'border-color 0.15s, box-shadow 0.15s',
    });
    search.addEventListener('input', () => {
      this.searchQuery = search.value.toLowerCase().trim();
      this.applyFilter();
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    search.addEventListener('focus', () => { search.style.borderColor = ACCENT; search.style.boxShadow = `0 0 8px rgba(51,255,102,0.15)`; });
    search.addEventListener('blur', () => { search.style.borderColor = 'rgba(51,255,102,0.15)'; search.style.boxShadow = 'none'; });
    header.appendChild(search);

    // Filter dropdown
    const filterSelect = document.createElement('select');
    Object.assign(filterSelect.style, {
      background: 'rgba(0,0,0,0.4)', border: `1px solid rgba(51,255,102,0.15)`,
      color: ACCENT, fontFamily: FONT, fontSize: '9px',
      padding: '4px 6px', cursor: 'pointer', borderRadius: '3px',
      outline: 'none',
    });
    const addFilterOpt = (label: string, value: string) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      filterSelect.appendChild(o);
    };
    addFilterOpt('All', '');
    for (const t of SHAPE_TAGS) addFilterOpt(t, t);
    for (const t of ROLE_TAGS) addFilterOpt(t.replace('-', ' '), t);
    for (const t of MOOD_TAGS) addFilterOpt(t, t);
    filterSelect.addEventListener('change', () => {
      this.activeFilter = filterSelect.value || null;
      this.applyFilter();
    });
    header.appendChild(filterSelect);

    // Count
    this.countLabel = document.createElement('span');
    this.countLabel.id = 'editor-palette-count';
    Object.assign(this.countLabel.style, { fontSize: '8px', color: ACCENT_DIM, marginLeft: 'auto' });
    this.countLabel.textContent = `${this.allTypes.length} elements`;
    header.appendChild(this.countLabel);

    // Hint
    const hint = document.createElement('span');
    hint.textContent = '? shortcuts';
    Object.assign(hint.style, { fontSize: '8px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.5px' });
    header.appendChild(hint);

    view.appendChild(header);

    // Tile scroll area
    this.tileScroll = document.createElement('div');
    this.tileScroll.id = 'editor-tile-scroll';
    Object.assign(this.tileScroll.style, {
      flex: '1', overflowX: 'auto', overflowY: 'hidden',
      display: 'flex', gap: '8px', padding: '8px 12px 6px',
      alignItems: 'stretch',
    });
    view.appendChild(this.tileScroll);

    return view;
  }

  private applyFilter(): void {
    let types = this.allTypes;
    if (this.activeFilter) {
      types = types.filter(t => matchesTag(t, this.activeFilter!));
    }
    if (this.searchQuery) {
      const q = this.searchQuery;
      types = types.filter(t => t.includes(q) || t.replace(/-/g, ' ').includes(q));
    }
    this.filteredTypes = types;
    this.populatePalette();
    this.countLabel.textContent = `${this.filteredTypes.length} of ${this.allTypes.length}`;
  }

  private populatePalette(): void {
    this.tileScroll.innerHTML = '';
    this.tileElements.clear();

    for (const type of this.filteredTypes) {
      const tile = document.createElement('div');
      tile.dataset.elementType = type;
      Object.assign(tile.style, {
        flexShrink: '0', width: `${TILE_W}px`,
        background: 'rgba(0,0,0,0.35)', border: `1px solid rgba(51,255,102,0.12)`,
        borderRadius: '4px', cursor: 'grab', userSelect: 'none',
        touchAction: 'none', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 0.15s, transform 0.12s, box-shadow 0.15s',
      });

      // Thumbnail container
      const thumbBox = document.createElement('div');
      Object.assign(thumbBox.style, {
        width: '100%', height: '64px', position: 'relative',
        overflow: 'hidden', background: 'rgba(0,0,0,0.5)',
        borderBottom: '1px solid rgba(51,255,102,0.08)',
      });

      // Actual thumbnail img (hidden until loaded)
      const img = document.createElement('img');
      Object.assign(img.style, {
        width: '100%', height: '100%', objectFit: 'cover', display: 'none',
        imageRendering: 'pixelated',
      });
      img.draggable = false;

      // Check if we already have a thumbnail
      const existingThumb = this.getThumbnail?.(type);
      if (existingThumb) {
        img.src = existingThumb;
        img.style.display = '';
      }

      // Placeholder (shown until thumbnail is ready)
      const ph = document.createElement('div');
      ph.className = 'ph';
      Object.assign(ph.style, {
        position: 'absolute', inset: '0',
        display: existingThumb ? 'none' : 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: '7px', color: 'rgba(51,255,102,0.3)', textTransform: 'uppercase',
        letterSpacing: '0.5px', textAlign: 'center', padding: '4px',
        wordBreak: 'break-word', lineHeight: '1.3',
        background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(51,255,102,0.03) 4px, rgba(51,255,102,0.03) 8px)',
      });
      ph.textContent = type.replace(/-/g, ' ');

      thumbBox.appendChild(img);
      thumbBox.appendChild(ph);
      tile.appendChild(thumbBox);

      // Name label
      const name = document.createElement('div');
      name.textContent = type.replace(/-/g, ' ');
      Object.assign(name.style, {
        fontSize: '7px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
        textAlign: 'center', padding: '4px 3px', letterSpacing: '0.5px',
        lineHeight: '1.2', overflow: 'hidden', whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      });
      tile.appendChild(name);

      // Hover
      tile.addEventListener('mouseenter', () => {
        tile.style.borderColor = ACCENT;
        tile.style.transform = 'translateY(-2px)';
        tile.style.boxShadow = `0 4px 12px rgba(51,255,102,0.15), inset 0 0 0 1px rgba(51,255,102,0.1)`;
        name.style.color = ACCENT;
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.borderColor = 'rgba(51,255,102,0.12)';
        tile.style.transform = 'translateY(0)';
        tile.style.boxShadow = 'none';
        name.style.color = 'rgba(255,255,255,0.4)';
      });

      // Interaction (click + drag)
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        this.onPointerDownOutside?.(e);
      });

      this.tileScroll.appendChild(tile);
      this.tileElements.set(type, tile);
    }
  }

  /* --- Inspector view --- */

  private buildInspectorView(): HTMLDivElement {
    const view = document.createElement('div');
    view.id = 'editor-properties';
    Object.assign(view.style, { display: 'flex', flexDirection: 'column', height: '100%' });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '5px 12px', borderBottom: `1px solid rgba(51,255,102,0.12)`,
      flexShrink: '0', background: 'rgba(0,0,0,0.2)',
    });

    const backBtn = btn('\u2190 Palette', () => this.hideProperties());
    header.appendChild(backBtn);

    const title = document.createElement('span');
    title.textContent = 'INSPECTOR';
    Object.assign(title.style, { fontSize: '10px', letterSpacing: '2px', color: ACCENT });
    header.appendChild(title);

    header.appendChild(document.createElement('div')).style.flex = '1';

    // Deselect button
    const deselBtn = btn('Deselect', () => {
      this.hideProperties();
      this.clearHandles();
      this.callbacks.onDelete; // just trigger deselect by hiding props
    }, { color: ACCENT_DIM });
    header.appendChild(deselBtn);

    view.appendChild(header);

    // Controls body
    const body = document.createElement('div');
    Object.assign(body.style, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      gap: '8px', padding: '8px 10px', flex: '1',
    });

    // Type selector
    const typeGroup = this.labelGroup('Type');
    this.propTypeSelect = document.createElement('select');
    this.propTypeSelect.id = 'editor-prop-type';
    Object.assign(this.propTypeSelect.style, {
      background: '#111', border: `1px solid ${ACCENT_BORDER}`,
      color: ACCENT, fontFamily: FONT, fontSize: '9px',
      padding: '3px 4px', cursor: 'pointer', maxWidth: '160px',
    });
    for (const t of this.allTypes) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      this.propTypeSelect.appendChild(o);
    }
    this.propTypeSelect.addEventListener('change', () => this.callbacks.onSwapType(this.propTypeSelect.value));
    this.propTypeSelect.addEventListener('keydown', (e) => e.stopPropagation());
    typeGroup.appendChild(this.propTypeSelect);
    body.appendChild(typeGroup);

    this.sep(body);

    // Position
    const posGroup = this.labelGroup('Pos');
    const xL = document.createElement('span');
    xL.textContent = 'X'; xL.style.cssText = 'font-size:9px;color:' + ACCENT_DIM;
    posGroup.appendChild(xL);
    this.propXInput = numInput(0, () => this.fireRegionUpdate(), 'editor-prop-x');
    posGroup.appendChild(this.propXInput);
    const yL = document.createElement('span');
    yL.textContent = 'Y'; yL.style.cssText = 'font-size:9px;color:' + ACCENT_DIM;
    posGroup.appendChild(yL);
    this.propYInput = numInput(0, () => this.fireRegionUpdate(), 'editor-prop-y');
    posGroup.appendChild(this.propYInput);
    body.appendChild(posGroup);

    // Size
    const sizeGroup = this.labelGroup('Size');
    const wL = document.createElement('span');
    wL.textContent = 'W'; wL.style.cssText = 'font-size:9px;color:' + ACCENT_DIM;
    sizeGroup.appendChild(wL);
    this.propWInput = numInput(0, () => this.fireRegionUpdate(), 'editor-prop-w');
    sizeGroup.appendChild(this.propWInput);
    const hL = document.createElement('span');
    hL.textContent = 'H'; hL.style.cssText = 'font-size:9px;color:' + ACCENT_DIM;
    sizeGroup.appendChild(hL);
    this.propHInput = numInput(0, () => this.fireRegionUpdate(), 'editor-prop-h');
    sizeGroup.appendChild(this.propHInput);
    body.appendChild(sizeGroup);

    this.sep(body);

    // Actions
    body.appendChild(btn('Duplicate', this.callbacks.onDuplicate));
    body.appendChild(btn('Delete', this.callbacks.onDelete, { color: '#ff6644' }));
    body.appendChild(btn('\u2191 Front', this.callbacks.onBringToFront));
    body.appendChild(btn('\u2193 Back', this.callbacks.onSendToBack));

    view.appendChild(body);
    return view;
  }

  private labelGroup(label: string): HTMLDivElement {
    const g = document.createElement('div');
    Object.assign(g.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    const l = document.createElement('span');
    l.textContent = label;
    Object.assign(l.style, { fontSize: '8px', color: ACCENT_DIM, letterSpacing: '1px', textTransform: 'uppercase' });
    g.appendChild(l);
    return g;
  }

  private fireRegionUpdate(): void {
    const x = Math.max(0, Math.min(100, parseFloat(this.propXInput.value) || 0)) / 100;
    const y = Math.max(0, Math.min(100, parseFloat(this.propYInput.value) || 0)) / 100;
    const w = Math.max(5, Math.min(100, parseFloat(this.propWInput.value) || 5)) / 100;
    const h = Math.max(5, Math.min(100, parseFloat(this.propHInput.value) || 5)) / 100;
    this.callbacks.onUpdateRegion(x, y, w, h);
  }

  /* ---------- Grid overlay ---------- */

  private buildGridOverlay(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.id = 'editor-grid-overlay';
    Object.assign(grid.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '895', display: 'none',
    });
    const cols = 12;
    for (let i = 1; i < cols; i++) {
      const pct = (i / cols * 100).toFixed(4);
      const v = document.createElement('div');
      Object.assign(v.style, {
        position: 'absolute', left: `${pct}%`, top: '0', bottom: '0',
        width: '1px', background: 'rgba(51,255,102,0.08)',
      });
      grid.appendChild(v);
      const h = document.createElement('div');
      Object.assign(h.style, {
        position: 'absolute', top: `${pct}%`, left: '0', right: '0',
        height: '1px', background: 'rgba(51,255,102,0.08)',
      });
      grid.appendChild(h);
    }
    return grid;
  }

  /* ---------- Context menu ---------- */

  private buildContextMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.id = 'editor-context-menu';
    Object.assign(menu.style, {
      position: 'fixed', display: 'none',
      background: 'rgba(10,10,10,0.95)', border: `1px solid ${ACCENT_BORDER}`,
      minWidth: '160px', pointerEvents: 'auto', zIndex: '990', padding: '4px 0',
    });
    const item = (label: string, shortcut: string, action: () => void) => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '5px 12px', fontSize: '10px', cursor: 'pointer', color: '#ddd',
      });
      const l = document.createElement('span'); l.textContent = label; d.appendChild(l);
      if (shortcut) {
        const s = document.createElement('span'); s.textContent = shortcut;
        Object.assign(s.style, { color: ACCENT_DIM, fontSize: '9px' }); d.appendChild(s);
      }
      d.addEventListener('mouseenter', () => { d.style.background = 'rgba(51,255,102,0.1)'; });
      d.addEventListener('mouseleave', () => { d.style.background = 'none'; });
      d.addEventListener('click', () => { this.hideContextMenu(); action(); });
      menu.appendChild(d);
    };
    item('Duplicate', 'Ctrl+D', this.callbacks.onDuplicate);
    item('Delete', 'Del', this.callbacks.onDelete);
    this.menuSep(menu);
    item('Bring to Front', '', this.callbacks.onBringToFront);
    item('Send to Back', '', this.callbacks.onSendToBack);
    this.menuSep(menu);
    item('Undo', 'Ctrl+Z', this.callbacks.onUndo);
    item('Redo', 'Ctrl+Y', this.callbacks.onRedo);
    return menu;
  }

  /* ---------- Help dialog ---------- */

  private buildHelpDialog(): HTMLDivElement {
    const backdrop = document.createElement('div');
    backdrop.id = 'editor-help-dialog';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.7)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto', zIndex: '10000',
    });
    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#111', border: `1px solid ${ACCENT_BORDER}`,
      padding: '20px 28px', minWidth: '320px', maxWidth: '400px',
    });
    const title = document.createElement('div');
    title.textContent = 'KEYBOARD SHORTCUTS';
    Object.assign(title.style, {
      color: ACCENT, fontSize: '12px', letterSpacing: '2px', textAlign: 'center',
      marginBottom: '12px', paddingBottom: '8px', borderBottom: `1px solid ${ACCENT_BORDER}`,
    });
    modal.appendChild(title);
    const shortcuts: [string, string][] = [
      ['Esc', 'Exit editor'], ['Tab', 'Perform mode'], ['P', 'Toggle panel'],
      ['G', 'Toggle grid'], ['?', 'This help'], ['', ''],
      ['Del / Backspace', 'Delete selected'], ['Ctrl+D', 'Duplicate'],
      ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Ctrl+S', 'Save layout'], ['', ''],
      ['\u2190\u2191\u2192\u2193', 'Nudge selected'],
      ['Click tile', 'Place at center'], ['Drag tile', 'Place at position'],
      ['Right-click', 'Context menu'],
    ];
    for (const [key, desc] of shortcuts) {
      if (!key && !desc) { const s = document.createElement('div'); s.style.height = '6px'; modal.appendChild(s); continue; }
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '10px' });
      const k = document.createElement('span');
      k.textContent = key; Object.assign(k.style, { color: ACCENT, minWidth: '120px' });
      const d = document.createElement('span');
      d.textContent = desc; Object.assign(d.style, { color: 'rgba(255,255,255,0.6)' });
      row.appendChild(k); row.appendChild(d);
      modal.appendChild(row);
    }
    const closeBtn = btn('Close', () => this.hideHelp(), { display: 'block', margin: '14px auto 0' });
    modal.appendChild(closeBtn);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.hideHelp(); });
    return backdrop;
  }

  /* ---------- Handles container ---------- */

  private buildHandlesContainer(): HTMLDivElement {
    const c = document.createElement('div');
    c.id = 'editor-handles';
    Object.assign(c.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '900' });
    return c;
  }

  /* ---------- Name edit ---------- */

  private startNameEdit(): void {
    const currentName = this.layoutNameEl.textContent || 'Untitled';
    const input = document.createElement('input');
    input.id = 'editor-layout-name-input';
    input.type = 'text';
    input.value = currentName;
    Object.assign(input.style, {
      background: '#111', border: `1px solid ${ACCENT}`,
      color: ACCENT, fontFamily: FONT, fontSize: '10px',
      padding: '1px 4px', width: '140px', outline: 'none',
    });
    const commit = () => {
      const name = input.value.trim() || 'Untitled';
      this.layoutNameEl.textContent = name;
      this.layoutNameEl.style.display = '';
      input.remove();
      this.callbacks.onRenameLayout(name);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { this.layoutNameEl.style.display = ''; input.remove(); }
    });
    input.addEventListener('blur', commit);
    this.layoutNameEl.style.display = 'none';
    this.layoutNameEl.parentElement!.insertBefore(input, this.layoutNameEl.nextSibling);
    input.focus(); input.select();
  }

  /* ---------- Entry / Load dialogs ---------- */

  showEntryPrompt(hasSaved: boolean, onChoice: (choice: 'current' | 'blank' | 'load') => void): void {
    const backdrop = this.modalBackdrop();
    const modal = this.modalCard('ENTER EDITOR');

    const makeChoice = (label: string, choice: 'current' | 'blank' | 'load') => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
        color: '#fff', fontFamily: FONT, fontSize: '11px', letterSpacing: '1px',
        padding: '10px 16px', cursor: 'pointer', textAlign: 'left', width: '100%',
      });
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(51,255,102,0.2)'; b.style.borderColor = ACCENT; });
      b.addEventListener('mouseleave', () => { b.style.background = ACCENT_BG; b.style.borderColor = ACCENT_BORDER; });
      b.addEventListener('click', () => { backdrop.remove(); onChoice(choice); });
      modal.appendChild(b);
    };

    makeChoice('Start from current layout', 'current');
    makeChoice('Start blank', 'blank');
    if (hasSaved) makeChoice('Load saved layout', 'load');
    modal.appendChild(this.cancelBtn(() => backdrop.remove()));
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  showLoadDialog(layouts: EditorLayout[], onSelect: (index: number) => void): void {
    const backdrop = this.modalBackdrop();
    const modal = this.modalCard('LOAD LAYOUT');

    if (layouts.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved layouts';
      Object.assign(empty.style, { color: 'rgba(255,255,255,0.4)', fontSize: '11px', textAlign: 'center', padding: '16px' });
      modal.appendChild(empty);
    } else {
      for (let i = 0; i < layouts.length; i++) {
        const layout = layouts[i];
        const b = document.createElement('button');
        const date = new Date(layout.modified).toLocaleDateString();
        b.textContent = `${layout.name} (${layout.regions.length} elements, ${date})`;
        Object.assign(b.style, {
          background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
          color: '#fff', fontFamily: FONT, fontSize: '10px', padding: '8px 12px',
          cursor: 'pointer', textAlign: 'left', width: '100%',
        });
        b.addEventListener('mouseenter', () => { b.style.background = 'rgba(51,255,102,0.2)'; });
        b.addEventListener('mouseleave', () => { b.style.background = ACCENT_BG; });
        b.addEventListener('click', () => { backdrop.remove(); onSelect(i); });
        modal.appendChild(b);
      }
    }
    modal.appendChild(this.cancelBtn(() => backdrop.remove()));
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  private modalBackdrop(): HTMLDivElement {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '10000', fontFamily: FONT,
    });
    return d;
  }

  private modalCard(title: string): HTMLDivElement {
    const d = document.createElement('div');
    Object.assign(d.style, {
      background: '#111', border: `1px solid ${ACCENT_BORDER}`,
      padding: '24px 32px', display: 'flex', flexDirection: 'column',
      gap: '12px', minWidth: '280px',
    });
    const t = document.createElement('div');
    t.textContent = title;
    Object.assign(t.style, { color: ACCENT, fontSize: '13px', letterSpacing: '3px', textAlign: 'center', marginBottom: '8px' });
    d.appendChild(t);
    return d;
  }

  private cancelBtn(action: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = 'Cancel';
    Object.assign(b.style, {
      background: 'none', border: '1px solid rgba(255,255,255,0.15)',
      color: 'rgba(255,255,255,0.4)', fontFamily: FONT, fontSize: '10px',
      padding: '6px 16px', cursor: 'pointer', marginTop: '4px',
    });
    b.addEventListener('click', action);
    return b;
  }

  /* ---------- Cleanup ---------- */

  dispose(): void {
    this.root.remove();
  }
}
