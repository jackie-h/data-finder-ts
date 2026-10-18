import type { Attribute } from './attribute';

/**
 * Join-less alternates for a related class's properties, keyed by dotted property path relative to
 * that class (e.g. `name`, `branch.city`). The attributes point at flat columns on the owning table.
 */
export type EmbeddedAttributes = Record<string, Attribute>;

/** The alternates under `prefix` (e.g. `branch.`), re-keyed relative to it; undefined when there are none. */
export function embeddedUnder(embedded: EmbeddedAttributes | undefined, prefix: string): EmbeddedAttributes | undefined {
  if (!embedded) return undefined;
  const result: EmbeddedAttributes = {};
  for (const [key, attr] of Object.entries(embedded)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = attr;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
