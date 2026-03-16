#!/usr/bin/env electron

/**
 * Electron-based headless renderer - much faster than Playwright.
 * Uses offscreen rendering with GPU acceleration and direct IPC.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  probeVideo,
  extractFrames,
  countFrames,
  framePath,
  createEncoder,
} from './ffmpeg.js';

interface RenderJob {
  type: 'process' | 'render';
  input?: string;
  output: string;
  width: number;
  height: number;
  fps: number;
  duration?: number;
  seed?: number;
  palette?: string;
  template?: string;
}

// Parse command line args
function parseArgs(): RenderJob {
  const args = process.argv.slice(2);
  const job: Partial<RenderJob> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--process':
        job.type = 'process';
        job.input = args[++i];
        break;
      case '--render':
        job.type = 'render';
        break;
      case '--output':
        job.output = args[++i];
        break;
      case '--width':
        job.width = parseInt(args[++i], 10);
        break;
      case '--height':
        job.height = parseInt(args[++i], 10);
        break;
      case '--fps':
        job.fps = parseInt(args[++i], 10);
        break;
      case '--duration':
        job.duration = parseFloat(args[++i]);
        break;
      case '--seed':
        job.seed = parseInt(args[++i], 10);
        break;
      case '--palette':
        job.palette = args[++i];
        break;
      case '--template':
        job.template = args[++i];
        break;
    }
  }

  if (!job.output) throw new Error('--output required');
  if (!job.type) throw new Error('--process or --render required');

  return job as RenderJob;
}

// Start HTTP server for frames
function startFrameServer(tempDir: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const frameNum = parseInt(req.url?.slice(1) || '0', 10);
      const path = framePath(tempDir, frameNum);
      if (existsSync(path)) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Access-Control-Allow-Origin', '*');
        createReadStream(path).pipe(res);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' ? addr?.port || 0 : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

async function main() {
  const job = parseArgs();

  // Disable GPU sandbox for offscreen rendering
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'metal');

  await app.whenReady();

  let tempDir: string | null = null;
  let frameServer: { port: number; close: () => void } | null = null;
  let extractedCount = 0;
  let meta: { width: number; height: number; fps: number; duration: number } | null = null;

  // Process mode: extract frames
  if (job.type === 'process' && job.input) {
    console.log(`Probing video: ${job.input}`);
    meta = await probeVideo(job.input);
    console.log(`  Resolution: ${meta.width}x${meta.height}`);
    console.log(`  FPS: ${meta.fps.toFixed(2)}`);
    console.log(`  Duration: ${meta.duration.toFixed(2)}s`);

    job.width = job.width || meta.width;
    job.height = job.height || meta.height;
    job.fps = job.fps || Math.round(meta.fps);

    tempDir = await mkdtemp(join(tmpdir(), 'interfaces-'));
    console.log(`Extracting frames to ${tempDir}...`);
    await extractFrames(job.input, tempDir, job.fps);
    extractedCount = await countFrames(tempDir);
    console.log(`Extracted ${extractedCount} frames`);

    frameServer = await startFrameServer(tempDir);
    console.log(`Frame server on port ${frameServer.port}`);
  } else {
    job.width = job.width || 1920;
    job.height = job.height || 1080;
    job.fps = job.fps || 60;
    job.duration = job.duration || 30;
  }

  // Create browser window with GPU (visible for better performance)
  const win = new BrowserWindow({
    width: job.width,
    height: job.height,
    show: true, // Visible window has better GPU compositing
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Build URL
  const params = new URLSearchParams({
    headless: '1',
    width: String(job.width),
    height: String(job.height),
  });
  if (job.type === 'process') params.set('mode', 'media');
  if (job.seed !== undefined) params.set('seed', String(job.seed));
  if (job.palette) params.set('palette', job.palette);
  if (job.template) params.set('template', job.template);

  const url = `http://localhost:5173/?${params}`;
  console.log(`Loading: ${url}`);
  await win.loadURL(url);

  // Wait for headless API
  await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const check = () => window.__headless?.ready ? resolve(true) : setTimeout(check, 50);
      check();
    });
  `);
  console.log('Headless API ready');

  // Initialize for process mode
  let totalFrames: number;
  let maxOffset = 0;

  if (job.type === 'process' && meta) {
    await win.webContents.executeJavaScript(`
      window.__headless.initTiles(${meta.width}, ${meta.height});
    `);
    maxOffset = await win.webContents.executeJavaScript(`
      window.__headless.getMaxFrameOffset();
    `);
    totalFrames = extractedCount + maxOffset;
    console.log(`Total frames: ${totalFrames} (${extractedCount} + ${maxOffset} offset)`);
  } else {
    totalFrames = Math.ceil((job.duration || 30) * job.fps);
    console.log(`Total frames: ${totalFrames}`);
  }

  // Create encoder (accepts PNG frames)
  const encoder = createEncoder(resolve(job.output), job.width, job.height, job.fps);
  console.log(`Encoding to: ${job.output}`);

  const dt = 1 / job.fps;
  const startTime = Date.now();

  // Render loop - direct pixel capture
  for (let frame = 1; frame <= totalFrames; frame++) {
    if (job.type === 'process' && frameServer) {
      // Load frames via HTTP and render
      await win.webContents.executeJavaScript(`
        (async () => {
          const h = window.__headless;
          const offsets = h.getTileOffsets();
          const globalFrame = ${frame};
          const extractedCount = ${extractedCount};
          const frameServerUrl = 'http://127.0.0.1:${frameServer.port}';

          // Calculate needed frames
          const neededFrames = new Set();
          for (const offset of offsets) {
            const tileFrame = globalFrame - offset;
            if (tileFrame >= 1 && tileFrame <= extractedCount) {
              neededFrames.add(tileFrame);
            }
          }

          // Load frames
          const cache = window.__frameCache || (window.__frameCache = new Map());
          await Promise.all([...neededFrames].filter(n => !cache.has(n)).map(n =>
            new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => { cache.set(n, img); resolve(); };
              img.onerror = reject;
              img.src = frameServerUrl + '/' + n;
            })
          ));

          // Update tiles
          const getFrame = n => cache.get(n) || null;
          await h.loadFrames({}, globalFrame); // Tiles will use cache

          // Clean old frames
          const minNeeded = globalFrame - Math.max(...offsets) - 1;
          for (const k of cache.keys()) if (k < minNeeded) cache.delete(k);

          h.step(${dt});
        })();
      `);
    } else {
      // Render mode - just step
      await win.webContents.executeJavaScript(`
        window.__headless.step(${dt});
      `);
    }

    // Use headless API's JPEG capture (faster than capturePage or CDP)
    const base64 = await win.webContents.executeJavaScript(`
      window.__headless.capture();
    `) as string;
    const buffer = Buffer.from(base64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    encoder.stdin.write(buffer);

    // Progress
    if (frame % 30 === 0 || frame === totalFrames) {
      const elapsed = (Date.now() - startTime) / 1000;
      const fps_actual = frame / elapsed;
      const eta = (totalFrames - frame) / fps_actual;
      process.stdout.write(
        `\rFrame ${frame}/${totalFrames} (${((frame / totalFrames) * 100).toFixed(1)}%) - ${fps_actual.toFixed(1)} fps - ETA: ${eta.toFixed(0)}s   `
      );
    }
  }

  console.log('\n\nFinalizing...');
  encoder.stdin.end();
  await encoder.promise;

  // Cleanup
  frameServer?.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  win.close();
  app.quit();

  console.log(`Done! Output: ${job.output}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  app.quit();
  process.exit(1);
});
