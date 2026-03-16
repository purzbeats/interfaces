import { Engine } from './engine';
import { initHeadless } from './headless';

const engine = new Engine();
engine.init();

// Check for headless mode (CLI video rendering)
const headlessActive = initHeadless(engine, () => engine.canvas);

if (!headlessActive) {
  // Normal browser mode: run RAF loop
  const perfFrames: number[] = ((window as any).__perfFrames = []);
  let lastTime = performance.now();

  function loop(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap dt to 100ms
    lastTime = now;

    const workStart = performance.now();
    engine.update(dt);
    engine.render();
    const workEnd = performance.now();

    perfFrames.push(workEnd - workStart);
    if (perfFrames.length > 300) perfFrames.shift();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
