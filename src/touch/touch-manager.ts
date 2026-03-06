/** Multi-touch state machine: fingers on canvas = intensity level. */

import { TouchRipple } from './touch-ripple';

export interface TouchManagerCallbacks {
  onIntensityChange(level: number): void;
  onElementTarget(elementId: string | null): void;
  hitTestElement(nx: number, ny: number): string | null;
}

// Haptic patterns per intensity level
const HAPTIC_PATTERNS: Record<number, number | number[]> = {
  1: 10,
  2: [10, 30, 15],
  3: [15, 20, 15, 20, 20],
  4: [20, 15, 30, 15, 30],
  5: [30, 10, 40, 10, 50],
};

function vibrate(level: number): void {
  if (!navigator.vibrate) return;
  const pattern = HAPTIC_PATTERNS[level];
  if (pattern !== undefined) {
    navigator.vibrate(pattern);
  }
}

export class TouchManager {
  private canvas: HTMLCanvasElement;
  private callbacks: TouchManagerCallbacks;
  private ripple: TouchRipple;
  private currentLevel: number = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private sustainHandle: { stop(): void } | null = null;
  private currentTargetId: string | null = null;

  /** When false, all touch events pass through without being captured. */
  enabled: boolean = true;

  private boundStart: (e: TouchEvent) => void;
  private boundMove: (e: TouchEvent) => void;
  private boundEnd: (e: TouchEvent) => void;

  constructor(canvas: HTMLCanvasElement, callbacks: TouchManagerCallbacks, ripple: TouchRipple) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.ripple = ripple;

    this.boundStart = (e) => this.handleStart(e);
    this.boundMove = (e) => this.handleMove(e);
    this.boundEnd = (e) => this.handleEnd(e);

    canvas.addEventListener('touchstart', this.boundStart, { passive: false });
    canvas.addEventListener('touchmove', this.boundMove, { passive: false });
    canvas.addEventListener('touchend', this.boundEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.boundEnd, { passive: false });
  }

  private handleStart(e: TouchEvent): void {
    if (!this.enabled) return;
    e.preventDefault(); // prevent scroll

    const count = Math.min(e.touches.length, 5);
    this.updateLevel(count);

    // Spawn ripple at each new touch point
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.ripple.spawn(t.clientX, t.clientY, count);
    }

    // Long-press: single finger, 500ms hold
    this.cancelLongPress();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.sustainHandle = this.ripple.spawnSustain(touch.clientX, touch.clientY);
        this.callbacks.onIntensityChange(5); // max intensity on long press
        vibrate(5);
      }, 500);
    }

    // Hit-test primary touch for element targeting
    this.updateElementTarget(e.touches[0]);
  }

  private handleMove(e: TouchEvent): void {
    if (!this.enabled) return;
    e.preventDefault();

    // Cancel long-press on any movement
    this.cancelLongPress();

    // Update element target based on primary finger position
    if (e.touches.length > 0) {
      this.updateElementTarget(e.touches[0]);
    }
  }

  private handleEnd(e: TouchEvent): void {
    if (!this.enabled) return;
    e.preventDefault();

    this.cancelLongPress();

    if (this.sustainHandle) {
      this.sustainHandle.stop();
      this.sustainHandle = null;
    }

    const count = Math.min(e.touches.length, 5);
    this.updateLevel(count);

    if (count === 0) {
      // All fingers lifted — clear element target
      if (this.currentTargetId !== null) {
        this.currentTargetId = null;
        this.callbacks.onElementTarget(null);
      }
    }
  }

  private updateLevel(count: number): void {
    if (count !== this.currentLevel) {
      this.currentLevel = count;
      this.callbacks.onIntensityChange(count);
      if (count > 0) vibrate(count);
    }
  }

  private updateElementTarget(touch: Touch): void {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (touch.clientX - rect.left) / rect.width;
    const ny = 1 - (touch.clientY - rect.top) / rect.height; // flip Y
    const id = this.callbacks.hitTestElement(nx, ny);

    if (id !== this.currentTargetId) {
      this.callbacks.onElementTarget(id);
      this.currentTargetId = id;
    }
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  destroy(): void {
    this.cancelLongPress();
    if (this.sustainHandle) {
      this.sustainHandle.stop();
      this.sustainHandle = null;
    }
    this.canvas.removeEventListener('touchstart', this.boundStart);
    this.canvas.removeEventListener('touchmove', this.boundMove);
    this.canvas.removeEventListener('touchend', this.boundEnd);
    this.canvas.removeEventListener('touchcancel', this.boundEnd);
  }
}
