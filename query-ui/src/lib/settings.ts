/** What a person can set once and keep: it is remembered in the browser. */
export interface Settings {
  /** How many joins from the start class the tree offers. */
  maxDepth: number;
  /** The most rows a query asks for. */
  rowLimit: number;
}

export const DEFAULT_SETTINGS: Settings = { maxDepth: 3, rowLimit: 1000 };
export const MAX_DEPTH_RANGE = { min: 1, max: 6 };
export const ROW_LIMIT_RANGE = { min: 1, max: 100000 };
const KEY = 'data-finder-query-ui.settings';

const clamp = (value: unknown, range: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value))) : fallback;

/** Settings from whatever was stored, with anything missing or out of range replaced. */
export function normalizeSettings(stored: unknown): Settings {
  const s = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    maxDepth: clamp(s.maxDepth, MAX_DEPTH_RANGE, DEFAULT_SETTINGS.maxDepth),
    rowLimit: clamp(s.rowLimit, ROW_LIMIT_RANGE, DEFAULT_SETTINGS.rowLimit),
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return normalizeSettings(text === null ? undefined : JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* the page works without it */ }
}
