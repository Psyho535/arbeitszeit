import { createStore, get, set } from 'idb-keyval';
import { DEFAULT_SETTINGS, Entry, Settings } from './core';

const db = createStore('arbeitszeit', 'data');

export interface AppData {
  version: 1;
  settings: Settings;
  entries: Record<string, Entry>;
}

export async function load(): Promise<AppData> {
  try {
    const [settings, entries] = await Promise.all([get<Settings>('settings', db), get<Record<string, Entry>>('entries', db)]);
    return { version: 1, settings: { ...DEFAULT_SETTINGS, ...settings }, entries: entries ?? {} };
  } catch {
    return { version: 1, settings: { ...DEFAULT_SETTINGS }, entries: {} };
  }
}

export async function save(data: AppData): Promise<void> {
  await Promise.all([set('settings', data.settings, db), set('entries', data.entries, db)]);
  // Speicher vor automatischem Aufräumen durch den Browser schützen
  navigator.storage?.persist?.().catch(() => {});
}

export function exportJSON(data: AppData): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function parseImport(text: string): AppData {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || typeof raw.entries !== 'object') throw new Error('Keine gültige Sicherung');
  return { version: 1, settings: { ...DEFAULT_SETTINGS, ...raw.settings }, entries: raw.entries };
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
