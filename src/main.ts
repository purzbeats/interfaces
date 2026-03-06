import { Engine } from './engine';

const engine = new Engine();
engine.init();

// Perf hook: exposes per-frame work times for profiling tools
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
