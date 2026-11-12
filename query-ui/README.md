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

## Running it

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
