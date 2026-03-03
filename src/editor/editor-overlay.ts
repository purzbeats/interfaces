import type { EditorRegion, EditorLayout } from './editor-layout';
import { elementTypes } from '../elements/registry';
import { getMeta } from '../elements/tags';

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

/* ---------- EditorOverlay class ---------- */

export class EditorOverlay {
  private root: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private palette: HTMLDivElement;
  private paletteGrid: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private handlesContainer: HTMLDivElement;
  private callbacks: OverlayCallbacks;
  private allTypes: string[];
  private filteredTypes: string[];
  private activeFilter: FilterTag = null;
  private _paletteVisible: boolean = true;
  private _performMode: boolean = false;
  private performBtn!: HTMLButtonElement;

  /**
   * EditorMode sets this callback. It is called whenever a pointerdown happens
   * on an interactive overlay element (handle, outline, palette tile).
   * The target element carries data-* attributes that EditorMode inspects to
   * decide what drag operation to start.
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

    this.root.append(this.toolbar, this.palette, this.statusBar, this.handlesContainer);
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
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /* ---------- Perform mode toggle ---------- */

  enterPerformMode(): void {
    this._performMode = true;
    this.toolbar.style.display = 'none';
    this.palette.style.display = 'none';
    this.statusBar.style.display = 'none';
    this.clearHandles();
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

  /* ---------- Status bar ---------- */

  updateStatus(layout: EditorLayout, snapOn: boolean): void {
    const count = layout.regions.length;
    this.statusBar.innerHTML = `<span style="opacity:0.7">${count} element${count !== 1 ? 's' : ''} &nbsp;\u00b7&nbsp; Snap: ${snapOn ? 'On' : 'Off'} &nbsp;\u00b7&nbsp; Layout: ${layout.name}</span>`;
  }

  /* ---------- Resize handles ---------- */

  clearHandles(): void {
    this.handlesContainer.innerHTML = '';
  }

  /**
   * Show 8 resize handles + move outline around a selected region.
   * All interactive elements use data-* attributes so that EditorMode
   * can identify them from the PointerEvent target — NO closure callbacks.
   */
  showHandles(region: EditorRegion, canvasRect: DOMRect): void {
    this.clearHandles();

    // Convert GL normalized coords to screen pixel coords
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
    this.handlesContainer.appendChild(outline);

    // 8 handles: corners + edge midpoints
    const handleSize = 12;
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

    const makeBtn = (label: string, action: () => void): HTMLButtonElement => {
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
      });
      btn.addEventListener('click', action);
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(51, 255, 102, 0.2)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = ACCENT_BG; });
      return btn;
    };

    bar.appendChild(makeBtn('New', this.callbacks.onNewLayout));
    bar.appendChild(makeBtn('Save', this.callbacks.onSaveLayout));
    bar.appendChild(makeBtn('Load', this.callbacks.onLoadLayout));
    bar.appendChild(makeBtn('Export', this.callbacks.onExportLayout));
    bar.appendChild(makeBtn('Import', this.callbacks.onImportLayout));
    bar.appendChild(makeBtn('Clear', this.callbacks.onClearLayout));

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    this.performBtn = makeBtn('Perform', this.callbacks.onTogglePerform);
    bar.appendChild(this.performBtn);
    bar.appendChild(makeBtn('Exit', this.callbacks.onExitEditor));

    return bar;
  }

  private updatePerformBtn(): void {
    this.performBtn.textContent = this._performMode ? 'Edit' : 'Perform';
  }

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

    // Filter chips
    const filterBar = document.createElement('div');
    Object.assign(filterBar.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '3px',
      padding: '6px 8px',
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
      gap: '4px',
      padding: '6px',
      alignContent: 'start',
    });
    panel.appendChild(grid);

    return panel;
  }

  private buildFilterChips(container: HTMLDivElement): void {
    const makeChip = (label: string, tag: FilterTag): HTMLSpanElement => {
      const chip = document.createElement('span');
      chip.textContent = label;
      const isActive = this.activeFilter === tag;
      Object.assign(chip.style, {
        display: 'inline-block',
        padding: '2px 6px',
        fontSize: '8px',
        letterSpacing: '1px',
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

    for (const tag of SHAPE_TAGS) {
      container.appendChild(makeChip(tag, tag));
    }
    for (const tag of ROLE_TAGS) {
      container.appendChild(makeChip(tag.replace('-', ' '), tag));
    }
    for (const tag of MOOD_TAGS) {
      container.appendChild(makeChip(tag, tag));
    }
  }

  private applyFilter(): void {
    if (this.activeFilter === null) {
      this.filteredTypes = this.allTypes;
    } else {
      this.filteredTypes = this.allTypes.filter(t => matchesTag(t, this.activeFilter!));
    }
    this.populatePalette();
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
        borderRadius: '3px',
        padding: '6px 4px',
        textAlign: 'center',
        cursor: 'grab',
        fontSize: '8px',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        color: ACCENT_DIM,
        transition: 'background 0.15s, border-color 0.15s',
        userSelect: 'none',
        touchAction: 'none',
        minHeight: '36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        wordBreak: 'break-word',
        lineHeight: '1.3',
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

      // All interaction (click-to-place AND drag-to-place) starts from pointerdown.
      // EditorMode distinguishes clicks from drags via movement threshold.
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
    });
    return bar;
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
