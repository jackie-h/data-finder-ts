# data-finder-ts

TypeScript port of [data-finder](https://github.com/jackie-h/data-finder), a model-driven SQL query builder with temporal (milestoned) data support. A Python generator reads the same mapping definitions used by the Python project and emits strongly-typed TypeScript finder classes.

## What it does

You define a mapping between your domain model and relational tables (in Python or Markdown). The generator produces a typed `*Finder` class per entity. You use those classes to build and run SQL queries without writing SQL directly:

```typescript
const tf = new TradeFinder();

// Filter, join, milestoning applied automatically
const rows = await tf.findAll(
  null,                        // business date (null = not applicable)
  new Date(),                  // processing valid-at (temporal snapshot)
  [tf.symbol(), tf.price(), tf.account().name()],
  tf.symbol().eq('AAPL'),
).toRows();
```

Temporal filtering (`in_z <= ? AND out_z > ?`) is injected automatically based on the milestoning type declared in the mapping.

## Setup

```bash
npm install

# Install Python generator dependencies (system-wide, no virtualenv)
pip3 install jinja2 markdown-it-py
```

Node ≥ 20 required.

## Generating finders

Generated files are gitignored — regenerate them before running tests on a fresh clone.

```bash
# From programmatic mapping definitions (example/mappings.py)
python3 example/generate.py               # → example/generated/

# From a markdown mapping file (finance_mapping.md in sibling data-finder repo)
python3 example/generate_from_markdown.py # → tests/generated_markdown/
```

The generators import directly from the sibling `../data-finder` Python project, which must be present.

## Running tests

```bash
npm test                                        # all tests
npx vitest run tests/duckdb.test.ts             # single file
npm run build                                   # type-check only
```

Tests use an in-memory DuckDB instance via `@duckdb/node-api`. `tests/duckdb.test.ts` loads CSV fixtures from `example/data/`; `tests/duckdb-markdown.test.ts` seeds data with INSERT statements.

## Milestoning types

| Type | Mapping class | `findAll` args used |
|---|---|---|
| None | — | neither |
| Processing temporal | `ProcessingDateMilestonesPropertyMapping` | `processingValidAt` |
| Single business date | `SingleBusinessDateMilestonePropertyMapping` | `businessDate` |
| Business date + processing | `BusinessDateAndProcessingMilestonePropertyMapping` | both |
| Bi-temporal | `BiTemporalMilestonePropertyMapping` | both |

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
from mapping_markdown.markdown_mapping import load
from ts_generator.generator import generate

mapping = load('my_mapping.md')
generate(mapping, 'output/')
```

## Reverse associations

When a model association is declared (e.g. `Trade → Account`), the generator adds a `trades()` method on `AccountFinder` pointing back to `TradeRelatedFinder`. Because ESM circular imports can't be resolved with static `import`, finders self-register at module load via `registerRelatedFinderClass`. When using a reverse association in tests, import the source finder's module first:

```typescript
await import('./generated/TradeFinder'); // ensures TradeRelatedFinder is registered
const { AccountFinder } = await import('./generated/AccountFinder');
const af = new AccountFinder();
const rows = await af.findAll(null, null, [af.name(), af.trades().symbol()]).toRows();
```
