/** The mappings the UI offers: every folder the generator wrote under src/mappings, with its metadata and finders. */
import type { MappingMetadata } from '@datafinder';

export interface MappingEntry {
  key: string;
  metadata: MappingMetadata;
  /** A finder for each class, by class name. */
  finders: () => Record<string, unknown>;
}

const metadataModules = import.meta.glob<Record<string, MappingMetadata>>('../mappings/*/*Metadata.ts', { eager: true });
const contextModules = import.meta.glob<Record<string, new () => Record<string, unknown>>>('../mappings/*/*Context.ts', { eager: true });

const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

export function loadMappings(): MappingEntry[] {
  const entries: MappingEntry[] = [];
  for (const [path, module] of Object.entries(metadataModules)) {
    const metadata = Object.values(module)[0];
    const folder = path.split('/').slice(-2, -1)[0];
    const contextPath = Object.keys(contextModules).find(p => p.startsWith(`../mappings/${folder}/`));
    if (metadata === undefined || contextPath === undefined) continue;
    const Context = (contextModules[contextPath] as Record<string, new () => Record<string, unknown>>)[metadata.context];
    entries.push({
      key: folder,
      metadata,
      finders: () => {
        const context = new Context();
        return Object.fromEntries(metadata.classes.map(c => [c.name, context[lowerFirst(c.name)]]));
      },
    });
  }
  return entries.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}
