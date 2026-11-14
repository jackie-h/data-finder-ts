/**
 * The mappings the app offers: every folder under src/mappings (what `npm run generate` writes), each with its metadata and
 * context. `data-finder-query-ui build` replaces this file with one that imports the folders of the mappings it is given.
 */
import type { MappingMetadata } from 'data-finder-ts';
import { loadMappingEntries, type MappingEntry } from './mappings';

const metadataModules = import.meta.glob<Record<string, MappingMetadata>>('../mappings/*/*Metadata.ts', { eager: true });
const contextModules = import.meta.glob<Record<string, new () => object>>('../mappings/*/*Context.ts', { eager: true });

export function loadMappings(): MappingEntry[] {
  return loadMappingEntries(metadataModules, contextModules);
}
