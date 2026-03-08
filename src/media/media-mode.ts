import * as THREE from 'three';
import { resizeRenderer, type RendererContext } from '../renderer/setup';
import { type PostFXPipeline } from '../postfx/pipeline';
import { type Config, computeAspectSize } from '../config';
import { getPalette, paletteNames, type Palette } from '../color/palettes';
import { loadLibrary, addFile, removeItem, getObjectUrl, revokeAllObjectUrls, type MediaItem } from './storage';
import { TOOLBAR_HEIGHT } from '../gui/mobile-toolbar';
import { showToast } from '../gui/toast';
import { SeededRandom } from '../random';
import { regionToPixels, type Region } from '../layout/region';
import { compose } from '../layout/compositor';
import { createElement } from '../elements/registry';
import { type BaseElement } from '../elements/base-element';

const ITEMS_PER_PAGE = 12;
const BROWSER_WIDTH = 340;

/** Yield to the browser for one frame so tile creation doesn't block rendering. */
const yieldFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

/** Yield for N frames — creates a staggered sweep effect between tiles. */
const yieldFrames = (n: number): Promise<void> => {
  if (n <= 1) return yieldFrame();
  return new Promise(resolve => {
    let count = 0;
    const tick = () => { if (++count >= n) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
};

/** Stagger delay in frames between each tile appearing */
const TILE_STAGGER_FRAMES = 18;

/** Opacity fade speed per second (slow for dramatic CRT power-on) */
const FADE_SPEED = 0.6;
/** Seconds between rolling rearrangements */
const ROLLING_INTERVAL = 30;

interface MediaTile {
  mesh: THREE.Mesh;
  texture: THREE.Texture;
  region: Region;
  item: MediaItem;
  objectUrl: string;
  source: HTMLImageElement | HTMLVideoElement | null;
  palette: Palette;
  opacity: number;
  targetOpacity: number;
  loaded: boolean;
  /** Ken Burns animation params (images only) */
  kenBurns: { zoomStart: number; zoomEnd: number; panX: number; panY: number } | null;
  /** Time offset when this tile was created (for Ken Burns interpolation) */
  spawnTime: number;
}

/* Palette remap shader with per-tile glitch effects (shared by image + video tiles) */
const PALETTE_REMAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PALETTE_REMAP_FRAG = /* glsl */ `
uniform sampler2D tMedia;
uniform float opacity;
uniform float uTime;
uniform float uSeed;
uniform vec3 uBg;
uniform vec3 uDim;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform float uKenBurnsZoom;
uniform vec2 uKenBurnsPan;
uniform float uReveal;
uniform float uRevealStyle; // 0.0 = smooth fade, 1.0 = CRT blink-in
varying vec2 vUv;

// --- Noise helpers ---
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 paletteRemap(float lum) {
  if (lum < 0.25) return mix(uBg, uDim, lum / 0.25);
  if (lum < 0.5)  return mix(uDim, uPrimary, (lum - 0.25) / 0.25);
  if (lum < 0.75) return mix(uPrimary, uSecondary, (lum - 0.5) / 0.25);
  return mix(uSecondary, vec3(1.0), (lum - 0.75) / 0.25);
}

void main() {
  // Per-tile variation derived from seed (no extra uniforms needed)
  float seed = uSeed;
  float scanlineCount = 120.0 + fract(seed * 3.7) * 100.0;
  float grainAmt = 0.008 + fract(seed * 7.3) * 0.015;
  float flickerRate = 1.5 + fract(seed * 11.1) * 2.5;

  // Apply Ken Burns (slow pan/zoom for stills — identity for video)
  vec2 kb = (vUv - 0.5) / uKenBurnsZoom + 0.5 + uKenBurnsPan;
  vec2 coverUv = kb * uCoverScale + uCoverOffset;
  float t = uTime;

  // --- Horizontal glitch shift (rare, per-scanline) ---
  float glitchEpoch = floor(t * 1.5 + seed * 7.0);
  float glitchActive = step(0.92, hash(glitchEpoch));
  float lineHash = hash(floor(coverUv.y * 80.0) + glitchEpoch * 3.7);
  float glitchShift = glitchActive * step(0.7, lineHash) * (lineHash - 0.7) * 0.08;
  coverUv.x += glitchShift;

  // --- Sample media ---
  vec4 tex = texture2D(tMedia, coverUv);
  float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = paletteRemap(lum);

  // --- CRT scan sweep (slow bright line moving down, per-tile speed) ---
  float sweepSpeed = 0.03 + fract(seed * 2.3) * 0.04;
  float sweepY = fract(t * sweepSpeed + seed * 0.5);
  float sweep = 1.0 - smoothstep(0.0, 0.025, abs(vUv.y - sweepY));
  col += sweep * uPrimary * 0.1;

  // --- Power dips (rare, gentle, phase-shifted per tile) ---
  float dipPhase = seed * 17.0;
  float dipCycle = sin((t + dipPhase) * (0.15 + fract(seed * 0.37) * 0.05))
                 * sin((t + dipPhase) * (0.09 + fract(seed * 0.19) * 0.03));
  float dip = smoothstep(0.8, 1.0, dipCycle) * 0.15;
  col *= 1.0 - dip;

  // --- Subtle flicker (rare single-frame drops, per-tile rate) ---
  float flickEpoch = floor(t * flickerRate + seed * 13.0);
  float flickHit = step(0.96, hash(flickEpoch));
  col *= 1.0 - flickHit * 0.15;

  // --- Scanlines (per-tile density) ---
  float scanline = 0.97 + 0.03 * step(0.5, fract(vUv.y * scanlineCount));
  col *= scanline;

  // --- Fine grain (per-tile intensity) ---
  float grain = hash2(vUv * 300.0 + floor(t * 8.0) * 17.0) * grainAmt;
  col += grain;

  // --- Reveal: smooth fade (default) or CRT blink-in ---
  float reveal = uReveal;
  vec3 fadeCol = col; // smooth fade just uses col as-is

  // CRT power-on (center-out expansion with static)
  float distFromCenter = abs(vUv.y - 0.5) * 2.0;
  float slitOpen = smoothstep(0.0, 0.3, reveal);
  float inSlit = step(distFromCenter, slitOpen);
  float imagePhase = smoothstep(0.2, 0.8, reveal);
  float staticNoise = hash2(vUv * 200.0 + floor(uTime * 12.0) * 37.0);
  vec3 staticCol = vec3(staticNoise) * uPrimary * 0.6;
  vec3 crtCol = mix(staticCol, col, imagePhase) * inSlit;
  float flare = smoothstep(0.0, 0.15, reveal) * (1.0 - smoothstep(0.15, 0.6, reveal));
  crtCol += flare * uPrimary * 0.25;
  float edgeDist = abs(distFromCenter - slitOpen);
  float edgeLine = (1.0 - smoothstep(0.0, 0.02, edgeDist)) * step(0.01, reveal) * step(reveal, 0.95);
  crtCol += edgeLine * uPrimary * 0.4 * inSlit;
  crtCol += (1.0 - smoothstep(0.0, 0.5, reveal)) * (1.0 - distFromCenter) * 0.15 * uPrimary * inSlit;

  // Mix based on reveal style
  vec3 finalCol = mix(fadeCol, crtCol, uRevealStyle);
  float finalAlpha = mix(opacity, opacity * step(0.001, reveal), uRevealStyle);

  gl_FragColor = vec4(finalCol, finalAlpha);
}
`;

/**
 * Media mode: display user images/videos using the main compositor layout
 * with palette color replacement, post-processing, and rolling rearrangement.
 * Activated by V key. Includes a file browser overlay for managing media.
 */
export class MediaMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private onExit: () => void;
  private isMobileCheck: () => boolean;

  private active = false;
  private stashedChildren: THREE.Object3D[] = [];
  private palette!: Palette;
  private multiPalette = false;
  private elapsed = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // Tile display
  private tiles: MediaTile[] = [];
  private outgoingTiles: MediaTile[] = [];

  // Divider elements (separators between tiles)
  private dividers: BaseElement[] = [];
  private dividerWrappers: THREE.Group[] = [];

  // Rolling rearrangement
  private rollingTimer = 0;
  private layoutSeed: number = 0;
  private spawnGeneration = 0;
  private rearranging = false;

  // Stable layout snapshot for debug overlay (survives async tile spawning)
  private currentContentRegions: Region[] = [];
  private currentDividerRegions: Region[] = [];
  private currentAssignments: { region: Region; label: string }[] = [];

  // Browser overlay
  private overlay: HTMLDivElement;
  private browserPage = 0;
  private browserVisible = true;
  private fileInput: HTMLInputElement;

  // Event handlers
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;
  private dropHandler: (e: DragEvent) => void;
  private dragOverHandler: (e: DragEvent) => void;
  private dragEnterHandler: (e: DragEvent) => void;
  private dragLeaveHandler: (e: DragEvent) => void;
  private dropZone!: HTMLDivElement;
  private dragCounter = 0;

  constructor(
    ctx: RendererContext,
    pipeline: PostFXPipeline,
    config: Config,
    onExit: () => void,
    isMobile: () => boolean,
  ) {
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.config = config;
    this.onExit = onExit;
    this.isMobileCheck = isMobile;

    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.overlay.style.display = 'none';

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*,video/*';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', () => this.handleFiles(this.fileInput.files));

    this.keyHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.resizeHandler = () => this.handleResize();
    this.dropHandler = (e: DragEvent) => this.handleDrop(e);
    this.dragOverHandler = (e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; };

    this.dragEnterHandler = (e: DragEvent) => {
      e.preventDefault();
      if (!this.active) return;
      this.dragCounter++;
      this.dropZone.style.display = 'flex';
    };
    this.dragLeaveHandler = (e: DragEvent) => {
      e.preventDefault();
      this.dragCounter--;
      if (this.dragCounter <= 0) {
        this.dragCounter = 0;
        this.dropZone.style.display = 'none';
      }
    };

    // Drop zone visual feedback
    this.dropZone = document.createElement('div');
    Object.assign(this.dropZone.style, {
      position: 'fixed', inset: '0', zIndex: '960',
      background: 'rgba(170, 255, 170, 0.06)',
      border: '3px dashed rgba(170, 255, 170, 0.4)',
      display: 'none', pointerEvents: 'none',
      fontFamily: '"JetBrains Mono", monospace', color: 'rgba(170, 255, 170, 0.5)',
      fontSize: '14px', letterSpacing: '3px', textTransform: 'uppercase',
      justifyContent: 'center', alignItems: 'center',
    });
    this.dropZone.textContent = 'DROP FILES';
    document.body.appendChild(this.dropZone);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Expose layout regions for the debug overlay (stable snapshot, not in-progress tiles). */
  getDebugRegions(): { tiles: { region: Region; label: string }[]; dividers: Region[] } {
    return {
      tiles: this.currentAssignments,
      dividers: this.currentDividerRegions,
    };
  }

  private get isMobile(): boolean {
    return this.isMobileCheck();
  }

  enter(): void {
    this.active = true;
    this.elapsed = 0;
    this.rollingTimer = 0;
    this.layoutSeed = this.config.seed;

    // Stash scene children
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('drop', this.dropHandler);
    window.addEventListener('dragover', this.dragOverHandler);
    window.addEventListener('dragenter', this.dragEnterHandler);
    window.addEventListener('dragleave', this.dragLeaveHandler);

    this.overlay.style.display = '';
    this.spawnTiles();
    this.updateBrowser();
  }

  exit(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    if (this.resizeTimer) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }

    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('drop', this.dropHandler);
    window.removeEventListener('dragover', this.dragOverHandler);
    window.removeEventListener('dragenter', this.dragEnterHandler);
    window.removeEventListener('dragleave', this.dragLeaveHandler);
    this.dropZone.style.display = 'none';
    this.dragCounter = 0;

    this.cancelAndClearAll();
    revokeAllObjectUrls();

    // Restore stashed scene children
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    this.pipeline.update(this.elapsed, this.config);

    // Fade in new tiles with scan-on reveal
    for (const tile of this.tiles) {
      if (tile.opacity < tile.targetOpacity) {
        tile.opacity = Math.min(tile.targetOpacity, tile.opacity + FADE_SPEED * dt);
        this.setTileOpacity(tile, tile.opacity);
        // Drive reveal uniform: 0→1 maps to CRT center-out power-on
        const mat = tile.mesh.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uReveal) {
          // Ease-out curve for more dramatic initial burst then slow resolve
          const t = tile.opacity;
          mat.uniforms.uReveal.value = Math.min(1.0, t * (2.0 - t) * 1.1);
        }
      }
    }

    // Fade out and clean up outgoing tiles (keep shader time ticking during fade)
    for (let i = this.outgoingTiles.length - 1; i >= 0; i--) {
      const tile = this.outgoingTiles[i];
      tile.opacity = Math.max(0, tile.opacity - FADE_SPEED * dt);
      this.setTileOpacity(tile, tile.opacity);
      const outMat = tile.mesh.material as THREE.ShaderMaterial;
      if (outMat.uniforms?.uTime) outMat.uniforms.uTime.value = this.elapsed;
      if (tile.opacity <= 0) {
        this.disposeTile(tile);
        this.outgoingTiles.splice(i, 1);
      }
    }

    // Update shader uniforms on all tiles (time, Ken Burns)
    const rollingDur = this.config.rollingInterval || ROLLING_INTERVAL;
    for (const tile of this.tiles) {
      const mat = tile.mesh.material as THREE.ShaderMaterial;
      if (!mat.uniforms) continue;
      mat.uniforms.uTime.value = this.elapsed;

      // Ken Burns: smooth pan/zoom interpolation for image tiles
      if (tile.kenBurns) {
        const age = this.elapsed - tile.spawnTime;
        const t = Math.min(1, age / rollingDur);
        const ease = t * t * (3 - 2 * t); // smoothstep
        const kb = tile.kenBurns;
        const zoom = kb.zoomStart + (kb.zoomEnd - kb.zoomStart) * ease;
        mat.uniforms.uKenBurnsZoom.value = zoom;
        mat.uniforms.uKenBurnsPan.value.set(kb.panX * ease, kb.panY * ease);
      }
    }

    // Tick divider elements (separators animate)
    for (const el of this.dividers) {
      el.tick(dt, this.elapsed);
    }

    // Rolling rearrangement using config interval
    if (this.tiles.length > 0 && this.config.rollingSwap) {
      this.rollingTimer += dt;
      const interval = this.config.rollingInterval || ROLLING_INTERVAL;
      if (this.rollingTimer >= interval) {
        this.rollingTimer = 0;
        this.rollingRearrange();
      }
    }
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  dispose(): void {
    this.clearTiles();
    this.clearOutgoing();
    this.overlay.remove();
    this.fileInput.remove();
    this.dropZone.remove();
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('drop', this.dropHandler);
    window.removeEventListener('dragover', this.dragOverHandler);
    window.removeEventListener('dragenter', this.dragEnterHandler);
    window.removeEventListener('dragleave', this.dragLeaveHandler);
  }

  // --- Layout & tile management ---

  private clearTiles(): void {
    for (const tile of this.tiles) {
      this.disposeTile(tile);
    }
    this.tiles = [];
    this.clearDividers();
    revokeAllObjectUrls();
  }

  private clearOutgoing(): void {
    for (const tile of this.outgoingTiles) {
      this.disposeTile(tile);
    }
    this.outgoingTiles = [];
  }

  /** Nuclear cleanup: bump generation to cancel in-flight spawns, dispose all tracked tiles. */
  private cancelAndClearAll(): void {
    this.spawnGeneration++;
    this.rearranging = false;
    for (const tile of this.tiles) {
      this.disposeTile(tile);
    }
    this.tiles = [];
    for (const tile of this.outgoingTiles) {
      this.disposeTile(tile);
    }
    this.outgoingTiles = [];
    this.clearDividers();
  }

  private clearDividers(): void {
    for (let i = 0; i < this.dividers.length; i++) {
      this.ctx.scene.remove(this.dividerWrappers[i]);
      if (this.dividers[i]._built) this.dividers[i].dispose();
    }
    this.dividers = [];
    this.dividerWrappers = [];
  }

  private setTileOpacity(tile: MediaTile, opacity: number): void {
    (tile.mesh.material as THREE.ShaderMaterial).uniforms.opacity.value = opacity;
  }

  private disposeTile(tile: MediaTile): void {
    this.ctx.scene.remove(tile.mesh);
    tile.texture.dispose();
    tile.mesh.geometry.dispose();
    (tile.mesh.material as THREE.Material).dispose();
    // Release video resources fully
    if (tile.source instanceof HTMLVideoElement) {
      tile.source.pause();
      tile.source.removeAttribute('src');
      tile.source.load();
    }
    tile.source = null;
  }

  /** Generate layout regions using the main compositor. */
  private generateLayout(): { content: Region[]; dividers: Region[] } {
    const rng = new SeededRandom(this.layoutSeed);
    const canvasAspect = this.config.width / this.config.height;
    const { regions } = compose(this.config.template, rng, canvasAspect, false);
    return {
      content: regions.filter(r => !r.isDivider),
      dividers: regions.filter(r => r.isDivider),
    };
  }

  private async spawnTiles(): Promise<void> {
    this.cancelAndClearAll();

    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const w = this.config.width;
    const h = this.config.height;

    // Use the main compositor for layout
    const { content, dividers } = this.generateLayout();

    // Store layout snapshot for debug overlay
    this.currentContentRegions = content;
    this.currentDividerRegions = dividers;

    // Create divider elements (separators)
    this.spawnDividers(dividers, w, h);

    const lib = loadLibrary();
    if (lib.items.length === 0) {
      this.currentAssignments = [];
      return;
    }

    // Assign media items to content regions — cycle if more regions than items
    const rng = new SeededRandom(this.layoutSeed);
    const shuffled = [...lib.items];
    rng.shuffle(shuffled);

    const assignedItems: { item: MediaItem; region: Region }[] = [];
    for (let i = 0; i < content.length; i++) {
      assignedItems.push({
        item: shuffled[i % shuffled.length],
        region: content[i],
      });
    }

    // Store assignments for debug overlay
    this.currentAssignments = assignedItems.map(a => ({
      region: a.region,
      label: `${a.item.type}: ${a.item.name}`,
    }));

    // Fetch object URLs for unique items
    const uniqueIds = [...new Set(assignedItems.map(a => a.item.id))];
    await Promise.all(uniqueIds.map(id => getObjectUrl(id)));

    // Create all tile meshes immediately (dim placeholders)
    this.spawnGeneration++;
    const gen = this.spawnGeneration;
    const isStale = () => gen !== this.spawnGeneration;
    const allPaletteNames = paletteNames();
    const palRng = new SeededRandom(this.layoutSeed + 777);
    const newTiles: MediaTile[] = [];
    for (const { item, region } of assignedItems) {
      const objectUrl = await getObjectUrl(item.id);
      if (!objectUrl || isStale()) return;
      const tilePal = this.multiPalette
        ? getPalette(allPaletteNames[palRng.int(0, allPaletteNames.length - 1)])
        : undefined;
      const tile = this.createTile(region, item, objectUrl, w, h, tilePal);
      tile.targetOpacity = 1;
      tile.opacity = 0;
      this.setTileOpacity(tile, 0);
      this.tiles.push(tile);
      newTiles.push(tile);
    }

    // Load media in background with staggered fade-in
    for (let i = 0; i < newTiles.length; i++) {
      if (isStale()) return;
      this.loadTileMedia(newTiles[i]);
      await yieldFrames(TILE_STAGGER_FRAMES);
    }
  }

  private spawnDividers(dividerRegions: Region[], w: number, h: number): void {
    const rng = new SeededRandom(this.layoutSeed + 999);
    for (const region of dividerRegions) {
      const elType = region.elementType ?? 'separator';
      const el = createElement(elType, region, this.palette, rng.fork(), w, h);
      const wrapper = new THREE.Group();
      wrapper.add(el.group);
      wrapper.renderOrder = 10;
      this.ctx.scene.add(wrapper);
      el.group.visible = true;
      el.stateMachine.transition('active');
      this.dividers.push(el);
      this.dividerWrappers.push(wrapper);
    }
  }

  /** Rolling rearrangement: crossfade to a new layout.
   *  @param newSeed — if true (default), generate a fresh seed. False when R key already set one. */
  private async rollingRearrange(newSeed = true): Promise<void> {
    const lib = loadLibrary();
    if (lib.items.length === 0) return;

    // Guard against concurrent rearranges — if one is already running,
    // cancel it via spawnGeneration and take over
    if (this.rearranging) {
      this.spawnGeneration++;
    }
    this.rearranging = true;

    // Cancel any in-flight spawn loop (but don't dispose tiles yet — crossfade them)
    this.spawnGeneration++;

    // Dispose any already-fading outgoing tiles to prevent accumulation
    this.clearOutgoing();

    // Move current tiles to outgoing so they fade out gracefully
    for (const tile of this.tiles) {
      tile.targetOpacity = 0;
      this.outgoingTiles.push(tile);
    }
    this.tiles = [];

    // Clear old dividers
    this.clearDividers();

    if (newSeed) {
      // Auto-rolling: pick a fresh seed and sync to config
      this.config.seed = Math.floor(Math.random() * 100000);
      this.layoutSeed = this.config.seed;
    }
    this.palette = getPalette(this.config.palette);

    const w = this.config.width;
    const h = this.config.height;
    const { content, dividers } = this.generateLayout();

    // Store layout snapshot for debug overlay
    this.currentContentRegions = content;
    this.currentDividerRegions = dividers;

    // Spawn new dividers
    this.spawnDividers(dividers, w, h);

    const rng = new SeededRandom(this.layoutSeed);
    const shuffled = [...lib.items];
    rng.shuffle(shuffled);

    // Store assignments for debug overlay
    this.currentAssignments = content.map((region, i) => ({
      region,
      label: `${shuffled[i % shuffled.length].type}: ${shuffled[i % shuffled.length].name}`,
    }));

    // Fetch object URLs
    const uniqueIds = [...new Set(shuffled.map(a => a.id))];
    await Promise.all(uniqueIds.map(id => getObjectUrl(id)));

    // After the await, check if a newer rearrange has taken over
    const gen = ++this.spawnGeneration;
    const isStale = () => gen !== this.spawnGeneration;

    if (isStale()) { this.rearranging = false; return; }

    // Create all tile meshes immediately (dim placeholders), staggered fade-in
    const allPaletteNames = paletteNames();
    const palRng = new SeededRandom(this.layoutSeed + 777);
    const newTiles: MediaTile[] = [];
    for (let i = 0; i < content.length; i++) {
      const item = shuffled[i % shuffled.length];
      const objectUrl = await getObjectUrl(item.id);
      if (!objectUrl || isStale()) {
        // Dispose tiles this call already created — a newer call owns the layout now
        for (const t of newTiles) { this.disposeTile(t); }
        this.tiles = this.tiles.filter(t => !newTiles.includes(t));
        this.rearranging = false;
        return;
      }
      const tilePal = this.multiPalette
        ? getPalette(allPaletteNames[palRng.int(0, allPaletteNames.length - 1)])
        : undefined;
      const tile = this.createTile(content[i], item, objectUrl, w, h, tilePal);
      tile.targetOpacity = 1;
      tile.opacity = 0;
      this.setTileOpacity(tile, 0);
      this.tiles.push(tile);
      newTiles.push(tile);
    }

    // Load media in background with staggered fade-in — no blocking between tiles
    for (let i = 0; i < newTiles.length; i++) {
      if (isStale()) { this.rearranging = false; return; }
      this.loadTileMedia(newTiles[i]); // fire-and-forget — loads in background
      await yieldFrames(TILE_STAGGER_FRAMES);
    }
    this.rearranging = false;
  }

  private createTile(region: Region, item: MediaItem, objectUrl: string, canvasW: number, canvasH: number, tilePalette?: Palette): MediaTile {
    const pal = tilePalette ?? this.palette;
    const px = regionToPixels(region, canvasW, canvasH);
    const geo = new THREE.PlaneGeometry(px.w, px.h);

    // Both image and video use the same GPU shader — placeholder texture initially
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    texture.needsUpdate = true;

    // Ken Burns for images: gentle random pan/zoom over the rolling interval
    const isImage = item.type === 'image';
    const rng = new SeededRandom(this.layoutSeed + region.x * 1000 + region.y * 7777);
    const kenBurns = isImage ? {
      zoomStart: 1.0 + rng.float(0, 0.08),
      zoomEnd: 1.0 + rng.float(0.04, 0.14),
      panX: rng.float(-0.02, 0.02),
      panY: rng.float(-0.02, 0.02),
    } : null;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tMedia: { value: texture },
        opacity: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: rng.float(0, 100) },
        uBg: { value: pal.bg.clone() },
        uDim: { value: pal.dim.clone() },
        uPrimary: { value: pal.primary.clone() },
        uSecondary: { value: pal.secondary.clone() },
        uCoverScale: { value: new THREE.Vector2(1, 1) },
        uCoverOffset: { value: new THREE.Vector2(0, 0) },
        uKenBurnsZoom: { value: 1.0 },
        uKenBurnsPan: { value: new THREE.Vector2(0, 0) },
        uReveal: { value: 0.0 },
        uRevealStyle: { value: rng.float(0, 1) < 0.3 ? 1.0 : 0.0 },
      },
      vertexShader: PALETTE_REMAP_VERT,
      fragmentShader: PALETTE_REMAP_FRAG,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px.x + px.w / 2, px.y + px.h / 2, 0);
    this.ctx.scene.add(mesh);

    return {
      mesh, texture, region, item, objectUrl,
      source: null, palette: pal, opacity: 0, targetOpacity: 1, loaded: false,
      kenBurns, spawnTime: this.elapsed,
    };
  }

  /** Compute cover-fit UV scale/offset so media fills tile without stretching. */
  private setCoverFitUniforms(tile: MediaTile, mediaW: number, mediaH: number): void {
    const px = regionToPixels(tile.region, this.config.width, this.config.height);
    const tileAspect = px.w / px.h;
    const mediaAspect = mediaW / mediaH;
    const uniforms = (tile.mesh.material as THREE.ShaderMaterial).uniforms;
    if (mediaAspect > tileAspect) {
      const scale = tileAspect / mediaAspect;
      uniforms.uCoverScale.value.set(scale, 1);
      uniforms.uCoverOffset.value.set((1 - scale) / 2, 0);
    } else {
      const scale = mediaAspect / tileAspect;
      uniforms.uCoverScale.value.set(1, scale);
      uniforms.uCoverOffset.value.set(0, (1 - scale) / 2);
    }
  }

  /** Load media for a tile (fire-and-forget). Both images and videos use GPU shader. */
  private loadTileMedia(tile: MediaTile): Promise<void> {
    const { item, objectUrl } = tile;

    if (item.type === 'image') {
      return new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          if (this.active) {
            tile.source = img;
            tile.loaded = true;

            // Create texture from image and swap into shader
            const imgTex = new THREE.Texture(img);
            imgTex.minFilter = THREE.LinearFilter;
            imgTex.magFilter = THREE.LinearFilter;
            imgTex.needsUpdate = true;
            tile.texture.dispose();
            tile.texture = imgTex;

            const uniforms = (tile.mesh.material as THREE.ShaderMaterial).uniforms;
            uniforms.tMedia.value = imgTex;
            this.setCoverFitUniforms(tile, img.width, img.height);
          }
          resolve();
        };
        img.onerror = () => {
          // Mark as loaded so it doesn't block — shows dim placeholder
          tile.loaded = true;
          resolve();
        };
        img.src = objectUrl;
      });
    } else {
      // Video: create VideoTexture → GPU shader does the rest
      return new Promise<void>(resolve => {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.onloadeddata = () => {
          if (this.active) {
            video.play();
            tile.source = video;
            tile.loaded = true;

            // Swap placeholder texture for a VideoTexture
            const vidTex = new THREE.VideoTexture(video);
            vidTex.minFilter = THREE.LinearFilter;
            vidTex.magFilter = THREE.LinearFilter;
            tile.texture.dispose();
            tile.texture = vidTex;

            const uniforms = (tile.mesh.material as THREE.ShaderMaterial).uniforms;
            uniforms.tMedia.value = vidTex;
            this.setCoverFitUniforms(tile, video.videoWidth, video.videoHeight);
          } else {
            video.pause();
            video.src = '';
            video.load();
          }
          resolve();
        };
        video.onerror = () => {
          tile.loaded = true;
          resolve();
        };
        video.src = objectUrl;
      });
    }
  }


  // --- File browser overlay ---

  private createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'media-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: `${BROWSER_WIDTH}px`,
      height: '100%',
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: '950',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      overflowY: 'auto',
    });
    return el;
  }

  private updateBrowser(): void {
    const lib = loadLibrary();
    const items = lib.items;
    const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    if (this.browserPage >= totalPages) this.browserPage = totalPages - 1;

    const start = this.browserPage * ITEMS_PER_PAGE;
    const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

    let html = '';

    // Header
    html += `<div style="
      padding:12px 16px;
      border-bottom:1px solid rgba(255,255,255,0.1);
      display:flex;
      justify-content:space-between;
      align-items:center;
      flex-shrink:0;
    ">
      <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.7;">
        MEDIA LIBRARY
      </span>
      <span style="font-size:10px;opacity:0.4;">${items.length} items</span>
    </div>`;

    // Add button
    html += `<div style="padding:8px 16px;flex-shrink:0;">
      <button id="media-add-btn" style="
        width:100%;
        padding:8px;
        background:rgba(255,255,255,0.08);
        border:1px solid rgba(255,255,255,0.2);
        border-radius:4px;
        color:#fff;
        font-family:inherit;
        font-size:11px;
        letter-spacing:1px;
        text-transform:uppercase;
        cursor:pointer;
      ">+ Add Files</button>
    </div>`;

    // Thumbnail grid
    if (pageItems.length === 0) {
      html += `<div style="
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        padding:32px;
        opacity:0.3;
        font-size:11px;
        line-height:1.6;
      ">
        No media added yet.<br>
        Click "Add Files" or<br>
        drag & drop images/videos.
      </div>`;
    } else {
      html += `<div style="
        padding:8px;
        display:grid;
        grid-template-columns:repeat(3, 1fr);
        gap:6px;
        flex:1;
        align-content:start;
      ">`;

      for (const item of pageItems) {
        html += `<div class="media-thumb" data-id="${item.id}" style="
          position:relative;
          aspect-ratio:1;
          border-radius:3px;
          overflow:hidden;
          cursor:pointer;
          border:1px solid rgba(255,255,255,0.1);
          transition:border-color 0.15s;
        ">
          <img src="${item.thumbUrl}" style="
            width:100%;
            height:100%;
            object-fit:cover;
            display:block;
          " />
          <button class="media-remove-btn" data-id="${item.id}" style="
            position:absolute;
            top:2px;
            right:2px;
            width:18px;
            height:18px;
            background:rgba(0,0,0,0.7);
            border:1px solid rgba(255,255,255,0.3);
            border-radius:50%;
            color:#fff;
            font-size:11px;
            line-height:1;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
            opacity:0;
            transition:opacity 0.15s;
          ">&times;</button>
          <div style="
            position:absolute;
            bottom:0;
            left:0;
            right:0;
            padding:2px 4px;
            background:rgba(0,0,0,0.6);
            font-size:8px;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
            opacity:0.7;
          ">${item.name}</div>
        </div>`;
      }

      html += `</div>`;
    }

    // Pagination
    if (totalPages > 1) {
      html += `<div style="
        padding:8px 16px;
        border-top:1px solid rgba(255,255,255,0.1);
        display:flex;
        justify-content:center;
        align-items:center;
        gap:12px;
        flex-shrink:0;
        font-size:10px;
      ">
        <button id="media-prev-btn" style="
          background:none;border:1px solid rgba(255,255,255,0.2);
          color:#fff;padding:4px 10px;border-radius:3px;cursor:pointer;
          font-family:inherit;font-size:10px;
          opacity:${this.browserPage > 0 ? '0.8' : '0.2'};
        ">&lsaquo; PREV</button>
        <span style="opacity:0.5;">${this.browserPage + 1} / ${totalPages}</span>
        <button id="media-next-btn" style="
          background:none;border:1px solid rgba(255,255,255,0.2);
          color:#fff;padding:4px 10px;border-radius:3px;cursor:pointer;
          font-family:inherit;font-size:10px;
          opacity:${this.browserPage < totalPages - 1 ? '0.8' : '0.2'};
        ">NEXT &rsaquo;</button>
      </div>`;
    }

    // Footer hint
    html += `<div style="
      padding:8px 16px;
      border-top:1px solid rgba(255,255,255,0.1);
      font-size:9px;
      opacity:0.3;
      text-align:center;
      flex-shrink:0;
      letter-spacing:1px;
    ">R rearrange &middot; P palette &middot; TAB browser &middot; &larr;&rarr; pages &middot; ESC exit</div>`;

    this.overlay.innerHTML = html;

    // Wire up events
    this.overlay.querySelector('#media-add-btn')?.addEventListener('click', () => {
      this.fileInput.click();
    });


    this.overlay.querySelectorAll('.media-remove-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        await removeItem(id);
        await this.spawnTiles();
        this.updateBrowser();
        showToast('Removed');
      });
    });

    // Show remove button on hover
    this.overlay.querySelectorAll('.media-thumb').forEach(thumb => {
      thumb.addEventListener('mouseenter', () => {
        const btn = thumb.querySelector('.media-remove-btn') as HTMLElement;
        if (btn) btn.style.opacity = '1';
      });
      thumb.addEventListener('mouseleave', () => {
        const btn = thumb.querySelector('.media-remove-btn') as HTMLElement;
        if (btn) btn.style.opacity = '0';
      });
    });

    this.overlay.querySelector('#media-prev-btn')?.addEventListener('click', () => {
      if (this.browserPage > 0) {
        this.browserPage--;
        this.updateBrowser();
      }
    });

    this.overlay.querySelector('#media-next-btn')?.addEventListener('click', () => {
      if (this.browserPage < totalPages - 1) {
        this.browserPage++;
        this.updateBrowser();
      }
    });

    // Toggle browser visibility
    this.overlay.style.display = this.browserVisible ? '' : 'none';
  }

  // --- Event handlers ---

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;
    switch (e.key) {
      case 'v':
      case 'V':
      case 'Escape':
        e.preventDefault();
        this.exit();
        break;
      case 'Tab':
        e.preventDefault();
        this.browserVisible = !this.browserVisible;
        this.overlay.style.display = this.browserVisible ? '' : 'none';
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        // Use config.seed (already updated by engine's R handler) for layout
        this.layoutSeed = this.config.seed;
        this.rollingRearrange(false);
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        this.multiPalette = !this.multiPalette;
        showToast(this.multiPalette ? 'Multi-palette: on' : 'Multi-palette: off');
        this.rollingRearrange();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (this.browserPage > 0) {
          this.browserPage--;
          this.updateBrowser();
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.browserPage++;
        this.updateBrowser(); // updateBrowser clamps to max page
        break;
    }
  }

  private handleResize(): void {
    if (!this.active) return;
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    // Debounce tile respawn during rapid resizing
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      if (this.active) this.spawnTiles();
    }, 250);
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    this.dropZone.style.display = 'none';
    this.dragCounter = 0;
    if (!this.active) return;
    const files = e.dataTransfer?.files;
    if (files) this.handleFiles(files);
  }

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      try {
        await addFile(file);
        added++;
      } catch (err) {
        console.warn('Failed to add media file:', err);
      }
    }
    if (added > 0) {
      showToast(`Added ${added} file${added > 1 ? 's' : ''}`);
      await this.spawnTiles();
      this.updateBrowser();
    }
    this.fileInput.value = '';
  }

  private applyAspect(): void {
    const mobile = this.isMobile;
    const viewportH = mobile ? window.innerHeight - TOOLBAR_HEIGHT : window.innerHeight;
    const { width, height, offsetX, offsetY } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth,
      viewportH,
    );
    this.config.width = width;
    this.config.height = height;
    const canvas = this.ctx.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.left = `${offsetX}px`;
    canvas.style.top = `${offsetY}px`;
  }
}
