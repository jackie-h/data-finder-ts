# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sibling project

This project mirrors `../data-finder` (Python). The Python models (`model/`, `datafinder/`, `model_markdown/`, `mapping_markdown/`) are the source of truth for concepts and behaviour. The TypeScript code here is a port; the Python generator here consumes those same Python model objects to emit TypeScript.

## Commands

Node ≥ 20 is required. The system ships Node 16 — use the Homebrew install:

```bash
PATH="/opt/homebrew/opt/node@25/bin:$PATH" npm test          # run all tests
PATH="/opt/homebrew/opt/node@25/bin:$PATH" npm run build     # tsc type-check

# Run a single test file
PATH="/opt/homebrew/opt/node@25/bin:$PATH" npx vitest run tests/duckdb.test.ts

# Regenerate TypeScript finders from programmatic mappings
python3 example/generate.py

# Regenerate TypeScript finders from the finance markdown mapping
python3 example/generate_from_markdown.py
```

Python dependencies for the generators (`jinja2`, `markdown-it-py`) must be installed system-wide (`pip3 install jinja2 markdown-it-py`). The generators import directly from `../data-finder`; no virtualenv is used.

## Architecture

### TypeScript library (`src/`)

**`src/model/`** — core data model, no dependencies on datafinder:
- `relational.ts` — operation tree (`ComparisonOperation`, `LogicalOperation`, `AggregateOperation`, `ColumnWithJoin`, `JoinOperation`, `JoinTreeNodeOperation`, …), `Column`, `Table`, `Schema`. Uses `instanceof` checks throughout (mirrors Python's `isinstance`). `Operation.andOp()` replaces Python's `__and__`.
- `milestoning.ts` — temporal types: `ProcessingTemporalColumns`, `SingleBusinessDateColumn`, `BusinessDateAndProcessingTemporalColumns`, `BiTemporalColumns`, `MilestonedTable`.

**`src/datafinder/`** — query building and execution:
- `attribute.ts` — base `Attribute` wrapping a `Column`; parent/join-node tracking for JOIN resolution.
- `typed-attributes.ts` — `StringAttribute`, `IntegerAttribute`, `DoubleAttribute` (= `FloatAttribute`), `DateAttribute`, `DateTimeAttribute`, `BooleanAttribute`, `DecimalAttribute`. Operator methods (`eq`, `gt`, `lt`, …) replace Python operator overloading.
- `sql-generator.ts` — `SQLQueryGenerator`; `buildMilestoningFilterOperation()` applies temporal WHERE clauses; `buildQueryOperation()` resolves JOINs from the `JoinTreeNodeOperation` chain; `toSql()` is the public entry point. Dates are always formatted in UTC (`getUTCFullYear` etc.) — date-only strings like `'2023-01-15'` parse as UTC midnight so UTC formatting avoids timezone-shift bugs.
- `runner.ts` — `QueryRunner` interface, module-level singleton registry (`registerRunner`/`clearRunner`/`getRunner`), `FinderResult` (lazy `toSql()` + async `toRows()`), `convertInputsAndSelect()`.
- `finder-registry.ts` — module-level `Map` for reverse-association lazy lookup; avoids ESM circular import issues. Each generated `*Finder.ts` calls `registerRelatedFinderClass(name, cls)` at module load; reverse association methods call `getRelatedFinderClass(name)`.

Path aliases: `@model/*` → `src/model/*`, `@datafinder/*` → `src/datafinder/*`, resolved by `vite-tsconfig-paths` in Vitest.

### Python generator (`generator/`)

`generator/src/ts_generator/generator.py` — reads a `Mapping` object (from `../data-finder`'s model layer) and renders three Jinja2 templates into a flat output directory:

- `finder_base_template.txt` → `{ClassName}FinderBase.ts` (abstract base classes)
- `finder_template.txt` → `{ClassName}Finder.ts` (concrete classes + self-registration)
- `context_template.txt` → `{MappingName}Context.ts` (instantiates all finders)

Key generator behaviours:
- `to_ts_name(prop)` converts property display names to camelCase. **Only actual JS/TS reserved words** trigger a trailing `_` — type names like `symbol`, `string`, `number` are intentionally excluded.
- Synthetic milestoning properties (defined in the mapping but absent from the model) use their mapping ID (e.g. `valid_from`) as the method name rather than a camelCase display name.
- Reverse associations use `getRelatedFinderClass` (not `require`/`import`) to avoid circular ESM imports. The source finder's module must be imported before the reverse method is called — in tests, import the source finder explicitly first.
- All output lands in a single flat directory regardless of class packages.

### Two generation paths

| Script | Mapping source | Output |
|---|---|---|
| `example/generate.py` | `example/mappings.py` (Python objects) | `example/generated/` |
| `example/generate_from_markdown.py` | `../data-finder/mapping_markdown/tests/finance_mapping.md` | `tests/generated_markdown/` |

Both output directories are gitignored and must be regenerated before running tests on a fresh clone.

### Tests (`tests/`)

- `duckdb-runner.ts` — `DuckDbRunner implements QueryRunner` using `@duckdb/node-api`; row retrieval via `result.getChunk(i).getRows()`.
- `duckdb.test.ts` — tests against `example/generated/` finders; loads CSV fixtures from `example/data/`.
- `duckdb-markdown.test.ts` — tests against `tests/generated_markdown/` finders; seeds data via `INSERT` statements (no CSVs needed).

`tsconfig.json` includes `example/generated/**/*` but not `tests/generated_markdown/**/*` — however `tests/**/*` already covers that path.
