import * as THREE from 'three';
import { resizeRenderer, type RendererContext } from '../renderer/setup';
import { type PostFXPipeline } from '../postfx/pipeline';
import { type Config, computeAspectSize } from '../config';
import { getPalette, type Palette } from '../color/palettes';
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
const TILE_STAGGER_FRAMES = 6;

/** Cap video canvas resolution — videos redraw every frame so lower res saves CPU */
/** Opacity fade speed per second */
const FADE_SPEED = 3.5;
/** Seconds between rolling rearrangements */
const ROLLING_INTERVAL = 15;

interface MediaTile {
  mesh: THREE.Mesh;
  texture: THREE.Texture;
  canvas: HTMLCanvasElement | null;
  ctx2d: CanvasRenderingContext2D | null;
  region: Region;
  item: MediaItem;
  objectUrl: string;
  source: HTMLImageElement | HTMLVideoElement | null;
  opacity: number;
  targetOpacity: number;
  loaded: boolean;
}

/* Palette remap shader with per-tile glitch effects */
const PALETTE_REMAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PALETTE_REMAP_FRAG = /* glsl */ `
uniform sampler2D tVideo;
uniform float opacity;
uniform float uTime;
uniform float uSeed;
uniform vec3 uBg;
uniform vec3 uDim;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
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
  vec2 coverUv = vUv * uCoverScale + uCoverOffset;
  float t = uTime;
  float seed = uSeed;

  // --- Sample video ---
  vec4 tex = texture2D(tVideo, coverUv);
  float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = paletteRemap(lum);

  // --- Power dips (rare, gentle) ---
  float dipCycle = sin(t * (0.15 + seed * 0.05)) * sin(t * (0.09 + seed * 0.03));
  float dip = smoothstep(0.8, 1.0, dipCycle) * 0.15;
  col *= 1.0 - dip;

  // --- Subtle flicker (rare single-frame drops) ---
  float flickEpoch = floor(t * 2.0 + seed * 13.0);
  float flickHit = step(0.96, hash(flickEpoch));
  col *= 1.0 - flickHit * 0.15;

  // --- Scanlines (very subtle) ---
  float scanline = 0.97 + 0.03 * step(0.5, fract(vUv.y * 150.0));
  col *= scanline;

  // --- Fine grain ---
  float grain = hash2(vUv * 300.0 + floor(t * 8.0) * 17.0) * 0.015;
  col += grain;

  gl_FragColor = vec4(col, opacity);
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
  private elapsed = 0;

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
  }

  get isActive(): boolean {
    return this.active;
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

    this.overlay.style.display = '';
    this.spawnTiles();
    this.updateBrowser();
  }

  exit(): void {
    this.active = false;
    this.overlay.style.display = 'none';

    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('drop', this.dropHandler);
    window.removeEventListener('dragover', this.dragOverHandler);

    this.clearTiles();
    this.clearOutgoing();

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

    // Fade in new tiles
    for (const tile of this.tiles) {
      if (tile.opacity < tile.targetOpacity) {
        tile.opacity = Math.min(tile.targetOpacity, tile.opacity + FADE_SPEED * dt);
        this.setTileOpacity(tile, tile.opacity);
      }
    }

    // Fade out and clean up outgoing tiles
    for (let i = this.outgoingTiles.length - 1; i >= 0; i--) {
      const tile = this.outgoingTiles[i];
      tile.opacity = Math.max(0, tile.opacity - FADE_SPEED * dt);
      this.setTileOpacity(tile, tile.opacity);
      if (tile.opacity <= 0) {
        this.disposeTile(tile);
        this.outgoingTiles.splice(i, 1);
      }
    }

    // Update time uniform on video tiles for shader effects
    for (const tile of this.tiles) {
      if (tile.item.type === 'video') {
        const mat = tile.mesh.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uTime) mat.uniforms.uTime.value = this.elapsed;
      }
    }

    // Tick divider elements (separators animate)
    for (const el of this.dividers) {
      el.tick(dt, this.elapsed);
    }

    // Rolling rearrangement on a slower cadence
    if (this.tiles.length > 0) {
      this.rollingTimer += dt;
      if (this.rollingTimer >= ROLLING_INTERVAL) {
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
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('drop', this.dropHandler);
    window.removeEventListener('dragover', this.dragOverHandler);
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

  private clearDividers(): void {
    for (let i = 0; i < this.dividers.length; i++) {
      this.ctx.scene.remove(this.dividerWrappers[i]);
      if (this.dividers[i]._built) this.dividers[i].dispose();
    }
    this.dividers = [];
    this.dividerWrappers = [];
  }

  private setTileOpacity(tile: MediaTile, opacity: number): void {
    const mat = tile.mesh.material;
    if (mat instanceof THREE.ShaderMaterial) {
      mat.uniforms.opacity.value = opacity;
    } else {
      (mat as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  private disposeTile(tile: MediaTile): void {
    this.ctx.scene.remove(tile.mesh);
    tile.texture.dispose();
    tile.mesh.geometry.dispose();
    (tile.mesh.material as THREE.Material).dispose();
    // Pause video if playing
    if (tile.source instanceof HTMLVideoElement) {
      tile.source.pause();
      tile.source.src = '';
    }
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
    this.clearTiles();

    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const w = this.config.width;
    const h = this.config.height;

    // Use the main compositor for layout
    const { content, dividers } = this.generateLayout();

    // Create divider elements (separators)
    this.spawnDividers(dividers, w, h);

    const lib = loadLibrary();
    if (lib.items.length === 0) return;

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

    // Fetch object URLs for unique items
    const uniqueIds = [...new Set(assignedItems.map(a => a.item.id))];
    await Promise.all(uniqueIds.map(id => getObjectUrl(id)));

    // Create tiles staggered across frames — await load+remap so work is spread out
    this.spawnGeneration++;
    const gen = this.spawnGeneration;
    for (const { item, region } of assignedItems) {
      if (gen !== this.spawnGeneration) return;
      const objectUrl = await getObjectUrl(item.id);
      if (!objectUrl || gen !== this.spawnGeneration) continue;
      const tile = this.createTile(region, item, objectUrl, w, h);
      tile.targetOpacity = 1;
      tile.opacity = 0;
      this.setTileOpacity(tile, 0);
      this.tiles.push(tile);
      await this.loadTileMedia(tile);
      if (gen !== this.spawnGeneration) return;
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

  /** Rolling rearrangement: crossfade to a new layout. */
  private async rollingRearrange(): Promise<void> {
    const lib = loadLibrary();
    if (lib.items.length === 0) return;

    // Move current tiles to outgoing (they'll fade out)
    for (const tile of this.tiles) {
      tile.targetOpacity = 0;
      this.outgoingTiles.push(tile);
    }
    this.tiles = [];

    // Clear old dividers
    this.clearDividers();

    // New layout seed
    this.layoutSeed = Math.floor(Math.random() * 100000);
    this.palette = getPalette(this.config.palette);

    const w = this.config.width;
    const h = this.config.height;
    const { content, dividers } = this.generateLayout();

    // Spawn new dividers
    this.spawnDividers(dividers, w, h);

    const rng = new SeededRandom(this.layoutSeed);
    const shuffled = [...lib.items];
    rng.shuffle(shuffled);

    // Fetch object URLs
    const uniqueIds = [...new Set(shuffled.map(a => a.id))];
    await Promise.all(uniqueIds.map(id => getObjectUrl(id)));

    this.spawnGeneration++;
    const gen = this.spawnGeneration;
    for (let i = 0; i < content.length; i++) {
      if (gen !== this.spawnGeneration) return;
      const item = shuffled[i % shuffled.length];
      const objectUrl = await getObjectUrl(item.id);
      if (!objectUrl || gen !== this.spawnGeneration) continue;
      const tile = this.createTile(content[i], item, objectUrl, w, h);
      tile.targetOpacity = 1;
      tile.opacity = 0;
      this.setTileOpacity(tile, 0);
      this.tiles.push(tile);
      await this.loadTileMedia(tile);
      if (gen !== this.spawnGeneration) return;
      await yieldFrames(TILE_STAGGER_FRAMES);
    }
  }

  private createTile(region: Region, item: MediaItem, objectUrl: string, canvasW: number, canvasH: number): MediaTile {
    const px = regionToPixels(region, canvasW, canvasH);
    const geo = new THREE.PlaneGeometry(px.w, px.h);

    let texture: THREE.Texture;
    let mat: THREE.Material;
    let canvas: HTMLCanvasElement | null = null;
    let ctx2d: CanvasRenderingContext2D | null = null;

    if (item.type === 'video') {
      // Video tiles: GPU shader path — no canvas, no CPU pixel ops
      // VideoTexture is created later in loadTileMedia once the video element exists.
      // Use a placeholder 1x1 texture initially.
      texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      texture.needsUpdate = true;
      mat = new THREE.ShaderMaterial({
        uniforms: {
          tVideo: { value: texture },
          opacity: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: Math.random() * 100 },
          uBg: { value: this.palette.bg.clone() },
          uDim: { value: this.palette.dim.clone() },
          uPrimary: { value: this.palette.primary.clone() },
          uSecondary: { value: this.palette.secondary.clone() },
          uCoverScale: { value: new THREE.Vector2(1, 1) },
          uCoverOffset: { value: new THREE.Vector2(0, 0) },
        },
        vertexShader: PALETTE_REMAP_VERT,
        fragmentShader: PALETTE_REMAP_FRAG,
        transparent: true,
      });
    } else {
      // Image tiles: canvas path (one-shot draw, no per-frame cost)
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(px.w));
      canvas.height = Math.max(1, Math.round(px.h));
      ctx2d = canvas.getContext('2d')!;

      ctx2d.fillStyle = '#' + this.palette.dim.getHexString();
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);

      texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;

      mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0 });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px.x + px.w / 2, px.y + px.h / 2, 0);
    this.ctx.scene.add(mesh);

    return {
      mesh, texture, canvas, ctx2d, region, item, objectUrl,
      source: null, opacity: 0, targetOpacity: 1, loaded: false,
    };
  }

  /** Load media for a tile. Awaitable so callers can stagger. */
  private loadTileMedia(tile: MediaTile): Promise<void> {
    const { item, objectUrl } = tile;

    if (item.type === 'image') {
      return new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          if (this.active && tile.ctx2d && tile.canvas) {
            tile.source = img;
            tile.loaded = true;
            this.drawMediaToCanvas(tile.ctx2d, img, tile.canvas.width, tile.canvas.height);
            this.applyPaletteRemap(tile.ctx2d, tile.canvas.width, tile.canvas.height);
            (tile.texture as THREE.CanvasTexture).needsUpdate = true;
          }
          resolve();
        };
        img.onerror = () => resolve();
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
            vidTex.minFilter = THREE.NearestFilter;
            vidTex.magFilter = THREE.NearestFilter;
            tile.texture.dispose();
            tile.texture = vidTex;

            const uniforms = (tile.mesh.material as THREE.ShaderMaterial).uniforms;
            uniforms.tVideo.value = vidTex;

            // Compute cover-fit UV transform so video fills tile without stretching
            const px = regionToPixels(tile.region, this.config.width, this.config.height);
            const tileAspect = px.w / px.h;
            const vidAspect = video.videoWidth / video.videoHeight;
            if (vidAspect > tileAspect) {
              // Video wider than tile: crop sides
              const scale = tileAspect / vidAspect;
              uniforms.uCoverScale.value.set(scale, 1);
              uniforms.uCoverOffset.value.set((1 - scale) / 2, 0);
            } else {
              // Video taller than tile: crop top/bottom
              const scale = vidAspect / tileAspect;
              uniforms.uCoverScale.value.set(1, scale);
              uniforms.uCoverOffset.value.set(0, (1 - scale) / 2);
            }
          }
          resolve();
        };
        video.onerror = () => resolve();
        video.src = objectUrl;
      });
    }
  }

  private drawMediaToCanvas(
    ctx: CanvasRenderingContext2D,
    source: HTMLImageElement | HTMLVideoElement,
    w: number,
    h: number,
  ): void {
    const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (srcW === 0 || srcH === 0) return;

    // Cover fit: scale to fill, crop excess
    const scale = Math.max(w / srcW, h / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const ox = (w - drawW) / 2;
    const oy = (h - drawH) / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, ox, oy, drawW, drawH);
  }

  /** Precomputed LUT: for each luminance 0-255, stores [R, G, B]. Built once per palette. */
  private paletteLUT: Uint8Array | null = null;
  private paletteLUTKey: string = '';

  private buildPaletteLUT(): Uint8Array {
    const lut = new Uint8Array(256 * 3);
    const bgR = Math.round(this.palette.bg.r * 255);
    const bgG = Math.round(this.palette.bg.g * 255);
    const bgB = Math.round(this.palette.bg.b * 255);
    const dimR = Math.round(this.palette.dim.r * 255);
    const dimG = Math.round(this.palette.dim.g * 255);
    const dimB = Math.round(this.palette.dim.b * 255);
    const priR = Math.round(this.palette.primary.r * 255);
    const priG = Math.round(this.palette.primary.g * 255);
    const priB = Math.round(this.palette.primary.b * 255);
    const secR = Math.round(this.palette.secondary.r * 255);
    const secG = Math.round(this.palette.secondary.g * 255);
    const secB = Math.round(this.palette.secondary.b * 255);

    for (let L = 0; L < 256; L++) {
      const lum = L / 255;
      let r: number, g: number, b: number;
      if (lum < 0.25) {
        const t = lum / 0.25;
        r = bgR + (dimR - bgR) * t;
        g = bgG + (dimG - bgG) * t;
        b = bgB + (dimB - bgB) * t;
      } else if (lum < 0.5) {
        const t = (lum - 0.25) / 0.25;
        r = dimR + (priR - dimR) * t;
        g = dimG + (priG - dimG) * t;
        b = dimB + (priB - dimB) * t;
      } else if (lum < 0.75) {
        const t = (lum - 0.5) / 0.25;
        r = priR + (secR - priR) * t;
        g = priG + (secG - priG) * t;
        b = priB + (secB - priB) * t;
      } else {
        const t = (lum - 0.75) / 0.25;
        r = secR + (255 - secR) * t;
        g = secG + (255 - secG) * t;
        b = secB + (255 - secB) * t;
      }
      const off = L * 3;
      lut[off] = r | 0;
      lut[off + 1] = g | 0;
      lut[off + 2] = b | 0;
    }
    return lut;
  }

  private getPaletteLUT(): Uint8Array {
    const key = this.palette.primary.getHexString() + this.palette.bg.getHexString();
    if (!this.paletteLUT || this.paletteLUTKey !== key) {
      this.paletteLUT = this.buildPaletteLUT();
      this.paletteLUTKey = key;
    }
    return this.paletteLUT;
  }

  private applyPaletteRemap(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const lut = this.getPaletteLUT();

    for (let i = 0; i < data.length; i += 4) {
      // Integer luminance 0-255 (fixed-point weighted sum, no division by 255)
      const L = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      const off = L * 3;
      data[i]     = lut[off];
      data[i + 1] = lut[off + 1];
      data[i + 2] = lut[off + 2];
    }

    ctx.putImageData(imageData, 0, 0);
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
    ">R rearrange &middot; TAB toggle browser &middot; ESC exit</div>`;

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
        this.rollingRearrange();
        break;
    }
  }

  private async handleResize(): Promise<void> {
    if (!this.active) return;
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    await this.spawnTiles();
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
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
