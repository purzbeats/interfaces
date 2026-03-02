/** Detect device shaking via DeviceMotion API. */

const SHAKE_THRESHOLD = 15; // m/s² delta sum
const COOLDOWN_MS = 1000;

export class ShakeDetector {
  private onShake: () => void;
  private lastX: number = 0;
  private lastY: number = 0;
  private lastZ: number = 0;
  private hasBaseline: boolean = false;
  private lastShakeTime: number = 0;
  private boundHandler: (e: DeviceMotionEvent) => void;
  private permissionGranted: boolean = false;

  constructor(onShake: () => void) {
    this.onShake = onShake;
    this.boundHandler = (e) => this.handleMotion(e);
  }

  /** Request permission (iOS 13+) and start listening. Call from a user gesture. */
  async requestPermission(): Promise<void> {
    if (this.permissionGranted) return;

    // iOS 13+ requires explicit permission
    const DME = DeviceMotionEvent as any;
    if (typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission();
        if (result !== 'granted') return;
      } catch {
        return;
      }
    }

    this.permissionGranted = true;
    window.addEventListener('devicemotion', this.boundHandler);
  }

  private handleMotion(e: DeviceMotionEvent): void {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

    const x = acc.x;
    const y = acc.y;
    const z = acc.z;

    if (!this.hasBaseline) {
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
      this.hasBaseline = true;
      return;
    }

    const delta = Math.abs(x - this.lastX) + Math.abs(y - this.lastY) + Math.abs(z - this.lastZ);
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;

    if (delta > SHAKE_THRESHOLD) {
      const now = performance.now();
      if (now - this.lastShakeTime > COOLDOWN_MS) {
        this.lastShakeTime = now;
        this.onShake();
      }
    }
  }

  destroy(): void {
    window.removeEventListener('devicemotion', this.boundHandler);
  }
}
