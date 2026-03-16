#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { chromium, type Page, type Browser, type CDPSession } from '@playwright/test';
import { mkdtemp, rm, access, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import {
  probeVideo,
  extractFrames,
  countFrames,
  framePath,
  createEncoder,
  createRawEncoder,
  createH264Muxer,
  readFrameBuffer,
  type VideoMetadata,
} from './ffmpeg.js';

/** Start HTTP server to serve frames (avoids base64 encoding overhead) */
function startFrameServer(tempDir: string): Promise<{ server: Server; port: number }> {
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
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' ? addr?.port || 0 : 0;
      resolve({ server, port });
    });
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CLIArgs {
  process?: string;
  render?: boolean;
  output?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  seed?: number;
  palette?: string;
  template?: string;
  uniform?: string;
  help?: boolean;
}

function printUsage(): void {
  console.log(`
INTERFACES CLI - Offline video rendering

Usage:
  interfaces --process <input.mp4> --output <output.mp4> [options]
  interfaces --render --output <output.mp4> [options]

Modes:
  --process <file>    Process input video through palette/effects pipeline
  --render            Render procedural interface to video (no input)

Required:
  --output <file>     Output video path

Options:
  --width <n>         Output width (default: input width or 1920)
  --height <n>        Output height (default: input height or 1080)
  --fps <n>           Output frame rate (default: 60)
  --duration <n>      Duration in seconds (default: input duration or 30)

Style options (same as URL params):
  --seed <n>          Random seed for reproducible output
  --palette <name>    Color palette (e.g., phosphor-green, cyber-pink)
  --template <name>   Layout template (e.g., auto, dense, sparse)
  --uniform <name>    Force all regions to use single element type

Examples:
  # Process video with cyber-pink palette
  interfaces --process input.mp4 --output out.mp4 --palette cyber-pink

  # Render 30s procedural animation at 4K
  interfaces --render --duration 30 --width 3840 --height 2160 --output out.mp4

  # Process with specific seed for reproducibility
  interfaces --process input.mp4 --output out.mp4 --seed 12345 --palette amber
`);
}

function parseArguments(): CLIArgs {
  const { values } = parseArgs({
    options: {
      process: { type: 'string' },
      render: { type: 'boolean', default: false },
      output: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      fps: { type: 'string' },
      duration: { type: 'string' },
      seed: { type: 'string' },
      palette: { type: 'string' },
      template: { type: 'string' },
      uniform: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  return {
    process: values.process,
    render: values.render,
    output: values.output,
    width: values.width ? parseInt(values.width, 10) : undefined,
    height: values.height ? parseInt(values.height, 10) : undefined,
    fps: values.fps ? parseInt(values.fps, 10) : undefined,
    duration: values.duration ? parseFloat(values.duration) : undefined,
    seed: values.seed ? parseInt(values.seed, 10) : undefined,
    palette: values.palette,
    template: values.template,
    uniform: values.uniform,
    help: values.help,
  };
}

function buildURL(
  baseUrl: string,
  args: CLIArgs,
  mode: 'process' | 'render',
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('headless', '1');

  if (mode === 'process') {
    url.searchParams.set('mode', 'media');
  }

  if (args.width) url.searchParams.set('width', String(args.width));
  if (args.height) url.searchParams.set('height', String(args.height));
  if (args.seed !== undefined) url.searchParams.set('seed', String(args.seed));
  if (args.palette) url.searchParams.set('palette', args.palette);
  if (args.template) url.searchParams.set('template', args.template);
  if (args.uniform) url.searchParams.set('uniform', args.uniform);

  return url.toString();
}

async function processVideo(args: CLIArgs): Promise<void> {
  const inputPath = resolve(args.process!);

  // Verify input exists
  try {
    await access(inputPath);
  } catch {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(`Probing video: ${inputPath}`);
  const meta = await probeVideo(inputPath);
  console.log(`  Resolution: ${meta.width}x${meta.height}`);
  console.log(`  FPS: ${meta.fps.toFixed(2)}`);
  console.log(`  Duration: ${meta.duration.toFixed(2)}s`);
  console.log(`  Frames: ${meta.frameCount}`);

  const width = args.width ?? meta.width;
  const height = args.height ?? meta.height;
  const fps = args.fps ?? Math.round(meta.fps);
  const duration = args.duration ?? meta.duration;
  const totalFrames = Math.ceil(duration * fps);

  console.log(`\nOutput settings:`);
  console.log(`  Resolution: ${width}x${height}`);
  console.log(`  FPS: ${fps}`);
  console.log(`  Duration: ${duration.toFixed(2)}s`);
  console.log(`  Total frames: ${totalFrames}`);

  // Extract frames to temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'interfaces-'));
  console.log(`\nExtracting frames to ${tempDir}...`);

  try {
    await extractFrames(inputPath, tempDir, fps);
    const extractedCount = await countFrames(tempDir);
    console.log(`Extracted ${extractedCount} frames`);

    // Start HTTP server for frame serving (faster than base64)
    const { server: frameServer, port: framePort } = await startFrameServer(tempDir);
    const frameServerUrl = `http://127.0.0.1:${framePort}`;
    console.log(`Frame server started on port ${framePort}`);

    // Launch browser with GPU acceleration
    console.log(`\nLaunching browser with GPU acceleration...`);
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=metal',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        '--enable-features=WebCodecs,WebCodecsEncoder',
      ],
    });

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Build URL with params
    const appUrl = buildURL('http://localhost:5173', args, 'process');
    console.log(`Loading: ${appUrl}`);
    await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for headless API to be ready
    await page.waitForFunction(() => (window as any).__headless?.ready, { timeout: 30000 });
    console.log('Headless API ready');

    // Initialize tiled layout (use input video dimensions for tile aspect ratio)
    await page.evaluate(async ({ w, h }: { w: number; h: number }) => {
      await (window as any).__headless.initTiles(w, h);
    }, { w: width, h: height });

    // Get max frame offset
    const maxOffset = await page.evaluate(() => (window as any).__headless.getMaxFrameOffset());
    console.log(`Tile offsets: max ${maxOffset} frames (${(maxOffset / fps).toFixed(1)}s stagger)`);

    const totalRenderFrames = extractedCount + maxOffset;
    console.log(`Total render frames: ${totalRenderFrames} (input: ${extractedCount} + offset: ${maxOffset})`);

    // Initialize WebCodecs encoder in browser
    let useWebCodecs = false;
    try {
      await page.evaluate(async ({ w, h, f }: { w: number; h: number; f: number }) => {
        await (window as any).__headless.initEncoder(w, h, f);
      }, { w: width, h: height, f: fps });
      useWebCodecs = true;
      console.log('WebCodecs H.264 encoder initialized (GPU-accelerated)');
    } catch (e) {
      console.log('WebCodecs not available, falling back to JPEG capture');
    }

    // Create muxer/encoder
    const outputPath = resolve(args.output!);
    console.log(`\nEncoding to: ${outputPath}`);
    const encoder = useWebCodecs
      ? createH264Muxer(outputPath, width, height, fps)
      : createEncoder(outputPath, width, height, fps);

    const dt = 1 / fps;
    const BATCH_SIZE = 30; // Process 30 frames per round-trip

    // Render loop with batching using HTTP frame server
    const startTime = Date.now();
    for (let batchStart = 1; batchStart <= totalRenderFrames; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalRenderFrames);
      const globalFrames: number[] = [];
      for (let i = batchStart; i <= batchEnd; i++) {
        globalFrames.push(i);
      }

      if (useWebCodecs) {
        // Use HTTP frame server with WebCodecs (fastest path)
        const chunks = await page.evaluate(
          async ({ url, frames, count, dt }: { url: string; frames: number[]; count: number; dt: number }) => {
            const results = await (window as any).__headless.renderBatchHttp(url, frames, count, dt);
            return results.map((chunk: Uint8Array) => Array.from(chunk));
          },
          { url: frameServerUrl, frames: globalFrames, count: extractedCount, dt },
        );

        // Write encoded chunks
        for (const chunk of chunks) {
          if (chunk && chunk.length > 0) {
            encoder.stdin.write(Buffer.from(chunk as number[]));
          }
        }
      } else {
        // Fallback: use HTTP with JPEG capture
        const frames = await page.evaluate(
          async ({ url, frames, count, dt }: { url: string; frames: number[]; count: number; dt: number }) => {
            const h = (window as any).__headless;
            const offsets = h.getTileOffsets();
            const imageCache = new Map<number, HTMLImageElement>();
            const results: string[] = [];

            for (const globalFrame of frames) {
              // Load needed frames via HTTP
              const neededFrames = new Set<number>();
              for (const offset of offsets) {
                const tileFrame = globalFrame - offset;
                if (tileFrame >= 1 && tileFrame <= count) {
                  neededFrames.add(tileFrame);
                }
              }

              for (const frameNum of neededFrames) {
                if (!imageCache.has(frameNum)) {
                  const res = await fetch(`${url}/${frameNum}`);
                  const blob = await res.blob();
                  const bitmap = await createImageBitmap(blob);
                  const canvas = document.createElement('canvas');
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const ctx = canvas.getContext('2d')!;
                  ctx.drawImage(bitmap, 0, 0);
                  const img = new Image();
                  img.src = canvas.toDataURL();
                  await new Promise<void>((resolve) => { img.onload = () => resolve(); });
                  imageCache.set(frameNum, img);
                }
              }

              await h.loadFrames({}, globalFrame); // Empty, we handle loading above
              h.step(dt);
              results.push(h.capture());
            }
            return results;
          },
          { url: frameServerUrl, frames: globalFrames, count: extractedCount, dt },
        );

        for (const base64 of frames) {
          const jpegBuffer = Buffer.from(base64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
          encoder.stdin.write(jpegBuffer);
        }
      }

      // Progress
      const currentFrame = batchEnd;
      if (currentFrame % 30 === 0 || currentFrame === totalRenderFrames) {
        const elapsed = (Date.now() - startTime) / 1000;
        const fps_actual = currentFrame / elapsed;
        const eta = (totalRenderFrames - currentFrame) / fps_actual;
        process.stdout.write(
          `\rFrame ${currentFrame}/${totalRenderFrames} (${((currentFrame / totalRenderFrames) * 100).toFixed(1)}%) - ${fps_actual.toFixed(1)} fps - ETA: ${eta.toFixed(0)}s   `
        );
      }
    }

    // Flush WebCodecs encoder
    if (useWebCodecs) {
      const remainingChunks = await page.evaluate(async () => {
        const chunks = await (window as any).__headless.flushEncoder();
        return chunks.map((chunk: Uint8Array) => Array.from(chunk));
      });
      for (const chunk of remainingChunks) {
        if (chunk && chunk.length > 0) {
          encoder.stdin.write(Buffer.from(chunk as number[]));
        }
      }
    }

    console.log('\n\nFinalizing...');
    encoder.stdin.end();
    await encoder.promise;

    await browser.close();
    frameServer.close();

    console.log(`Done! Output: ${outputPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function renderProcedural(args: CLIArgs): Promise<void> {
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  const fps = args.fps ?? 60;
  const duration = args.duration ?? 30;
  const totalFrames = Math.ceil(duration * fps);

  console.log(`Render settings:`);
  console.log(`  Resolution: ${width}x${height}`);
  console.log(`  FPS: ${fps}`);
  console.log(`  Duration: ${duration}s`);
  console.log(`  Total frames: ${totalFrames}`);
  if (args.seed !== undefined) console.log(`  Seed: ${args.seed}`);
  if (args.palette) console.log(`  Palette: ${args.palette}`);
  if (args.template) console.log(`  Template: ${args.template}`);

  // Launch browser with GPU acceleration
  console.log(`\nLaunching browser with GPU acceleration...`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer',
      '--enable-features=WebCodecs,WebCodecsEncoder',
    ],
  });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Build URL with params
  const appUrl = buildURL('http://localhost:5173', args, 'render');
  console.log(`Loading: ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for headless API to be ready
  await page.waitForFunction(() => (window as any).__headless?.ready, { timeout: 30000 });
  console.log('Headless API ready');

  // Initialize WebCodecs encoder
  let useWebCodecs = false;
  try {
    await page.evaluate(async ({ w, h, f }: { w: number; h: number; f: number }) => {
      await (window as any).__headless.initEncoder(w, h, f);
    }, { w: width, h: height, f: fps });
    useWebCodecs = true;
    console.log('WebCodecs H.264 encoder initialized (GPU-accelerated)');
  } catch (e) {
    console.log('WebCodecs not available, falling back to JPEG capture');
  }

  // Create muxer/encoder
  const outputPath = resolve(args.output!);
  console.log(`\nEncoding to: ${outputPath}`);
  const encoder = useWebCodecs
    ? createH264Muxer(outputPath, width, height, fps)
    : createEncoder(outputPath, width, height, fps);

  const dt = 1 / fps;
  const BATCH_SIZE = 30; // Render 30 frames per round-trip

  // Render loop with batching
  const startTime = Date.now();
  for (let batchStart = 1; batchStart <= totalFrames; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalFrames);
    const batchCount = batchEnd - batchStart + 1;

    if (useWebCodecs) {
      // Batch render with WebCodecs
      const chunks = await page.evaluate(async ({ count, dt }: { count: number; dt: number }) => {
        const h = (window as any).__headless;
        const results: number[][] = [];
        for (let i = 0; i < count; i++) {
          h.step(dt);
          const chunk = await h.encodeFrame();
          if (chunk) results.push(Array.from(chunk));
        }
        return results;
      }, { count: batchCount, dt });

      for (const chunk of chunks) {
        if (chunk && chunk.length > 0) {
          encoder.stdin.write(Buffer.from(chunk));
        }
      }
    } else {
      // Batch render with JPEG capture
      const frames = await page.evaluate(async ({ count, dt }: { count: number; dt: number }) => {
        const h = (window as any).__headless;
        const results: string[] = [];
        for (let i = 0; i < count; i++) {
          h.step(dt);
          results.push(h.capture());
        }
        return results;
      }, { count: batchCount, dt });

      for (const base64 of frames) {
        const jpegBuffer = Buffer.from(base64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
        encoder.stdin.write(jpegBuffer);
      }
    }

    // Progress
    if (batchEnd % 30 === 0 || batchEnd === totalFrames) {
      const elapsed = (Date.now() - startTime) / 1000;
      const fps_actual = batchEnd / elapsed;
      const eta = (totalFrames - batchEnd) / fps_actual;
      process.stdout.write(
        `\rFrame ${batchEnd}/${totalFrames} (${((batchEnd / totalFrames) * 100).toFixed(1)}%) - ${fps_actual.toFixed(1)} fps - ETA: ${eta.toFixed(0)}s   `
      );
    }
  }

  // Flush WebCodecs encoder
  if (useWebCodecs) {
    const remainingChunks = await page.evaluate(async () => {
      const chunks = await (window as any).__headless.flushEncoder();
      return chunks.map((chunk: Uint8Array) => Array.from(chunk));
    });
    for (const chunk of remainingChunks) {
      if (chunk && chunk.length > 0) {
        encoder.stdin.write(Buffer.from(chunk as number[]));
      }
    }
  }

  console.log('\n\nFinalizing...');
  encoder.stdin.end();
  await encoder.promise;

  await browser.close();

  console.log(`Done! Output: ${outputPath}`);
}

async function main(): Promise<void> {
  const args = parseArguments();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.output) {
    console.error('Error: --output is required');
    printUsage();
    process.exit(1);
  }

  if (args.process && args.render) {
    console.error('Error: Cannot use both --process and --render');
    process.exit(1);
  }

  if (!args.process && !args.render) {
    console.error('Error: Must specify either --process or --render');
    printUsage();
    process.exit(1);
  }

  try {
    if (args.process) {
      await processVideo(args);
    } else {
      await renderProcedural(args);
    }
  } catch (err) {
    console.error('\nError:', (err as Error).message);
    process.exit(1);
  }
}

main();
