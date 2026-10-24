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

Combine with `.and()` and `.or()`. A chain reads left to right, each call taking everything before it as its left side, so the first line below is `(name is Acme or name is Beta) and id > 100` and the second is `(name is Acme and id > 100) or name is Beta`:

```ts
af.name().eq('Acme').or(af.name().eq('Beta')).and(af.id().gt(100))
af.name().eq('Acme').and(af.id().gt(100)).or(af.name().eq('Beta'))
```

To group differently, build the part that should bind first and combine it on the other side, e.g. `a.or(b.and(c))`.

### Functions of functions, and comparing them

The result of a function has the functions of its type, so they chain: `cf.name().toUpperCase().length()` is labelled "Length Upper Name", and `price().sqrt().floor()` works the same way. An expression can be compared like a column, with a value or with another expression: `cf.name().toUpperCase().eq('ACME CORP')`, `cf.name().length().gt(cf.category().length())`. The GraphQL runner does not compute either on the client.

### Arithmetic

A numeric column, aggregate, number function or another calculation has `.plus()`, `.minus()`, `.times()` and `.dividedBy()`, with a number or another numeric expression on the other side: `tf.price().times(tf.quantity())`, `tf.price().plus(1.5)`. A number on the left is a constant: `constant(100).minus(tf.price())`. Parentheses are written only where the meaning needs them, so `tf.price().plus(1).times(2)` is `(t0.price + 1) * 2` and `a.minus(b.minus(1))` keeps its brackets. A result is named "Expression" unless `.alias()` names it, and can be compared (`tf.price().times(2).gte(8)`), sorted and aliased. A query that holds an aggregate in a calculation is grouped like any other aggregate. The GraphQL runner does not compute it on the client.

## Sorting

Sort with `.orderBy()` and limit with `.limit()`. Several `orderBy` calls accumulate: the latest call takes priority and the earlier ones break its ties, so the two sorts below order by category and then by name. Sorting a column again replaces its earlier direction.

```ts
cf.findAll(null, null, [cf.name(), cf.category()])
  .orderBy(cf.name().ascending())
  .orderBy(cf.category().ascending())
```

A result can also be ordered by an aggregate or another expression: `cf.findAll(null, null, [cf.category(), cf.id().count()]).orderBy(cf.id().count().descending(), cf.category().ascending())`. Each expression is its own sort, so ordering by one again adds a sort.

`.distinct()` returns each row once (`SELECT DISTINCT`): `cf.findAll(null, null, [cf.category()]).distinct()`. A sort on a distinct query has to use a selected column. The GraphQL runner removes the duplicates on the client, so it applies a limit after that rather than on the server.

`.offset(n)` skips the first `n` rows and `.slice(start, stop)` keeps rows `start` up to `stop`, counting from 0. Sort first: without an order, which rows come first is not defined. The GraphQL runner applies the offset on the client, after the sort, and the limit after that rather than on the server.

## Naming columns

A column is named in the result after its property. Give it another name with `.alias()`, on an attribute, an aggregate or a function of a column:

```ts
cf.findAll(null, null, [cf.name().alias('Company'), cf.id().count().alias('N')])
```

Only a column of the result can be aliased, so a filter has no `.alias()`. Aliasing an alias replaces its name.

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

`.countDistinct()` counts the different non-NULL values (`COUNT(DISTINCT column)`); use it with `.groupBy()` to count per group. The GraphQL runner does not compute aggregates on the client.

`.join(separator, orderBy)` on a string attribute joins the values of a group into one text (`STRING_AGG`): `cf.findAll(null, null, [cf.category(), cf.name().join(', ', [cf.name().ascending()])]).groupBy(cf.category())`. `orderBy` is the order they are joined in; without it the order is not defined. Missing values are skipped.

### Grouping

With no `.groupBy()`, a query that selects aggregates is grouped by its other columns, as a DataFrame's `groupby(columns).agg(...)` is: `cf.findAll(null, null, [cf.category(), cf.id().count()])` counts per category. A query that selects only aggregates over the root's own columns is not grouped, so the aggregate covers every row. An aggregate read through a to-many association is computed for each row of the root, as Legend does, so the root's primary key is grouped by too: `ef.findAll(null, null, [ef.name(), ef.employees().id().count()])` gives each employee the count of their own reports, 0 for none. An explicit `.groupBy()` is used as given.

## Constant columns

`constant(value)` selects a fixed value next to the columns. It is named "Constant" unless `.alias()` gives it a name. A `DateOnly` is a date and any other `Date` a timestamp; a number is an integer or a float.

```ts
import { constant } from 'data-finder-ts';

cf.findAll(null, null, [cf.name(), constant('EU').alias('Region')])
```

The GraphQL runner fills a constant in itself rather than reading it from the server, so a query needs at least one real field too.

## Conditions as columns, and `when`

A condition (a comparison, a null check, `isIn`, `exists`, or `.and()` / `.or()` of those) can be selected as a column: true or false for each row, named "Expression" unless wrapped in an `Alias`. A comparison with a missing value is missing, not false.

`when(condition).then(value).otherwise(value)` is a value that depends on a condition (`CASE WHEN`). Further cases follow with `.when(...).then(...)`; with no `otherwise` the value is missing. A value is a column, an expression or a plain value.

```ts
import { when } from 'data-finder-ts';

cf.findAll(null, null, [cf.name(), when(cf.category().eq('Technology')).then('tech').otherwise('other')])
cf.findAll(null, null, [when(cf.id().lt(2)).then('low').when(cf.id().lt(4)).then('mid').otherwise('high')])
```

The object `when(...)` returns has a `then` method, so don't `await` it before calling `.then(value)`. The GraphQL runner does not compute either on the client.

## Replacing a missing value

`.orElse(default)` (`COALESCE` in SQL) selects the value, or `default` when it is NULL. It works on any attribute, including one reached through an association (for example a manager that may not exist). The default is a string, number or boolean.

```ts
ef.findAll(null, null, [ef.name(), ef.manager().name().orElse('nobody')])
```

The GraphQL runner does not compute functions on the client, so it reports `GraphQLClientComputationError` for an `orElse` column, as for the other functions.

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
