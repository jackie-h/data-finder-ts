/** What the UI offers for a mapping, and how to make one from the files the generator writes. */
import type { MappingMetadata } from 'data-finder-ts';

export interface MappingEntry {
  key: string;
  metadata: MappingMetadata;
  /** A finder for each class, by class name. */
  finders: () => Record<string, unknown>;
}

const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * A mapping the UI can query, from its generated `<Mapping>Metadata.ts` and `<Mapping>Context.ts`:
 *
 *     mappingEntry('finance', FinanceMappingMetadata, FinanceMappingContext)
 *
 * The finders are made again for each query on purpose: a query's joins belong to the finder that made them.
 */
export function mappingEntry(key: string, metadata: MappingMetadata, Context: new () => object): MappingEntry {
  return {
    key,
    metadata,
    finders: () => {
      const context = new Context() as Record<string, unknown>;
      return Object.fromEntries(metadata.classes.map(c => [c.name, context[lowerFirst(c.name)]]));
    },
  };
}

type MetadataModules = Record<string, Record<string, MappingMetadata>>;
type ContextModules = Record<string, Record<string, new () => object>>;

/**
 * The mappings in the modules the generator wrote: for each folder, its `<Mapping>Metadata.ts` and `<Mapping>Context.ts`, keyed by
 * a path whose second to last part is the folder. The app finds them with `import.meta.glob` (src/lib/app-mappings.ts), and
 * `data-finder-query-ui build` writes that file again with an import for each of the user's mappings.
 */
export function loadMappingEntries(metadataModules: MetadataModules, contextModules: ContextModules): MappingEntry[] {
  const folderOf = (path: string): string | undefined => path.split('/').slice(-2, -1)[0];
  const entries: MappingEntry[] = [];
  for (const [path, module] of Object.entries(metadataModules)) {
    const metadata = Object.values(module)[0];
    const folder = folderOf(path);
    const contextPath = Object.keys(contextModules).find(p => folderOf(p) === folder);
    if (metadata === undefined || folder === undefined || contextPath === undefined) continue;
    const Context = contextModules[contextPath][metadata.context];
    if (Context === undefined) continue;
    entries.push(mappingEntry(folder, metadata, Context));
  }
  return entries.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}
