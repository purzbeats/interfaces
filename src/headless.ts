/**
 * Headless rendering mode for CLI video processing.
 * Exposes window.__headless API for frame-by-frame control from Playwright.
 */

import type { Engine } from './engine';

export interface HeadlessAPI {
  ready: boolean;
  /** Initialize tiled layout for video processing */
  initTiles(mediaWidth: number, mediaHeight: number): Promise<void>;
  /** Get the maximum frame offset (for calculating total render frames) */
  getMaxFrameOffset(): number;
  /** Get all tile frame offsets */
  getTileOffsets(): number[];
  /** Load frames with per-tile offsets. frameDataUrls is a map of frameNum -> dataUrl */
  loadFrames(frameDataUrls: Record<number, string>, globalFrame: number): Promise<void>;
  /** Step simulation by dt seconds */
  step(dt: number): void;
  /** Capture current canvas as PNG data URL */
  capture(): string;
  /** Capture raw RGBA pixels (much faster - returns Uint8Array) */
  captureRaw(): Uint8Array;
  /** Initialize WebCodecs encoder for GPU-accelerated H.264 encoding */
  initEncoder(width: number, height: number, fps: number): Promise<void>;
  /** Encode current frame using WebCodecs (returns encoded H.264 chunk) */
  encodeFrame(): Promise<Uint8Array | null>;
  /** Flush encoder and get remaining frames */
  flushEncoder(): Promise<Uint8Array[]>;
  /** Render a batch of frames and return encoded chunks */
  renderBatch(frames: Array<{ frameDataUrls: Record<number, string>; globalFrame: number }>, dt: number): Promise<Uint8Array[]>;
  /** Render batch using HTTP frame server (faster - no base64 overhead) */
  renderBatchHttp(
    frameServerUrl: string,
    globalFrames: number[],
    extractedCount: number,
    dt: number,
  ): Promise<Uint8Array[]>;
}

declare global {
  interface Window {
    __headless?: HeadlessAPI;
  }
}

/** Check if we're in headless mode (via URL param) */
export function isHeadlessMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('headless') === '1';
}

/** Get headless configuration from URL params */
export function getHeadlessConfig(): {
  mode: 'process' | 'render';
  width: number;
  height: number;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('mode') === 'media' ? 'process' : 'render',
    width: parseInt(params.get('width') || '1920', 10),
    height: parseInt(params.get('height') || '1080', 10),
  };
}

/**
 * Initialize headless mode - called from main.ts when headless=1
 * Returns false if normal RAF loop should run, true if headless takes over.
 */
export function initHeadless(
  engine: Engine,
  getCanvas: () => HTMLCanvasElement,
): boolean {
  if (!isHeadlessMode()) {
    return false;
  }

  const config = getHeadlessConfig();

  // Cache loaded images by frame number
  const imageCache: Map<number, HTMLImageElement> = new Map();

  // WebCodecs encoder state
  let videoEncoder: VideoEncoder | null = null;
  let encodedChunks: Uint8Array[] = [];
  let frameIndex = 0;

  const api: HeadlessAPI = {
    ready: false,

    async initTiles(mediaWidth: number, mediaHeight: number): Promise<void> {
      if (config.mode !== 'process') {
        throw new Error('initTiles only available in process mode');
      }
      console.log(`[headless] initTiles: ${mediaWidth}x${mediaHeight}`);
      await engine.mediaMode.initHeadlessTiles(mediaWidth, mediaHeight);
      console.log(`[headless] tiles created, maxOffset: ${engine.mediaMode.getMaxFrameOffset()}`);
    },

    getMaxFrameOffset(): number {
      return engine.mediaMode.getMaxFrameOffset();
    },

    getTileOffsets(): number[] {
      return engine.mediaMode.getTileOffsets();
    },

    async loadFrames(frameDataUrls: Record<number, string>, globalFrame: number): Promise<void> {
      if (config.mode !== 'process') {
        throw new Error('loadFrames only available in process mode');
      }

      const frameNums = Object.keys(frameDataUrls).map(Number);
      if (globalFrame === 1 || globalFrame % 60 === 0) {
        console.log(`[headless] loadFrames: globalFrame=${globalFrame}, frames=[${frameNums.join(',')}], cacheSize=${imageCache.size}`);
      }

      // Load any new frames into cache
      const loadPromises: Promise<void>[] = [];
      for (const [frameNumStr, dataUrl] of Object.entries(frameDataUrls)) {
        const frameNum = parseInt(frameNumStr, 10);
        if (!imageCache.has(frameNum)) {
          loadPromises.push(new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              imageCache.set(frameNum, img);
              if (globalFrame === 1 || globalFrame % 60 === 0) {
                console.log(`[headless] loaded image for frame ${frameNum}: ${img.width}x${img.height}`);
              }
              resolve();
            };
            img.onerror = () => reject(new Error(`Failed to load frame ${frameNum}`));
            img.src = dataUrl;
          }));
        }
      }
      await Promise.all(loadPromises);

      // Update tiles with appropriate frames based on their offsets
      const getFrame = (frameNum: number): HTMLImageElement | null => {
        return imageCache.get(frameNum) ?? null;
      };

      await engine.mediaMode.loadHeadlessFrames(getFrame, globalFrame);

      // Clean up old frames from cache (only keep frames that tiles still need)
      // Tiles need frames from (globalFrame - maxOffset) to globalFrame
      const offsets = engine.mediaMode.getTileOffsets();
      const minNeeded = globalFrame - Math.max(...offsets) - 1;
      for (const key of imageCache.keys()) {
        if (key < minNeeded) {
          imageCache.delete(key);
        }
      }
    },

    step(dt: number): void {
      engine.update(dt);
      engine.render();
    },

    capture(): string {
      const canvas = getCanvas();
      // JPEG is much faster to encode than PNG
      return canvas.toDataURL('image/jpeg', 0.95);
    },

    captureRaw(): Uint8Array {
      const canvas = getCanvas();
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        throw new Error('WebGL context not available');
      }
      const w = canvas.width;
      const h = canvas.height;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    },

    async initEncoder(width: number, height: number, fps: number): Promise<void> {
      if (!('VideoEncoder' in window)) {
        throw new Error('WebCodecs not supported');
      }

      encodedChunks = [];
      frameIndex = 0;

      const config: VideoEncoderConfig = {
        codec: 'avc1.640028', // H.264 High Profile Level 4.0
        width,
        height,
        bitrate: 10_000_000, // 10 Mbps
        framerate: fps,
        hardwareAcceleration: 'prefer-hardware',
        avc: { format: 'annexb' }, // Raw H.264 NAL units
      };

      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error('H.264 encoding not supported');
      }

      videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          encodedChunks.push(data);
        },
        error: (e) => console.error('Encoder error:', e),
      });

      videoEncoder.configure(config);
      console.log('[headless] WebCodecs encoder initialized:', width, 'x', height, '@', fps, 'fps');
    },

    async encodeFrame(): Promise<Uint8Array | null> {
      if (!videoEncoder) throw new Error('Encoder not initialized');

      const canvas = getCanvas();
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * (1_000_000 / 60), // microseconds
      });

      const keyFrame = frameIndex % 30 === 0; // Keyframe every 30 frames
      videoEncoder.encode(frame, { keyFrame });
      frame.close();
      frameIndex++;

      // Return any completed chunks
      if (encodedChunks.length > 0) {
        const chunks = encodedChunks;
        encodedChunks = [];
        // Concatenate all chunks
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      }
      return null;
    },

    async flushEncoder(): Promise<Uint8Array[]> {
      if (!videoEncoder) return [];
      await videoEncoder.flush();
      const result = encodedChunks;
      encodedChunks = [];
      return result;
    },

    async renderBatch(
      frames: Array<{ frameDataUrls: Record<number, string>; globalFrame: number }>,
      dt: number,
    ): Promise<Uint8Array[]> {
      const results: Uint8Array[] = [];

      for (const { frameDataUrls, globalFrame } of frames) {
        // Load frames into cache
        const loadPromises: Promise<void>[] = [];
        for (const [frameNumStr, dataUrl] of Object.entries(frameDataUrls)) {
          const frameNum = parseInt(frameNumStr, 10);
          if (!imageCache.has(frameNum)) {
            loadPromises.push(new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                imageCache.set(frameNum, img);
                resolve();
              };
              img.onerror = () => reject(new Error(`Failed to load frame ${frameNum}`));
              img.src = dataUrl;
            }));
          }
        }
        await Promise.all(loadPromises);

        // Update tiles
        const getFrame = (frameNum: number): HTMLImageElement | null => {
          return imageCache.get(frameNum) ?? null;
        };
        await engine.mediaMode.loadHeadlessFrames(getFrame, globalFrame);

        // Step and render
        engine.update(dt);
        engine.render();

        // Encode frame
        if (videoEncoder) {
          const chunk = await api.encodeFrame();
          if (chunk) results.push(chunk);
        }
      }

      // Clean up old frames from image cache
      if (frames.length > 0) {
        const lastFrame = frames[frames.length - 1].globalFrame;
        const offsets = engine.mediaMode.getTileOffsets();
        const minNeeded = lastFrame - Math.max(...offsets) - 1;
        for (const key of imageCache.keys()) {
          if (key < minNeeded) {
            imageCache.delete(key);
          }
        }
      }

      return results;
    },

    async renderBatchHttp(
      frameServerUrl: string,
      globalFrames: number[],
      extractedCount: number,
      dt: number,
    ): Promise<Uint8Array[]> {
      const results: Uint8Array[] = [];
      const offsets = engine.mediaMode.getTileOffsets();

      for (const globalFrame of globalFrames) {
        // Calculate which frames each tile needs
        const neededFrames = new Set<number>();
        for (const offset of offsets) {
          const tileFrame = globalFrame - offset;
          if (tileFrame >= 1 && tileFrame <= extractedCount) {
            neededFrames.add(tileFrame);
          }
        }

        // Load frames via HTTP as HTMLImageElement
        const loadPromises: Promise<void>[] = [];
        for (const frameNum of neededFrames) {
          if (!imageCache.has(frameNum)) {
            loadPromises.push(new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                imageCache.set(frameNum, img);
                resolve();
              };
              img.onerror = () => reject(new Error(`Failed to load frame ${frameNum}`));
              img.src = `${frameServerUrl}/${frameNum}`;
            }));
          }
        }
        await Promise.all(loadPromises);

        // Update tiles
        const getFrame = (frameNum: number): HTMLImageElement | null => {
          return imageCache.get(frameNum) ?? null;
        };
        await engine.mediaMode.loadHeadlessFrames(getFrame, globalFrame);

        // Step and render
        engine.update(dt);
        engine.render();

        // Encode frame
        if (videoEncoder) {
          const chunk = await api.encodeFrame();
          if (chunk) results.push(chunk);
        }
      }

      // Clean up old images from cache
      if (globalFrames.length > 0) {
        const lastFrame = globalFrames[globalFrames.length - 1];
        const minNeeded = lastFrame - Math.max(...offsets) - 1;
        for (const key of imageCache.keys()) {
          if (key < minNeeded) {
            imageCache.delete(key);
          }
        }
      }

      return results;
    },
  };

  // Expose API globally for Playwright
  window.__headless = api;

  // Force canvas to exact size from URL params (bypasses window.innerWidth/innerHeight)
  engine.forceSize(config.width, config.height);

  // Initialize based on mode
  setTimeout(async () => {
    if (config.mode === 'process') {
      // Enter media mode for video processing (headless=true skips UI)
      engine.mediaMode.enter(true);
    }
    // Initial render to set up the scene
    engine.update(0);
    engine.render();
    api.ready = true;
  }, 100);

  // Return true to indicate headless mode is active (skip RAF loop)
  return true;
}
