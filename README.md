# data-finder-ts

TypeScript port of [data-finder](https://github.com/jackie-h/data-finder), a model-driven SQL query builder with temporal (milestoned) data support. A Python generator reads mapping definitions and emits strongly-typed TypeScript finder classes.

For runtime usage and query API see **[FINDERS.md](FINDERS.md)**.

## Requirements

- Node ≥ 24
- [uv](https://docs.astral.sh/uv/) (Python package manager)

## Install

```bash
npm install
uv sync       # install Python generator dependencies
```

## Generating finders

Generated files are gitignored — regenerate before running tests on a fresh clone.

```bash
npm run generate           # from programmatic mappings (example/mappings.py) → example/generated/
npm run generate:examples  # from all datafinder_examples mappings → tests/generated_examples/
```

The generator uses the [`data-finder`](https://pypi.org/project/data-finder/) PyPI package (installed via `uv sync`).

## Running tests

```bash
npm test                                  # all tests
npx vitest run tests/duckdb.test.ts       # single file
npm run build                             # type-check only
npm run build:lib                         # build distributable (tsup)
```

Tests use an in-memory DuckDB instance via `@duckdb/node-api`.

## Defining a mapping (Markdown)

```markdown
## Model: my_model.md

## DataStore: my_db (Database)

| Scheme           | processing_start | processing_end |
|------------------|------------------|----------------|
| processing_only  | in_z             | out_z          |

### Schema: trading

#### Table: trades → Trade (milestoning: processing_only)

| Column     | Type      | Key | Property |
|------------|-----------|-----|----------|
| sym        | VARCHAR   |     | symbol   |
| price      | DOUBLE    |     | price    |
| account_id | INT       | FK  | account  |
| in_z       | TIMESTAMP |     | valid_from |
| out_z      | TIMESTAMP |     | valid_to   |

#### Association: TradeAccount

| Source Column | Target Table   | Target Column |
|---------------|----------------|---------------|
| account_id    | account_master | ID            |
```

Load and generate:

```python
from datafinder_examples.finance_mapping import load
from ts_generator.generator import generate

mapping = load('my_mapping.md')
generate(mapping, 'output/')
```
