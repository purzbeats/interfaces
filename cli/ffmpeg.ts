import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
}

/** Probe video file for metadata using ffprobe */
export async function probeVideo(inputPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames',
      '-of', 'json',
      inputPath,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }

      try {
        const json = JSON.parse(stdout);
        const stream = json.streams?.[0];
        if (!stream) {
          reject(new Error('No video stream found'));
          return;
        }

        // Parse frame rate (e.g., "30/1" or "30000/1001")
        const [num, den] = stream.r_frame_rate.split('/').map(Number);
        const fps = num / den;

        // Duration might be in stream or need to be calculated
        let duration = parseFloat(stream.duration);
        if (isNaN(duration)) {
          // Fallback: probe container duration
          duration = 0;
        }

        // Frame count might be explicit or calculated
        let frameCount = parseInt(stream.nb_frames, 10);
        if (isNaN(frameCount) && duration > 0) {
          frameCount = Math.ceil(duration * fps);
        }

        resolve({
          width: stream.width,
          height: stream.height,
          fps,
          duration,
          frameCount,
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffprobe not found. Is FFmpeg installed? ${err.message}`));
    });
  });
}

/** Extract all frames from video to a directory as PNGs */
export async function extractFrames(
  inputPath: string,
  outputDir: string,
  fps: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vf', `fps=${fps}`,
      '-start_number', '1',
      join(outputDir, 'frame_%06d.png'),
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data;
      // Parse progress from stderr if needed
      const match = stderr.match(/frame=\s*(\d+)/);
      if (match) {
        process.stdout.write(`\rExtracting frames: ${match[1]}...`);
      }
    });

    proc.on('close', (code) => {
      process.stdout.write('\n');
      if (code !== 0) {
        reject(new Error(`ffmpeg extract failed: ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Is FFmpeg installed? ${err.message}`));
    });
  });
}

/** Count extracted frames in directory */
export async function countFrames(dir: string): Promise<number> {
  const files = await readdir(dir);
  return files.filter(f => f.startsWith('frame_') && f.endsWith('.png')).length;
}

/** Get frame path for a given index (1-based) */
export function framePath(dir: string, index: number): string {
  return join(dir, `frame_${String(index).padStart(6, '0')}.png`);
}

export interface Encoder {
  stdin: Writable;
  process: ChildProcess;
  promise: Promise<void>;
}

/** Create FFmpeg encoder that reads raw PNG frames from stdin */
export function createEncoder(
  outputPath: string,
  width: number,
  height: number,
  fps: number,
): Encoder {
  const args = [
    '-y',                          // Overwrite output
    '-f', 'image2pipe',            // Input is piped images
    '-framerate', String(fps),
    '-i', '-',                     // Read from stdin
    '-c:v', 'libx264',             // H.264 codec
    '-preset', 'medium',           // Encoding speed/quality tradeoff
    '-crf', '18',                  // Quality (lower = better, 18-23 is good)
    '-pix_fmt', 'yuv420p',         // Compatibility
    '-movflags', '+faststart',     // Web-friendly
    outputPath,
  ];

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (data) => { stderr += data; });

  const promise = new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg encode failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Is FFmpeg installed? ${err.message}`));
    });
  });

  return {
    stdin: proc.stdin!,
    process: proc,
    promise,
  };
}

/** Create FFmpeg encoder that reads raw RGBA pixel data (much faster - no PNG encoding) */
export function createRawEncoder(
  outputPath: string,
  width: number,
  height: number,
  fps: number,
): Encoder {
  const args = [
    '-y',                          // Overwrite output
    '-f', 'rawvideo',              // Raw pixel input
    '-pix_fmt', 'rgba',            // RGBA format from WebGL
    '-s', `${width}x${height}`,    // Frame size
    '-r', String(fps),             // Input frame rate
    '-i', '-',                     // Read from stdin
    '-vf', 'vflip',                // WebGL is upside-down
    '-c:v', 'libx264',             // H.264 codec
    '-preset', 'fast',             // Faster encoding
    '-crf', '18',                  // Quality
    '-pix_fmt', 'yuv420p',         // Output pixel format
    '-movflags', '+faststart',     // Web-friendly
    outputPath,
  ];

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (data) => { stderr += data; });

  const promise = new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg encode failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Is FFmpeg installed? ${err.message}`));
    });
  });

  return {
    stdin: proc.stdin!,
    process: proc,
    promise,
  };
}

/** Create FFmpeg muxer for raw H.264 Annex B stream (from WebCodecs) */
export function createH264Muxer(
  outputPath: string,
  width: number,
  height: number,
  fps: number,
): Encoder {
  const args = [
    '-y',                          // Overwrite output
    '-f', 'h264',                  // Input is raw H.264 Annex B
    '-r', String(fps),             // Input frame rate
    '-i', '-',                     // Read from stdin
    '-c:v', 'copy',                // No re-encoding, just mux
    '-r', String(fps),             // Output frame rate
    '-movflags', '+faststart',     // Web-friendly
    outputPath,
  ];

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (data) => { stderr += data; });

  const promise = new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg mux failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Is FFmpeg installed? ${err.message}`));
    });
  });

  return {
    stdin: proc.stdin!,
    process: proc,
    promise,
  };
}

/** Read a frame file as Buffer */
export async function readFrameBuffer(framePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(framePath);
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
