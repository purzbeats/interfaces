/**
 * Attract Mode — C64/Amiga demoscene-style auto-running showcase.
 *
 * Cycles through templates and palettes with compressed timelines,
 * auto-intensity ramps, and a classic sine-wave text scroller.
 * Designed to run unattended like an arcade attract screen.
 *
 * Key: A to enter, ESC to exit.
 */
import * as THREE from 'three';
import { resizeRenderer, type RendererContext } from './renderer/setup';
import { type PostFXPipeline } from './postfx/pipeline';
import { type Config, computeAspectSize } from './config';
import { getPalette, paletteNames, type Palette } from './color/palettes';
import { SeededRandom } from './random';
import { compose } from './layout/compositor';
import { createElement } from './elements/registry';
import { BaseElement, createIntensityConfig } from './elements/base-element';
import { generateTimeline, Timeline } from './animation/timeline';
// templateNames available from './layout/templates' if needed
import { TOOLBAR_HEIGHT } from './gui/mobile-toolbar';
import type { Region } from './layout/region';

// --- Act timing ---
const ACT_DURATION = 12;       // seconds per composition before crossfade
const BOOT_DURATION = 1.5;     // fast boot
const MAIN_DURATION = 6;       // compressed main phase
const ALERT_DURATION = 2;      // short alert burst
const COOLDOWN_DURATION = 1;   // quick cooldown
const INTENSITY_RAMP_START = 3;  // seconds into act to start ramping
const CROSSFADE_LAG = 1.5;    // overlap old/new composition during crossfade

// --- Scroller ---
const SCROLL_SPEED = 120;     // pixels per second
const SINE_AMPLITUDE = 20;    // vertical bounce pixels
const SINE_FREQUENCY = 0.08;  // waves per pixel

// Greetz — alphabetical, no favourites
const GREETZ = [
  'ABCDJ', 'AL CREGO', 'ARTURO', 'BINX', 'CERSPENSE', 'CFRYANT',
  'CHRIS ALLEN', 'CHRIS HACKETT', 'CLAIRE SILVER', 'CRYPTONATRIX',
  'DIGTHATDATA', 'DOTSIMULATE', 'DRAISE', 'ECLECTIC METHOD', 'ELLIEMAKES',
  'EMILY', 'ENID PINXIT', 'ERINDALE', 'FIREFLY', 'FOFR', 'GANDAMU',
  'GERDEGOTIT', 'GHOST', 'GOSSIP GOBLIN', 'HELLOROB', 'HODGEMANN',
  'ITERATION', 'JBOOG', 'JEFFUFU', 'JERU', 'JOE SPARKS', 'JOVIEX',
  'JULIANAIART', 'KALIYUGA', 'KOSINKAINK', 'KYTRA', 'LOLA VISCERA',
  'LOUIEPECAN', 'LOVIS', 'MACBETH', 'MACHINE DELUSIONS', 'MAKEITRAD',
  'MATT ZIEN', 'MAX CAPACITY', 'MECHANICAL REPRODUCTIONS', 'MELMASS',
  'MOBOTATO', 'NATHAN SHIPLEY', 'NIN', 'NOBANE', 'NOPER',
  'ORANGUERILLATAN', 'OSTRIS', 'PHARMAPSYCHOTIC', 'PXTCHXS',
  'RIVERSHAVEWINGS', 'RONNY KHALIL', 'ROYALCITIES', 'RYANONTHEINSIDE',
  'SASSY', 'SHADOW WANDERER', 'STEVEN SCOTT', 'STERLINGCRISPIN', 'SUTU',
  'SYNTAX DIFFUSION', 'TENGUSHEE', 'TENZIA', 'TONY JOSE MATOS',
  'TRISHA CODE', 'TWODUKES', 'VISUALFRISSON', 'WONDERMUNDO', 'XOR',
  'XPONENTIAL', 'ZANELLI',
];

const SCROLLER_TEXT = [
  'INTERFACES',
  '///  PROCEDURAL SCI-FI INTERFACE GENERATOR  ///',
  '384 VISUAL ELEMENTS  *  REAL-TIME RENDERING  *  THREE.JS + TYPESCRIPT',
  '///  GREETZ  ///',
  GREETZ.join('  *  '),
  '///  CODE IS ART  *  ART IS CODE  ///',
  'PRESS ESC TO EXIT  *  PRESS A TO RESTART',
].join('     \u2022     '); // bullet separators

// Curated templates that look good in attract mode
const ATTRACT_TEMPLATES = [
  'tactical', 'surveillance', 'nerv', 'command-center',
  'ops-hud', 'diagnostic', 'datastream', 'quad-view',
  'mosaic', 'biolab',
];

interface Composition {
  elements: BaseElement[];
  elementMap: Map<string, BaseElement>;
  wrappers: Map<string, THREE.Group>;
  regions: Region[];
}

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';

export class AttractMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private onExit: () => void;
  private isMobileCheck: () => boolean;

  private active = false;
  private stashedChildren: THREE.Object3D[] = [];

  // Compositions
  private current: Composition | null = null;
  private outgoing: Composition | null = null;
  private timeline: Timeline = new Timeline();
  private intensityConfig = createIntensityConfig();

  // Timing
  private elapsed = 0;
  private actTimer = 0;
  private actIndex = 0;
  private palette!: Palette;

  // Sequence cycling
  private templateOrder: string[] = [];
  private paletteOrder: string[] = [];

  // Greetz display — names flash over random tiles
  private greetzIndex = 0;
  private greetzTimer = 0;
  private greetzEl: HTMLDivElement | null = null;

  // DOM overlay
  private overlay: HTMLDivElement | null = null;
  private scrollCanvas: HTMLCanvasElement | null = null;
  private scrollCtx: CanvasRenderingContext2D | null = null;
  private scrollOffset = 0;
  private scrollTextWidth = 0;

  // Input
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;

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

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exit();
      }
    };
    this.resizeHandler = () => {
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      this.resizeScrollCanvas();
    };
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    this.active = true;

    // Stash scene
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    // Shuffle template and palette orders for variety
    const rng = new SeededRandom(Date.now());
    this.templateOrder = [...ATTRACT_TEMPLATES];
    rng.shuffle(this.templateOrder);
    this.paletteOrder = paletteNames().filter(n => n !== 'custom');
    rng.shuffle(this.paletteOrder);

    this.elapsed = 0;
    this.actTimer = 0;
    this.actIndex = 0;

    // Create DOM overlay
    this.createOverlay();

    // Bind input
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);

    // Start first act
    this.startAct();
  }

  exit(): void {
    this.active = false;

    // Cleanup compositions
    this.teardown(this.current);
    this.teardown(this.outgoing);
    this.current = null;
    this.outgoing = null;

    // Remove overlay
    this.overlay?.remove();
    this.overlay = null;
    this.greetzEl = null;
    this.scrollCanvas = null;
    this.scrollCtx = null;

    // Unbind
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);

    // Restore scene
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  update(dt: number): void {
    if (!this.active) return;

    this.elapsed += dt;
    this.actTimer += dt;

    // Advance timeline
    this.timeline.update(dt, (cue) => {
      const el = this.current?.elementMap.get(cue.elementId);
      if (el) el.onAction(cue.action);
    });

    // Auto intensity ramp: escalate during each act
    if (this.current) {
      const actProgress = this.actTimer / ACT_DURATION;
      let intensity = 0;
      if (this.actTimer > INTENSITY_RAMP_START) {
        const rampProgress = (this.actTimer - INTENSITY_RAMP_START) / (ACT_DURATION - INTENSITY_RAMP_START);
        intensity = Math.min(5, Math.floor(rampProgress * 5) + 1);
      }
      // Pulse all active elements
      for (const el of this.current.elements) {
        if (el.stateMachine.state === 'active' || el.stateMachine.state === 'activating') {
          // Periodic micro-pulses for energy
          if (intensity > 0 && Math.sin(this.elapsed * 4 + actProgress * 10) > 0.7) {
            el.onIntensity(intensity);
          }
        }
      }
    }

    // Tick current elements
    if (this.current) {
      for (const el of this.current.elements) {
        el.tick(dt, this.elapsed);
      }
    }

    // Tick outgoing (fading out)
    if (this.outgoing) {
      for (const el of this.outgoing.elements) {
        el.tick(dt, this.elapsed);
        // Check if fully deactivated
        if (el.stateMachine.state === 'idle') continue;
      }
      // Tear down outgoing once all elements are idle
      const allIdle = this.outgoing.elements.every(el => el.stateMachine.state === 'idle');
      if (allIdle) {
        this.teardown(this.outgoing);
        this.outgoing = null;
      }
    }

    // Time for next act?
    if (this.actTimer >= ACT_DURATION) {
      this.startAct();
    }

    // Greetz ticker — flash a name over a random tile every ~1.5s
    this.updateGreetz(dt);

    // Update scroller
    this.updateScroller(dt);

    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  dispose(): void {
    this.overlay?.remove();
  }

  // --- Act management ---

  private startAct(): void {
    // Move current → outgoing for crossfade
    if (this.current) {
      this.teardown(this.outgoing); // clean up any lingering outgoing
      this.outgoing = this.current;
      // Deactivate outgoing
      for (const el of this.outgoing.elements) {
        if (el.stateMachine.state !== 'idle') {
          el.onAction('deactivate');
        }
      }
    }

    this.actTimer = 0;

    // Cycle template and palette
    const templateName = this.templateOrder[this.actIndex % this.templateOrder.length];
    const paletteName = this.paletteOrder[this.actIndex % this.paletteOrder.length];
    this.actIndex++;

    this.config.palette = paletteName;
    this.palette = getPalette(paletteName);
    this.ctx.scene.background = this.palette.bg;

    // Build composition
    const seed = Math.floor(Math.random() * 100000);
    const rng = new SeededRandom(seed);

    const savedTemplate = this.config.template;
    this.config.template = templateName;

    const layoutRng = rng.fork();
    const canvasAspect = this.config.width / this.config.height;
    const { regions } = compose(this.config.template, layoutRng, canvasAspect, false);

    this.config.template = savedTemplate; // restore

    // Filter out dividers for a cleaner look
    const contentRegions = regions.filter(r => !r.isDivider);

    const comp: Composition = {
      elements: [],
      elementMap: new Map(),
      wrappers: new Map(),
      regions: contentRegions,
    };

    const elementRng = rng.fork();
    const emitAudio = () => {}; // silent in attract mode

    for (const region of contentRegions) {
      const elRng = elementRng.fork();
      const elementType = region.elementType ?? 'panel';
      const el = createElement(
        elementType, region, this.palette, elRng,
        this.config.width, this.config.height,
        emitAudio, this.intensityConfig,
      );

      comp.elements.push(el);
      comp.elementMap.set(el.id, el);

      const wrapper = new THREE.Group();
      wrapper.add(el.group);
      comp.wrappers.set(el.id, wrapper);
      this.ctx.scene.add(wrapper);
      el.group.visible = true;
    }

    this.current = comp;

    // Generate compressed timeline
    const timelineRng = rng.fork();
    const elementIds = comp.elements.map(e => e.id);
    this.timeline = generateTimeline(elementIds, {
      bootDuration: BOOT_DURATION,
      mainDuration: MAIN_DURATION,
      alertDuration: ALERT_DURATION,
      cooldownDuration: COOLDOWN_DURATION,
    }, timelineRng);
    this.timeline.loop = false;

  }

  private teardown(comp: Composition | null): void {
    if (!comp) return;
    for (const el of comp.elements) {
      const wrapper = comp.wrappers.get(el.id);
      if (wrapper) this.ctx.scene.remove(wrapper);
      if (el._built) el.dispose();
    }
    comp.elements.length = 0;
    comp.elementMap.clear();
    comp.wrappers.clear();
  }

  // --- DOM overlay ---

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed', inset: '0',
      pointerEvents: 'none', zIndex: '900',
      fontFamily: FONT,
    });

    // Greetz overlay — positioned over a random tile
    this.greetzEl = document.createElement('div');
    Object.assign(this.greetzEl.style, {
      position: 'absolute',
      pointerEvents: 'none',
      fontFamily: FONT,
      fontSize: '20px',
      fontWeight: 'bold',
      letterSpacing: '6px',
      textTransform: 'uppercase',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 0.3s',
      textShadow: '0 0 20px currentColor, 0 0 40px currentColor',
      padding: '8px 16px',
      background: 'rgba(0,0,0,0.5)',
      borderTop: '1px solid currentColor',
      borderBottom: '1px solid currentColor',
    });
    this.overlay.appendChild(this.greetzEl);

    // Scroller canvas at bottom
    this.scrollCanvas = document.createElement('canvas');
    Object.assign(this.scrollCanvas.style, {
      position: 'absolute', bottom: '0', left: '0',
      width: '100%', height: '48px',
      pointerEvents: 'none',
    });
    this.overlay.appendChild(this.scrollCanvas);
    this.scrollCtx = this.scrollCanvas.getContext('2d')!;

    document.body.appendChild(this.overlay);
    this.resizeScrollCanvas();
  }

  private resizeScrollCanvas(): void {
    if (!this.scrollCanvas || !this.scrollCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scrollCanvas.width = Math.round(window.innerWidth * dpr);
    this.scrollCanvas.height = Math.round(48 * dpr);
    this.scrollCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Measure text width
    this.scrollCtx.font = `bold 16px ${FONT}`;
    this.scrollTextWidth = this.scrollCtx.measureText(SCROLLER_TEXT).width;
  }

  private updateGreetz(dt: number): void {
    if (!this.greetzEl || !this.current) return;

    this.greetzTimer += dt;
    const GREETZ_INTERVAL = 1.8;
    const GREETZ_VISIBLE = 1.2;

    if (this.greetzTimer >= GREETZ_INTERVAL) {
      this.greetzTimer = 0;
      this.greetzIndex = (this.greetzIndex + 1) % GREETZ.length;

      // Pick a random tile region to position over
      const regions = this.current.regions;
      if (regions.length === 0) return;
      const region = regions[Math.floor(Math.random() * regions.length)];

      const color = this.palette
        ? '#' + this.palette.primary.getHexString()
        : '#33ff66';

      // Position centered on the tile
      const cx = (region.x + region.width / 2) * 100;
      const cy = (region.y + region.height / 2) * 100;

      // Scale font to tile width
      const tileW = region.width * window.innerWidth;
      const fontSize = Math.max(10, Math.min(24, tileW * 0.08));

      this.greetzEl.textContent = GREETZ[this.greetzIndex];
      this.greetzEl.style.color = color;
      this.greetzEl.style.fontSize = `${fontSize}px`;
      this.greetzEl.style.left = `${cx}%`;
      this.greetzEl.style.top = `${cy}%`;
      this.greetzEl.style.transform = 'translate(-50%, -50%)';
      this.greetzEl.style.opacity = '1';
    } else if (this.greetzTimer >= GREETZ_VISIBLE) {
      this.greetzEl.style.opacity = '0';
    }
  }

  private updateScroller(dt: number): void {
    if (!this.scrollCtx || !this.scrollCanvas) return;

    const ctx = this.scrollCtx;
    const w = window.innerWidth;
    const h = 48;

    // Advance scroll position
    this.scrollOffset += SCROLL_SPEED * dt;
    if (this.scrollOffset > this.scrollTextWidth + w) {
      this.scrollOffset = 0;
    }

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Dark gradient backdrop
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Get palette color
    const color = this.palette
      ? '#' + this.palette.primary.getHexString()
      : '#33ff66';

    // Draw sine-wave scroller
    ctx.font = `bold 16px ${FONT}`;
    ctx.textBaseline = 'middle';

    const baseX = w - this.scrollOffset;
    const baseY = h / 2 + 4;
    const text = SCROLLER_TEXT;

    // Character-by-character sine wave
    let x = baseX;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const charWidth = ctx.measureText(ch).width;
      const screenX = x;

      // Only render visible chars
      if (screenX > -20 && screenX < w + 20) {
        const y = baseY + Math.sin((screenX) * SINE_FREQUENCY + this.elapsed * 3) * SINE_AMPLITUDE;

        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillText(ch, screenX, y);

        // Bright core
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.fillText(ch, screenX, y);
      }
      x += charWidth;
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Raster bar effect — horizontal color band that moves vertically
    const barY = (Math.sin(this.elapsed * 1.5) * 0.5 + 0.5) * h;
    const barGrad = ctx.createLinearGradient(0, barY - 8, 0, barY + 8);
    barGrad.addColorStop(0, 'rgba(255,255,255,0)');
    barGrad.addColorStop(0.5, color + '30');
    barGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, barY - 8, w, 16);
  }

  private applyAspect(): void {
    const mobile = this.isMobileCheck();
    const viewportH = mobile ? window.innerHeight - TOOLBAR_HEIGHT : window.innerHeight;
    const { width, height } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth,
      viewportH,
    );
    this.config.width = width;
    this.config.height = height;
  }
}
