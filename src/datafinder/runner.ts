import { Attribute, Comparand } from './attribute';
import { buildQuerySpecification, toSql } from './sql-generator';
import { attributes, columnName } from './relation';
import { MilestonedTable, hasProcessingRange, milestoningColumnsOf } from '../model/milestoning';
import { DialectName, SqlDialect } from './dialect';
import {
  Alias,
  Relation,
  TableAlias,
  UnionOperation,
  QueryExpression,
  RelationExistsOperation,
  QuerySpecification,
  JoinOperation,
  JoinKind,
  Table,
  containsAggregate,
  Operation,
  SortOperation,
  NoOperation,
  RelationalOperationElement,
  ColumnWithJoin,
  DateOnly,
  DATE_ONLY_PATTERN,
} from '../model/relational';

export type Row = unknown[];

export const DEFAULT_TIMEOUT_MS = 60_000;

/** Thrown by a QueryRunner when a query runs longer than the timeout set on its FinderResult. */
export class QueryTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded ${timeoutMs}ms timeout`);
    this.name = 'QueryTimeoutError';
  }
}

/** Minimum interface satisfied by both Table (SQL) and GraphQLQuery (GraphQL). */
export interface QueryTarget {
  readonly name: string;
}

export interface QueryRunner {
  /** The SQL a runner that executes SQL sends: `toSql()` writes it for this dialect. Postgres when absent. */
  readonly dialect?: DialectName | SqlDialect;

  select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy?: SortOperation[],
    groupBy?: Comparand[],
    limit?: number,
    timeoutMs?: number,
    businessDateTo?: Date | null,
    distinct?: boolean,
    offset?: number,
    having?: Operation,
    processingDatetimeTo?: Date | null,
  ): Promise<Row[]>;
}

let _runner: QueryRunner | null = null;

export function registerRunner(runner: QueryRunner): void { _runner = runner; }
export function clearRunner(): void { _runner = null; }
export function getRunner(): QueryRunner {
  if (!_runner) throw new Error('No query runner registered. Call registerRunner() first.');
  return _runner;
}

const expressionIds = new WeakMap<object, number>();
let nextExpressionId = 1;

/**
 * What a sort orders by: a column and the joins to reach it. Any other expression, such as an aggregate, is its
 * own target, so sorting by an expression again adds a sort.
 */
function sortTarget(sort: SortOperation): string {
  const column = sort.column;
  if (!(column instanceof ColumnWithJoin)) {
    if (!expressionIds.has(column)) expressionIds.set(column, nextExpressionId++);
    return JSON.stringify(['expression', expressionIds.get(column)]);
  }
  const joins: string[] = [];
  for (let node = column.parent; node !== undefined; node = node.parent) joins.push(node.join.name);
  return JSON.stringify([column.column.ownerName, column.column.name, joins]);
}

let nextRelationNumber = 1;

/**
 * A row of a result as a function of it reads it: its columns are attributes, `r.price`, as Legend's `$r.price`. The
 * columns are known when the query is built, so a name that is not one is refused then, with the columns there are.
 * A column's type is what it holds when the query is built, so a row's attributes are loosely typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResultRow = Record<string, any>;

function rowOf(columns: Map<string, Attribute>): ResultRow {
  return new Proxy({} as ResultRow, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      const column = columns.get(name);
      if (column === undefined) throw new Error(`No column '${name}' in this result: its columns are ${JSON.stringify([...columns.keys()])}`);
      return column;
    },
    set() { throw new Error('A row is read, not changed: use extend() to add a column'); },
  });
}

/**
 * Whether `other` has a row for which `condition` holds, as Legend's `exists(e | ...)`, and SQL's `EXISTS`. It is a condition, for
 * the `filter` of a result: the function is of a row of `other`, and it reads the row being filtered from the function it is in.
 * `.not()` is `NOT EXISTS`, and conditions are combined with `and` / `or`:
 *
 *     lateLines.filter(l1 => exists(lines, l2 => l2.order.eq(l1.order).and(l2.supplier.ne(l1.supplier)))
 *                              .and(exists(late, l3 => l3.order.eq(l1.order).and(l3.supplier.ne(l1.supplier))).not()))
 */
export function exists(other: FinderResult, condition: (row: ResultRow) => Operation): RelationExistsOperation {
  if (typeof condition !== 'function') {
    throw new TypeError('The condition of an exists is a function of a row of the other result: exists(other, o => o.key.eq(r.key))');
  }
  const { alias } = other.relation();
  // a name of its own each time, so that a result tested against itself reads as two relations
  const inner = new TableAlias(alias.relation, `relation${nextRelationNumber++}`);
  const test = condition(rowOf(attributes(inner)));
  if (!(test instanceof Operation)) {
    throw new TypeError(`The condition of an exists gives a comparison, such as o.key.eq(r.key), not ${test === null ? 'null' : typeof test}`);
  }
  return new RelationExistsOperation(inner, test);
}

/** What a `groupBy` function of a row returns: a column, or several, or an expression named with `alias()`. */
export type GroupKey = Attribute | Alias | readonly (Attribute | Alias)[];

/** The rows of a result grouped by keys: what `groupBy(r => r.dept)` gives, which can only be aggregated. */
export class GroupedRows {
  private readonly _keys: (Attribute | Alias)[] = [];

  constructor(private readonly _result: FinderResult, keys: readonly ((row: ResultRow) => GroupKey)[]) {
    const row = _result.row();
    for (const key of keys) {
      const found = key(row);
      this._keys.push(...(Array.isArray(found) ? found : [found as Attribute | Alias]));
    }
    for (const key of this._keys) {
      if (key instanceof Attribute) continue;
      if (key instanceof Alias && !(key.element instanceof Alias)) continue;
      throw new TypeError('A groupBy key is a column, or an expression named with alias(): groupBy(r => r.shipDate.year().alias(\'year\'))');
    }
  }

  /**
   * The keys, and a column for each key of the object that is an aggregate of the rows of its group, as Legend's
   * `groupBy(~dept, ~headcount : x | $x.id : y | $y->count())`:
   *
   *     rows.groupBy(r => r.dept).aggregate({ headcount: r => r.id.count(), avgSalary: r => r.salary.average() })
   */
  aggregate(columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): FinderResult {
    const entries = Object.entries(columns);
    if (entries.length === 0) throw new Error('aggregate needs at least one column: aggregate({ total: r => r.price.sum() })');
    const row = this._result.row();
    const shown = this._keys.map(key => (key instanceof Alias ? key.name : key.displayName()));
    const aggregates: Alias[] = [];
    for (const [name, fn] of entries) {
      if (typeof fn !== 'function') throw new TypeError(`The column '${name}' is a function of a row: aggregate({ ${name}: r => r.price.sum() })`);
      const expression = fn(row);
      const element = expression instanceof Attribute ? expression.cwj() : expression;
      if (!containsAggregate(element)) {
        throw new TypeError(`The column '${name}' is not an aggregate of the rows of a group (sum, count, average, min, max, ...), so it has no one value for the group`);
      }
      if (shown.includes(name) || aggregates.some(a => a.name === name)) throw new Error(`The column '${name}' is named twice in this aggregate`);
      aggregates.push(new Alias(element, name));
    }
    const keys = this._keys.map(key => (key instanceof Alias ? key.element : key));
    return this._result.step([...this._keys, ...aggregates], undefined, keys as Comparand[]);
  }
}

export class FinderResult {
  private _relationName?: string;
  private _orderBy: SortOperation[] = [];
  private _groupBy: Comparand[] = [];
  private _limit?: number;
  private _distinct = false;
  private _offset?: number;
  private _having?: Operation;
  private _timeoutMs: number = DEFAULT_TIMEOUT_MS;

  constructor(
    private readonly _businessDate: Date | null,
    private readonly _processingDatetime: Date | null,
    private readonly _columns: (Attribute | RelationalOperationElement)[],
    private readonly _table: QueryTarget,
    private readonly _op: RelationalOperationElement,
    private readonly _businessDateTo: Date | null = null,
    private readonly _processingDatetimeTo: Date | null = null,
  ) {}

  // --- a result as a relation, for what follows it -------------------------------------------------------------------

  /** @internal This result as a relation: its query, with each column named for what reads it. */
  relation(): { alias: TableAlias; attributes: Map<string, Attribute> } {
    this._relationName ??= `relation${nextRelationNumber++}`;
    const display = this._columns.map(c => (c instanceof Alias ? c : c instanceof Attribute ? c.alias(columnName(c)) : new Alias(c, columnName(c))));
    const query = buildQuerySpecification(
      this._businessDate, this._processingDatetime, display, this._table as unknown as Relation, this._op, this._orderBy, this._groupBy,
      this._limit, this._businessDateTo, this._distinct, this._offset, this._having, this._processingDatetimeTo);
    const alias = new TableAlias(query, this._relationName);
    return { alias, attributes: attributes(alias) };
  }

  /** The names of this result's columns, as what follows it reads them: the name `alias()` gave, or the display name in snake_case. */
  columnNames(): string[] {
    return [...this.relation().attributes.keys()];
  }

  /**
   * A column of this result by name, to order a concatenated result by: `rows.orderBy(rows.column('name').ascending())`. It is a
   * typed attribute of the type the column holds.
   */
  column(name: string): Attribute {
    const { attributes: columns } = this.relation();
    const found = columns.get(name);
    if (found === undefined) throw new Error(`No column '${name}' in this result: its columns are ${JSON.stringify([...columns.keys()])}`);
    return found;
  }

  /**
   * The rows of this result and of `other`, which has the same columns: `UNION` (each distinct row once), or `UNION ALL`
   * with `{ all: true }`, as Legend's `concatenate`. The result is a result like any other: it can be ordered, limited and
   * concatenated again. Its columns are named as `columnNames()` gives them.
   */
  concatenate(other: FinderResult, options: { all?: boolean } = {}): FinderResult {
    const { alias: leftAlias, attributes: left } = this.relation();
    const { alias: rightAlias, attributes: right } = other.relation();
    const leftNames = [...left.keys()];
    const rightNames = [...right.keys()];
    if (leftNames.join('\u0000') !== rightNames.join('\u0000')) {
      throw new Error(`Concatenated results need the same columns: ${JSON.stringify(leftNames)} and ${JSON.stringify(rightNames)} differ`);
    }
    const all = options.all ?? false;
    const union = new TableAlias(
      new UnionOperation(this._unionSide(leftAlias, all), other._unionSide(rightAlias, all), all),
      `relation${nextRelationNumber++}`);
    // each column keeps the name it has, so a chain of unions has the first one's names
    return new FinderResult(null, null, [...attributes(union)].map(([name, attribute]) => attribute.alias(name)), union, new NoOperation());
  }

  /**
   * This result as one side of a union. A result that is only the union of two more with the same operator is that union
   * itself, not a SELECT over it, so `a.concatenate(b).concatenate(c)` is one flat chain of unions.
   */
  private _unionSide(asRelation: TableAlias, all: boolean): QueryExpression {
    const source = this._table as unknown;
    const bare = source instanceof TableAlias && source.relation instanceof UnionOperation && source.relation.all === all
      && this._op instanceof NoOperation
      && this._orderBy.length === 0 && this._groupBy.length === 0 && !this._distinct && this._having === undefined
      && this._limit === undefined && this._offset === undefined;
    return (bare ? (source as TableAlias).relation : asRelation.relation) as QueryExpression;
  }

  /** A result that reads from this one: a query over this result's query, as Legend's relation functions are. */
  private _next(display: (Attribute | RelationalOperationElement)[], op?: Operation, groupBy: Comparand[] = []): FinderResult {
    const { alias } = this.relation();
    const step = new FinderResult(null, null, display, alias, op ?? new NoOperation());
    step._groupBy = groupBy;
    return step;
  }

  /** @internal A row of this result, for the functions of a step. */
  row(): ResultRow { return rowOf(this.relation().attributes); }

  /** @internal */
  step(display: (Attribute | RelationalOperationElement)[], op?: Operation, groupBy: Comparand[] = []): FinderResult {
    return this._next(display, op, groupBy);
  }

  /**
   * The rows of this result for which every condition holds, as Legend's `filter(r | $r.price > 250)`: each condition is a
   * function of a row that reads its columns as attributes, including one that a window function, an aggregate or `extend`
   * made, which a `WHERE` over the rows themselves cannot do:
   *
   *     rows.filter(r => r.price.gt(250))
   */
  filter(...conditions: ((row: ResultRow) => Operation)[]): FinderResult {
    const { attributes: columns } = this.relation();
    const row = rowOf(columns);
    let op: Operation | undefined;
    for (const condition of conditions) {
      if (typeof condition !== 'function') throw new TypeError('A filter condition is a function of a row: filter(r => r.price.gt(250))');
      op = op === undefined ? condition(row) : op.and(condition(row)) as Operation;
    }
    return this._next([...columns.values()], op);
  }

  /**
   * This result with more columns, each named by its key and worked out from a row, as Legend's `extend(~top : r | ...)`. A
   * window adds an aggregate over the rows to each row:
   *
   *     rows.extend({ double: r => r.price.times(2), top: r => r.price.max().over([r.account]) })
   */
  extend(columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): FinderResult {
    const { attributes: existing } = this.relation();
    const row = rowOf(existing);
    const added = Object.entries(columns).map(([name, expression]) => {
      if (typeof expression !== 'function') throw new TypeError(`The column '${name}' is a function of a row: extend({ ${name}: r => ... })`);
      const value = expression(row);
      return value instanceof Attribute ? value.alias(name) : new Alias(value, name);
    });
    return this._next([...existing.values(), ...added]);
  }

  /** Only some of this result's columns, by name, as Legend's `select(~[sym, price])`. To rename or work out a column use `extend` first. */
  select(...names: string[]): FinderResult {
    const { attributes: columns } = this.relation();
    const missing = names.filter(n => !columns.has(n));
    if (missing.length > 0) throw new Error(`No column ${JSON.stringify(missing)} in this result: its columns are ${JSON.stringify([...columns.keys()])}`);
    return this._next(names.map(n => columns.get(n)!));
  }

  /**
   * A column of this result, as `column(name)` gives it, is what this result shows under that name: so
   * `rows.orderBy(rows.column('name').ascending())` orders by the column, not by a column of a later query.
   */
  private _own<T extends RelationalOperationElement | Attribute>(element: T): T | RelationalOperationElement | Attribute {
    const column = element instanceof Attribute ? element.column() : element instanceof ColumnWithJoin ? element.column : undefined;
    if (column === undefined || this._relationName === undefined) return element;
    const owner = column.owner;
    if (!(owner instanceof TableAlias) || owner.name !== this._relationName) return element;
    const shown = new Map(this._columns.map(c => [columnName(c), c instanceof Alias ? c.element : c]));
    const found = shown.get(column.name) ?? element;
    return found instanceof Attribute ? found.cwj() : found;
  }

  /**
   * Order the rows. Calls accumulate: the sorts of the latest call take priority and earlier ones order the
   * rows it leaves tied, as in a chain of `sortBy` calls. Sorting a column again replaces its earlier direction.
   */
  orderBy(...given: SortOperation[]): this {
    const sorts = given.map(s => new SortOperation(this._own(s.column) as RelationalOperationElement, s.direction));
    const resorted = new Set(sorts.map(sortTarget));
    this._orderBy = [...sorts, ...this._orderBy.filter(s => !resorted.has(sortTarget(s)))];
    return this;
  }

  /**
   * The rows of this result put together with the rows of `other`, as Legend's `join`. The condition is a function of a row of
   * each, and `and` / `or` combine comparisons:
   *
   *     orders.join(customers, (o, c) => o.customerId.eq(c.id), 'inner')   // only orders that have a customer
   *     orders.join(customers, (o, c) => o.customerId.eq(c.id), 'left')    // every order, with a customer or NULL
   *     lines.join(others, (a, b) => a.order.eq(b.order).and(a.supplier.ne(b.supplier)), 'inner')
   *
   * `how` is one of ANSI SQL's join types: `inner`, or `left`, `right` or `full`, the outer joins that keep the rows that find no
   * match, with NULL for the other side's columns. The columns of the two must be named differently, as Legend requires: name
   * them with `alias()`, or `extend` then `select`.
   */
  join(other: FinderResult, condition: (left: ResultRow, right: ResultRow) => Operation, how: 'inner' | 'left' | 'right' | 'full'): FinderResult {
    const kinds = Object.values(JoinKind) as string[];
    if (!kinds.includes(how)) throw new Error(`A join is one of ${JSON.stringify(kinds)}, not '${how}'`);
    if (typeof condition !== 'function') throw new TypeError('A join condition is a function of a row of each: join(other, (a, b) => a.key.eq(b.key), \'inner\')');
    const { alias: leftAlias, attributes: left } = this.relation();
    const { alias: rightAlias, attributes: right } = other.relation();
    const repeated = [...left.keys()].filter(n => right.has(n)).sort();
    if (repeated.length > 0) {
      throw new Error(`A join needs the columns of its two sides named differently, but ${JSON.stringify(repeated)} are on both: name them with alias(), or extend() then select()`);
    }
    const test = condition(rowOf(left), rowOf(right));
    if (!(test instanceof Operation)) {
      throw new TypeError(`A join condition gives a comparison, such as a.key.eq(b.key), not ${test === null ? 'null' : typeof test}`);
    }
    const columns = [...left, ...right].map(([name, attribute]) => attribute.alias(name));
    const joined = new QuerySpecification(columns, new NoOperation(), [], leftAlias, new Map(), false, undefined, new Map(),
      [new JoinOperation('', rightAlias, test, how as JoinKind)]);
    const alias = new TableAlias(joined, `relation${nextRelationNumber++}`);
    return new FinderResult(null, null, [...attributes(alias)].map(([name, attribute]) => attribute.alias(name)), alias, new NoOperation());
  }

  /**
   * Group the rows. Given finder attributes (or expressions), the aggregates selected next to them are grouped by them, and
   * the result is this one. Given a function of a row, as Legend's `groupBy(~dept, ...)`, the rows of this result are grouped
   * by the key it returns (a column, an array of them, or an expression named with `alias()`), and the result of `aggregate`
   * on that is a step over this one:
   *
   *     rows.groupBy(r => r.dept).aggregate({ headcount: r => r.id.count() })
   *     rows.groupBy(r => [r.dept, r.title]).aggregate({ total: r => r.salary.sum() })
   */
  groupBy(...keys: ((row: ResultRow) => GroupKey)[]): GroupedRows;
  groupBy(...attrs: Comparand[]): this;
  groupBy(...keys: (Comparand | ((row: ResultRow) => GroupKey))[]): GroupedRows | this {
    const functions = keys.map(k => typeof k === 'function');
    if (keys.length > 0 && functions.every(Boolean)) return new GroupedRows(this, keys as ((row: ResultRow) => GroupKey)[]);
    if (functions.some(Boolean)) throw new TypeError('groupBy takes finder attributes, or functions of a row (r => r.dept), not both');
    this._groupBy = (keys as Comparand[]).map(a => this._own(a) as Comparand);
    return this;
  }

  /**
   * One row for the whole of this result, each column named by its key and an aggregate of the rows, as Legend's
   * `aggregate(~total : x | $x.salary : y | $y->plus())`: `rows.aggregate({ total: r => r.salary.sum() })`.
   */
  aggregate(columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): FinderResult {
    return new GroupedRows(this, []).aggregate(columns);
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Skip the first `n` rows. Sort the rows first: without an order, which rows are first is not defined. */
  offset(n: number): this {
    if (!Number.isInteger(n) || n < 0) throw new Error('offset cannot be negative');
    this._offset = n;
    return this;
  }

  /** Rows `start` up to but not including `stop`, counting from 0: `offset(start).limit(stop - start)`. */
  slice(start: number, stop: number): this {
    if (!Number.isInteger(start) || !Number.isInteger(stop) || start < 0 || stop < start) {
      throw new Error('slice needs 0 <= start <= stop');
    }
    return this.offset(start).limit(stop - start);
  }

  /**
   * Keep the groups for which every condition holds: `HAVING`. A condition tests an aggregate or a grouping column:
   * `f.findAll(null, null, [f.category(), countAll()]).groupBy(f.category()).having(countAll().gt(1))`. A group is a
   * column, or an expression: `.groupBy(f.date().year())`.
   * Calls accumulate, as `and` does.
   */
  having(...conditions: Operation[]): this {
    for (const condition of conditions) this._having = this._having === undefined ? condition : this._having.and(condition) as Operation;
    return this;
  }

  /** Return each distinct row once: `SELECT DISTINCT`. A sort on a distinct query has to use a selected column. */
  distinct(): this {
    this._distinct = true;
    return this;
  }

  /** Abort the query and throw QueryTimeoutError if it runs longer than `milliseconds` (default 60000). */
  timeout(milliseconds: number): this {
    this._timeoutMs = milliseconds;
    return this;
  }

  /** The query as SQL, in Postgres unless a dialect is given: `toSql('databricks')`. Nothing is run. */
  toSql(dialect: DialectName | SqlDialect = 'postgres'): string {
    return toSql(
      this._businessDate,
      this._processingDatetime,
      this._columns,
      this._table as Table,
      this._op,
      this._orderBy,
      this._groupBy,
      this._limit,
      this._businessDateTo,
      this._distinct,
      this._offset,
      this._having,
      dialect,
      this._processingDatetimeTo,
    );
  }

  async toRows(): Promise<Row[]> {
    return getRunner().select(
      this._businessDate,
      this._processingDatetime,
      this._columns,
      this._table,
      this._op,
      this._orderBy,
      this._groupBy,
      this._limit,
      this._timeoutMs,
      this._businessDateTo,
      this._distinct,
      this._offset,
      this._having,
      this._processingDatetimeTo,
    );
  }
}

/** A processing date input keeps the precision it was given: a date stays a date, a timestamp a timestamp. */
export function convertProcessingDate(value: Date | string | null): Date | null {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) return new DateOnly(value + 'T00:00:00Z');
  return convertDate(value);
}

export function convertDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  // Zone-less strings (YYYY-MM-DD, or YYYY-MM-DD HH:MM[:SS]) are read as UTC, matching how
  // dates are formatted into SQL, so the value doesn't shift with the machine's timezone.
  let normalized = value;
  if (DATE_ONLY_PATTERN.test(value)) normalized = value + 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) normalized = value.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) throw new Error(`Cannot parse date: ${value}`);
  return d;
}

export function convertInputsAndSelect(
  businessDate: Date | string | null,
  processingDatetime: Date | string | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: QueryTarget,
  op: RelationalOperationElement = new NoOperation(),
): FinderResult {
  return new FinderResult(
    convertDate(businessDate),
    convertProcessingDate(processingDatetime),
    columns,
    table,
    op,
  );
}

export function convertInputsAndSelectForDateRange(
  businessDateFrom: Date | string,
  businessDateTo: Date | string,
  processingDatetime: Date | string | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: QueryTarget,
  op: RelationalOperationElement = new NoOperation(),
): FinderResult {
  if (businessDateFrom == null) throw new Error('businessDateFrom is required for findForDateRange');
  if (businessDateTo == null) throw new Error('businessDateTo is required for findForDateRange');
  // a table with no processing columns, such as a single business date, has no processing time to give
  const milestoning = milestoningColumnsOf(table as unknown as Relation);
  if (processingDatetime == null && milestoning !== undefined && hasProcessingRange(milestoning)) {
    throw new Error('processingTime is required for findForDateRange');
  }
  return new FinderResult(
    convertDate(businessDateFrom),
    convertProcessingDate(processingDatetime),
    columns,
    table,
    op,
    convertDate(businessDateTo),
  );
}

export function convertInputsAndSelectForProcessingRange(
  businessDate: Date | string | null,
  processingFrom: Date | string,
  processingTo: Date | string,
  columns: (Attribute | RelationalOperationElement)[],
  table: QueryTarget,
  op: RelationalOperationElement = new NoOperation(),
): FinderResult {
  if (processingFrom == null) throw new Error('processingFrom is required for findForProcessingRange');
  if (processingTo == null) throw new Error('processingTo is required for findForProcessingRange');
  return new FinderResult(
    convertDate(businessDate),
    convertProcessingDate(processingFrom),
    columns,
    table,
    op,
    null,
    convertProcessingDate(processingTo),
  );
}
