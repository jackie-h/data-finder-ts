import { Attribute, Comparand } from './attribute';
import {
  ClauseChanges, acceptsGroupBy, buildQuerySpecification, checkViewJoins, columnName, columnOf, columnType, dropped, labelled, madeDistinct,
  querySqlToString, relationNumber, sortedBy, stage, taken, viewSqlToString, withClauses,
} from './sql-generator';
import { typedAttribute } from './typed-attributes';
import { View, ViewDefinitionError } from '../model/view';
import { AsOf, MilestonedTable, hasProcessingRange, milestoningColumnsOf } from '../model/milestoning';
import { DialectName, SqlDialect } from './dialect';
import {
  Alias,
  Relation,
  TableAlias,
  UnionOperation,
  QueryExpression,
  RelationExistsOperation,
  QuerySpecification,
  OrderedQuerySpecification,
  JoinOperation,
  JoinKind,
  Table,
  containsAggregate,
  containsAggregateOrWindow,
  Column,
  ConstantOperation,
  ArithmeticOperation,
  ScalarFunction,
  ScalarFunctionOperation,
  VECTOR_METRICS,
  ComparisonOperation,
  LogicalOperation,
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

  /** Create the view on the backend, replacing any existing view of that name. A runner that cannot, leaves this out. */
  createView?(view: View): Promise<void>;

  /** Return all rows of a view that already exists, ordered by the named view columns. A runner that cannot, leaves this out. */
  selectView?(view: View, orderBy?: string[], timeoutMs?: number): Promise<Row[]>;
}

let _runner: QueryRunner | null = null;

export function registerRunner(runner: QueryRunner): void { _runner = runner; }
export function clearRunner(): void { _runner = null; }
export function getRunner(): QueryRunner {
  if (!_runner) throw new Error('No query runner registered. Call registerRunner() first.');
  return _runner;
}

/**
 * The columns of a relation under a name, as a query that reads from it sees them: a typed attribute for each, named as
 * `columnName` names it and owned by the alias.
 */
function attributes(alias: TableAlias): Map<string, Attribute> {
  const names = alias.columns.map(columnName);
  const duplicates = [...new Set(names.filter(n => names.filter(m => m === n).length > 1))].sort();
  if (duplicates.length > 0) {
    throw new Error(`A result needs each column named once, but ${JSON.stringify(duplicates)} are repeated: name them with alias()`);
  }
  return new Map(alias.columns.map((element, i) => [names[i], typedAttribute(names[i], columnType(element), alias)]));
}

/**
 * A row of a result as a function of it reads it: its columns are attributes, `r.price`, as Legend's `$r.price`. The
 * columns are known when the query is built, so a name that is not one is refused then, with the columns there are.
 * A column's type is what it holds when the query is built, so a row's attributes are loosely typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResultRow = Record<string, any>;

function rowOf(columns: ReadonlyMap<string, unknown>): ResultRow {
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
  const inner = new TableAlias(alias.relation, `relation${relationNumber()}`);
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
  constructor(private readonly _result: FinderResult, private readonly _functions: readonly ((row: ResultRow) => GroupKey)[]) {
    this._keysOf(_result.row());   // a key that is not a column or a named expression is refused when the grouping is written
  }

  /**
   * The keys, read from `row`. `names` are the names of the columns of a select, when the row is of what they are made of: a key
   * that is one of those is named as the column is.
   */
  private _keysOf(row: ResultRow, names?: Map<unknown, string>): (Attribute | Alias)[] {
    const keys: (Attribute | Alias)[] = [];
    for (const key of this._functions) {
      const found = key(row);
      for (let one of (Array.isArray(found) ? found : [found as Attribute | Alias])) {
        const name = names?.get(one);
        if (name !== undefined) one = new Alias(one as RelationalOperationElement, name);
        keys.push(one);
      }
    }
    for (const key of keys) {
      if (key instanceof Attribute) continue;
      if (key instanceof Alias && !(key.element instanceof Alias)) continue;
      throw new TypeError('A groupBy key is a column, or an expression named with alias(): groupBy(r => r.shipDate.year().alias(\'year\'))');
    }
    return keys;
  }

  private _aggregatesOf(row: ResultRow, keys: (Attribute | Alias)[], columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): Alias[] {
    const shown = keys.map(key => (key instanceof Alias ? key.name : key.displayName()));
    const aggregates: Alias[] = [];
    for (const [name, fn] of Object.entries(columns)) {
      const expression = fn(row);
      const element = expression instanceof Attribute ? expression.cwj() : expression;
      if (!containsAggregate(element)) {
        throw new TypeError(`The column '${name}' is not an aggregate of the rows of a group (sum, count, average, min, max, ...), so it has no one value for the group`);
      }
      if (shown.includes(name) || aggregates.some(a => a.name === name)) throw new Error(`The column '${name}' is named twice in this aggregate`);
      aggregates.push(new Alias(element, name));
    }
    return aggregates;
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
    for (const [name, fn] of entries) {
      if (typeof fn !== 'function') throw new TypeError(`The column '${name}' is a function of a row: aggregate({ ${name}: r => r.price.sum() })`);
    }
    const result = this._result;
    const shown = result.shown();
    if (shown !== undefined) {   // the rows are grouped in the select they are read in
      const names = new Map([...shown].map(([name, element]) => [element, name]));
      const made = result.tryFolded(() => {
        const keys = this._keysOf(rowOf(shown), names);
        return { keys, aggregates: this._aggregatesOf(rowOf(shown), keys, columns) };
      });
      if (made !== undefined) return result.grouped(made.keys, made.aggregates);
    }
    const keys = this._keysOf(result.row());
    const aggregates = this._aggregatesOf(result.row(), keys, columns);
    return result.step([...keys, ...aggregates], undefined, keys.map(key => (key instanceof Alias ? key.element : key)) as Comparand[]);
  }
}

/** A result as one side of a union. A union of the same operator is that union itself, not a SELECT over it, so `a.concatenate(b).concatenate(c)` is one flat chain of unions. */
function unionSide(result: FinderResult, all: boolean): QueryExpression {
  const query = result.query();
  const table = query.table;
  if (table instanceof TableAlias && table.relation instanceof UnionOperation && table.relation.all === all
      && query.filter instanceof NoOperation && query.groupBy.length === 0 && !query.distinct && query.having === undefined
      && query.limit === undefined && query.offset === undefined && query.orderBy.length === 0) {
    return table.relation;
  }
  return labelled(query);
}

/**
 * The rows of a query. A step written after it gives a result of its own and leaves this one as it was.
 *
 * A result is a query (`query()`) and the relation it is read as by the step after it (`relation()`). A step that comes next in a SELECT's
 * order, or can be part of its columns and conditions, is folded into that SELECT; any other is a SELECT over it.
 */
export class FinderResult {
  private _query!: OrderedQuerySpecification;
  private _timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private _alias!: TableAlias;

  constructor(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    businessDateTo: Date | null = null,
    processingDatetimeTo: Date | null = null,
    query?: OrderedQuerySpecification,
  ) {
    this._start(query ?? buildQuerySpecification(
      businessDate, processingDatetime, columns, table as unknown as Relation, op, [], [], undefined, businessDateTo, false, undefined, undefined,
      processingDatetimeTo));
  }

  private _start(query: OrderedQuerySpecification, timeoutMs: number = DEFAULT_TIMEOUT_MS, relationName?: string): void {
    this._query = query;
    this._timeoutMs = timeoutMs;
    // the query as a relation that a step reads, which the columns of this result belong to
    this._alias = new TableAlias(labelled(query), relationName ?? `relation${relationNumber()}`);
  }

  /** @internal The query of this result. */
  query(): OrderedQuerySpecification { return this._query; }

  /** The dates the rows are read as of. */
  private get _asOf(): AsOf {
    const asOf = this._query.asOf;
    if (asOf === undefined) throw new Error('A result has the dates it is read as of');
    return asOf;
  }

  /** A result of a step written after this one. */
  private _then(query: OrderedQuerySpecification): FinderResult {
    const result = Object.create(FinderResult.prototype) as FinderResult;
    // a change to the same select shows the columns of this result, so it is the same relation
    result._start(query, this._timeoutMs, query.table === this._query.table ? this._alias.name : undefined);
    return result;
  }

  // --- a result as a relation, for what follows it ---------------------------------------------------------------------------

  /** @internal This result as a relation: its query, with each column named for what reads it. */
  relation(): { alias: TableAlias; attributes: Map<string, Attribute> } {
    return { alias: this._alias, attributes: attributes(this._alias) };
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
    const left = this.columnNames();
    const right = other.columnNames();
    if (left.join('\u0000') !== right.join('\u0000')) {
      throw new Error(`Concatenated results need the same columns: ${JSON.stringify(left)} and ${JSON.stringify(right)} differ`);
    }
    const all = options.all ?? false;
    return this._of(new TableAlias(new UnionOperation(unionSide(this, all), unionSide(other, all), all), `relation${relationNumber()}`));
  }

  /** A result of every column of a relation that is read under a name of its own. */
  private _of(alias: TableAlias): FinderResult {
    return this._then(buildQuerySpecification(null, null, [...attributes(alias)].map(([name, attribute]) => attribute.alias(name)), alias, new NoOperation()));
  }

  /** @internal A row of this result, for the functions of a step. */
  row(): ResultRow { return rowOf(this.relation().attributes); }

  /**
   * What this result shows, by the name that reads it, when a step can be part of its select: each column is what it is worked out
   * from, so a condition or a column made of them is written over the columns of the select and not over a select of it. Nothing when
   * the select has gone beyond what a step can be added to: it groups, is distinct, is ordered, offset or limited (a step comes after
   * those), or shows an aggregate, a window or something that is not a column, a constant, arithmetic or a function.
   * @internal
   */
  shown(): Map<string, RelationalOperationElement | Attribute> | undefined {
    const query = this._query;
    if (stage(query) !== 0 || query.groupBy.length > 0 || query.having !== undefined) return undefined;
    const shown = new Map<string, RelationalOperationElement | Attribute>();
    for (const column of query.columns) {
      let element: RelationalOperationElement | Attribute = column;
      while (element instanceof Alias) element = element.element;
      const simple = element instanceof Attribute || element instanceof ColumnWithJoin || element instanceof Column
        || element instanceof ConstantOperation || element instanceof ArithmeticOperation || element instanceof ScalarFunctionOperation
        || element instanceof ComparisonOperation || element instanceof LogicalOperation;
      if (!simple || containsAggregateOrWindow(element)) return undefined;
      const name = columnName(column);
      if (shown.has(name)) return undefined;   // a name twice is refused when a step reads this result as a relation
      shown.set(name, element);
    }
    return shown;
  }

  /**
   * What a step makes of the columns of the select, or nothing when one of them is something that has not what a column of a
   * relation has (a method of an attribute): it is then read as a column of the select.
   * @internal
   */
  tryFolded<T>(make: () => T): T | undefined {
    try {
      return make();
    } catch (error) {
      if (error instanceof TypeError) return undefined;
      throw error;
    }
  }

  /** @internal This result's rows grouped by `keys`, with `aggregates` over each group, in its own select. */
  grouped(keys: (Attribute | Alias)[], aggregates: Alias[]): FinderResult {
    return this._then(withClauses(this._query, {
      columns: [...keys, ...aggregates], groupBy: keys.map(key => (key instanceof Alias ? key.element : key)) as Comparand[],
    }));
  }

  /** This result with a step added to its select. */
  private _folded(changes: ClauseChanges): FinderResult {
    return this._then(withClauses(this._query, changes));
  }

  /** @internal A result that reads from this one: a query over this result's query. */
  step(display: (Attribute | RelationalOperationElement)[], op?: Operation, groupBy: Comparand[] = []): FinderResult {
    return this._then(buildQuerySpecification(null, null, display, this._alias, op ?? new NoOperation(), [], groupBy));
  }

  /**
   * The rows of this result for which every condition holds, as Legend's `filter(r | $r.price > 250)`: each condition is a
   * function of a row that reads its columns as attributes, including one that a window function, an aggregate or `extend`
   * made, which a `WHERE` over the rows themselves cannot do:
   *
   *     rows.filter(r => r.price.gt(250))
   */
  filter(...conditions: ((row: ResultRow) => Operation)[]): FinderResult {
    for (const condition of conditions) {
      if (typeof condition !== 'function') throw new TypeError('A filter condition is a function of a row: filter(r => r.price.gt(250))');
    }
    const together = (row: ResultRow): Operation | undefined => {
      let op: Operation | undefined;
      for (const condition of conditions) op = op === undefined ? condition(row) : op.and(condition(row)) as Operation;
      return op;
    };
    const shown = this.shown();
    if (shown !== undefined) {
      const op = this.tryFolded(() => together(rowOf(shown)));
      if (op !== undefined) {
        const asked = this._query.filter;
        return this._folded({ filter: asked instanceof NoOperation ? op : asked instanceof Operation ? asked.and(op) : op });
      }
    }
    return this.step([...this.relation().attributes.values()], together(this.row()));
  }

  /**
   * This result with more columns, each named by its key and worked out from a row, as Legend's `extend(~top : r | ...)`. A
   * window adds an aggregate over the rows to each row:
   *
   *     rows.extend({ double: r => r.price.times(2), top: r => r.price.max().over([r.account]) })
   */
  extend(columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): FinderResult {
    for (const [name, expression] of Object.entries(columns)) {
      if (typeof expression !== 'function') throw new TypeError(`The column '${name}' is a function of a row: extend({ ${name}: r => ... })`);
    }
    const madeOf = (row: ResultRow): Alias[] => Object.entries(columns).map(([name, expression]) => {
      const value = expression(row);
      return value instanceof Attribute ? value.alias(name) : new Alias(value, name);
    });
    const shown = this.shown();
    if (shown !== undefined && !Object.keys(columns).some(name => shown.has(name))) {
      const made = this.tryFolded(() => madeOf(rowOf(shown)));
      // a window keeps every row, so it is a column of this select, though nothing after it can fold
      if (made !== undefined && !made.some(m => containsAggregate(m))) return this._folded({ columns: [...this._query.columns, ...made] });
    }
    return this.step([...this.relation().attributes.values(), ...madeOf(this.row())]);
  }

  /** Only some of this result's columns, by name, as Legend's `select(~[sym, price])`. To rename or work out a column use `extend` first. */
  select(...names: string[]): FinderResult {
    const { attributes: columns } = this.relation();
    const missing = names.filter(n => !columns.has(n));
    if (missing.length > 0) throw new Error(`No column ${JSON.stringify(missing)} in this result: its columns are ${JSON.stringify([...columns.keys()])}`);
    if (this.shown() !== undefined) {   // the columns of the select that are asked for, in the order asked for
      const byName = new Map(this._query.columns.map(c => [columnName(c), c]));
      return this._folded({ columns: names.map(n => byName.get(n)!) });
    }
    return this.step(names.map(n => columns.get(n)!.alias(n)));
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
    return this._of(new TableAlias(joined, `relation${relationNumber()}`));
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
  groupBy(...attrs: Comparand[]): FinderResult;
  groupBy(...keys: (Comparand | ((row: ResultRow) => GroupKey))[]): GroupedRows | FinderResult {
    const functions = keys.map(k => typeof k === 'function');
    if (keys.length > 0 && functions.every(Boolean)) return new GroupedRows(this, keys as ((row: ResultRow) => GroupKey)[]);
    if (functions.some(Boolean)) throw new TypeError('groupBy takes finder attributes, or functions of a row (r => r.dept), not both');
    return this._then(withClauses(this._read('groupBy'), { groupBy: (keys as Comparand[]).map(a => this._own(a) as Comparand) }));
  }

  /**
   * The query of the rows a finder reads, which is what `groupBy` and `having` apply to. They come before a distinct, an order, an offset
   * and a limit, so they cannot follow one.
   */
  private _read(name: string): OrderedQuerySpecification {
    if (!acceptsGroupBy(this._query)) {
      throw new Error(`${name} applies to the rows a finder reads, so it comes before distinct, orderBy, offset and limit: write ${name} first, `
        + `or group the rows after them with groupBy(r => ...).aggregate(...)`);
    }
    return this._query;
  }

  /**
   * One row for the whole of this result, each column named by its key and an aggregate of the rows, as Legend's
   * `aggregate(~total : x | $x.salary : y | $y->plus())`: `rows.aggregate({ total: r => r.salary.sum() })`.
   */
  aggregate(columns: Record<string, (row: ResultRow) => RelationalOperationElement | Attribute>): FinderResult {
    return new GroupedRows(this, []).aggregate(columns);
  }

  /**
   * A column of this result, as `column(name)` gives it, is what this result shows under that name: so
   * `rows.orderBy(rows.column('name').ascending())` orders by the column, not by a column of a later query.
   */
  private _own<T extends RelationalOperationElement | Attribute>(element: T): T | RelationalOperationElement | Attribute {
    const column = columnOf(element);
    if (column === undefined || !(column.owner instanceof TableAlias) || column.owner.name !== this._alias.name) return element;
    const shown = new Map(this._query.columns.map(c => [columnName(c), c]));
    const found = shown.get(column.name);
    if (found === undefined) return element;
    const inner = found instanceof Alias ? found.element : found;
    // a column is ordered by itself, and an expression by the name it is selected under
    return inner instanceof Attribute ? inner.cwj() : found;
  }

  /**
   * Order the rows. Calls accumulate: the sorts of the latest call take priority and earlier ones order the
   * rows it leaves tied, as in a chain of `sortBy` calls. Sorting a column again replaces its earlier direction.
   * Rows that are already dropped or taken are ordered after that, as a step over them.
   */
  orderBy(...given: SortOperation[]): FinderResult {
    const sorts = given.map(s => new SortOperation(this._own(s.column) as RelationalOperationElement, s.direction, s.nullsFirst));
    const source = this._query.table;
    if (source instanceof TableAlias && source.name.startsWith('relation')) {   // a step over a result, not over a mapped query
      for (const sort of sorts) {
        const column = columnOf(sort.column);
        if (column !== undefined && column.owner instanceof Table) {
          throw new Error(`The rows of a step are ordered by the columns of the result before it: ${JSON.stringify(this.columnNames())} `
            + `(result.column('${column.name}').ascending()), not by a column of the table it was first read from`);
        }
      }
    }
    return this._then(sortedBy(this._query, sorts));
  }

  /**
   * The `k` rows nearest to a vector: those with the smallest `cosineDistance` or `l2Distance` of a vector column, or the largest
   * `innerProduct` (a similarity, so the nearest are the most similar), the nearest first. A row with no vector comes after all that
   * have one. It is an exact search of the rows the query reads, and an engine may answer it from an approximate index:
   *
   *     f.findAll([f.name(), distance], f.category().eq('Technology')).nearest(distance, 10)
   */
  nearest(distance: ScalarFunctionOperation, k: number): FinderResult {
    if (!(distance instanceof ScalarFunctionOperation) || !VECTOR_METRICS.has(distance.func)) {
      throw new Error('nearest is of a cosineDistance, l2Distance or innerProduct of a vector column');
    }
    if (!(k >= 1)) throw new Error('nearest needs at least one row: k >= 1');
    const largest = distance.func === ScalarFunction.INNER_PRODUCT;
    return this.orderBy(largest ? distance.descending({ nulls: 'last' }) : distance.ascending({ nulls: 'last' })).limit(k);
  }

  /** The first `n` rows. Taking again takes from the rows taken. */
  limit(n: number): FinderResult {
    return this._then(taken(this._query, n));
  }

  /**
   * Skip the first `n` rows. Sort the rows first: without an order, which rows come first is not defined. Rows that were already taken are
   * skipped after that: `limit(5).offset(2)` is three rows.
   */
  offset(n: number): FinderResult {
    if (!Number.isInteger(n) || n < 0) throw new Error('offset cannot be negative');
    return this._then(dropped(this._query, n));
  }

  /** Rows `start` up to but not including `stop`, counting from 0: `offset(start).limit(stop - start)`. */
  slice(start: number, stop: number): FinderResult {
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
  having(...conditions: Operation[]): FinderResult {
    const read = this._read('having');
    let having = read.having;
    for (const condition of conditions) having = having === undefined ? condition : having.and(condition) as Operation;
    return this._then(withClauses(read, { having }));
  }

  /** Return each distinct row once: `SELECT DISTINCT`. */
  distinct(): FinderResult {
    return this._then(madeDistinct(this._query));
  }

  /** Abort the query and throw QueryTimeoutError if it runs longer than `milliseconds` (default 60000). */
  timeout(milliseconds: number): this {
    this._timeoutMs = milliseconds;
    return this;
  }

  /**
   * Define a SQL view from this query: `schema.name`.
   *
   * A view has no dates, so `findAll` must have been called with `null` for the business date and processing time. The view
   * exposes the root table's milestoning columns instead, and every joined milestoned table is pinned to the version that
   * applied when the root row was recorded. A view also has no ORDER BY or row limit; to order the rows you read back use
   * `ViewDefinition.result().orderBy()`. Each column is named after its display name in snake_case, e.g. "Account Name"
   * becomes `account_name`.
   */
  toView(name: string, schema: string): ViewDefinition {
    const q = this._query;
    const a = this._asOf;
    if (a.businessDate !== null || a.businessDateTo !== null || a.processingDatetime !== null || a.processingDatetimeTo !== null) {
      throw new ViewDefinitionError(
        'A view has no dates: pass null for the business date and processing time, and the view will expose the milestoning columns instead');
    }
    if (q.distinct) throw new ViewDefinitionError('A view cannot be distinct');
    if (q.offset !== undefined) throw new ViewDefinitionError('A view has no row offset');
    if (q.having !== undefined) throw new ViewDefinitionError('A view has no HAVING; filter the rows you read back from it');
    if (q.orderBy.length > 0 || q.limit !== undefined) {
      throw new ViewDefinitionError('A view has no ORDER BY or row limit; order the rows when you read them with result().orderBy()');
    }
    if (!(q.table instanceof Table)) throw new ViewDefinitionError('A view is defined over a table, not over a union');
    const projection = q.columns.map(column => (column instanceof Alias ? column : new Alias(column, columnName(column))));
    const view = new ViewDefinition(name, schema, q.table, projection, q.filter, [...q.groupBy]);
    checkViewJoins(view);
    return view;
  }

  /** The query as SQL, in Postgres unless a dialect is given: `toSql('databricks')`. Nothing is run. */
  toSql(dialect: DialectName | SqlDialect = 'postgres'): string {
    return querySqlToString(this._query, dialect);
  }

  async toRows(): Promise<Row[]> {
    const q = this._query;
    const a = this._asOf;
    return getRunner().select(
      a.businessDate, a.processingDatetime, q.columns as (Attribute | RelationalOperationElement)[], q.table as unknown as QueryTarget, q.filter,
      q.orderBy, q.groupBy as Comparand[], q.limit, this._timeoutMs, a.businessDateTo, q.distinct, q.offset, q.having, a.processingDatetimeTo);
  }
}

/** A relational View that can render itself as DDL and be read back through a ViewResult. */
export class ViewDefinition extends View {
  /** `CREATE OR REPLACE VIEW` DDL, in Postgres or transpiled to `dialect` (e.g. 'databricks'). */
  toSql(dialect: DialectName | SqlDialect = 'postgres'): string {
    return viewSqlToString(this, dialect);
  }

  /** The view's rows, read by creating it on the registered runner's backend. */
  result(): ViewResult {
    return new ViewResult(this);
  }
}

/**
 * The rows of a view.
 *
 * `toSql()` is the view's CREATE VIEW DDL. `toRows()` has the registered runner create the view, then select all of its rows.
 * Like FinderResult, nothing runs until rows are asked for.
 *
 * A view has no ORDER BY, so its rows come back in no particular order; `orderBy` orders the read-back (not the view) by output
 * column name.
 */
export class ViewResult {
  private _orderBy: string[] = [];
  private _timeoutMs: number = DEFAULT_TIMEOUT_MS;

  constructor(private readonly _view: View) {}

  orderBy(...columns: string[]): this {
    const unknown = columns.filter(c => !this._view.columnNames().includes(c));
    if (unknown.length > 0) {
      throw new Error(`Unknown view columns ${JSON.stringify(unknown)} — valid columns are: ${JSON.stringify(this._view.columnNames())}`);
    }
    this._orderBy = columns;
    return this;
  }

  timeout(milliseconds: number): this {
    this._timeoutMs = milliseconds;
    return this;
  }

  toSql(dialect: DialectName | SqlDialect = 'postgres'): string {
    return viewSqlToString(this._view, dialect);
  }

  async toRows(): Promise<Row[]> {
    const runner = getRunner();
    if (runner.createView === undefined || runner.selectView === undefined) {
      throw new Error('The registered runner does not support views: it has no createView and selectView');
    }
    await runner.createView(this._view);
    return runner.selectView(this._view, this._orderBy, this._timeoutMs);
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
