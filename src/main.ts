import { Engine } from './engine';

const engine = new Engine();
engine.init();

let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1); // cap dt to 100ms
  lastTime = now;

  engine.update(dt);
  engine.render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
