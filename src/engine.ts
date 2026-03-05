import { type Config, DEFAULT_CONFIG, computeAspectSize } from './config';
import { ShowcaseMode } from './showcase';
import { GalleryMode } from './gallery';
import { EditorMode } from './editor';
import { SeededRandom } from './random';
import { createRenderer, resizeRenderer, type RendererContext } from './renderer/setup';
import { getPalette, type Palette } from './color/palettes';
import { compose, pickElementForRegion } from './layout/compositor';
import { createElement, createElementDeferred } from './elements/registry';
import { BaseElement, createIntensityConfig, type IntensityConfig } from './elements/base-element';
import { generateTimeline, type Timeline } from './animation/timeline';
import { createPostFXPipeline, type PostFXPipeline } from './postfx/pipeline';
import { createGUI, type GUIControls } from './gui/controls';
import { MobileToolbar, TOOLBAR_HEIGHT } from './gui/mobile-toolbar';
import { takeScreenshot, createVideoRecorder, type VideoRecorder } from './export/exporter';
import { AudioSynth } from './audio/synth';
import { AudioReactive } from './audio/audio-reactive';
import { TouchRipple } from './touch/touch-ripple';
import { TouchManager } from './touch/touch-manager';
import { ShakeDetector } from './touch/shake-detector';
import { loadConfig, saveConfig, updateURL } from './persistence';
import { setDividerBrightness, setDividerThickness } from './elements/separator';
import { getMeta, BAND_INDEX } from './elements/tags';
import { showToast } from './gui/toast';
import { toggleHelp, isHelpVisible } from './gui/help-overlay';
import type { Region } from './layout/region';
import { regionClippingPlanes } from './layout/region';
import { HexBorderOverlay } from './layout/hex-border';
import { hexClippingPlanes } from './layout/hex-grid';
import type { HexCell } from './layout/hex-grid';
import * as THREE from 'three';

interface Composition {
  elements: BaseElement[];
  elementMap: Map<string, BaseElement>;
  regionMap: Map<string, Region>;
  elementTypeMap: Map<string, string>;
  wrapperMap: Map<string, THREE.Group>;
  regions: Region[];
  borderOverlays: BaseElement[];
  borderWrappers: Map<string, THREE.Group>;
  /** Maps content region ID → border overlay element for that region. */
  borderByRegion: Map<string, BaseElement>;
}

export class Engine {
  config: Config;
  private ctx!: RendererContext;
  private pipeline!: PostFXPipeline;
  private gui!: GUIControls;
  private recorder!: VideoRecorder;
  private audio: AudioSynth = new AudioSynth();
  audioReactive: AudioReactive = new AudioReactive();
  private current: Composition | null = null;
  private outgoing: Composition | null = null;
  private retiringElements: { el: BaseElement; wrapper: THREE.Group; onRetired?: () => void }[] = [];
  /** Spawns queued to fire after their corresponding retiring element finishes powering down. */
  private pendingSpawns: { waitingOn: BaseElement; spawn: () => void }[] = [];
  private timeline!: Timeline;
  private palette!: Palette;
  private elapsed: number = 0;
  private disposed: boolean = false;
  private pendingBuild: { element: BaseElement; wrapper: THREE.Group }[] = [];
  private readonly BUILD_BATCH_SIZE = 3;
  private showcase!: ShowcaseMode;
  private gallery!: GalleryMode;
  private editor!: EditorMode;
  private mobileToolbar: MobileToolbar | null = null;
  private mobileQuery!: MediaQueryList;
  private touchRipple: TouchRipple | null = null;
  private touchManager: TouchManager | null = null;
  private shakeDetector: ShakeDetector | null = null;
  private touchTargetId: string | null = null;
  private generationCounter: number = 0;
  private rollingTimer: number = 0;
  private swapCounter: number = 0;
  private mutationCount: number = 0;
  private originalElementCount: number = 0;
  private readonly MAX_MUTATIONS_BEFORE_RESET = 50;

  /** Current intensity level (0 = baseline, 1–5 = active). */
  currentIntensity: number = 0;
  private intensityKeyDownTime: number = 0;
  /** Per-band smooth intensity envelopes [sub, bass, mid, high]. */
  private bandEnvelopes: Float32Array = new Float32Array(4);
  /** Cached per-element intensity level — avoids redundant onIntensity calls. */
  private elementIntensityCache: Map<string, number> = new Map();

  /** Hex border overlay — present only when current layout is hex-based. */
  private hexBorder: HexBorderOverlay | null = null;

  /** Shared intensity config passed to all elements (replaces static globals). */
  readonly intensityConfig: IntensityConfig = createIntensityConfig();

  constructor(config?: Partial<Config>) {
    // Layer: defaults → localStorage → URL params → constructor overrides
    const persisted = loadConfig();
    this.config = { ...DEFAULT_CONFIG, ...persisted, ...config };

    // URL params override everything
    const params = new URLSearchParams(window.location.search);
    if (params.has('seed')) this.config.seed = parseInt(params.get('seed')!, 10) || 42;
    if (params.has('palette')) this.config.palette = params.get('palette')!;
    if (params.has('template')) this.config.template = params.get('template')!;
  }

  /** Apply hex clipping planes to all materials in an element's group. */
  private applyHexClipping(element: BaseElement, hexCell: HexCell): void {
    const planes = hexClippingPlanes(hexCell, this.config.width, this.config.height);
    element.group.traverse(obj => {
      // Cast broadly — Mesh, Line, LineSegments, LineSegments2, Points, Sprite all have .material
      const renderable = obj as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const mat of materials) {
        if (mat instanceof THREE.Material) {
          mat.clippingPlanes = planes;
          mat.clipIntersection = false;
          mat.needsUpdate = true;
        }
      }
    });
  }

  /** Apply rectangular clipping planes to all materials in an element's group. */
  private applyRectClipping(element: BaseElement, region: Region): void {
    const planes = regionClippingPlanes(region, this.config.width, this.config.height);
    element.group.traverse(obj => {
      const renderable = obj as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const mat of materials) {
        if (mat instanceof THREE.Material) {
          mat.clippingPlanes = planes;
          mat.clipIntersection = false;
          mat.needsUpdate = true;
        }
      }
    });
  }

  /** Compute and apply canvas size from aspect ratio + window dimensions. */
  private applyAspect(): void {
    const pad = this.config.overscanPadding;
    const viewportHeight = this.mobileToolbar
      ? window.innerHeight - TOOLBAR_HEIGHT
      : window.innerHeight;
    const { width, height, offsetX, offsetY } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth - pad * 2,
      viewportHeight - pad * 2
    );
    this.config.width = width;
    this.config.height = height;

    if (this.ctx) {
      const canvas = this.ctx.renderer.domElement;
      canvas.style.position = 'absolute';
      canvas.style.left = `${offsetX + pad + this.config.overscanX}px`;
      canvas.style.top = `${offsetY + pad + this.config.overscanY}px`;
      // Set background to black for letterbox/pillarbox bars
      document.body.style.background = '#000';
    }
  }

  /** Helper: create the audio emitter callback for element audio events. */
  private makeEmitAudio(): (event: string, param?: number) => void {
    return (event: string, param?: number) => {
      switch (event) {
        case 'keystroke': this.audio.keystroke(param); break;
        case 'dataChirp': this.audio.dataChirp(); break;
        case 'seekSound': this.audio.blip(param ?? 200); break;
      }
    };
  }

  init(): void {
    setDividerBrightness(this.config.dividerBrightness);
    setDividerThickness(this.config.dividerThickness);
    this.config.width = window.innerWidth;
    this.config.height = window.innerHeight;

    this.ctx = createRenderer(this.config.width, this.config.height);
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline = createPostFXPipeline(
      this.ctx.renderer, this.ctx.scene, this.ctx.camera, this.config
    );
    this.recorder = createVideoRecorder(this.ctx.renderer.domElement, this.config.export.fps);
    this.showcase = new ShowcaseMode(this.ctx, this.pipeline, this.config, () => {
      // On exit: restore aspect, regenerate the normal composition
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      this.generate(this.config.seed);
    });
    this.gallery = new GalleryMode(this.ctx, this.pipeline, this.config, this.showcase, () => {
      // On exit: restore aspect, regenerate the normal composition
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      this.generate(this.config.seed);
    }, () => !!this.mobileToolbar);

    this.editor = new EditorMode(this.ctx, this.pipeline, this.config, () => {
      // On exit: restore aspect, regenerate the normal composition
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      this.generate(this.config.seed);
    }, () => !!this.mobileToolbar);

    // Wire audio-reactive → intensity system (per-band envelopes)
    this.audioReactive.onKick = (level) => {
      // Kick detected — boost bass and sub envelopes
      this.bandEnvelopes[1] = Math.max(this.bandEnvelopes[1], level);
      this.bandEnvelopes[0] = Math.max(this.bandEnvelopes[0], level * 0.7);
    };

    this.gui = createGUI(
      this.config,
      () => this.generate(this.config.seed),
      () => takeScreenshot(this.ctx.renderer.domElement),
      () => {
        if (this.recorder.isRecording) this.recorder.stop();
        else this.recorder.start();
      },
      this.audio,
      {
        onPause: () => this.togglePause(),
        onRestart: () => this.restart(),
        onLoopToggle: (v: boolean) => { this.timeline.loop = v; },
      },
      () => this.applyAspectAndRegenerate(),
      this.audioReactive,
    );

    // Mobile toolbar: create/destroy based on viewport width
    this.mobileQuery = window.matchMedia('(max-width: 767px) and (pointer: coarse)');
    const handleMobileChange = (matches: boolean) => {
      if (matches && !this.mobileToolbar) {
        // Touch system
        this.touchRipple = new TouchRipple();
        const canvas = this.ctx.renderer.domElement;
        this.touchManager = new TouchManager(canvas, {
          onIntensityChange: (level) => {
            this.broadcastIntensity(level);
            if (level > 0 && this.touchRipple) {
              // ripples are spawned inside TouchManager already
            }
          },
          onElementTarget: (elementId) => {
            // Fade old element, light new one
            if (this.touchTargetId && this.touchTargetId !== elementId) {
              const old = this.current?.elementMap.get(this.touchTargetId);
              if (old) old.onIntensity(0);
            }
            this.touchTargetId = elementId;
            if (elementId) {
              const el = this.current?.elementMap.get(elementId);
              if (el) {
                el.onIntensity(this.currentIntensity || 1);
                this.audio.blip(200 + Math.random() * 200);
              }
            }
          },
          hitTestElement: (nx, ny) => this.hitTestElement(nx, ny),
        }, this.touchRipple);

        // Shake detector
        this.shakeDetector = new ShakeDetector(() => {
          if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 80]);
          this.config.seed = Math.floor(Math.random() * 100000);
          this.generate(this.config.seed);
        });
        // Request permission on first canvas touch
        canvas.addEventListener('touchstart', () => {
          this.shakeDetector?.requestPermission();
        }, { once: true, passive: true });

        this.mobileToolbar = new MobileToolbar({
          onRegenerate: () => {
            this.config.seed = Math.floor(Math.random() * 100000);
            this.generate(this.config.seed);
          },
          onTogglePause: () => {
            this.togglePause();
            this.mobileToolbar?.setPaused(this.isPaused);
          },
          onToggleMute: () => {
            this.audio.muted = !this.audio.muted;
            this.mobileToolbar?.setMuted(this.audio.muted);
          },
          onScreenshot: () => takeScreenshot(this.ctx.renderer.domElement),
          onShowcase: () => {
            if (!this.showcase.isActive && !this.gallery.isActive && !this.editor.isActive) this.showcase.enter();
          },
          onGallery: () => {
            if (!this.gallery.isActive && !this.showcase.isActive && !this.editor.isActive) this.gallery.enter();
          },
          onEditor: () => {
            if (!this.editor.isActive && !this.gallery.isActive && !this.showcase.isActive) {
              this.editor.promptEntry(
                this.current?.regions,
                this.current ? this.current.elementTypeMap : undefined,
                this.config.palette,
              );
            }
          },
          onToggleLoop: () => {
            this.timeline.loop = !this.timeline.loop;
            this.mobileToolbar?.setLoop(this.timeline.loop);
          },
          onToggleSettings: () => this.gui.toggle(),
          onResumeAudio: () => this.audio.blip(0, 0),
        });
        this.applyAspect();
        resizeRenderer(this.ctx, this.config.width, this.config.height);
        this.pipeline.resize(this.config.width, this.config.height);
        this.generate(this.config.seed);
      } else if (!matches && this.mobileToolbar) {
        this.touchManager?.destroy();
        this.touchManager = null;
        this.touchRipple?.destroy();
        this.touchRipple = null;
        this.shakeDetector?.destroy();
        this.shakeDetector = null;
        this.touchTargetId = null;
        this.mobileToolbar.destroy();
        this.mobileToolbar = null;
        this.applyAspect();
        resizeRenderer(this.ctx, this.config.width, this.config.height);
        this.pipeline.resize(this.config.width, this.config.height);
        this.generate(this.config.seed);
      }
    };
    handleMobileChange(this.mobileQuery.matches);
    this.mobileQuery.addEventListener('change', (e) => handleMobileChange(e.matches));

    if (!this.mobileToolbar) {
      // Only generate here if mobile didn't already trigger it
      this.generate(this.config.seed);
    }
    this.setupEvents();
  }

  /**
   * Build a new composition: layout + create elements (deferred or immediate).
   * Does NOT add wrappers to the scene — caller is responsible.
   */
  private buildComposition(seed: number, deferred: boolean): Composition {
    const rng = new SeededRandom(seed);
    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const layoutRng = rng.fork();
    const canvasAspect = this.config.width / this.config.height;
    const hexLayout = this.config.hexLayout;
    const { regions, borderOverlays: borderOverlaySpecs } = compose(this.config.template, layoutRng, canvasAspect, hexLayout);

    const emitAudio = this.makeEmitAudio();

    const comp: Composition = {
      elements: [],
      elementMap: new Map(),
      regionMap: new Map(),
      elementTypeMap: new Map(),
      wrapperMap: new Map(),
      regions,
      borderOverlays: [],
      borderByRegion: new Map(),
      borderWrappers: new Map(),
    };

    const genPrefix = `g${this.generationCounter}_`;
    const elementRng = rng.fork();
    for (const region of regions) {
      // Prefix region IDs to avoid collisions during crossfade
      region.id = genPrefix + region.id;

      const elRng = elementRng.fork();
      const elementType = region.elementType ?? 'panel';
      const element = deferred
        ? createElementDeferred(elementType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig)
        : createElement(elementType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig);

      comp.elements.push(element);
      comp.elementMap.set(element.id, element);
      comp.regionMap.set(region.id, region);
      comp.elementTypeMap.set(element.id, elementType);

      const wrapper = new THREE.Group();
      if (!deferred) {
        wrapper.add(element.group);
      }
      if (region.isDivider) {
        wrapper.renderOrder = 10;
      }
      comp.wrapperMap.set(element.id, wrapper);

      if (deferred) {
        this.pendingBuild.push({ element, wrapper });
      }
    }

    // Create border overlay elements — same regions as content, rendered on top
    const borderRng = rng.fork();
    for (const spec of borderOverlaySpecs) {
      // Find the region with the prefixed ID
      const region = spec.region; // already prefixed above
      const elRng = borderRng.fork();
      const borderEl = deferred
        ? createElementDeferred(spec.borderType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig)
        : createElement(spec.borderType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig);

      comp.borderOverlays.push(borderEl);
      comp.elementMap.set(borderEl.id, borderEl);
      comp.borderByRegion.set(region.id, borderEl);

      const wrapper = new THREE.Group();
      if (!deferred) {
        wrapper.add(borderEl.group);
      }
      wrapper.renderOrder = 12; // above content (0), below hex border (15)
      comp.borderWrappers.set(borderEl.id, wrapper);

      if (deferred) {
        this.pendingBuild.push({ element: borderEl, wrapper });
      }
    }

    if (deferred) {
      // Reverse so we can pop() from the end (O(1))
      this.pendingBuild.reverse();
    }

    return comp;
  }

  generate(seed: number): void {
    this.config.seed = seed;
    this.elapsed = 0;
    this.elementIntensityCache.clear();
    this.generationCounter++;
    this.pendingBuild = [];
    this.rollingTimer = 0;
    this.mutationCount = 0;

    // If there's already an outgoing composition, tear it down immediately
    if (this.outgoing) {
      this.teardownComposition(this.outgoing);
      this.outgoing = null;
    }

    // Move current → outgoing for crossfade
    if (this.current) {
      this.outgoing = this.current;
      // Deactivate all outgoing elements so they fade out
      for (const el of this.outgoing.elements) {
        if (el.stateMachine.state !== 'idle') {
          el.onAction('deactivate');
        }
      }
      for (const el of this.outgoing.borderOverlays) {
        if (el.stateMachine.state !== 'idle') {
          el.onAction('deactivate');
        }
      }
    }

    // Tear down previous hex border overlay
    if (this.hexBorder) {
      this.ctx.scene.remove(this.hexBorder.group);
      this.hexBorder.dispose();
      this.hexBorder = null;
    }

    // Build new composition (deferred — staggered build in update())
    this.current = this.buildComposition(seed, true);
    this.originalElementCount = this.current.elements.filter(
      (el) => !this.current!.regionMap.get(el.id)?.isDivider
    ).length;

    // Create hex border overlay if this is a hex layout
    const hexCells = this.current.regions
      .map(r => r.hexCell)
      .filter((c): c is HexCell => c != null);
    if (hexCells.length > 0) {
      this.hexBorder = new HexBorderOverlay();
      this.hexBorder.create(hexCells, this.config.width, this.config.height, this.palette);
      this.hexBorder.group.renderOrder = 15;
      this.ctx.scene.add(this.hexBorder.group);
    }

    // Generate timeline
    const wasLooping = this.timeline?.loop ?? true;
    const rng = new SeededRandom(seed);
    rng.fork(); // skip layout rng
    rng.fork(); // skip element rng
    rng.fork(); // skip border rng
    const timelineRng = rng.fork();
    const elementIds = [
      ...this.current.elements.map((e) => e.id),
      ...this.current.borderOverlays.map((e) => e.id),
    ];

    if (this.config.rollingSwap) {
      // Boot-only timeline: just stagger-activate, no cooldown
      this.timeline = generateTimeline(elementIds, {
        ...this.config.timeline,
        mainDuration: 0,
        alertDuration: 0,
        cooldownDuration: 0,
      }, timelineRng);
    } else {
      this.timeline = generateTimeline(elementIds, this.config.timeline, timelineRng);
    }
    this.timeline.loop = wasLooping;

    // Persist state
    saveConfig(this.config);
    updateURL(this.config);

    // Refresh debug overlay if active
    if (this.debugVisible) this.renderDebugOverlay();
  }

  /** Remove all wrappers from scene and dispose all elements in a composition. */
  private teardownComposition(comp: Composition): void {
    for (const el of comp.elements) {
      const wrapper = comp.wrapperMap.get(el.id);
      if (wrapper) {
        this.ctx.scene.remove(wrapper);
      } else {
        this.ctx.scene.remove(el.group);
      }
      el.dispose();
    }
    // Dispose border overlays
    for (const el of comp.borderOverlays) {
      const wrapper = comp.borderWrappers.get(el.id);
      if (wrapper) {
        this.ctx.scene.remove(wrapper);
      } else {
        this.ctx.scene.remove(el.group);
      }
      el.dispose();
    }
  }

  // --- Rolling swap mutation system ---

  /** Get non-divider elements eligible for mutation. */
  private getSwappable(): BaseElement[] {
    if (!this.current) return [];
    return this.current.elements.filter(
      (el) => !this.current!.regionMap.get(el.id)?.isDivider
    );
  }

  /** Retire an element: deactivate it, move to retiring list, remove from current composition. */
  private retireElement(el: BaseElement, onRetired?: () => void): void {
    if (!this.current) return;
    const wrapper = this.current.wrapperMap.get(el.id);
    if (el.stateMachine.state !== 'idle') {
      el.onAction('deactivate');
    }
    if (wrapper) {
      this.retiringElements.push({ el, wrapper, onRetired });
    }
    const idx = this.current.elements.indexOf(el);
    if (idx !== -1) this.current.elements.splice(idx, 1);
    this.current.elementMap.delete(el.id);
    this.current.elementTypeMap.delete(el.id);
    this.current.wrapperMap.delete(el.id);
    this.current.regionMap.delete(el.id);

    // Also retire the associated border overlay (if any)
    this.retireBorderForRegion(el.id);
  }

  /** Retire and dispose the border overlay associated with a region. */
  private retireBorderForRegion(regionId: string): void {
    if (!this.current) return;
    const borderEl = this.current.borderByRegion.get(regionId);
    if (!borderEl) return;

    const borderWrapper = this.current.borderWrappers.get(borderEl.id);
    if (borderEl.stateMachine.state !== 'idle') {
      borderEl.onAction('deactivate');
    }
    if (borderWrapper) {
      this.retiringElements.push({ el: borderEl, wrapper: borderWrapper });
    }

    // Remove from all tracking structures
    const idx = this.current.borderOverlays.indexOf(borderEl);
    if (idx !== -1) this.current.borderOverlays.splice(idx, 1);
    this.current.elementMap.delete(borderEl.id);
    this.current.borderWrappers.delete(borderEl.id);
    this.current.borderByRegion.delete(regionId);
  }

  /** Spawn a new element into the current composition for a given region. */
  private spawnElement(region: Region, excludeType: string, rng: SeededRandom): void {
    if (!this.current) return;

    const currentTypes = new Set<string>();
    for (const t of this.current.elementTypeMap.values()) currentTypes.add(t);

    const canvasAspect = this.config.width / this.config.height;
    const newType = pickElementForRegion(region, currentTypes, excludeType, rng, canvasAspect);

    const emitAudio = this.makeEmitAudio();
    const elRng = rng.fork();
    const newEl = createElement(newType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig);

    // Apply clipping planes to keep content inside tile bounds
    const hex = region.hexCell;
    if (hex) this.applyHexClipping(newEl, hex);
    else this.applyRectClipping(newEl, region);

    const newWrapper = new THREE.Group();
    newWrapper.add(newEl.group);
    if (region.isDivider) newWrapper.renderOrder = 10;
    this.ctx.scene.add(newWrapper);
    newEl.onAction('activate');

    this.current.elements.push(newEl);
    this.current.elementMap.set(newEl.id, newEl);
    this.current.elementTypeMap.set(newEl.id, newType);
    this.current.wrapperMap.set(newEl.id, newWrapper);
    this.current.regionMap.set(region.id, region);

    this.audio.blip(200 + Math.random() * 200);

    // Spawn a border overlay for this region (~30% chance)
    this.maybeSpawnBorder(region, rng);
  }

  private static readonly BORDER_TYPES = [
    'border-chase', 'bracket-frame', 'corner-pip',
    'drop-shadow', 'face-brackets', 'zigzag-divider',
  ];

  /** Optionally spawn a border overlay for a newly-created content region. */
  private maybeSpawnBorder(region: Region, rng: SeededRandom): void {
    if (!this.current) return;
    // ~30% chance to get a border overlay
    if (rng.float(0, 1) > 0.3) return;

    const borderType = rng.pick(Engine.BORDER_TYPES);
    const emitAudio = this.makeEmitAudio();
    const elRng = rng.fork();
    const borderEl = createElement(borderType, region, this.palette, elRng, this.config.width, this.config.height, emitAudio, this.intensityConfig);

    // Apply clipping planes — same region bounds as content
    const hex = region.hexCell;
    if (hex) this.applyHexClipping(borderEl, hex);
    else this.applyRectClipping(borderEl, region);

    const wrapper = new THREE.Group();
    wrapper.add(borderEl.group);
    wrapper.renderOrder = 12;
    this.ctx.scene.add(wrapper);
    borderEl.onAction('activate');

    this.current.borderOverlays.push(borderEl);
    this.current.elementMap.set(borderEl.id, borderEl);
    this.current.borderWrappers.set(borderEl.id, wrapper);
    this.current.borderByRegion.set(region.id, borderEl);
  }

  /** Classify tier from region area. */
  private tierFromArea(area: number): 'hero' | 'panel' | 'widget' {
    if (area >= 0.06) return 'hero';
    if (area >= 0.03) return 'panel';
    return 'widget';
  }

  /** Pick and execute a random rolling mutation. */
  private rollingMutate(): void {
    if (!this.current) return;

    // Periodic full reset: after many mutations, crossfade to a fresh layout
    this.mutationCount++;
    if (this.mutationCount >= this.MAX_MUTATIONS_BEFORE_RESET) {
      const newSeed = Math.floor(Math.random() * 100000);
      this.config.seed = newSeed;
      this.generate(newSeed);
      return;
    }

    const swappable = this.getSwappable();
    if (swappable.length === 0) return;

    const rng = new SeededRandom(Date.now());

    // Bias split/merge based on element count drift
    const countRatio = swappable.length / Math.max(1, this.originalElementCount);
    // Too many elements → suppress splits, prefer merges
    // Too few elements → suppress merges, prefer splits
    const canSplit = countRatio < 1.5 && swappable.length < 30;
    const canMerge = countRatio > 0.6 && swappable.length > 3;

    const roll = rng.float(0, 1);

    if (roll < 0.55) {
      this.mutateSwap(1, rng, swappable);
    } else if (roll < 0.75) {
      this.mutateSwap(Math.min(rng.int(2, 3), swappable.length), rng, swappable);
    } else if (roll < 0.90) {
      if (canSplit) {
        this.mutateSplit(rng, swappable);
      } else {
        this.mutateSwap(1, rng, swappable);
      }
    } else {
      if (canMerge) {
        this.mutateMerge(rng, swappable);
      } else {
        this.mutateSwap(1, rng, swappable);
      }
    }
  }

  /** Swap N elements for new ones of different types. */
  private mutateSwap(count: number, rng: SeededRandom, swappable: BaseElement[]): void {
    const shuffled = [...swappable];
    rng.shuffle(shuffled);
    const toSwap = shuffled.slice(0, count);

    for (const oldEl of toSwap) {
      const region = this.current!.regionMap.get(oldEl.id);
      if (!region) continue;
      const oldType = this.current!.elementTypeMap.get(oldEl.id) ?? 'panel';
      // Fork RNG now so the spawn closure captures its own seed
      const spawnRng = rng.fork();
      this.retireElement(oldEl, () => {
        this.spawnElement(region, oldType, spawnRng);
      });
    }
  }

  /** Split one element's region into 2–3 sub-regions with new elements. */
  private mutateSplit(rng: SeededRandom, swappable: BaseElement[]): void {
    // Prefer larger elements for splitting
    const sorted = [...swappable].sort((a, b) => {
      const aArea = a.region.width * a.region.height;
      const bArea = b.region.width * b.region.height;
      return bArea - aArea;
    });

    // Pick from the larger half
    const candidates = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
    const oldEl = rng.pick(candidates);
    const region = this.current!.regionMap.get(oldEl.id);
    if (!region) { this.mutateSwap(1, rng, swappable); return; }

    // Don't split regions that are already tiny
    const area = region.width * region.height;
    if (area < 0.02) { this.mutateSwap(1, rng, swappable); return; }

    const splitCount = area > 0.08 ? rng.int(2, 3) : 2;
    const oldType = this.current!.elementTypeMap.get(oldEl.id) ?? 'panel';

    // Split along the longer pixel dimension
    const pixelAspect = (region.width / region.height) * (this.config.width / this.config.height);
    const splitHorizontal = pixelAspect > 1;

    const subRegions: Region[] = [];
    for (let i = 0; i < splitCount; i++) {
      const id = `g${this.generationCounter}_s${this.swapCounter++}`;
      const subArea = area / splitCount;
      if (splitHorizontal) {
        subRegions.push({
          id,
          x: region.x + (region.width / splitCount) * i,
          y: region.y,
          width: region.width / splitCount,
          height: region.height,
          padding: region.padding,
          tier: this.tierFromArea(subArea),
        });
      } else {
        subRegions.push({
          id,
          x: region.x,
          y: region.y + (region.height / splitCount) * i,
          width: region.width,
          height: region.height / splitCount,
          padding: region.padding,
          tier: this.tierFromArea(subArea),
        });
      }
    }

    const spawnRng = rng.fork();
    this.retireElement(oldEl, () => {
      for (const sub of subRegions) {
        this.spawnElement(sub, oldType, spawnRng);
      }
    });
  }

  /**
   * Merge 2 adjacent elements into one larger element.
   * Only merges regions that form a clean rectangle — same extent on the
   * shared axis — to prevent bounding-box creep and overlap.
   */
  private mutateMerge(rng: SeededRandom, swappable: BaseElement[]): void {
    if (swappable.length < 2) { this.mutateSwap(1, rng, swappable); return; }

    const TOL = 0.005;
    const pairs: { a: BaseElement; b: BaseElement; merged: Region }[] = [];

    for (let i = 0; i < swappable.length; i++) {
      for (let j = i + 1; j < swappable.length; j++) {
        const rA = swappable[i].region;
        const rB = swappable[j].region;

        // Side by side horizontally: same y and height, shared vertical edge
        if (Math.abs(rA.y - rB.y) < TOL && Math.abs(rA.height - rB.height) < TOL) {
          const aR = rA.x + rA.width;
          const bR = rB.x + rB.width;
          if (Math.abs(aR - rB.x) < TOL || Math.abs(bR - rA.x) < TOL) {
            const x = Math.min(rA.x, rB.x);
            const w = rA.width + rB.width;
            pairs.push({
              a: swappable[i], b: swappable[j],
              merged: {
                id: '', x, y: rA.y, width: w, height: rA.height,
                padding: rA.padding, tier: this.tierFromArea(w * rA.height),
              },
            });
          }
        }

        // Stacked vertically: same x and width, shared horizontal edge
        if (Math.abs(rA.x - rB.x) < TOL && Math.abs(rA.width - rB.width) < TOL) {
          const aB = rA.y + rA.height;
          const bB = rB.y + rB.height;
          if (Math.abs(aB - rB.y) < TOL || Math.abs(bB - rA.y) < TOL) {
            const y = Math.min(rA.y, rB.y);
            const h = rA.height + rB.height;
            pairs.push({
              a: swappable[i], b: swappable[j],
              merged: {
                id: '', x: rA.x, y, width: rA.width, height: h,
                padding: rA.padding, tier: this.tierFromArea(rA.width * h),
              },
            });
          }
        }
      }
    }

    if (pairs.length === 0) { this.mutateSwap(1, rng, swappable); return; }

    const pick = rng.pick(pairs);
    pick.merged.id = `g${this.generationCounter}_m${this.swapCounter++}`;

    // Spawn the merged element only after both have powered down
    const spawnRng = rng.fork();
    let retiredCount = 0;
    const onBothRetired = () => {
      retiredCount++;
      if (retiredCount >= 2) {
        this.spawnElement(pick.merged, '', spawnRng);
      }
    };
    this.retireElement(pick.a, onBothRetired);
    this.retireElement(pick.b, onBothRetired);
  }

  update(dt: number): void {
    if (this.disposed) return;

    // Editor/showcase/gallery mode takes over update/render
    if (this.editor.isActive) {
      this.editor.update(dt);
      return;
    }
    if (this.showcase.isActive) {
      this.showcase.update(dt);
      return;
    }
    if (this.gallery.isActive) {
      this.gallery.update(dt);
      return;
    }

    this.elapsed += dt;

    // Audio-reactive runs regardless of build phase
    this.audioReactive.update(dt);

    // Per-band envelope tracking and per-element intensity routing
    if (this.audioReactive.isActive && this.current) {
      const frame = this.audioReactive.frame;
      const decay = Math.exp(-4 * dt); // ~170ms half-life

      // Update each band envelope: follow energy up instantly, decay down
      for (let b = 0; b < 4; b++) {
        const bandEnergy = frame ? frame.bands[b] * 5 : 0; // scale 0-1 → 0-5
        // Decay toward zero
        this.bandEnvelopes[b] *= decay;
        // Follow energy upward instantly; floor at 50% of current energy
        this.bandEnvelopes[b] = Math.max(this.bandEnvelopes[b], bandEnergy, bandEnergy * 0.5);
      }

      // Sync config flags so base-element gates pulse/glitch
      this.intensityConfig.audioFlickerEnabled = this.config.audioReactive.flicker;
      this.intensityConfig.audioJiggleEnabled = this.config.audioReactive.jiggle;
      this.intensityConfig.intensityFromAudio = true;

      // Per-element intensity routing
      let anyActive = false;
      for (const el of this.current.elements) {
        if (!el.group.visible || el.stateMachine.state === 'idle') continue;

        // Look up element's band affinity and sensitivity from registration meta
        const elementType = this.current.elementTypeMap.get(el.id);
        const meta = elementType ? getMeta(elementType) : undefined;
        const bandIdx = BAND_INDEX[meta?.bandAffinity ?? 'bass'];
        const sensitivity = meta?.audioSensitivity ?? 1.0;

        const envelope = this.bandEnvelopes[bandIdx];
        // Map to 0-5: envelope is already in 0-5 range, apply sensitivity and mild curve
        const scaled = envelope * sensitivity;
        const level = Math.round(Math.min(5, scaled));

        if (level > 0) anyActive = true;

        // Only call onIntensity when level actually changes
        const cached = this.elementIntensityCache.get(el.id);
        if (cached !== level) {
          this.elementIntensityCache.set(el.id, level);
          el.onIntensity(level);
        }
      }

      // Track a global current intensity for external queries
      if (!anyActive && this.currentIntensity !== 0) {
        this.currentIntensity = 0;
      } else if (anyActive) {
        // Use bass envelope as representative global intensity
        this.currentIntensity = Math.round(Math.min(5, Math.max(1, this.bandEnvelopes[1])));
      }

      this.intensityConfig.intensityFromAudio = false;
    }

    // Phase A: Staggered build — pop a batch each frame
    if (this.pendingBuild.length > 0) {
      const count = Math.min(this.BUILD_BATCH_SIZE, this.pendingBuild.length);
      for (let i = 0; i < count; i++) {
        const item = this.pendingBuild.pop()!;
        item.element.build();
        // Apply clipping planes to keep content inside tile bounds
        const hex = item.element.region.hexCell;
        if (hex) this.applyHexClipping(item.element, hex);
        else this.applyRectClipping(item.element, item.element.region);
        item.wrapper.add(item.element.group);
        this.ctx.scene.add(item.wrapper);
      }
      // Don't return early — keep ticking outgoing composition so it animates during build
    }

    // Phase C: Outgoing lifecycle — tick outgoing elements, dispose when all idle
    if (this.outgoing) {
      let allIdle = true;
      for (const el of this.outgoing.elements) {
        el.tick(dt, this.elapsed);
        if (el.stateMachine.state !== 'idle') {
          allIdle = false;
        }
      }
      for (const el of this.outgoing.borderOverlays) {
        el.tick(dt, this.elapsed);
        if (el.stateMachine.state !== 'idle') {
          allIdle = false;
        }
      }
      if (allIdle) {
        this.teardownComposition(this.outgoing);
        this.outgoing = null;
      }
    }

    // Phase F: Retiring elements (from rolling swaps)
    for (let i = this.retiringElements.length - 1; i >= 0; i--) {
      const { el, wrapper, onRetired } = this.retiringElements[i];
      el.tick(dt, this.elapsed);
      if (el.stateMachine.state === 'idle') {
        this.ctx.scene.remove(wrapper);
        el.dispose();
        this.retiringElements.splice(i, 1);
        // Fire queued spawn now that power-down is complete
        if (onRetired) onRetired();
      }
    }

    // Skip timeline/element updates if still building
    if (this.pendingBuild.length > 0) {
      this.pipeline.update(this.elapsed, this.config);
      return;
    }

    if (!this.current) {
      this.pipeline.update(this.elapsed, this.config);
      return;
    }

    // Advance timeline
    this.timeline.update(dt, (cue) => {
      // When rolling swap is active, suppress deactivation/cooldown cues
      if (this.config.rollingSwap && (cue.action === 'deactivate' || cue.action === 'alert')) {
        return;
      }
      const element = this.current?.elementMap.get(cue.elementId);
      if (element) {
        element.onAction(cue.action);
        // Sound feedback
        switch (cue.action) {
          case 'activate':
            this.audio.blip(200 + Math.random() * 200);
            break;
          case 'deactivate':
            this.audio.deactivate();
            break;
          case 'pulse':
            this.audio.dataChirp();
            break;
          case 'glitch':
            this.audio.glitchNoise();
            break;
          case 'alert':
            this.audio.alert(1.5);
            break;
        }
      }
    });

    // Phase D: Loop cycling — crossfade instead of blackout
    if (this.timeline.finished && this.timeline.loop && !this.config.rollingSwap) {
      const newSeed = Math.floor(Math.random() * 100000);
      this.config.seed = newSeed;
      this.generate(newSeed);
      // Don't process further this frame — next frame picks up new state
      this.pipeline.update(this.elapsed, this.config);
      return;
    }

    // Phase E: Rolling swap — start once elements are built and some are active
    if (
      this.config.rollingSwap &&
      !this.timeline.paused &&
      this.pendingBuild.length === 0 &&
      this.outgoing === null
    ) {
      // Only start swapping once at least one element has been activated by the timeline
      const hasActiveElements = this.current.elements.some(
        (el) => el.stateMachine.state === 'active' || el.stateMachine.state === 'activating'
      );
      if (hasActiveElements) {
        this.rollingTimer += dt;
        if (this.rollingTimer >= this.config.rollingInterval) {
          this.rollingTimer = 0;
          this.rollingMutate();
        }
      }
    }

    // Update current elements
    for (const el of this.current.elements) {
      el.tick(dt, this.elapsed);
    }

    // Update border overlay elements
    for (const el of this.current.borderOverlays) {
      el.tick(dt, this.elapsed);
    }

    // Pass real audio data to elements when audio-reactive is active
    const audioFrame = this.audioReactive.frame;
    if (audioFrame) {
      for (const el of this.current.elements) {
        if (!el.group.visible || el.stateMachine.state === 'idle') continue;
        el.tickAudio(audioFrame);
      }
      for (const el of this.current.borderOverlays) {
        if (!el.group.visible || el.stateMachine.state === 'idle') continue;
        el.tickAudio(audioFrame);
      }
    }

    // Update hex border overlay
    if (this.hexBorder) {
      this.hexBorder.update(dt, this.elapsed);
    }

    // Refresh debug overlay periodically during rolling swaps (~2Hz)
    if (this.debugVisible && this.config.rollingSwap) {
      this.debugRefreshTimer += dt;
      if (this.debugRefreshTimer >= 0.5) {
        this.debugRefreshTimer = 0;
        this.renderDebugOverlay();
      }
    }

    // Update post-FX
    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (this.disposed) return;
    if (this.editor.isActive) {
      this.editor.render();
      return;
    }
    if (this.showcase.isActive) {
      this.showcase.render();
      return;
    }
    if (this.gallery.isActive) {
      this.gallery.render();
      return;
    }
    this.pipeline.composer.render();
  }

  togglePause(): void {
    this.timeline.paused = !this.timeline.paused;
  }

  restart(): void {
    this.timeline.reset();
    this.timeline.paused = false;
    // Force all elements to idle, then let timeline re-activate them
    if (this.current) {
      for (const el of this.current.elements) {
        el.stateMachine.forceIdle();
        el.group.visible = false;
      }
      for (const el of this.current.borderOverlays) {
        el.stateMachine.forceIdle();
        el.group.visible = false;
      }
    }
  }

  get isPaused(): boolean {
    return this.timeline.paused;
  }

  get timelineProgress(): number {
    return this.timeline.normalizedTime;
  }

  /** Broadcast intensity level to all visible, active elements. */
  broadcastIntensity(level: number): void {
    this.currentIntensity = level;
    if (!this.current) return;
    for (const el of this.current.elements) {
      if (!el.group.visible) continue;
      if (el.stateMachine.state === 'idle') continue;
      el.onIntensity(level);
    }
    for (const el of this.current.borderOverlays) {
      if (!el.group.visible) continue;
      if (el.stateMachine.state === 'idle') continue;
      el.onIntensity(level);
    }
    // Don't play synth blips when audio-reactive is active — the user's music IS the audio
    if (level > 0 && !this.audioReactive.isActive) {
      this.audio.intensityBlip(level);
    }
  }

  /** Hit-test normalized coordinates against element regions. Returns element ID or null. */
  hitTestElement(nx: number, ny: number): string | null {
    if (!this.current) return null;
    for (const el of this.current.elements) {
      if (!el.group.visible || el.stateMachine.state === 'idle') continue;
      const r = el.region;
      if (nx >= r.x && nx <= r.x + r.width && ny >= r.y && ny <= r.y + r.height) {
        return el.id;
      }
    }
    return null;
  }

  /** Called when aspect ratio setting changes. */
  applyAspectAndRegenerate(): void {
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    this.generate(this.config.seed);
  }

  private debugOverlay: HTMLDivElement | null = null;
  private debugVisible: boolean = false;
  private debugRefreshTimer: number = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Toggle the debug region overlay. */
  private toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    if (this.debugVisible) {
      this.renderDebugOverlay();
    } else {
      this.debugOverlay?.remove();
      this.debugOverlay = null;
    }
  }

  /** Build/rebuild the debug overlay showing region outlines, IDs, and element types. */
  private renderDebugOverlay(): void {
    if (!this.current) return;
    this.debugOverlay?.remove();

    const canvas = this.ctx.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.id = 'debug-region-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: 'none',
      zIndex: '9999',
      overflow: 'hidden',
    });

    const cw = rect.width;
    const ch = rect.height;

    // Content elements
    for (const el of this.current.elements) {
      const r = el.region;
      const elType = this.current.elementTypeMap.get(el.id) ?? '?';
      const isBorder = this.current.borderByRegion.has(r.id);
      overlay.appendChild(this.createDebugCell(r, cw, ch, el.id, elType, r.isDivider ? '#555' : '#0f0', isBorder));
    }

    // Border overlay elements
    for (const el of this.current.borderOverlays) {
      const r = el.region;
      // Find what border type this is
      const bType = el.constructor?.toString().match(/class (\w+)/)?.[1] ?? 'border';
      overlay.appendChild(this.createDebugCell(r, cw, ch, `B:${el.id}`, bType, '#f0f', false, true));
    }

    document.body.appendChild(overlay);
    this.debugOverlay = overlay;
  }

  /** Create a single debug cell div. */
  private createDebugCell(
    r: Region, cw: number, ch: number,
    id: string, typeName: string, color: string,
    hasBorder: boolean, isBorderOverlay: boolean = false,
  ): HTMLDivElement {
    const div = document.createElement('div');
    // Region coordinates: x is left-to-right, y is bottom-to-top (GL convention)
    const left = r.x * cw;
    const top = (1 - r.y - r.height) * ch;
    const width = r.width * cw;
    const height = r.height * ch;

    Object.assign(div.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      border: `1px ${isBorderOverlay ? 'dashed' : 'solid'} ${color}`,
      boxSizing: 'border-box',
      overflow: 'hidden',
      background: isBorderOverlay ? 'rgba(255,0,255,0.05)' : 'rgba(0,0,0,0.6)',
    });

    const label = document.createElement('div');
    Object.assign(label.style, {
      fontFamily: 'monospace',
      fontSize: '9px',
      lineHeight: '1.2',
      color,
      padding: '2px 3px',
      wordBreak: 'break-all',
    });

    // Strip generation prefix for readability
    const shortId = id.replace(/^[gG]\d+_/, '').replace(/^B:g\d+_/, 'B:');
    label.innerHTML = `<b>${shortId}</b><br>${typeName}${hasBorder ? '<br>+border' : ''}`;
    div.appendChild(label);
    return div;
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      // Immediately update canvas size for smooth visual feedback
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      // Debounce the expensive regeneration (layout + element rebuild)
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.generate(this.config.seed);
      }, 250);
    });

    // Click/touch on an element → intensity 5 one-shot on that element
    const canvas = this.ctx.renderer.domElement;
    const handleTap = (clientX: number, clientY: number) => {
      if (!this.current) return;
      const rect = canvas.getBoundingClientRect();
      const nx = (clientX - rect.left) / rect.width;
      const ny = 1 - (clientY - rect.top) / rect.height; // flip Y: CSS top-down → GL bottom-up
      for (const el of this.current.elements) {
        if (!el.group.visible || el.stateMachine.state === 'idle') continue;
        const r = el.region;
        if (nx >= r.x && nx <= r.x + r.width && ny >= r.y && ny <= r.y + r.height) {
          el.onIntensity(5);
          this.audio.intensityBlip(5);
          return;
        }
      }
    };
    canvas.addEventListener('click', (e) => handleTap(e.clientX, e.clientY));

    window.addEventListener('keyup', (e) => {
      const intensityLevel = parseInt(e.key);
      if (intensityLevel >= 1 && intensityLevel <= 5) {
        // Always reset on release — the effect timers provide subtle falloff
        this.broadcastIntensity(0);
      }
    });

    window.addEventListener('keydown', (e) => {
      // Help overlay toggle — ? key (shift+/ or dedicated ?)
      if (e.key === '?') {
        toggleHelp();
        return;
      }
      // While help is visible, swallow all other keys
      if (isHelpVisible()) return;

      // Intensity keys 1–5 (before the main switch, so they work regardless)
      if (!e.repeat) {
        const intensityLevel = parseInt(e.key);
        if (intensityLevel >= 1 && intensityLevel <= 5) {
          this.intensityKeyDownTime = performance.now();
          this.broadcastIntensity(intensityLevel);
          return;
        }
      } else {
        // Ignore held repeats for intensity keys
        const intensityLevel = parseInt(e.key);
        if (intensityLevel >= 1 && intensityLevel <= 5) return;
      }

      switch (e.key.toLowerCase()) {
        case 'h':
          this.gui.toggle();
          break;
        case 'r':
          if (!e.ctrlKey && !e.metaKey) {
            this.config.seed = Math.floor(Math.random() * 100000);
            showToast(`Seed: ${this.config.seed}`);
            this.generate(this.config.seed);
          }
          break;
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            showToast('Screenshot saved');
            takeScreenshot(this.ctx.renderer.domElement);
          }
          break;
        case 'v':
          if (this.recorder.isRecording) {
            this.recorder.stop();
            showToast('Recording stopped');
          } else {
            this.recorder.start();
            showToast('Recording...');
          }
          break;
        case 'f':
          if (!this.showcase.isActive) {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen();
            } else {
              document.exitFullscreen();
            }
          }
          break;
        case 'm':
          this.audio.muted = !this.audio.muted;
          this.mobileToolbar?.setMuted(this.audio.muted);
          showToast(this.audio.muted ? 'Muted' : 'Unmuted');
          break;
        case ' ':
          e.preventDefault();
          this.togglePause();
          this.mobileToolbar?.setPaused(this.isPaused);
          showToast(this.isPaused ? 'Paused' : 'Playing');
          break;
        case 'backspace':
          if (!e.ctrlKey && !e.metaKey) {
            showToast('Restarting');
            this.restart();
          }
          break;
        case 'l':
          this.timeline.loop = !this.timeline.loop;
          showToast(this.timeline.loop ? 'Loop: on' : 'Loop: off');
          break;
        case 'd':
          this.toggleDebug();
          showToast(this.debugVisible ? 'Debug: on' : 'Debug: off');
          break;
        case 'g':
          if (!this.showcase.isActive && !this.gallery.isActive && !this.editor.isActive) {
            this.showcase.enter();
            showToast('Showcase mode');
          }
          break;
        case 'b':
          if (!this.gallery.isActive && !this.showcase.isActive && !this.editor.isActive) {
            this.gallery.enter();
            showToast('Gallery mode');
          }
          break;
        case 'x':
          this.config.hexLayout = !this.config.hexLayout;
          showToast(this.config.hexLayout ? 'Hex layout: on' : 'Hex layout: off');
          this.generate(this.config.seed);
          break;
        case 'e':
          if (!this.editor.isActive && !this.gallery.isActive && !this.showcase.isActive) {
            this.editor.promptEntry(
              this.current?.regions,
              this.current ? this.current.elementTypeMap : undefined,
              this.config.palette,
            );
          }
          break;
        case '+':
        case '=':
          this.config.overscanPadding = Math.min(this.config.overscanPadding + 1, 100);
          this.applyAspectAndRegenerate();
          break;
        case '-':
          this.config.overscanPadding = Math.max(this.config.overscanPadding - 1, 0);
          this.applyAspectAndRegenerate();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            e.preventDefault();
            this.config.overscanX = Math.max(this.config.overscanX - 1, -100);
            this.applyAspect();
          }
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            e.preventDefault();
            this.config.overscanX = Math.min(this.config.overscanX + 1, 100);
            this.applyAspect();
          }
          break;
        case 'ArrowUp':
          if (e.shiftKey) {
            e.preventDefault();
            this.config.overscanY = Math.max(this.config.overscanY - 1, -100);
            this.applyAspect();
          }
          break;
        case 'ArrowDown':
          if (e.shiftKey) {
            e.preventDefault();
            this.config.overscanY = Math.min(this.config.overscanY + 1, 100);
            this.applyAspect();
          }
          break;
      }
    });

    // Resume AudioContext on first user interaction
    const resumeAudio = () => {
      this.audio.blip(0, 0); // silent blip to initialize context
      window.removeEventListener('click', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
    window.addEventListener('click', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
  }

  dispose(): void {
    this.disposed = true;
    if (this.current) {
      for (const el of this.current.elements) {
        el.dispose();
      }
    }
    if (this.outgoing) {
      for (const el of this.outgoing.elements) {
        el.dispose();
      }
    }
    for (const { el } of this.retiringElements) {
      el.dispose();
    }
    if (this.hexBorder) {
      this.hexBorder.dispose();
      this.hexBorder = null;
    }
    this.showcase.dispose();
    this.gallery.dispose();
    this.editor.dispose();
    this.gui.destroy();
    this.touchManager?.destroy();
    this.touchRipple?.destroy();
    this.shakeDetector?.destroy();
    this.mobileToolbar?.destroy();
    this.mobileToolbar = null;
    this.audio.dispose();
    this.audioReactive.dispose();
    this.ctx.renderer.dispose();
  }
}
