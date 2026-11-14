// `data-finder-query-ui build`: the query page, built against the user's own mappings and data-finder-ts.
//
// The app's source is copied into a folder of the user's project for the build, so React, AG Grid, DuckDB-wasm and data-finder-ts
// all resolve from the user's node_modules (one copy of each). The generated finders import the library through the aliases
// `@datafinder/*` and `@model/*`; they are pointed at data-finder-ts's published modules. src/lib/app-mappings.ts is written
// again with an import for each of the user's mappings.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The folders of `dir` that hold a generated mapping: a `*Metadata.ts` and a `*Context.ts`. */
export async function findMappings(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(dir, entry.name));
    if (files.some(f => f.endsWith('Metadata.ts')) && files.some(f => f.endsWith('Context.ts'))) found.push(entry.name);
  }
  return found.sort();
}

/** src/lib/app-mappings.ts for these mappings: an import of the metadata and the context of each, where the repository's finds them with a glob. */
export async function appMappingsSource(mappingsDir, names, from) {
  const imports = [];
  const metadata = [];
  const contexts = [];
  for (const [i, name] of names.entries()) {
    const files = await readdir(join(mappingsDir, name));
    const metadataFile = files.find(f => f.endsWith('Metadata.ts'));
    const contextFile = files.find(f => f.endsWith('Context.ts'));
    const specifier = file => relative(from, join(mappingsDir, name, file)).split(sep).join('/').replace(/\.ts$/, '');
    imports.push(`import * as metadata${i} from ${JSON.stringify(specifier(metadataFile))};`, `import * as context${i} from ${JSON.stringify(specifier(contextFile))};`);
    metadata.push(`  ${JSON.stringify(`${name}/${metadataFile}`)}: metadata${i},`);
    contexts.push(`  ${JSON.stringify(`${name}/${contextFile}`)}: context${i},`);
  }
  return `// Written by data-finder-query-ui build.
import { loadMappingEntries, type MappingEntry } from './mappings';
${imports.join('\n')}

export function loadMappings(): MappingEntry[] {
  return loadMappingEntries({
${metadata.join('\n')}
  } as never, {
${contexts.join('\n')}
  } as never);
}
`;
}

/**
 * Build the page for the mappings in `mappings` (a folder with one folder for each generated mapping) into `out`.
 * `config` is the query-ui.config.json to ship beside it (the targets); the package's example one when not given.
 */
export async function buildApp({ mappings, out, config, cwd = process.cwd(), keep = false, log = console.log }) {
  const mappingsDir = resolve(cwd, mappings);
  if (!existsSync(mappingsDir)) throw new Error(`The mappings folder ${mappingsDir} does not exist. Generate the finders first (ts_generator.generator.generate).`);
  const names = await findMappings(mappingsDir);
  if (names.length === 0) {
    throw new Error(`${mappingsDir} has no generated mapping: a folder with the <Mapping>Metadata.ts and <Mapping>Context.ts the generator writes, for each mapping.`);
  }
  const outDir = resolve(cwd, out);
  const configFile = config === undefined ? join(PACKAGE_ROOT, 'public', 'query-ui.config.json') : resolve(cwd, config);
  if (!existsSync(configFile)) throw new Error(`The config file ${configFile} does not exist.`);

  const work = join(cwd, '.data-finder-query-ui');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    await cp(join(PACKAGE_ROOT, 'src'), join(work, 'src'), { recursive: true, filter: source => !source.endsWith(`${join('src', 'mappings')}`) });
    await writeFile(join(work, 'src', 'lib', 'app-mappings.ts'), await appMappingsSource(mappingsDir, names, join(work, 'src', 'lib')));
    await cp(join(PACKAGE_ROOT, 'index.html'), join(work, 'index.html'));
    await mkdir(join(work, 'public'));
    await writeFile(join(work, 'public', 'query-ui.config.json'), await readFile(configFile));

    const { build } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    log(`Building the query UI for ${names.length} mapping${names.length === 1 ? '' : 's'}: ${names.join(', ')}`);
    await build({
      root: work,
      configFile: false,
      logLevel: 'warn',
      plugins: [react()],
      resolve: {
        alias: [
          { find: /^@datafinder\/(.*)$/, replacement: 'data-finder-ts/datafinder/$1' },
          { find: /^@datafinder$/, replacement: 'data-finder-ts' },
          { find: /^@model\/(.*)$/, replacement: 'data-finder-ts/model/$1' },
        ],
        dedupe: ['react', 'react-dom', 'data-finder-ts'],
      },
      build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
    });
  } finally {
    if (!keep) await rm(work, { recursive: true, force: true });
  }
  log(`Built ${outDir}. Serve it with: data-finder-query-ui serve --dir ${out}`);
  return outDir;
}
