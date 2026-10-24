# Using Generated Finders

Generated finders provide a type-safe API for querying database tables without writing SQL.

## Setup

```ts
import { registerRunner } from 'data-finder-ts/datafinder/runner';
import { AccountFinder } from './generated/AccountFinder';
import { TradeFinder } from './generated/TradeFinder';

registerRunner(myRunner); // register once at app startup
```

## Query

```ts
const af = new AccountFinder();

const result = af.findAll(
  businessDate,           // Date | string | null  (null = not milestoned)
  processingDate,         // Date | string | null  (null = not milestoned); a 'YYYY-MM-DD' string or a DateOnly is a date literal, a Date or 'YYYY-MM-DD HH:MM:SS' a timestamp
  [af.id(), af.name()],  // columns to SELECT
  af.id().eq(42),         // optional WHERE filter
);

const sql: string        = result.toSql();
const rows: unknown[][]  = await result.toRows();
// rows[i] aligns to displayColumns order
```

## Milestoning (temporal filtering)

Pass dates to `findAll` to snapshot data at a point in time. Temporal WHERE clauses are injected automatically.

| Type | `businessDate` | `processingDate` |
|---|---|---|
| None | `null` | `null` |
| Processing temporal | `null` | required |
| Single business date | required | `null` |
| Business date + processing | required | required |
| Bi-temporal | required | required |

### Date ranges

Finders for tables with a business date (single business date, business date + processing, bi-temporal) also have `findForDateRange(from, to, processingValidAt, columns, filter?)`. It returns every record whose business date falls in the inclusive range; for bi-temporal tables, records whose business-date interval overlaps it. The processing time is still a point-in-time filter.

```ts
cpf.findForDateRange('2023-01-15', '2023-01-16', new Date(), [cpf.quantity()])
```

## Query timeout

Queries time out after 60 seconds by default. Override per query with `.timeout(ms)`; a runner that exceeds it rejects with `QueryTimeoutError`.

```ts
await af.findAll(null, null, [af.name()]).timeout(5_000).toRows();
```

Custom `QueryRunner`s receive the timeout as the last argument to `select`.

## Filter operators

| Type | Methods |
|---|---|
| `StringAttribute` | `.eq(v)` `.contains(v)` `.startsWith(v)` `.endsWith(v)` |
| `IntegerAttribute` `DoubleAttribute` `DecimalAttribute` | `.eq(v)` `.gt(v)` `.lt(v)` `.gte(v)` `.lte(v)` |
| `DateAttribute` `DateTimeAttribute` | `.eq(v)` `.gt(v)` `.lt(v)` `.gte(v)` `.lte(v)` |
| `BooleanAttribute` | `.eq(v)` |

Combine with `.andOp()`:

```ts
af.name().eq('Acme').andOp(af.id().gt(100))
```

## Sorting

Sort with `.orderByOp()` and limit with `.limit()`. Several `orderByOp` calls accumulate: the latest call takes priority and the earlier ones break its ties, so the two sorts below order by category and then by name. Sorting a column again replaces its earlier direction.

```ts
cf.findAll(null, null, [cf.name(), cf.category()])
  .orderByOp(cf.name().ascending())
  .orderByOp(cf.category().ascending())
```

## Joins

Call a related finder method to include a JOIN and access its columns:

```ts
const tf = new TradeFinder();

tf.findAll(null, new Date(),
  [tf.account().name(), tf.symbol(), tf.price()],
  tf.account().name().eq('Acme'),
).toRows();
```

Chains are arbitrarily deep: `tf.account().address().city().eq('London')`.

### Embedded (denormalized) columns

If the mapping declares flat columns on the table that duplicate a related property (e.g. `acct_name` for `account.name`, see `finance_mapping_embedded.md`), the generated finders carry them as join-less alternates. When every property taken from a related table has one, whether projected, filtered, grouped, ordered or partitioned on, the JOIN is left out of the SQL. If any property from that table lacks one (e.g. `account().id()`), the real join is used for all of them.
### Filtering a join by property

A related-finder accessor accepts property values to restrict the joined rows (an equality filter on the join, so unmatched rows stay as NULLs rather than being dropped):

```ts
ef.findAll(null, null, [ef.firstName(), ef.projects({ code: 'ALPHA' }).name()])
```

### Existence filters

`exists()` and `notExists()` on a related finder keep only rows that do (or don't) have a match through that join:

```ts
ef.findAll(null, null, [ef.firstName()], ef.manager().notExists())   // employees with no manager
```

They compile to a LEFT JOIN checked for NULL, so a to-many join repeats the row once per match.

## Count

```ts
af.findAll(null, null, [af.count()]).toSql()
// → SELECT COUNT(*) FROM ref_data.account_master
```

## Reverse associations

When a `Trade → Account` association exists, `AccountFinder` gets a `trades()` method. Because ESM circular imports can't be resolved statically, finders self-register at module load — import the source finder first:

```ts
await import('./generated/TradeFinder'); // registers TradeRelatedFinder
const { AccountFinder } = await import('./generated/AccountFinder');

const af = new AccountFinder();
af.findAll(null, null, [af.name(), af.trades().symbol()]).toRows();
```

## Implementing QueryRunner

```ts
import type { QueryRunner, QueryTarget } from 'data-finder-ts/datafinder/runner';

class MyRunner implements QueryRunner {
  async executeQuery(sql: string, target: QueryTarget): Promise<unknown[][]> {
    return myDb.query(sql);
  }
}
registerRunner(new MyRunner());
```
