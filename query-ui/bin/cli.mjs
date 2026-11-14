#!/usr/bin/env node
// data-finder-query-ui: build the query page for your mappings, and serve it.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildApp } from './build.mjs';
import { startProxy } from '../server/proxy.mjs';

const HELP = `data-finder-query-ui: a page that builds SQL from a data-finder mapping, runs it on Databricks and keeps the rows in DuckDB.

Usage
  data-finder-query-ui build --mappings <folder> [--out <folder>] [--config <file>]
      Build the page for the mappings in <folder>: one folder for each mapping the generator wrote
      (the <Mapping>Metadata.ts and <Mapping>Context.ts files). --out is query-ui-dist unless given.
      --config is a query-ui.config.json with the targets queries can be sent to.

  data-finder-query-ui serve [--dir <folder>] [--port <n>]
      Serve a built page, and forward its queries to Databricks through a read-only proxy that holds the token.
      Set DATABRICKS_HOST and DATABRICKS_TOKEN. MAX_ROWS (100000) caps the rows of a statement.

The page needs data-finder-ts, react, react-dom, ag-grid-community, ag-grid-react and @duckdb/duckdb-wasm in your project (npm installs them as peers).
Anything that can reach the proxy can read what its token can: put access control in front of it before it is shared.
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mappings: { type: 'string' }, out: { type: 'string', default: 'query-ui-dist' }, config: { type: 'string' },
    dir: { type: 'string' }, port: { type: 'string' }, keep: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }, version: { type: 'boolean', short: 'v', default: false },
  },
});

async function main() {
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }
  const [command] = positionals;
  if (values.help || command === undefined) return console.log(HELP);
  if (command === 'build') {
    if (values.mappings === undefined) throw new Error('build needs --mappings <folder>.');
    await buildApp({ mappings: values.mappings, out: values.out, config: values.config, keep: values.keep });
  } else if (command === 'serve') {
    const dir = resolve(values.dir ?? values.out);
    if (!existsSync(resolve(dir, 'index.html'))) throw new Error(`${dir} has no built page. Run: data-finder-query-ui build --mappings <folder> --out ${values.dir ?? values.out}`);
    await startProxy({
      port: Number(values.port ?? process.env.PORT ?? 8787), maxRows: Number(process.env.MAX_ROWS ?? 100000),
      host: process.env.DATABRICKS_HOST, token: process.env.DATABRICKS_TOKEN, demo: Boolean(process.env.DEMO), staticDir: dir,
    });
  } else {
    throw new Error(`Unknown command '${command}'.\n\n${HELP}`);
  }
}

main().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
