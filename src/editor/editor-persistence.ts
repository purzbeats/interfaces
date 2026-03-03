import type { EditorLayout } from './editor-layout';

const STORAGE_KEY = 'interfaces-editor-layouts';

export interface SavedEditorLayouts {
  layouts: EditorLayout[];
  lastActiveIndex: number;
}

/** Save all editor layouts to localStorage. */
export function saveEditorLayouts(data: SavedEditorLayouts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

/** Load saved editor layouts from localStorage. */
export function loadEditorLayouts(): SavedEditorLayouts | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedEditorLayouts;
    if (!Array.isArray(data.layouts)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Export a single layout as a JSON string. */
export function exportLayoutJSON(layout: EditorLayout): string {
  return JSON.stringify(layout, null, 2);
}

/** Import a layout from a JSON string. Returns null if invalid. */
export function importLayoutJSON(json: string): EditorLayout | null {
  try {
    const data = JSON.parse(json);
    if (!data.name || !Array.isArray(data.regions)) return null;
    return data as EditorLayout;
  } catch {
    return null;
  }
}

/** Trigger a file download with the given content. */
export function downloadJSON(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker and read the selected JSON file. Returns the text content. */
export function pickJSONFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
