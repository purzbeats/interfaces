/**
 * Media library with IndexedDB-backed blob storage.
 * Metadata (thumbnails, dimensions) in localStorage; raw file blobs in IndexedDB.
 * Files are stored as Blobs (not base64) to minimize storage overhead.
 * Object URLs are created on demand for playback/display.
 */

const STORAGE_KEY = 'interfaces-media-library';
const DB_NAME = 'interfaces-media';
const DB_STORE = 'blobs';
const DB_VERSION = 1;
const THUMB_SIZE = 128;

export interface MediaItem {
  id: string;
  name: string;
  type: 'image' | 'video';
  mimeType: string;
  thumbUrl: string;
  width: number;
  height: number;
  addedAt: number;
}

export interface MediaLibrary {
  items: MediaItem[];
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(blob, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result as Blob | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function deleteBlob(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearBlobs(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// --- Metadata (localStorage) ---

export function loadLibrary(): MediaLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}

function saveMetadata(lib: MediaLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    console.warn('Failed to save media metadata to localStorage');
  }
}

// --- Object URL management ---

const activeObjectUrls = new Map<string, string>();

/** Get an object URL for a media item's blob. Caller must call revokeObjectUrl when done. */
export async function getObjectUrl(id: string): Promise<string | undefined> {
  // Return cached URL if still active
  const existing = activeObjectUrls.get(id);
  if (existing) return existing;

  const blob = await getBlob(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  activeObjectUrls.set(id, url);
  return url;
}

/** Revoke an object URL to free memory. */
export function revokeObjectUrl(id: string): void {
  const url = activeObjectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    activeObjectUrls.delete(id);
  }
}

/** Revoke all active object URLs. */
export function revokeAllObjectUrls(): void {
  for (const [id, url] of activeObjectUrls) {
    URL.revokeObjectURL(url);
  }
  activeObjectUrls.clear();
}

// --- Thumbnail ---

function generateThumbnail(
  source: HTMLImageElement | HTMLVideoElement,
  srcWidth: number,
  srcHeight: number,
): string {
  const canvas = document.createElement('canvas');
  const aspect = srcWidth / srcHeight;
  if (aspect >= 1) {
    canvas.width = THUMB_SIZE;
    canvas.height = Math.max(1, Math.round(THUMB_SIZE / aspect));
  } else {
    canvas.height = THUMB_SIZE;
    canvas.width = Math.max(1, Math.round(THUMB_SIZE * aspect));
  }
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

// --- Public API ---

/** Add a file (from <input> or drop) to the library. Returns the new item. */
export function addFile(file: File): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const id = genId();
    const isVideo = file.type.startsWith('video/');

    // Store the raw file blob in IndexedDB (no base64 conversion)
    putBlob(id, file).then(() => {
      const objectUrl = URL.createObjectURL(file);

      if (isVideo) {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'metadata';
        video.onloadeddata = () => { video.currentTime = 0.1; };
        video.onseeked = () => {
          const item: MediaItem = {
            id,
            name: file.name,
            type: 'video',
            mimeType: file.type,
            thumbUrl: generateThumbnail(video, video.videoWidth, video.videoHeight),
            width: video.videoWidth,
            height: video.videoHeight,
            addedAt: Date.now(),
          };
          URL.revokeObjectURL(objectUrl);
          const lib = loadLibrary();
          lib.items.push(item);
          saveMetadata(lib);
          resolve(item);
        };
        video.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Failed to load video'));
        };
        video.src = objectUrl;
      } else {
        const img = new Image();
        img.onload = () => {
          const item: MediaItem = {
            id,
            name: file.name,
            type: 'image',
            mimeType: file.type,
            thumbUrl: generateThumbnail(img, img.width, img.height),
            width: img.width,
            height: img.height,
            addedAt: Date.now(),
          };
          URL.revokeObjectURL(objectUrl);
          const lib = loadLibrary();
          lib.items.push(item);
          saveMetadata(lib);
          resolve(item);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Failed to load image'));
        };
        img.src = objectUrl;
      }
    }).catch(reject);
  });
}

/** Remove an item from the library by ID. */
export async function removeItem(id: string): Promise<void> {
  revokeObjectUrl(id);
  const lib = loadLibrary();
  lib.items = lib.items.filter(i => i.id !== id);
  saveMetadata(lib);
  await deleteBlob(id).catch(() => {});
}

/** Clear entire library. */
export async function clearLibrary(): Promise<void> {
  revokeAllObjectUrls();
  saveMetadata({ items: [] });
  await clearBlobs().catch(() => {});
}
