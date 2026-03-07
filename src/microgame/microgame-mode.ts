import * as THREE from 'three';
import { resizeRenderer, type RendererContext } from '../renderer/setup';
import { type PostFXPipeline } from '../postfx/pipeline';
import { type Config, computeAspectSize } from '../config';
import { getPalette } from '../color/palettes';
import { SeededRandom } from '../random';
import { createElement } from '../elements/registry';
import { type BaseElement } from '../elements/base-element';
import { TOOLBAR_HEIGHT } from '../gui/mobile-toolbar';
import { showToast } from '../gui/toast';
import { MicrogameHUD } from './microgame-hud';
import { MicrogameEffects } from './effects';
import { Narrator, OPENING_LINES } from './narrator';
import { pickRandom, allMicrogames } from './microgame-registry';
import type { MicrogameState, MicrogameInput, MicrogameDefinition, MicrogameDrawContext } from './microgame-types';
import type { Region } from '../layout/region';

// Import all microgame definitions so they self-register
import './games/track-target';
import './games/fill-gauge';
import './games/stop-needle';
import './games/dodge-sweep';
import './games/sort-bars';
import './games/match-wave';
import './games/find-blip';
import './games/hold-level';
import './games/count-pulses';
import './games/escape-maze';

type Phase = 'idle' | 'opening' | 'ready' | 'playing' | 'result' | 'gameover';

const STARTING_LIVES = 4;
const OPENING_DURATION = 2.5;
const READY_DURATION = 1.0;
const RESULT_DURATION = 1.2; // longer to allow win/lose animation
const GAMEOVER_DURATION = 4.0;
const SPEED_INCREMENT = 0.08;
const MAX_SPEED = 2.5;

/** Convert a THREE.Color to a CSS hex string */
function colorToCSS(c: THREE.Color): string {
  return '#' + c.getHexString();
}

export class MicrogameMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private onExit: () => void;
  private isMobileCheck: () => boolean;

  private active = false;
  private stashedChildren: THREE.Object3D[] = [];
  private hud: MicrogameHUD;
  private effects: MicrogameEffects = new MicrogameEffects();
  private narrator: Narrator = new Narrator();

  // Game state
  private phase: Phase = 'idle';
  private phaseTimer = 0;
  private playTimer = 0; // total elapsed during play phase (for draw context)
  private score = 0;
  private lives = STARTING_LIVES;
  private speed = 1.0;
  private round = 0;
  private lastGameId: string | null = null;

  // Current round
  private currentDef: MicrogameDefinition | null = null;
  private currentState: MicrogameState | null = null;
  private currentElement: BaseElement | null = null;
  private elementWrapper: THREE.Group | null = null;

  // Draw context (reused between frames)
  private drawCtx: MicrogameDrawContext | null = null;

  // Input tracking
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private pointer: { nx: number; ny: number } | null = null;
  private pointerDown = false;
  private pointerJustDown = false;
  private pointerDownThisFrame = false;

  // Event handlers
  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private mouseMoveHandler: (e: MouseEvent) => void;
  private mouseDownHandler: (e: MouseEvent) => void;
  private mouseUpHandler: (e: MouseEvent) => void;
  private touchStartHandler: (e: TouchEvent) => void;
  private touchMoveHandler: (e: TouchEvent) => void;
  private touchEndHandler: (e: TouchEvent) => void;

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
    this.hud = new MicrogameHUD();

    this.keyDownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
    this.keyUpHandler = (e: KeyboardEvent) => this.onKeyUp(e);
    this.mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
    this.mouseDownHandler = (e: MouseEvent) => this.onMouseDown(e);
    this.mouseUpHandler = (e: MouseEvent) => this.onMouseUp(e);
    this.touchStartHandler = (e: TouchEvent) => this.onTouchStart(e);
    this.touchMoveHandler = (e: TouchEvent) => this.onTouchMove(e);
    this.touchEndHandler = (e: TouchEvent) => this.onTouchEnd(e);
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (allMicrogames().length === 0) {
      showToast('No microgames registered');
      return;
    }

    this.active = true;

    // Stash current scene
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    const palette = getPalette(this.config.palette);
    this.ctx.scene.background = palette.bg;

    // Reset game state
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.speed = 1.0;
    this.round = 0;
    this.lastGameId = null;
    this.effects.clear();
    this.narrator.reset();

    // Show HUD and size game canvas
    this.hud.show();
    this.hud.resizeGameCanvas();
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);
    this.hud.setSpeed(1);

    // Bind input
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener('mousemove', this.mouseMoveHandler);
    canvas.addEventListener('mousedown', this.mouseDownHandler);
    canvas.addEventListener('mouseup', this.mouseUpHandler);
    canvas.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    canvas.addEventListener('touchend', this.touchEndHandler);

    // Show cryo-revival opening sequence
    this.phase = 'opening';
    this.phaseTimer = 0;
    this.hud.showInterstitial('REVIVAL SEQUENCE', this.narrator.getOpening());
  }

  exit(): void {
    this.active = false;
    this.hud.hide();
    this.hud.hideInterstitial();
    this.hud.clearGameCanvas();
    this.effects.clear();
    this.disposeCurrentElement();

    // Unbind input
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    const canvas = this.ctx.renderer.domElement;
    canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    canvas.removeEventListener('mousedown', this.mouseDownHandler);
    canvas.removeEventListener('mouseup', this.mouseUpHandler);
    canvas.removeEventListener('touchstart', this.touchStartHandler);
    canvas.removeEventListener('touchmove', this.touchMoveHandler);
    canvas.removeEventListener('touchend', this.touchEndHandler);

    this.keysDown.clear();
    this.keysPressed.clear();

    // Restore scene
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.pipeline.update(this.phaseTimer, this.config);
    this.effects.update(dt);

    switch (this.phase) {
      case 'opening':
        this.phaseTimer += dt;
        if (this.phaseTimer >= OPENING_DURATION) {
          this.startReady();
        }
        break;

      case 'ready':
        this.phaseTimer += dt;
        if (this.currentElement) {
          this.currentElement.tick(dt, this.phaseTimer);
        }
        if (this.phaseTimer >= READY_DURATION) {
          this.startPlaying();
        }
        break;

      case 'playing':
        this.updatePlaying(dt);
        break;

      case 'result':
        this.phaseTimer += dt;
        if (this.currentElement) {
          this.currentElement.tick(dt, this.phaseTimer);
        }
        // Keep drawing game + effects during result for animation
        if (this.drawCtx && this.currentDef && this.currentState) {
          this.hud.clearGameCanvas();
          this.drawCtx.w = window.innerWidth;
          this.drawCtx.h = window.innerHeight;
          this.drawCtx.time = this.playTimer;
          this.currentDef.draw(this.currentState, this.drawCtx);
          this.effects.draw(this.drawCtx.ctx);
        }
        if (this.phaseTimer >= RESULT_DURATION) {
          if (this.lives <= 0) {
            this.startGameOver();
          } else {
            this.startReady();
          }
        }
        break;

      case 'gameover':
        this.phaseTimer += dt;
        // Keep effects running during game over
        this.hud.clearGameCanvas();
        if (this.drawCtx) {
          this.effects.draw(this.drawCtx.ctx);
        }
        if (this.phaseTimer >= GAMEOVER_DURATION) {
          this.exit();
        }
        break;
    }

    // Clear per-frame input
    this.keysPressed.clear();
    this.pointerJustDown = false;
    this.pointerDownThisFrame = false;
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  dispose(): void {
    this.hud.dispose();
    this.disposeCurrentElement();
  }

  // --- Phase transitions ---

  private startReady(): void {
    this.disposeCurrentElement();
    this.hud.clearGameCanvas();
    this.effects.clear();
    this.phase = 'ready';
    this.phaseTimer = 0;
    this.playTimer = 0;

    // Pick next game
    this.currentDef = pickRandom(this.lastGameId);
    this.lastGameId = this.currentDef.id;
    this.round++;

    // Show prompt with narrator intro quip
    const quip = this.narrator.getIntro(this.round);
    this.hud.showInterstitial(this.currentDef.prompt, quip);
    this.hud.setPrompt(this.currentDef.prompt);
    this.hud.setTimer(1);

    // Spawn background element
    this.spawnElement(this.currentDef.elementType);
  }

  private startPlaying(): void {
    this.phase = 'playing';
    this.phaseTimer = 0;
    this.hud.hideInterstitial();

    if (!this.currentDef || !this.currentElement) return;

    const totalTime = this.currentDef.baseTime / this.speed;

    // Build palette colors for draw context
    const palette = getPalette(this.config.palette);
    this.drawCtx = {
      ctx: this.hud.getGameContext(),
      w: window.innerWidth,
      h: window.innerHeight,
      time: 0,
      fx: this.effects,
      colors: {
        primary: colorToCSS(palette.primary),
        secondary: colorToCSS(palette.secondary),
        dim: colorToCSS(palette.dim),
        bg: colorToCSS(palette.bg),
        alert: colorToCSS(palette.alert),
      },
    };

    this.currentState = {
      element: this.currentElement,
      timeLeft: totalTime,
      totalTime,
      speed: this.speed,
      data: {},
      result: 'pending',
      prompt: this.currentDef.prompt,
    };

    // Let the game set up
    this.currentDef.setup(this.currentState);

    // Update prompt in case setup changed it
    this.hud.setPrompt(this.currentState.prompt);

    // Activate element
    this.currentElement.stateMachine.transition('active');
  }

  private updatePlaying(dt: number): void {
    if (!this.currentDef || !this.currentState || !this.currentElement || !this.drawCtx) return;

    // Update timer
    this.currentState.timeLeft -= dt;
    this.phaseTimer += dt;
    this.playTimer += dt;
    const fraction = Math.max(0, this.currentState.timeLeft / this.currentState.totalTime);
    this.hud.setTimer(fraction);

    // Build input
    const input: MicrogameInput = {
      keysDown: this.keysDown,
      keysPressed: this.keysPressed,
      pointer: this.pointer,
      pointerDown: this.pointerDown,
      pointerJustDown: this.pointerDownThisFrame,
    };

    // Update game logic
    this.currentDef.update(this.currentState, input, dt);

    // Update element visuals
    this.currentElement.tick(dt, this.phaseTimer);

    // Draw game overlay + effects
    this.hud.clearGameCanvas();
    this.drawCtx.w = window.innerWidth;
    this.drawCtx.h = window.innerHeight;
    this.drawCtx.time = this.playTimer;
    this.currentDef.draw(this.currentState, this.drawCtx);
    this.effects.draw(this.drawCtx.ctx);

    // Check result
    if (this.currentState.result !== 'pending') {
      this.endRound(this.currentState.result === 'win');
    } else if (this.currentState.timeLeft <= 0) {
      this.endRound(false);
    }
  }

  private endRound(win: boolean): void {
    this.phase = 'result';
    this.phaseTimer = 0;

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    if (win) {
      this.score++;
      this.hud.flash(true);
      this.hud.showInterstitial('PASS', this.narrator.getWinReaction());
      this.effects.winBurst(cx, cy, this.drawCtx?.colors.primary ?? '#33ff66');
    } else {
      this.lives--;
      this.hud.flash(false);
      this.hud.showInterstitial('FAIL', this.narrator.getLoseReaction());
      this.effects.loseBurst(cx, cy, this.drawCtx?.colors.alert ?? '#ff3344');
    }

    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);

    // Last life warning
    if (this.lives === 1 && !win) {
      this.hud.setQuip(this.narrator.getLastLife());
    }

    // Speed up every 4 rounds
    if (this.round % 4 === 0 && this.speed < MAX_SPEED) {
      this.speed = Math.min(MAX_SPEED, this.speed + SPEED_INCREMENT);
      this.hud.setSpeed(Math.floor(this.speed * 10) / 10);
      // Show speed-up quip (overwrites win/lose quip briefly — that's fine)
      this.hud.setQuip(this.narrator.getSpeedUp());
    }
  }

  private startGameOver(): void {
    this.phase = 'gameover';
    this.phaseTimer = 0;
    this.disposeCurrentElement();
    this.hud.showInterstitial(
      `DIAGNOSTIC COMPLETE — ${this.score}`,
      this.narrator.getGameOver(this.score),
    );
  }

  // --- Element management ---

  private spawnElement(elementType: string): void {
    const palette = getPalette(this.config.palette);
    const rng = new SeededRandom(this.config.seed + this.round * 777);
    const w = this.config.width;
    const h = this.config.height;

    const region: Region = {
      id: `microgame-${this.round}`,
      x: 0.02,
      y: 0.04,
      width: 0.96,
      height: 0.94,
      padding: 0.01,
      isDivider: false,
    };

    const el = createElement(elementType, region, palette, rng, w, h);
    this.currentElement = el;

    this.elementWrapper = new THREE.Group();
    this.elementWrapper.add(el.group);
    this.ctx.scene.add(this.elementWrapper);
    el.group.visible = true;
  }

  private disposeCurrentElement(): void {
    if (this.currentElement) {
      if (this.elementWrapper) {
        this.ctx.scene.remove(this.elementWrapper);
      }
      if (this.currentElement._built) {
        this.currentElement.dispose();
      }
      this.currentElement = null;
      this.elementWrapper = null;
    }
    this.currentState = null;
  }

  // --- Input handling ---

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.exit();
      return;
    }
    if (!e.repeat) {
      this.keysDown.add(e.key.toLowerCase());
      this.keysPressed.add(e.key.toLowerCase());
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key.toLowerCase());
  }

  private onMouseMove(e: MouseEvent): void {
    this.updatePointer(e.clientX, e.clientY);
  }

  private onMouseDown(e: MouseEvent): void {
    this.pointerDown = true;
    this.pointerJustDown = true;
    this.pointerDownThisFrame = true;
    this.updatePointer(e.clientX, e.clientY);
    // Click ripple
    if (this.phase === 'playing' && this.drawCtx) {
      this.effects.clickRipple(e.clientX, e.clientY, this.drawCtx.colors.secondary);
    }
  }

  private onMouseUp(_e: MouseEvent): void {
    this.pointerDown = false;
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches[0];
    this.pointerDown = true;
    this.pointerJustDown = true;
    this.pointerDownThisFrame = true;
    this.updatePointer(t.clientX, t.clientY);
    // Touch ripple
    if (this.phase === 'playing' && this.drawCtx) {
      this.effects.clickRipple(t.clientX, t.clientY, this.drawCtx.colors.secondary);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const t = e.touches[0];
    this.updatePointer(t.clientX, t.clientY);
  }

  private onTouchEnd(_e: TouchEvent): void {
    this.pointerDown = false;
  }

  private updatePointer(clientX: number, clientY: number): void {
    const nx = clientX / window.innerWidth;
    const ny = clientY / window.innerHeight;
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
      this.pointer = { nx, ny };
    } else {
      this.pointer = null;
    }
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
