import { type Config, DEFAULT_CONFIG, computeAspectSize } from './config';
import { ShowcaseMode } from './showcase';
import { GalleryMode } from './gallery';
import { SeededRandom } from './random';
import { createRenderer, resizeRenderer, type RendererContext } from './renderer/setup';
import { getPalette, type Palette } from './color/palettes';
import { compose } from './layout/compositor';
import { createElement, createElementDeferred } from './elements/registry';
import { type BaseElement } from './elements/base-element';
import { generateTimeline, type Timeline } from './animation/timeline';
import { createPostFXPipeline, type PostFXPipeline } from './postfx/pipeline';
import { createGUI, type GUIControls } from './gui/controls';
import { MobileToolbar, TOOLBAR_HEIGHT } from './gui/mobile-toolbar';
import { takeScreenshot, createVideoRecorder, type VideoRecorder } from './export/exporter';
import { AudioSynth } from './audio/synth';
import { AudioReactive } from './audio/audio-reactive';
import { loadConfig, saveConfig, updateURL } from './persistence';
import { setDividerBrightness, setDividerThickness } from './elements/separator';
import type { Region } from './layout/region';
import * as THREE from 'three';

export class Engine {
  config: Config;
  private ctx!: RendererContext;
  private pipeline!: PostFXPipeline;
  private gui!: GUIControls;
  private recorder!: VideoRecorder;
  private audio: AudioSynth = new AudioSynth();
  audioReactive: AudioReactive = new AudioReactive();
  private elements: BaseElement[] = [];
  private elementMap: Map<string, BaseElement> = new Map();
  private regionMap: Map<string, Region> = new Map();
  private elementTypeMap: Map<string, string> = new Map();
  private wrapperMap: Map<string, THREE.Group> = new Map();
  private timeline!: Timeline;
  private palette!: Palette;
  private elapsed: number = 0;
  private disposed: boolean = false;
  private loopDwell: number = 0;
  private readonly LOOP_DWELL_TIME = 1.5; // seconds of darkness between compositions
  private pendingBuild: { element: BaseElement; wrapper: THREE.Group }[] = [];
  private readonly BUILD_BATCH_SIZE = 3;
  private showcase!: ShowcaseMode;
  private gallery!: GalleryMode;
  private mobileToolbar: MobileToolbar | null = null;
  private mobileQuery!: MediaQueryList;

  /** Current intensity level (0 = baseline, 1–5 = active). */
  currentIntensity: number = 0;
  private intensityKeyDownTime: number = 0;

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
    });

    // Wire audio-reactive → intensity system
    this.audioReactive.onKick = (level) => {
      this.broadcastIntensity(level);
      setTimeout(() => this.broadcastIntensity(0), 150);
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
            if (!this.showcase.isActive) this.showcase.enter();
          },
          onToggleSettings: () => this.gui.toggle(),
          onResumeAudio: () => this.audio.blip(0, 0),
        });
        this.applyAspect();
        resizeRenderer(this.ctx, this.config.width, this.config.height);
        this.pipeline.resize(this.config.width, this.config.height);
        this.generate(this.config.seed);
      } else if (!matches && this.mobileToolbar) {
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

  generate(seed: number): void {
    this.config.seed = seed;
    this.elapsed = 0;

    // Tear down existing elements
    for (const el of this.elements) {
      const wrapper = this.wrapperMap.get(el.id);
      if (wrapper) {
        this.ctx.scene.remove(wrapper);
      } else {
        this.ctx.scene.remove(el.group);
      }
      el.dispose();
    }
    this.elements = [];
    this.elementMap.clear();
    this.regionMap.clear();
    this.elementTypeMap.clear();
    this.wrapperMap.clear();

    const rng = new SeededRandom(seed);
    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    // Layout
    const layoutRng = rng.fork();
    const { regions } = compose(this.config.template, layoutRng);

    // Audio emitter — routes element audio events to the synth
    const emitAudio = (event: string, param?: number) => {
      switch (event) {
        case 'keystroke': this.audio.keystroke(param); break;
        case 'dataChirp': this.audio.dataChirp(); break;
        case 'seekSound': this.audio.blip(param ?? 200); break;
      }
    };

    // Create elements with wrapper groups
    const elementRng = rng.fork();
    for (const region of regions) {
      const elRng = elementRng.fork();
      const elementType = region.elementType ?? 'panel';
      const element = createElement(
        elementType,
        region,
        this.palette,
        elRng,
        this.config.width,
        this.config.height,
        emitAudio
      );
      this.elements.push(element);
      this.elementMap.set(element.id, element);
      this.regionMap.set(region.id, region);
      this.elementTypeMap.set(element.id, elementType);

      // Wrapper group architecture: scene → wrapper → element.group
      const wrapper = new THREE.Group();
      wrapper.add(element.group);
      if (region.isDivider) {
        wrapper.renderOrder = 10;
      }
      this.wrapperMap.set(element.id, wrapper);
      this.ctx.scene.add(wrapper);
    }

    // Generate timeline (preserve loop state across regenerations)
    const wasLooping = this.timeline?.loop ?? true;
    const timelineRng = rng.fork();
    const elementIds = this.elements.map((e) => e.id);
    this.timeline = generateTimeline(elementIds, this.config.timeline, timelineRng);
    this.timeline.loop = wasLooping;

    // Persist state
    saveConfig(this.config);
    updateURL(this.config);
  }

  /** Phase 1 of staged loading: teardown + layout + construct (no build). */
  private prepareNext(): void {
    this.config.seed = Math.floor(Math.random() * 100000);
    const seed = this.config.seed;
    this.elapsed = 0;

    // Tear down existing elements
    for (const el of this.elements) {
      const wrapper = this.wrapperMap.get(el.id);
      if (wrapper) {
        this.ctx.scene.remove(wrapper);
      } else {
        this.ctx.scene.remove(el.group);
      }
      el.dispose();
    }
    this.elements = [];
    this.elementMap.clear();
    this.regionMap.clear();
    this.elementTypeMap.clear();
    this.wrapperMap.clear();
    this.pendingBuild = [];

    const rng = new SeededRandom(seed);
    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    // Layout
    const layoutRng = rng.fork();
    const { regions } = compose(this.config.template, layoutRng);

    // Audio emitter
    const emitAudio = (event: string, param?: number) => {
      switch (event) {
        case 'keystroke': this.audio.keystroke(param); break;
        case 'dataChirp': this.audio.dataChirp(); break;
        case 'seekSound': this.audio.blip(param ?? 200); break;
      }
    };

    // Create elements WITHOUT calling build()
    const elementRng = rng.fork();
    for (const region of regions) {
      const elRng = elementRng.fork();
      const elementType = region.elementType ?? 'panel';
      const element = createElementDeferred(
        elementType,
        region,
        this.palette,
        elRng,
        this.config.width,
        this.config.height,
        emitAudio
      );
      this.elements.push(element);
      this.elementMap.set(element.id, element);
      this.regionMap.set(region.id, region);
      this.elementTypeMap.set(element.id, elementType);

      const wrapper = new THREE.Group();
      if (region.isDivider) {
        wrapper.renderOrder = 10;
      }
      this.wrapperMap.set(element.id, wrapper);

      // Queue for staggered build
      this.pendingBuild.push({ element, wrapper });
    }

    // Generate timeline (preserve loop state)
    const wasLooping = this.timeline?.loop ?? true;
    const timelineRng = rng.fork();
    const elementIds = this.elements.map((e) => e.id);
    this.timeline = generateTimeline(elementIds, this.config.timeline, timelineRng);
    this.timeline.loop = wasLooping;

    // Persist state
    saveConfig(this.config);
    updateURL(this.config);
  }

  update(dt: number): void {
    if (this.disposed) return;

    // Showcase/gallery mode takes over update/render
    if (this.showcase.isActive) {
      this.showcase.update(dt);
      return;
    }
    if (this.gallery.isActive) {
      this.gallery.update(dt);
      return;
    }

    this.elapsed += dt;

    // Audio-reactive runs regardless of build/dwell phase
    this.audioReactive.update(dt);

    // Phase 2: staggered build — pop a batch each frame
    if (this.pendingBuild.length > 0) {
      const count = Math.min(this.BUILD_BATCH_SIZE, this.pendingBuild.length);
      for (let i = 0; i < count; i++) {
        const item = this.pendingBuild.shift()!;
        item.element.build();
        item.wrapper.add(item.element.group);
        this.ctx.scene.add(item.wrapper);
      }
      // Still building — render scene (elements stay invisible until timeline activates them)
      this.pipeline.update(this.elapsed, this.config);
      return;
    }

    // Loop dwell: waiting in darkness before next composition
    if (this.loopDwell > 0) {
      this.loopDwell -= dt;
      if (this.loopDwell <= 0) {
        // Dwell finished — kick off staged build (Phase 1)
        this.prepareNext();
      }
      // Still in dwell period — just render the empty scene
      this.pipeline.update(this.elapsed, this.config);
      return;
    }

    // Advance timeline
    this.timeline.update(dt, (cue) => {
      const element = this.elementMap.get(cue.elementId);
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

    // Check if timeline finished and loop is enabled
    if (this.timeline.finished && this.timeline.loop) {
      this.loopDwell = this.LOOP_DWELL_TIME;
    }

    // Update elements
    for (const el of this.elements) {
      el.tick(dt, this.elapsed);
    }

    // Update post-FX
    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (this.disposed) return;
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
    for (const el of this.elements) {
      el.stateMachine.forceIdle();
      el.group.visible = false;
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
    for (const el of this.elements) {
      if (!el.group.visible) continue;
      if (el.stateMachine.state === 'idle') continue;
      el.onIntensity(level);
    }
    if (level > 0) {
      this.audio.intensityBlip(level);
    }
  }

  /** Called when aspect ratio setting changes. */
  applyAspectAndRegenerate(): void {
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    this.generate(this.config.seed);
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      this.applyAspect();
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      // Regenerate to fix stale pixel coordinates
      this.generate(this.config.seed);
    });

    window.addEventListener('keyup', (e) => {
      const intensityLevel = parseInt(e.key);
      if (intensityLevel >= 1 && intensityLevel <= 5) {
        // Always reset on release — the effect timers provide subtle falloff
        this.broadcastIntensity(0);
      }
    });

    window.addEventListener('keydown', (e) => {
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
            this.generate(this.config.seed);
          }
          break;
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            takeScreenshot(this.ctx.renderer.domElement);
          }
          break;
        case 'v':
          if (this.recorder.isRecording) this.recorder.stop();
          else this.recorder.start();
          break;
        case 'f':
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
          break;
        case 'm':
          this.audio.muted = !this.audio.muted;
          this.mobileToolbar?.setMuted(this.audio.muted);
          break;
        case ' ':
          e.preventDefault();
          this.togglePause();
          this.mobileToolbar?.setPaused(this.isPaused);
          break;
        case 'backspace':
          if (!e.ctrlKey && !e.metaKey) {
            this.restart();
          }
          break;
        case 'l':
          this.timeline.loop = !this.timeline.loop;
          break;
        case 'g':
          if (!this.showcase.isActive && !this.gallery.isActive) {
            this.showcase.enter();
          }
          break;
        case 'b':
          if (!this.gallery.isActive && !this.showcase.isActive) {
            this.gallery.enter();
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
    for (const el of this.elements) {
      el.dispose();
    }
    this.showcase.dispose();
    this.gallery.dispose();
    this.gui.destroy();
    this.mobileToolbar?.destroy();
    this.mobileToolbar = null;
    this.audio.dispose();
    this.audioReactive.dispose();
    this.ctx.renderer.dispose();
  }
}
