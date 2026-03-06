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
  onTogglePalette: () => void;
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
}

type FilterTag = string | null;

/* ---------- Style constants ---------- */

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const ACCENT = '#33ff66';
const ACCENT_DIM = 'rgba(51, 255, 102, 0.4)';
const ACCENT_BG = 'rgba(51, 255, 102, 0.08)';
const ACCENT_BORDER = 'rgba(51, 255, 102, 0.25)';
const BG_PANEL = 'rgba(0, 0, 0, 0.85)';
const TOOLBAR_H = 36;
const STATUS_H = 28;
const PALETTE_W = 240;
const PROPS_W = 220;

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

function makeBtn(label: string, action: () => void, extraStyle?: Partial<CSSStyleDeclaration>): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn.style, {
    background: ACCENT_BG,
    border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT,
    fontFamily: FONT,
    fontSize: '10px',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '2px',
    whiteSpace: 'nowrap',
    ...extraStyle,
  });
  btn.addEventListener('click', action);
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(51, 255, 102, 0.2)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = extraStyle?.background ?? ACCENT_BG; });
  return btn;
}

function makeSelect(options: string[], selected: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  Object.assign(sel.style, {
    background: '#111',
    border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT,
    fontFamily: FONT,
    fontSize: '9px',
    padding: '3px 4px',
    cursor: 'pointer',
    borderRadius: '2px',
    maxWidth: '130px',
  });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === selected) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeNumberInput(value: number, onChange: (v: number) => void, id?: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = '1';
  inp.min = '0';
  inp.max = '100';
  inp.value = Math.round(value * 100).toString();
  if (id) inp.id = id;
  Object.assign(inp.style, {
    width: '52px',
    background: '#111',
    border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT,
    fontFamily: FONT,
    fontSize: '10px',
    padding: '2px 4px',
    borderRadius: '2px',
    textAlign: 'right',
  });
  inp.addEventListener('change', () => {
    const v = Math.max(0, Math.min(100, parseFloat(inp.value) || 0)) / 100;
    onChange(v);
  });
  // Stop keyboard events from reaching the editor
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return inp;
}

/* ---------- EditorOverlay class ---------- */

export class EditorOverlay {
  private root: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private palette: HTMLDivElement;
  private paletteGrid: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private handlesContainer: HTMLDivElement;
  private propertiesPanel: HTMLDivElement;
  private gridOverlay: HTMLDivElement;
  private contextMenuEl: HTMLDivElement;
  private helpDialog: HTMLDivElement;
  private callbacks: OverlayCallbacks;
  private allTypes: string[];
  private filteredTypes: string[];
  private activeFilter: FilterTag = null;
  private searchQuery: string = '';
  private _paletteVisible: boolean = true;
  private _performMode: boolean = false;
  private _gridVisible: boolean = false;
  private performBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private paletteSelect!: HTMLSelectElement;
  private statusTextEl!: HTMLSpanElement;
  private layoutNameEl!: HTMLSpanElement;

  // Properties panel inputs
  private propTypeSelect!: HTMLSelectElement;
  private propXInput!: HTMLInputElement;
  private propYInput!: HTMLInputElement;
  private propWInput!: HTMLInputElement;
  private propHInput!: HTMLInputElement;
  private currentPropsRegion: EditorRegion | null = null;

  /**
   * EditorMode sets this callback. It is called whenever a pointerdown happens
   * on an interactive overlay element (handle, outline, palette tile).
   */
  onPointerDownOutside: ((e: PointerEvent) => void) | null = null;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
    this.allTypes = elementTypes().filter(t => t !== 'panel' && t !== 'separator');
    this.filteredTypes = this.allTypes;

    this.root = document.createElement('div');
    this.root.id = 'editor-overlay';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '900',
      pointerEvents: 'none',
      fontFamily: FONT,
      color: '#fff',
    });

    this.toolbar = this.createToolbar();
    this.palette = this.createPalette();
    this.paletteGrid = this.palette.querySelector('#editor-palette-grid') as HTMLDivElement;
    this.statusBar = this.createStatusBar();
    this.handlesContainer = this.createHandlesContainer();
    this.propertiesPanel = this.createPropertiesPanel();
    this.gridOverlay = this.createGridOverlay();
    this.contextMenuEl = this.createContextMenu();
    this.helpDialog = this.createHelpDialog();

    this.root.append(
      this.toolbar,
      this.palette,
      this.propertiesPanel,
      this.statusBar,
      this.handlesContainer,
      this.gridOverlay,
      this.contextMenuEl,
      this.helpDialog,
    );
    document.body.appendChild(this.root);
    this.root.style.display = 'none';

    this.populatePalette();
  }

  show(): void {
    this.root.style.display = '';
    this._performMode = false;
    this.showEditUI();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.clearHandles();
    this.hideProperties();
    this.hideContextMenu();
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /* ---------- Perform mode toggle ---------- */

  enterPerformMode(): void {
    this._performMode = true;
    this.toolbar.style.display = 'none';
    this.palette.style.display = 'none';
    this.propertiesPanel.style.display = 'none';
    this.statusBar.style.display = 'none';
    this.gridOverlay.style.display = 'none';
    this.clearHandles();
    this.hideContextMenu();
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
    this.palette.style.display = this._paletteVisible ? '' : 'none';
    this.statusBar.style.display = '';
    if (this._gridVisible) this.gridOverlay.style.display = '';
    this.updatePerformBtn();
  }

  /* ---------- Palette visibility ---------- */

  togglePalette(): void {
    this._paletteVisible = !this._paletteVisible;
    if (!this._performMode) {
      this.palette.style.display = this._paletteVisible ? '' : 'none';
    }
  }

  get paletteVisible(): boolean {
    return this._paletteVisible;
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
      left: `${canvasRect.left}px`,
      top: `${canvasRect.top}px`,
      width: `${canvasRect.width}px`,
      height: `${canvasRect.height}px`,
    });
  }

  /* ---------- Status bar ---------- */

  updateStatus(layout: EditorLayout, snapOn: boolean, undoCount: number = 0, redoCount: number = 0): void {
    const count = layout.regions.length;
    this.statusTextEl.id = 'editor-status-text';
    this.statusTextEl.innerHTML = `${count} element${count !== 1 ? 's' : ''} &nbsp;\u00b7&nbsp; Snap: ${snapOn ? 'On' : 'Off'}`;

    this.layoutNameEl.id = 'editor-layout-name';
    this.layoutNameEl.textContent = layout.name;
    this.layoutNameEl.title = 'Click to rename';

    // Update undo/redo button states
    this.undoBtn.style.opacity = undoCount > 0 ? '1' : '0.3';
    this.undoBtn.style.pointerEvents = undoCount > 0 ? 'auto' : 'none';
    this.redoBtn.style.opacity = redoCount > 0 ? '1' : '0.3';
    this.redoBtn.style.pointerEvents = redoCount > 0 ? 'auto' : 'none';
  }

  /* ---------- Properties panel ---------- */

  showProperties(region: EditorRegion): void {
    this.currentPropsRegion = region;
    this.propertiesPanel.style.display = '';

    this.propTypeSelect.value = region.elementType;
    this.propXInput.value = Math.round(region.x * 100).toString();
    this.propYInput.value = Math.round(region.y * 100).toString();
    this.propWInput.value = Math.round(region.width * 100).toString();
    this.propHInput.value = Math.round(region.height * 100).toString();
  }

  hideProperties(): void {
    this.currentPropsRegion = null;
    this.propertiesPanel.style.display = 'none';
  }

  updatePropertiesPosition(region: EditorRegion): void {
    if (!this.currentPropsRegion) return;
    this.currentPropsRegion = region;
    this.propXInput.value = Math.round(region.x * 100).toString();
    this.propYInput.value = Math.round(region.y * 100).toString();
    this.propWInput.value = Math.round(region.width * 100).toString();
    this.propHInput.value = Math.round(region.height * 100).toString();
  }

  /* ---------- Resize handles ---------- */

  clearHandles(): void {
    this.handlesContainer.innerHTML = '';
  }

  showHandles(region: EditorRegion, canvasRect: DOMRect): void {
    this.clearHandles();

    const left = canvasRect.left + region.x * canvasRect.width;
    const top = canvasRect.top + (1 - region.y - region.height) * canvasRect.height;
    const w = region.width * canvasRect.width;
    const h = region.height * canvasRect.height;

    // Selection outline — move target
    const outline = document.createElement('div');
    outline.dataset.editorOutline = region.id;
    Object.assign(outline.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
      border: `2px solid ${ACCENT}`,
      boxSizing: 'border-box',
      pointerEvents: 'auto',
      cursor: 'move',
      zIndex: '910',
    });
    outline.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onPointerDownOutside?.(e);
    });
    outline.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e.clientX, e.clientY);
    });
    this.handlesContainer.appendChild(outline);

    // Element type label above outline
    const label = document.createElement('div');
    label.textContent = region.elementType;
    Object.assign(label.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top - 16}px`,
      fontSize: '9px',
      letterSpacing: '0.5px',
      color: ACCENT,
      textTransform: 'uppercase',
      pointerEvents: 'none',
      zIndex: '915',
      textShadow: '0 0 4px rgba(0,0,0,0.8)',
    });
    this.handlesContainer.appendChild(label);

    // Dimension label below outline
    const dimLabel = document.createElement('div');
    const pctW = Math.round(region.width * 100);
    const pctH = Math.round(region.height * 100);
    dimLabel.textContent = `${pctW}% \u00d7 ${pctH}%`;
    Object.assign(dimLabel.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top + h + 2}px`,
      fontSize: '8px',
      color: ACCENT_DIM,
      pointerEvents: 'none',
      zIndex: '915',
    });
    this.handlesContainer.appendChild(dimLabel);

    // 8 handles: corners + edge midpoints
    const handleSize = 10;
    const half = handleSize / 2;
    const positions: { id: string; cx: number; cy: number; cursor: string }[] = [
      { id: 'nw', cx: left, cy: top, cursor: 'nwse-resize' },
      { id: 'n', cx: left + w / 2, cy: top, cursor: 'ns-resize' },
      { id: 'ne', cx: left + w, cy: top, cursor: 'nesw-resize' },
      { id: 'e', cx: left + w, cy: top + h / 2, cursor: 'ew-resize' },
      { id: 'se', cx: left + w, cy: top + h, cursor: 'nwse-resize' },
      { id: 's', cx: left + w / 2, cy: top + h, cursor: 'ns-resize' },
      { id: 'sw', cx: left, cy: top + h, cursor: 'nesw-resize' },
      { id: 'w', cx: left, cy: top + h / 2, cursor: 'ew-resize' },
    ];

    for (const pos of positions) {
      const handle = document.createElement('div');
      handle.dataset.editorHandle = pos.id;
      handle.dataset.editorRegion = region.id;
      Object.assign(handle.style, {
        position: 'fixed',
        left: `${pos.cx - half}px`,
        top: `${pos.cy - half}px`,
        width: `${handleSize}px`,
        height: `${handleSize}px`,
        background: ACCENT,
        border: '1px solid #000',
        boxSizing: 'border-box',
        cursor: pos.cursor,
        pointerEvents: 'auto',
        zIndex: '920',
      });
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.onPointerDownOutside?.(e);
      });
      this.handlesContainer.appendChild(handle);
    }
  }

  /** Show a ghost rectangle during drag/resize operations. */
  showGhostRect(canvasRect: DOMRect, x: number, y: number, w: number, h: number): void {
    let ghost = this.handlesContainer.querySelector('#editor-ghost') as HTMLDivElement | null;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'editor-ghost';
      Object.assign(ghost.style, {
        position: 'fixed',
        border: `2px dashed ${ACCENT}`,
        background: 'rgba(51, 255, 102, 0.05)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: '905',
      });
      this.handlesContainer.appendChild(ghost);
    }

    const pxLeft = canvasRect.left + x * canvasRect.width;
    const pxTop = canvasRect.top + (1 - y - h) * canvasRect.height;
    const pw = w * canvasRect.width;
    const ph = h * canvasRect.height;

    Object.assign(ghost.style, {
      left: `${pxLeft}px`,
      top: `${pxTop}px`,
      width: `${pw}px`,
      height: `${ph}px`,
      display: '',
    });
  }

  hideGhostRect(): void {
    const ghost = this.handlesContainer.querySelector('#editor-ghost') as HTMLDivElement | null;
    if (ghost) ghost.style.display = 'none';
  }

  /* ---------- Context menu ---------- */

  showContextMenu(clientX: number, clientY: number): void {
    Object.assign(this.contextMenuEl.style, {
      left: `${clientX}px`,
      top: `${clientY}px`,
      display: '',
    });

    // Close on next click anywhere
    const close = (e: Event) => {
      if (!this.contextMenuEl.contains(e.target as Node)) {
        this.hideContextMenu();
      }
      document.removeEventListener('pointerdown', close, true);
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  hideContextMenu(): void {
    this.contextMenuEl.style.display = 'none';
  }

  /* ---------- Help dialog ---------- */

  showHelp(): void {
    this.helpDialog.style.display = 'flex';
  }

  hideHelp(): void {
    this.helpDialog.style.display = 'none';
  }

  get helpVisible(): boolean {
    return this.helpDialog.style.display !== 'none';
  }

  /* ---------- DOM Builders ---------- */

  private createToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      height: `${TOOLBAR_H}px`,
      background: BG_PANEL,
      borderBottom: `1px solid ${ACCENT_BORDER}`,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '0 8px',
      pointerEvents: 'auto',
      zIndex: '950',
    });

    // File operations group
    bar.appendChild(makeBtn('New', this.callbacks.onNewLayout));
    bar.appendChild(makeBtn('Save', this.callbacks.onSaveLayout));
    bar.appendChild(makeBtn('Load', this.callbacks.onLoadLayout));

    // Separator
    const sep1 = document.createElement('div');
    Object.assign(sep1.style, { width: '1px', height: '20px', background: ACCENT_BORDER, margin: '0 4px' });
    bar.appendChild(sep1);

    bar.appendChild(makeBtn('Export', this.callbacks.onExportLayout));
    bar.appendChild(makeBtn('Import', this.callbacks.onImportLayout));
    bar.appendChild(makeBtn('Clear', this.callbacks.onClearLayout));

    // Separator
    const sep2 = document.createElement('div');
    Object.assign(sep2.style, { width: '1px', height: '20px', background: ACCENT_BORDER, margin: '0 4px' });
    bar.appendChild(sep2);

    // Undo/Redo
    this.undoBtn = makeBtn('\u21B6', this.callbacks.onUndo);
    this.undoBtn.title = 'Undo (Ctrl+Z)';
    this.undoBtn.style.opacity = '0.3';
    this.undoBtn.style.pointerEvents = 'none';
    bar.appendChild(this.undoBtn);

    this.redoBtn = makeBtn('\u21B7', this.callbacks.onRedo);
    this.redoBtn.title = 'Redo (Ctrl+Y)';
    this.redoBtn.style.opacity = '0.3';
    this.redoBtn.style.pointerEvents = 'none';
    bar.appendChild(this.redoBtn);

    // Separator
    const sep3 = document.createElement('div');
    Object.assign(sep3.style, { width: '1px', height: '20px', background: ACCENT_BORDER, margin: '0 4px' });
    bar.appendChild(sep3);

    // Grid toggle
    const gridBtn = makeBtn('Grid', () => this.callbacks.onToggleGrid());
    gridBtn.title = 'Toggle grid (G)';
    bar.appendChild(gridBtn);

    // Palette selector
    const palLabel = document.createElement('span');
    palLabel.textContent = 'Pal:';
    Object.assign(palLabel.style, { fontSize: '9px', color: ACCENT_DIM, marginLeft: '4px' });
    bar.appendChild(palLabel);

    this.paletteSelect = makeSelect(paletteNames(), '', (v) => this.callbacks.onChangePalette(v));
    this.paletteSelect.id = 'editor-palette-select';
    bar.appendChild(this.paletteSelect);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Help button
    const helpBtn = makeBtn('?', () => this.showHelp());
    helpBtn.title = 'Keyboard shortcuts (?)';
    helpBtn.style.fontWeight = 'bold';
    bar.appendChild(helpBtn);

    this.performBtn = makeBtn('Perform', this.callbacks.onTogglePerform);
    bar.appendChild(this.performBtn);
    bar.appendChild(makeBtn('Exit', this.callbacks.onExitEditor));

    return bar;
  }

  private updatePerformBtn(): void {
    this.performBtn.textContent = this._performMode ? 'Edit' : 'Perform';
  }

  setPalette(name: string): void {
    this.paletteSelect.value = name;
  }

  /* ---------- Palette panel ---------- */

  private createPalette(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'editor-palette';
    Object.assign(panel.style, {
      position: 'fixed',
      top: `${TOOLBAR_H}px`,
      left: '0',
      width: `${PALETTE_W}px`,
      bottom: `${STATUS_H}px`,
      background: BG_PANEL,
      borderRight: `1px solid ${ACCENT_BORDER}`,
      display: 'flex',
      flexDirection: 'column',
      pointerEvents: 'auto',
      zIndex: '940',
      overflowY: 'hidden',
    });

    // Search input
    const searchBar = document.createElement('div');
    Object.assign(searchBar.style, {
      padding: '6px 8px 4px',
      borderBottom: `1px solid ${ACCENT_BORDER}`,
      flexShrink: '0',
    });

    const searchInput = document.createElement('input');
    searchInput.id = 'editor-palette-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search elements...';
    Object.assign(searchInput.style, {
      width: '100%',
      background: '#111',
      border: `1px solid ${ACCENT_BORDER}`,
      color: ACCENT,
      fontFamily: FONT,
      fontSize: '10px',
      padding: '5px 8px',
      borderRadius: '2px',
      outline: 'none',
      boxSizing: 'border-box',
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase().trim();
      this.applyFilter();
    });
    searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = ACCENT;
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = ACCENT_BORDER;
    });
    searchBar.appendChild(searchInput);

    // Result count
    const countLabel = document.createElement('div');
    countLabel.id = 'editor-palette-count';
    Object.assign(countLabel.style, {
      fontSize: '8px',
      color: ACCENT_DIM,
      textAlign: 'right',
      padding: '2px 0 0',
    });
    countLabel.textContent = `${this.allTypes.length} elements`;
    searchBar.appendChild(countLabel);

    panel.appendChild(searchBar);

    // Filter chips
    const filterBar = document.createElement('div');
    filterBar.id = 'editor-filter-bar';
    Object.assign(filterBar.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '3px',
      padding: '4px 8px',
      borderBottom: `1px solid ${ACCENT_BORDER}`,
      flexShrink: '0',
    });
    this.buildFilterChips(filterBar);
    panel.appendChild(filterBar);

    // Scrollable grid
    const grid = document.createElement('div');
    grid.id = 'editor-palette-grid';
    Object.assign(grid.style, {
      flex: '1',
      overflowY: 'auto',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '3px',
      padding: '4px',
      alignContent: 'start',
    });
    panel.appendChild(grid);

    return panel;
  }

  private buildFilterChips(container: HTMLDivElement): void {
    const makeChip = (label: string, tag: FilterTag): HTMLSpanElement => {
      const chip = document.createElement('span');
      const isActive = this.activeFilter === tag;

      // Count matching elements
      let count = this.allTypes.length;
      if (tag !== null) {
        count = this.allTypes.filter(t => matchesTag(t, tag)).length;
      }

      chip.textContent = `${label} ${count}`;
      Object.assign(chip.style, {
        display: 'inline-block',
        padding: '2px 5px',
        fontSize: '7px',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        background: isActive ? 'rgba(51, 255, 102, 0.2)' : ACCENT_BG,
        border: `1px solid ${isActive ? ACCENT : ACCENT_BORDER}`,
        borderRadius: '2px',
        cursor: 'pointer',
        color: isActive ? ACCENT : ACCENT_DIM,
        whiteSpace: 'nowrap',
      });
      chip.addEventListener('click', () => {
        this.activeFilter = this.activeFilter === tag ? null : tag;
        this.applyFilter();
        container.innerHTML = '';
        this.buildFilterChips(container);
      });
      return chip;
    };

    container.appendChild(makeChip('All', null));
    for (const tag of SHAPE_TAGS) container.appendChild(makeChip(tag, tag));
    for (const tag of ROLE_TAGS) container.appendChild(makeChip(tag.replace('-', ' '), tag));
    for (const tag of MOOD_TAGS) container.appendChild(makeChip(tag, tag));
  }

  private applyFilter(): void {
    let types = this.allTypes;

    // Apply tag filter
    if (this.activeFilter !== null) {
      types = types.filter(t => matchesTag(t, this.activeFilter!));
    }

    // Apply search query
    if (this.searchQuery) {
      const q = this.searchQuery;
      types = types.filter(t => t.includes(q) || t.replace(/-/g, ' ').includes(q));
    }

    this.filteredTypes = types;
    this.populatePalette();

    // Update count
    const countEl = this.palette.querySelector('#editor-palette-count');
    if (countEl) {
      countEl.textContent = `${this.filteredTypes.length} of ${this.allTypes.length} elements`;
    }
  }

  private populatePalette(): void {
    if (!this.paletteGrid) return;
    this.paletteGrid.innerHTML = '';

    for (const type of this.filteredTypes) {
      const tile = document.createElement('div');
      const displayName = type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      Object.assign(tile.style, {
        background: ACCENT_BG,
        border: `1px solid ${ACCENT_BORDER}`,
        borderRadius: '2px',
        padding: '4px 3px',
        textAlign: 'center',
        cursor: 'grab',
        fontSize: '7px',
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        color: ACCENT_DIM,
        transition: 'background 0.1s, border-color 0.1s',
        userSelect: 'none',
        touchAction: 'none',
        minHeight: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        wordBreak: 'break-word',
        lineHeight: '1.2',
      });
      tile.textContent = displayName;
      tile.dataset.elementType = type;

      tile.addEventListener('mouseenter', () => {
        tile.style.background = 'rgba(51, 255, 102, 0.15)';
        tile.style.borderColor = ACCENT;
        tile.style.color = ACCENT;
      });
      tile.addEventListener('mouseleave', () => {
        tile.style.background = ACCENT_BG;
        tile.style.borderColor = ACCENT_BORDER;
        tile.style.color = ACCENT_DIM;
      });

      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        this.onPointerDownOutside?.(e);
      });

      this.paletteGrid.appendChild(tile);
    }
  }

  /** Check if a point is inside the palette panel. */
  isInsidePalette(clientX: number, clientY: number): boolean {
    if (!this._paletteVisible || this._performMode) return false;
    const rect = this.palette.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom
    );
  }

  get paletteWidth(): number {
    return this._paletteVisible && !this._performMode ? PALETTE_W : 0;
  }

  get toolbarHeight(): number {
    return this._performMode ? 0 : TOOLBAR_H;
  }

  get statusHeight(): number {
    return this._performMode ? 0 : STATUS_H;
  }

  /* ---------- Properties panel ---------- */

  private createPropertiesPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'editor-properties';
    Object.assign(panel.style, {
      position: 'fixed',
      top: `${TOOLBAR_H}px`,
      right: '0',
      width: `${PROPS_W}px`,
      background: BG_PANEL,
      borderLeft: `1px solid ${ACCENT_BORDER}`,
      display: 'none',
      flexDirection: 'column',
      pointerEvents: 'auto',
      zIndex: '940',
      padding: '10px',
      gap: '8px',
    });

    // Title
    const title = document.createElement('div');
    title.textContent = 'INSPECTOR';
    Object.assign(title.style, {
      fontSize: '10px',
      letterSpacing: '2px',
      color: ACCENT,
      textAlign: 'center',
      borderBottom: `1px solid ${ACCENT_BORDER}`,
      paddingBottom: '6px',
      marginBottom: '4px',
    });
    panel.appendChild(title);

    // Type selector
    const typeRow = document.createElement('div');
    Object.assign(typeRow.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    const typeLabel = document.createElement('div');
    typeLabel.textContent = 'TYPE';
    Object.assign(typeLabel.style, { fontSize: '8px', color: ACCENT_DIM, letterSpacing: '1px' });
    typeRow.appendChild(typeLabel);

    this.propTypeSelect = document.createElement('select');
    this.propTypeSelect.id = 'editor-prop-type';
    Object.assign(this.propTypeSelect.style, {
      width: '100%',
      background: '#111',
      border: `1px solid ${ACCENT_BORDER}`,
      color: ACCENT,
      fontFamily: FONT,
      fontSize: '9px',
      padding: '4px',
      cursor: 'pointer',
    });
    for (const t of this.allTypes) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      this.propTypeSelect.appendChild(o);
    }
    this.propTypeSelect.addEventListener('change', () => {
      this.callbacks.onSwapType(this.propTypeSelect.value);
    });
    this.propTypeSelect.addEventListener('keydown', (e) => e.stopPropagation());
    typeRow.appendChild(this.propTypeSelect);
    panel.appendChild(typeRow);

    // Position
    const posSection = document.createElement('div');
    Object.assign(posSection.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    const posLabel = document.createElement('div');
    posLabel.textContent = 'POSITION';
    Object.assign(posLabel.style, { fontSize: '8px', color: ACCENT_DIM, letterSpacing: '1px' });
    posSection.appendChild(posLabel);

    const posRow = document.createElement('div');
    Object.assign(posRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });

    const xLabel = document.createElement('span');
    xLabel.textContent = 'X';
    Object.assign(xLabel.style, { fontSize: '9px', color: ACCENT_DIM });
    posRow.appendChild(xLabel);

    this.propXInput = makeNumberInput(0, (v) => {
      this.fireRegionUpdate();
    }, 'editor-prop-x');
    posRow.appendChild(this.propXInput);

    const yLabel = document.createElement('span');
    yLabel.textContent = 'Y';
    Object.assign(yLabel.style, { fontSize: '9px', color: ACCENT_DIM });
    posRow.appendChild(yLabel);

    this.propYInput = makeNumberInput(0, (v) => {
      this.fireRegionUpdate();
    }, 'editor-prop-y');
    posRow.appendChild(this.propYInput);
    posSection.appendChild(posRow);
    panel.appendChild(posSection);

    // Size
    const sizeSection = document.createElement('div');
    Object.assign(sizeSection.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    const sizeLabel = document.createElement('div');
    sizeLabel.textContent = 'SIZE';
    Object.assign(sizeLabel.style, { fontSize: '8px', color: ACCENT_DIM, letterSpacing: '1px' });
    sizeSection.appendChild(sizeLabel);

    const sizeRow = document.createElement('div');
    Object.assign(sizeRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });

    const wLabel = document.createElement('span');
    wLabel.textContent = 'W';
    Object.assign(wLabel.style, { fontSize: '9px', color: ACCENT_DIM });
    sizeRow.appendChild(wLabel);

    this.propWInput = makeNumberInput(0, (v) => {
      this.fireRegionUpdate();
    }, 'editor-prop-w');
    sizeRow.appendChild(this.propWInput);

    const hLabel = document.createElement('span');
    hLabel.textContent = 'H';
    Object.assign(hLabel.style, { fontSize: '9px', color: ACCENT_DIM });
    sizeRow.appendChild(hLabel);

    this.propHInput = makeNumberInput(0, (v) => {
      this.fireRegionUpdate();
    }, 'editor-prop-h');
    sizeRow.appendChild(this.propHInput);
    sizeSection.appendChild(sizeRow);
    panel.appendChild(sizeSection);

    // Action buttons
    const actionSep = document.createElement('div');
    Object.assign(actionSep.style, { borderTop: `1px solid ${ACCENT_BORDER}`, paddingTop: '6px', marginTop: '4px' });

    const row1 = document.createElement('div');
    Object.assign(row1.style, { display: 'flex', gap: '4px' });
    row1.appendChild(makeBtn('Duplicate', this.callbacks.onDuplicate, { flex: '1', textAlign: 'center' } as any));
    row1.appendChild(makeBtn('Delete', this.callbacks.onDelete, { flex: '1', textAlign: 'center', color: '#ff6644' } as any));
    actionSep.appendChild(row1);

    const row2 = document.createElement('div');
    Object.assign(row2.style, { display: 'flex', gap: '4px', marginTop: '4px' });
    row2.appendChild(makeBtn('\u2191 Front', this.callbacks.onBringToFront, { flex: '1', textAlign: 'center' } as any));
    row2.appendChild(makeBtn('\u2193 Back', this.callbacks.onSendToBack, { flex: '1', textAlign: 'center' } as any));
    actionSep.appendChild(row2);

    panel.appendChild(actionSep);

    return panel;
  }

  private fireRegionUpdate(): void {
    const x = Math.max(0, Math.min(100, parseFloat(this.propXInput.value) || 0)) / 100;
    const y = Math.max(0, Math.min(100, parseFloat(this.propYInput.value) || 0)) / 100;
    const w = Math.max(5, Math.min(100, parseFloat(this.propWInput.value) || 5)) / 100;
    const h = Math.max(5, Math.min(100, parseFloat(this.propHInput.value) || 5)) / 100;
    this.callbacks.onUpdateRegion(x, y, w, h);
  }

  /* ---------- Grid overlay ---------- */

  private createGridOverlay(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.id = 'editor-grid-overlay';
    Object.assign(grid.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '895',
      display: 'none',
    });

    // Build 12-column grid lines + 12-row grid lines
    const cols = 12;
    for (let i = 1; i < cols; i++) {
      const pct = (i / cols * 100).toFixed(4);
      const vLine = document.createElement('div');
      Object.assign(vLine.style, {
        position: 'absolute',
        left: `${pct}%`,
        top: '0',
        bottom: '0',
        width: '1px',
        background: 'rgba(51, 255, 102, 0.08)',
      });
      grid.appendChild(vLine);

      const hLine = document.createElement('div');
      Object.assign(hLine.style, {
        position: 'absolute',
        top: `${pct}%`,
        left: '0',
        right: '0',
        height: '1px',
        background: 'rgba(51, 255, 102, 0.08)',
      });
      grid.appendChild(hLine);
    }

    return grid;
  }

  /* ---------- Context menu ---------- */

  private createContextMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.id = 'editor-context-menu';
    Object.assign(menu.style, {
      position: 'fixed',
      display: 'none',
      background: 'rgba(10, 10, 10, 0.95)',
      border: `1px solid ${ACCENT_BORDER}`,
      minWidth: '160px',
      pointerEvents: 'auto',
      zIndex: '990',
      padding: '4px 0',
    });

    const makeItem = (label: string, shortcut: string, action: () => void) => {
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 12px',
        fontSize: '10px',
        cursor: 'pointer',
        color: '#ddd',
        letterSpacing: '0.5px',
      });

      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      item.appendChild(labelEl);

      if (shortcut) {
        const sc = document.createElement('span');
        sc.textContent = shortcut;
        Object.assign(sc.style, { color: ACCENT_DIM, fontSize: '9px' });
        item.appendChild(sc);
      }

      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(51, 255, 102, 0.1)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
      item.addEventListener('click', () => {
        this.hideContextMenu();
        action();
      });
      return item;
    };

    const makeSep = () => {
      const sep = document.createElement('div');
      Object.assign(sep.style, { borderTop: `1px solid ${ACCENT_BORDER}`, margin: '3px 8px' });
      return sep;
    };

    menu.appendChild(makeItem('Duplicate', 'Ctrl+D', this.callbacks.onDuplicate));
    menu.appendChild(makeItem('Delete', 'Del', this.callbacks.onDelete));
    menu.appendChild(makeSep());
    menu.appendChild(makeItem('Bring to Front', '', this.callbacks.onBringToFront));
    menu.appendChild(makeItem('Send to Back', '', this.callbacks.onSendToBack));
    menu.appendChild(makeSep());
    menu.appendChild(makeItem('Undo', 'Ctrl+Z', this.callbacks.onUndo));
    menu.appendChild(makeItem('Redo', 'Ctrl+Y', this.callbacks.onRedo));

    return menu;
  }

  /* ---------- Help dialog ---------- */

  private createHelpDialog(): HTMLDivElement {
    const backdrop = document.createElement('div');
    backdrop.id = 'editor-help-dialog';
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      zIndex: '10000',
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#111',
      border: `1px solid ${ACCENT_BORDER}`,
      padding: '20px 28px',
      minWidth: '320px',
      maxWidth: '400px',
    });

    const title = document.createElement('div');
    title.textContent = 'KEYBOARD SHORTCUTS';
    Object.assign(title.style, {
      color: ACCENT,
      fontSize: '12px',
      letterSpacing: '2px',
      textAlign: 'center',
      marginBottom: '12px',
      paddingBottom: '8px',
      borderBottom: `1px solid ${ACCENT_BORDER}`,
    });
    modal.appendChild(title);

    const shortcuts = [
      ['Esc', 'Exit editor'],
      ['Tab', 'Toggle perform mode'],
      ['P', 'Toggle palette'],
      ['G', 'Toggle grid'],
      ['?', 'This help'],
      ['', ''],
      ['Del / Backspace', 'Delete selected'],
      ['Ctrl+D', 'Duplicate selected'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y', 'Redo'],
      ['Ctrl+S', 'Save layout'],
      ['', ''],
      ['\u2190\u2191\u2192\u2193', 'Nudge selected'],
      ['Click palette', 'Place at center'],
      ['Drag palette', 'Place at position'],
      ['Right-click', 'Context menu'],
    ];

    for (const [key, desc] of shortcuts) {
      if (!key && !desc) {
        const sep = document.createElement('div');
        sep.style.height = '6px';
        modal.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 0',
        fontSize: '10px',
      });
      const keyEl = document.createElement('span');
      keyEl.textContent = key;
      Object.assign(keyEl.style, {
        color: ACCENT,
        minWidth: '120px',
        letterSpacing: '0.5px',
      });
      const descEl = document.createElement('span');
      descEl.textContent = desc;
      Object.assign(descEl.style, { color: 'rgba(255,255,255,0.6)' });
      row.appendChild(keyEl);
      row.appendChild(descEl);
      modal.appendChild(row);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    Object.assign(closeBtn.style, {
      display: 'block',
      margin: '14px auto 0',
      background: ACCENT_BG,
      border: `1px solid ${ACCENT_BORDER}`,
      color: ACCENT,
      fontFamily: FONT,
      fontSize: '10px',
      padding: '5px 20px',
      cursor: 'pointer',
      letterSpacing: '1px',
    });
    closeBtn.addEventListener('click', () => this.hideHelp());
    modal.appendChild(closeBtn);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.hideHelp();
    });

    return backdrop;
  }

  /* ---------- Status bar ---------- */

  private createStatusBar(): HTMLDivElement {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      height: `${STATUS_H}px`,
      background: BG_PANEL,
      borderTop: `1px solid ${ACCENT_BORDER}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      pointerEvents: 'auto',
      zIndex: '950',
      fontSize: '10px',
      letterSpacing: '1px',
      color: ACCENT_DIM,
      gap: '8px',
    });

    // Status text (element count, snap state)
    this.statusTextEl = document.createElement('span');
    this.statusTextEl.id = 'editor-status-text';
    bar.appendChild(this.statusTextEl);

    // Separator
    const sep = document.createElement('span');
    sep.textContent = '\u00b7';
    sep.style.opacity = '0.5';
    bar.appendChild(sep);

    // Layout name (click to rename)
    this.layoutNameEl = document.createElement('span');
    this.layoutNameEl.id = 'editor-layout-name';
    Object.assign(this.layoutNameEl.style, {
      cursor: 'pointer',
      borderBottom: `1px dashed ${ACCENT_BORDER}`,
      padding: '0 2px',
    });
    this.layoutNameEl.addEventListener('click', () => {
      this.startNameEdit();
    });
    bar.appendChild(this.layoutNameEl);

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Hint
    const hint = document.createElement('span');
    hint.textContent = '? for shortcuts';
    Object.assign(hint.style, { fontSize: '8px', opacity: '0.4' });
    bar.appendChild(hint);

    return bar;
  }

  private startNameEdit(): void {
    const currentName = this.layoutNameEl.textContent || 'Untitled';
    const input = document.createElement('input');
    input.id = 'editor-layout-name-input';
    input.type = 'text';
    input.value = currentName;
    Object.assign(input.style, {
      background: '#111',
      border: `1px solid ${ACCENT}`,
      color: ACCENT,
      fontFamily: FONT,
      fontSize: '10px',
      padding: '1px 4px',
      width: '150px',
      outline: 'none',
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
      if (e.key === 'Escape') {
        this.layoutNameEl.style.display = '';
        input.remove();
      }
    });
    input.addEventListener('blur', commit);

    this.layoutNameEl.style.display = 'none';
    this.layoutNameEl.parentElement!.insertBefore(input, this.layoutNameEl.nextSibling);
    input.focus();
    input.select();
  }

  private createHandlesContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'editor-handles';
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      pointerEvents: 'none',
      zIndex: '900',
    });
    return container;
  }

  /* ---------- Entry prompt ---------- */

  showEntryPrompt(hasSaved: boolean, onChoice: (choice: 'current' | 'blank' | 'load') => void): void {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
      fontFamily: FONT,
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#111',
      border: `1px solid ${ACCENT_BORDER}`,
      padding: '24px 32px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      minWidth: '280px',
    });

    const title = document.createElement('div');
    title.textContent = 'ENTER EDITOR';
    Object.assign(title.style, {
      color: ACCENT,
      fontSize: '13px',
      letterSpacing: '3px',
      textAlign: 'center',
      marginBottom: '8px',
    });
    modal.appendChild(title);

    const makeChoice = (label: string, choice: 'current' | 'blank' | 'load') => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        background: ACCENT_BG,
        border: `1px solid ${ACCENT_BORDER}`,
        color: '#fff',
        fontFamily: FONT,
        fontSize: '11px',
        letterSpacing: '1px',
        padding: '10px 16px',
        cursor: 'pointer',
        textAlign: 'left',
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(51, 255, 102, 0.2)';
        btn.style.borderColor = ACCENT;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = ACCENT_BG;
        btn.style.borderColor = ACCENT_BORDER;
      });
      btn.addEventListener('click', () => {
        backdrop.remove();
        onChoice(choice);
      });
      modal.appendChild(btn);
    };

    makeChoice('Start from current layout', 'current');
    makeChoice('Start blank', 'blank');
    if (hasSaved) {
      makeChoice('Load saved layout', 'load');
    }

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    Object.assign(cancel.style, {
      background: 'none',
      border: `1px solid rgba(255,255,255,0.15)`,
      color: 'rgba(255,255,255,0.4)',
      fontFamily: FONT,
      fontSize: '10px',
      letterSpacing: '1px',
      padding: '6px 16px',
      cursor: 'pointer',
      marginTop: '4px',
    });
    cancel.addEventListener('click', () => {
      backdrop.remove();
    });
    modal.appendChild(cancel);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    document.body.appendChild(backdrop);
  }

  showLoadDialog(
    layouts: EditorLayout[],
    onSelect: (index: number) => void,
  ): void {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
      fontFamily: FONT,
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#111',
      border: `1px solid ${ACCENT_BORDER}`,
      padding: '24px 32px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: '300px',
      maxHeight: '60vh',
      overflowY: 'auto',
    });

    const title = document.createElement('div');
    title.textContent = 'LOAD LAYOUT';
    Object.assign(title.style, {
      color: ACCENT,
      fontSize: '13px',
      letterSpacing: '3px',
      textAlign: 'center',
      marginBottom: '8px',
    });
    modal.appendChild(title);

    if (layouts.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved layouts';
      Object.assign(empty.style, { color: 'rgba(255,255,255,0.4)', fontSize: '11px', textAlign: 'center', padding: '16px' });
      modal.appendChild(empty);
    } else {
      layouts.forEach((layout, i) => {
        const btn = document.createElement('button');
        const date = new Date(layout.modified).toLocaleDateString();
        btn.textContent = `${layout.name} (${layout.regions.length} elements, ${date})`;
        Object.assign(btn.style, {
          background: ACCENT_BG,
          border: `1px solid ${ACCENT_BORDER}`,
          color: '#fff',
          fontFamily: FONT,
          fontSize: '10px',
          letterSpacing: '0.5px',
          padding: '8px 12px',
          cursor: 'pointer',
          textAlign: 'left',
        });
        btn.addEventListener('mouseenter', () => {
          btn.style.background = 'rgba(51, 255, 102, 0.2)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = ACCENT_BG;
        });
        btn.addEventListener('click', () => {
          backdrop.remove();
          onSelect(i);
        });
        modal.appendChild(btn);
      });
    }

    const close = document.createElement('button');
    close.textContent = 'Cancel';
    Object.assign(close.style, {
      background: 'none',
      border: `1px solid rgba(255,255,255,0.15)`,
      color: 'rgba(255,255,255,0.4)',
      fontFamily: FONT,
      fontSize: '10px',
      padding: '6px 16px',
      cursor: 'pointer',
      marginTop: '4px',
    });
    close.addEventListener('click', () => backdrop.remove());
    modal.appendChild(close);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    document.body.appendChild(backdrop);
  }

  /* ---------- Cleanup ---------- */

  dispose(): void {
    this.root.remove();
  }
}
