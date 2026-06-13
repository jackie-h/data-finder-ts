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
  processingDate,         // Date | string | null  (null = not milestoned)
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
