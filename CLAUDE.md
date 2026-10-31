# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Python project

The Python generator and its dependencies are managed by `uv` via `pyproject.toml` in the repo root. The `data-finder` package (published to PyPI) provides the model classes; `datafinder_examples` (included in 0.1.11+) provides the CSV fixtures and markdown mapping files used in tests and generation.

## Commands

```bash
uv sync                                               # install Python deps (first time / after pulling)

npm test                                              # run all tests
npm run build                                         # tsc type-check
npx vitest run tests/duckdb.test.ts                   # run a single test file

# Regenerate TypeScript finders from programmatic mappings
npm run generate

# Regenerate TypeScript finders from all datafinder_examples mappings
npm run generate:examples

# Regenerate TypeScript GraphQL finders from the datafinder_examples GraphQL mappings
npm run generate:graphql

# Regenerate tests/specs/ from the Python datafinder_examples_tests specs
npm run generate:specs
```

Finder output (`example/generated/`, `tests/generated_examples/`, `tests/generated_graphql/`) is gitignored and must be regenerated before running tests on a fresh clone. `tests/specs/` is committed — commit it after `generate:specs`; CI fails if it is out of date.

## Architecture

### TypeScript library (`src/`)

**`src/model/`** — core data model, no dependencies on datafinder:
- `relational.ts` — operation tree (`ComparisonOperation`, `LogicalOperation`, `AggregateOperation`, `ColumnWithJoin`, `JoinOperation`, `JoinTreeNodeOperation`, …), `Column`, `Table`, `Schema`. Uses `instanceof` checks throughout (mirrors Python's `isinstance`). `Operation.and()` replaces Python's `__and__`.
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
- Reverse associations use `getRelatedFinderClass` (not `require`/`import`) to avoid circular ESM imports. The source finder's module must be imported before the reverse method is called — in tests, import the source finder explicitly first.
- All output lands in a single flat directory regardless of class packages.

### GraphQL (`src/datafinder/graphql-runner.ts`, `generator/src/ts_generator/graphql_generator.py`)

`GraphQLConnect` pushes filters, sorts and limits to the server using the endpoint's `GraphQLFilterConvention`, and expands to-many relations (a `[]` in the field path) into rows. It never compensates on the client: what it can't push or compute throws `GraphQLPushdownError` / `GraphQLUnsupportedError`. `graphql_generator.py` renders `graphql_finder_template.txt` for each `GraphQLClassMapping`; it reuses the helpers in `datafinder_graphql.generator`.

### Two generation paths

| Script | Mapping source | Output |
|---|---|---|
| `example/generate.py` | `example/mappings.py` (Python objects) | `example/generated/` |
| `example/generate_examples.py` | `datafinder_examples` markdown mappings (PyPI) | `tests/generated_examples/<name>/` |

### Tests (`tests/`)

- `duckdb-runner.ts` — `DuckDbRunner implements QueryRunner` using `@duckdb/node-api`; row retrieval via `result.getChunk(i).getRows()`.
- `duckdb.test.ts` — tests against `example/generated/` finders; CSV fixtures resolved at runtime from the installed `datafinder_examples` package via `uv run python`.
- `specs/*.test.ts` — **generated** by `scripts/generate_spec_tests.py` (`npm run generate:specs`) from the Python `datafinder_examples_tests` specs, one file per spec module, so every Python `TestExpectation` has a TypeScript equivalent (queries translated, expected columns/values/SQL fragments copied). Don't edit by hand; CI regenerates and fails on drift. Fixtures are in `spec-seeds.ts`, the runner in `spec-harness.ts`. Only deviation: `strip`/`lstrip`/`rstrip` result labels follow the TS names (`Trim Name`, …).
- `specs/cases/*.ts` — the generated queries and expectations, shared by the DuckDB tests (`specs/*.test.ts`) and the GraphQL tests. Each group is a `SpecCase[]`; `SPEC_GROUPS` names the finder it runs on.
- `graphql-specs.test.ts` — runs those same cases against `GraphQLConnect` and `csv-graphql-server.ts` (a mock server seeded from the example CSVs, supporting `where`/`order_by`/`limit`/`asOf`/`businessDate`), using the finders in `tests/generated_graphql/`. Strict mode: a case with `skipGraphql` (from Python's `skip_backends`) is skipped, as is one that needs client-side computation (`GraphQLClientComputationError`: aggregates, scalar/window functions, group by). Anything else the server can't do is a failure.
- Other `*.test.ts` — hand-written tests against `tests/generated_examples/` finders; most seed data via `INSERT` statements.

`tsconfig.json` includes `example/generated/**/*`; `tests/**/*` already covers `tests/generated_examples/`.

### ER diagram viewer (`er-diagram/`)

Mermaid diagrams of the `datafinder_examples` models and mappings, built to static HTML (see `er-diagram/README.md`). `export_json.py` parses the markdown with data-finder's loaders into JSON and `generate.mjs` draws it; `data-finder.config.json` says which models and mappings to show. It has its own `package.json` and tests (`npm test --prefix er-diagram`, `npm run test:export --prefix er-diagram`) and is excluded from vitest. The export runs against a data-finder commit pinned in `er-diagram/requirements.txt` (newer than PyPI's 0.1.17). CI builds it and uploads `er-diagram/out` as the `er-diagrams` artifact.
