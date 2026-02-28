export function takeScreenshot(canvas: HTMLCanvasElement, filename: string = 'interfaces'): void {
  const link = document.createElement('a');
  link.download = `${filename}-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function detectMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm'; // fallback
}

export interface VideoRecorder {
  isRecording: boolean;
  start(): void;
  stop(): void;
}

export function createVideoRecorder(canvas: HTMLCanvasElement, fps: number = 60): VideoRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let isRecording = false;

  return {
    get isRecording() { return isRecording; },

    start() {
      if (isRecording) return;
      chunks = [];

      const mimeType = detectMimeType();
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const stream = canvas.captureStream(fps);

      try {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
        });
      } catch {
        // Fallback without specifying mimeType
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `interfaces-${Date.now()}.${ext}`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      };
      mediaRecorder.start();
      isRecording = true;
    },

    stop() {
      if (!isRecording || !mediaRecorder) return;
      mediaRecorder.stop();
      isRecording = false;
    },
  };
}
