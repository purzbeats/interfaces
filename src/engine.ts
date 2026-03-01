import { type Config, DEFAULT_CONFIG } from './config';
import { SeededRandom } from './random';
import { createRenderer, resizeRenderer, type RendererContext } from './renderer/setup';
import { getPalette, type Palette } from './color/palettes';
import { compose } from './layout/compositor';
import { createElement } from './elements/registry';
import { type BaseElement } from './elements/base-element';
import { generateTimeline, type Timeline } from './animation/timeline';
import { createPostFXPipeline, type PostFXPipeline } from './postfx/pipeline';
import { createGUI, type GUIControls } from './gui/controls';
import { takeScreenshot, createVideoRecorder, type VideoRecorder } from './export/exporter';
import { AudioSynth } from './audio/synth';
import { loadConfig, saveConfig, updateURL } from './persistence';
import type { Region } from './layout/region';
import * as THREE from 'three';

export class Engine {
  config: Config;
  private ctx!: RendererContext;
  private pipeline!: PostFXPipeline;
  private gui!: GUIControls;
  private recorder!: VideoRecorder;
  private audio: AudioSynth = new AudioSynth();
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

  init(): void {
    this.config.width = window.innerWidth;
    this.config.height = window.innerHeight;

    this.ctx = createRenderer(this.config.width, this.config.height);
    this.pipeline = createPostFXPipeline(
      this.ctx.renderer, this.ctx.scene, this.ctx.camera, this.config
    );
    this.recorder = createVideoRecorder(this.ctx.renderer.domElement, this.config.export.fps);

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
      }
    );

    this.generate(this.config.seed);
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
      this.wrapperMap.set(element.id, wrapper);
      this.ctx.scene.add(wrapper);
    }

    // Generate timeline (preserve loop state across regenerations)
    const wasLooping = this.timeline?.loop ?? false;
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
    this.elapsed += dt;

    // Loop dwell: waiting in darkness before next composition
    if (this.loopDwell > 0) {
      this.loopDwell -= dt;
      if (this.loopDwell <= 0) {
        // Dwell finished — generate new seed and start fresh
        this.config.seed = Math.floor(Math.random() * 100000);
        this.generate(this.config.seed);
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

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      this.config.width = window.innerWidth;
      this.config.height = window.innerHeight;
      resizeRenderer(this.ctx, this.config.width, this.config.height);
      this.pipeline.resize(this.config.width, this.config.height);
      // Regenerate to fix stale pixel coordinates
      this.generate(this.config.seed);
    });

    window.addEventListener('keydown', (e) => {
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
          break;
        case ' ':
          e.preventDefault();
          this.togglePause();
          break;
        case 'backspace':
          if (!e.ctrlKey && !e.metaKey) {
            this.restart();
          }
          break;
        case 'l':
          this.timeline.loop = !this.timeline.loop;
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
    this.gui.destroy();
    this.audio.dispose();
    this.ctx.renderer.dispose();
  }
}
