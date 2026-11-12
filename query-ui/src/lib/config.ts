/** Where queries can be sent. Read from query-ui.config.json next to the page, so a deployment sets it without a rebuild. */
export interface Target {
  name: string;
  /** The server that forwards the Statement Execution API; empty for the one that served this page. */
  host: string;
  warehouseId: string;
  catalog?: string;
  schema?: string;
}

export const FALLBACK_TARGETS: Target[] = [{ name: 'Demo data', host: '', warehouseId: 'demo' }];

export function parseTargets(json: unknown): Target[] {
  const list = (json as { targets?: unknown })?.targets;
  if (!Array.isArray(list)) return FALLBACK_TARGETS;
  const targets = list.filter((t): t is Target =>
    typeof t === 'object' && t !== null && typeof (t as Target).name === 'string' && typeof (t as Target).warehouseId === 'string');
  return targets.length > 0 ? targets.map(t => ({ ...t, host: typeof t.host === 'string' ? t.host : '' })) : FALLBACK_TARGETS;
}

export async function loadTargets(): Promise<Target[]> {
  try {
    const response = await fetch('query-ui.config.json', { cache: 'no-cache' });
    return response.ok ? parseTargets(await response.json()) : FALLBACK_TARGETS;
  } catch {
    return FALLBACK_TARGETS;
  }
}
