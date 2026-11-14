# Data Finder query UI

A browser tool for asking questions of a mapping without writing code.

1. Pick a mapping and a class to start from.
2. Tick properties in the tree: the class's own, and those of every class reached through its relations, down to the
   **max depth** (3 joins unless you change it in Settings).
3. Add filters, summarise columns (sum, average, count, ...), and the columns shown as they are become the group.
4. Press **RUN**. The page writes the SQL with the library's `toSql('databricks')`, sends it through a small proxy to a
   Databricks SQL warehouse, and shows the rows in AG Grid.
5. The rows are also held in a DuckDB inside the page, as a table called `results`. **Analyse in DuckDB** runs SQL on them
   without going back to the warehouse.

The panel on the left collapses so the results can use the whole width. **Show SQL** displays what will be sent.

## Install it from npm

`data-finder-query-ui` is a package of its own, in two forms: a command that builds and serves the page for your mappings, and
React components to put the page in your own app. Both need your generated finders (`ts_generator.generator.generate`, one folder for each mapping).

```bash
npm install data-finder-ts data-finder-query-ui     # react, react-dom, ag-grid-* and @duckdb/duckdb-wasm come with it as peers
```

### The command

```bash
npx data-finder-query-ui build --mappings generated --out query-ui-dist --config query-ui.config.json
DATABRICKS_HOST=https://adb-123.azuredatabricks.net DATABRICKS_TOKEN=... npx data-finder-query-ui serve --dir query-ui-dist
```

`generated` is a folder with one folder for each mapping, each holding the `<Mapping>Metadata.ts` and `<Mapping>Context.ts` (and the finders)
the generator wrote. `build` copies the page into `.data-finder-query-ui/` in your project, builds it against your `node_modules`
(one copy of React, AG Grid, DuckDB-wasm and data-finder-ts) and removes the folder again. `--config` is the `query-ui.config.json` with the targets
(below); the package's example when not given. `serve` is the page and the read-only proxy in one process: the token stays on the server.

### The components

```tsx
import { QueryUi, mappingEntry } from 'data-finder-query-ui';
import 'data-finder-query-ui/styles.css';
import { FinanceMappingMetadata } from './generated/finance/FinanceMappingMetadata';
import { FinanceMappingContext } from './generated/finance/FinanceMappingContext';

<QueryUi
  mappings={[mappingEntry('finance', FinanceMappingMetadata, FinanceMappingContext)]}
  targets={[{ name: 'Databricks', host: '', warehouseId: 'abc123' }]} />
```

`QueryUi` is the whole page; `PropertyTree`, `ColumnList`, `FilterList`, `ResultsGrid`, `AnalysePane` and `SettingsDialog` are its parts, and `buildQuery`
for a spec of your own is in data-finder-ts. The generated finders import the library through the aliases `@datafinder/*` and
`@model/*`; point them at data-finder-ts in your bundler (`@datafinder/x` is `data-finder-ts/datafinder/x`, `@model/x` is `data-finder-ts/model/x`).
`targets` is read from `query-ui.config.json` next to the page when not given. The page needs a bundler that handles `?url` imports (Vite does)
for the DuckDB-wasm files. `data-finder-query-ui/server` exports `startProxy` for running the proxy yourself.

## Running it from a checkout of the repository

```bash
uv sync && npm ci && npm ci --prefix query-ui
npm run generate --prefix query-ui      # finders and metadata for the example mappings -> query-ui/src/mappings/
DEMO=1 npm run proxy --prefix query-ui  # a stand-in for Databricks over DuckDB and the example data
npm run dev --prefix query-ui           # http://localhost:5173
```

For a real workspace start the proxy with the workspace and a token instead of `DEMO=1`:

```bash
DATABRICKS_HOST=https://adb-123.azuredatabricks.net DATABRICKS_TOKEN=... npm run proxy --prefix query-ui
```

A workspace sends no CORS headers, so the page cannot call it. The proxy forwards `/api/2.0/sql/statements`, adds the
token (the page never holds one), lets only a single read-only `SELECT` or `WITH` statement through, and caps the rows a
statement may return (`MAX_ROWS`, 100000). Put real access control in front of it before it is shared: whoever can reach it
can read what its token can.

## Configuration

- `public/query-ui.config.json`: the targets in the "Send to" list: a name, the warehouse id, and optionally the host of
  the proxy (empty for the server that served the page), a catalog and a schema. It is read when the page loads, so a
  deployment changes it without a rebuild.
- Settings (the gear in the panel): the max depth of joins and the row limit. They are remembered in the browser.
- Mappings: every folder under `src/mappings/` that the generator wrote. Add a mapping to `generate_mappings.py`, or
  generate your own with `ts_generator.generator.generate`; the UI needs the `*Metadata.ts` and `*Context.ts` files it writes.

## How it fits together

| Piece | Where |
|---|---|
| What a mapping offers (classes, properties, relations, display names, dates) | generated `<Mapping>Metadata.ts`; shape in `src/datafinder/metadata.ts` |
| Description of a query to a finder query | `buildQuery` in `src/datafinder/query-builder.ts` |
| SQL | `FinderResult.toSql('databricks')` |
| Sending it | `DatabricksConnect` (`src/datafinder/databricks-runner.ts`) through `server/proxy.mjs` |
| DuckDB in the page | `src/lib/duckdb.ts` (`@duckdb/duckdb-wasm`, loaded when Analyse is first opened) |

The tests for the logic are in `tests/` and run with the library's: `npx vitest run query-ui/tests` from the repo root.

## Not done yet

Joins through embedded properties are not in the tree. Filtering with exists / not exists, group by an expression
(`year` of a date), saved queries, CSV export, cancelling a running statement and results larger than the inline limit of
the Statement API (25 MiB) are not supported.
