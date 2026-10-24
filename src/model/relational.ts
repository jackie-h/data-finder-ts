export enum ComparisonOperator {
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN_OR_EQUAL_TO = 'LESS_THAN_OR_EQUAL_TO',
  GREATER_THAN_OR_EQUAL_TO = 'GREATER_THAN_OR_EQUAL_TO',
  LIKE = 'LIKE',
  NOT_LIKE = 'NOT_LIKE',
}

/** The character that makes the next one literal in a LIKE pattern built from a value (`contains`, `startsWith`, ...). */
export const LIKE_ESCAPE = '!';

/**
 * `value` as part of a LIKE pattern that matches it literally: `%`, `_` and the escape character itself
 * would otherwise be wildcards.
 */
export function escapeLike(value: string): string {
  return value.replaceAll(LIKE_ESCAPE, LIKE_ESCAPE + LIKE_ESCAPE).replaceAll('%', LIKE_ESCAPE + '%').replaceAll('_', LIKE_ESCAPE + '_');
}

export enum LogicalOperator {
  AND = 'AND',
  OR = 'OR',
}

export enum AggregateOperator {
  COUNT = 'COUNT',
  SUM = 'SUM',
  MIN = 'MIN',
  MAX = 'MAX',
  AVERAGE = 'AVERAGE',
}

export enum ScalarFunction {
  ABS = 'ABS',
  CEILING = 'CEILING',
  FLOOR = 'FLOOR',
  MOD = 'MOD',
  POWER = 'POWER',
  SQRT = 'SQRT',
  ROUND = 'ROUND',
  UPPER = 'UPPER',
  LOWER = 'LOWER',
  TRIM = 'TRIM',
  LTRIM = 'LTRIM',
  RTRIM = 'RTRIM',
  LENGTH = 'LENGTH',
  REVERSE = 'REVERSE',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  REPEAT = 'REPEAT',
  REPLACE = 'REPLACE',
  SUBSTRING = 'SUBSTRING',
  COALESCE = 'COALESCE',
}

export enum DatePart {
  YEAR = 'YEAR',
  MONTH = 'MONTH',
  DAY = 'DAY',
  HOUR = 'HOUR',
  MINUTE = 'MINUTE',
  SECOND = 'SECOND',
  QUARTER = 'QUARTER',
  WEEK = 'WEEK',
  DOW = 'DOW',
}

export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

export abstract class RelationalOperationElement {}

/**
 * Something that can be a column of the result, so can be given a name there:
 * `f.price().sum().alias('Total')`. The name is held by an `Alias` that wraps the column.
 */
export interface Aliasable {
  alias(name: string): Alias;
}

export abstract class Operation extends RelationalOperationElement {
  and(other: RelationalOperationElement): Operation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  /** Combine with `other` using OR. A chain reads left to right: `a.or(b).and(c)` is `(a OR b) AND c`. */
  or(other: RelationalOperationElement): Operation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }
}

export class NoOperation extends Operation {
  and(other: RelationalOperationElement): Operation {
    return other as Operation;
  }

  /** No filter matches every row, so OR-ing anything with it still matches every row. */
  or(_other: RelationalOperationElement): Operation {
    return this;
  }
}

export abstract class ConstantOperation extends RelationalOperationElement implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }
}

export class IntegerConstantOperation extends ConstantOperation {
  constructor(readonly value: number) { super(); }
}

export class FloatConstantOperation extends ConstantOperation {
  constructor(readonly value: number) { super(); }
}

export class StringConstantOperation extends ConstantOperation {
  constructor(readonly value: string) { super(); }
}

/** Matches a zone-less calendar date such as `2024-06-01`. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, held as UTC midnight. JavaScript has no date-only type, so this marks a `Date`
 * that was given as a date rather than a timestamp, and is rendered as a date literal (`'2024-06-01'`)
 * instead of a timestamp literal (`'2024-06-01 00:00:00'`).
 */
export class DateOnly extends Date {}

export class DateConstantOperation extends ConstantOperation {
  constructor(readonly value: Date) { super(); }
}

export class DateTimeConstantOperation extends ConstantOperation {
  constructor(readonly value: Date) { super(); }
}

export class DecimalConstantOperation extends ConstantOperation {
  constructor(readonly value: number) { super(); }
}

export class BooleanConstantOperation extends ConstantOperation {
  constructor(readonly value: boolean) { super(); }
}

export abstract class UnaryOperation extends Operation {
  constructor(readonly element: RelationalOperationElement) { super(); }
}

export abstract class BinaryOperation extends Operation {
  constructor(
    readonly left: RelationalOperationElement,
    readonly right: RelationalOperationElement,
  ) { super(); }
}

export class IsNullOperation extends UnaryOperation {}

export class IsNotNullOperation extends UnaryOperation {}

/** The element is one of `values` (`element IN (...)`). */
export class InOperation extends UnaryOperation {
  constructor(element: RelationalOperationElement, readonly values: ConstantOperation[]) { super(element); }
}

/** The element is none of `values` (`element NOT IN (...)`). */
export class NotInOperation extends UnaryOperation {
  constructor(element: RelationalOperationElement, readonly values: ConstantOperation[]) { super(element); }
}

export class ComparisonOperation extends BinaryOperation {
  constructor(
    left: RelationalOperationElement,
    readonly operator: ComparisonOperator,
    right: RelationalOperationElement,
  ) { super(left, right); }
}

export class LogicalOperation extends BinaryOperation {
  constructor(
    left: RelationalOperationElement,
    readonly operator: LogicalOperator,
    right: RelationalOperationElement,
  ) { super(left, right); }
}

export class WindowSpecification {
  constructor(
    readonly partitionBy: RelationalOperationElement[] = [],
    readonly orderBy: SortOperation[] = [],
  ) {}
}

export class AggregateOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement,
    readonly operator: AggregateOperator,
    readonly displayName?: string,
    readonly window?: WindowSpecification,
  ) { super(element); }

  over(partitionBy?: RelationalOperationElement[], orderBy?: SortOperation[]): AggregateOperation {
    return new AggregateOperation(this.element, this.operator, this.displayName,
      new WindowSpecification(partitionBy ?? [], orderBy ?? []));
  }
}

export enum WindowFunction {
  ROW_NUMBER = 'ROW_NUMBER',
  RANK = 'RANK',
  DENSE_RANK = 'DENSE_RANK',
  NTILE = 'NTILE',
  LAG = 'LAG',
  LEAD = 'LEAD',
  FIRST_VALUE = 'FIRST_VALUE',
  LAST_VALUE = 'LAST_VALUE',
  CUME_DIST = 'CUME_DIST',
  PERCENT_RANK = 'PERCENT_RANK',
}

export class WindowFunctionOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement | null,
    readonly func: WindowFunction,
    readonly displayName?: string,
    readonly secondArg?: number,
    readonly extraArgs: (string | number)[] = [],
    readonly window?: WindowSpecification,
  ) { super(element as RelationalOperationElement); }

  over(partitionBy?: RelationalOperationElement[], orderBy?: SortOperation[]): WindowFunctionOperation {
    return new WindowFunctionOperation(this.element, this.func, this.displayName, this.secondArg,
      [...this.extraArgs], new WindowSpecification(partitionBy ?? [], orderBy ?? []));
  }
}

export class ScalarFunctionOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement,
    readonly func: ScalarFunction,
    readonly displayName?: string,
    readonly secondArg?: number,
    readonly extraArgs: (string | number | boolean)[] = [],
  ) { super(element); }
}

export class DateExtractOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement,
    readonly part: DatePart,
    readonly displayName?: string,
  ) { super(element); }
}

export class DateArithmeticOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement,
    readonly n: number,
    readonly unit: DatePart,
    readonly isAdd: boolean = true,
    readonly displayName?: string,
  ) { super(element); }
}

export class DateDiffOperation extends UnaryOperation implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(
    element: RelationalOperationElement,
    readonly other: Date,
    readonly unit: DatePart,
    readonly displayName?: string,
  ) { super(element); }
}

export class Column extends RelationalOperationElement {
  table?: Table;
  /** Whether the column may hold NULL. As in Legend, a primary key is never null. */
  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly type: string,
    readonly owner?: string,
    readonly primaryKey: boolean = false,
    nullable: boolean = true,
  ) {
    super();
    this.nullable = nullable && !primaryKey;
  }
}

export class ForeignKey {
  constructor(readonly column: Column, readonly references: Column) {}
}

export abstract class DataStore {
  readonly schemas: Schema[] = [];

  constructor(readonly name: string) {}

  abstract namespace(schemaName: string): string;
}

export class Database extends DataStore {
  constructor(name: string, readonly location?: string) { super(name); }

  namespace(schemaName: string): string { return schemaName; }
}

export class DataCatalog extends DataStore {
  constructor(name: string) { super(name); }

  namespace(schemaName: string): string { return `${this.name}.${schemaName}`; }
}

export class Schema {
  readonly tables: Table[] = [];

  constructor(readonly name: string, readonly datastore?: DataStore) {
    datastore?.schemas.push(this);
  }
}

export class Table {
  private readonly _columnsByName: Map<string, Column> = new Map();
  readonly foreignKeys: ForeignKey[] = [];

  constructor(readonly name: string, columns: Column[], readonly schema?: Schema) {
    for (const col of columns) {
      if (this._columnsByName.has(col.name)) {
        throw new Error(`Duplicate column name '${col.name}' in table '${name}'`);
      }
      this._columnsByName.set(col.name, col);
      col.table = this;
    }
    schema?.tables.push(this);
  }

  get columns(): Column[] {
    return Array.from(this._columnsByName.values());
  }

  get qualifiedName(): string {
    if (!this.schema) return this.name;
    if (!this.schema.datastore) return `${this.schema.name}.${this.name}`;
    return `${this.schema.datastore.namespace(this.schema.name)}.${this.name}`;
  }
}

export class JoinOperation {
  filter?: RelationalOperationElement;
  /** Property-equality filters on the join target (property id -> value), set by a related finder given a filter. */
  filterKwargs: Record<string, unknown> = {};
  /** Maps property ids to [column, type, table] for `filterKwargs`. */
  filterColumnMap: Record<string, [string, string, string]> = {};

  constructor(
    readonly name: string,
    readonly target: Table,
    readonly left: Column,
    readonly right: Column,
    filter?: RelationalOperationElement,
  ) {
    this.filter = filter;
  }
}

export class JoinTreeNodeOperation {
  constructor(
    readonly join: JoinOperation,
    readonly parent?: JoinTreeNodeOperation,
  ) {}
}

export class ColumnWithJoin extends RelationalOperationElement {
  /**
   * `embedded` is an alternate reference to a flat (denormalized) column on the owning table that
   * holds the same value without the join; the SQL generator uses it when the join can be elided.
   */
  constructor(
    readonly column: Column,
    readonly parent?: JoinTreeNodeOperation,
    readonly embedded?: ColumnWithJoin,
  ) { super(); }
}

export class SortOperation {
  constructor(
    readonly column: ColumnWithJoin,
    readonly direction: SortDirection,
  ) {}
}

export class CountAllOperation extends RelationalOperationElement implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(readonly table: string) { super(); }
}

/**
 * A column of the result under another name, wrapping the column it names. Only things that can be a
 * column of the result have `alias()` (an `Attribute`, an aggregate, a function, a constant, ...), so a
 * filter cannot be aliased; aliasing an alias replaces its name.
 */
export class Alias extends RelationalOperationElement implements Aliasable {
  constructor(readonly element: RelationalOperationElement, readonly name: string) { super(); }

  alias(name: string): Alias { return new Alias(this.element, name); }
}

/** Returned by `RelatedFinder.exists()`. A backend translates it to a join-presence check. */
export class ExistsOperation extends RelationalOperationElement {
  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  and(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  or(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }
}

/** Returned by `RelatedFinder.notExists()`. A backend translates it to a join-absence check. */
export class NotExistsOperation extends RelationalOperationElement {
  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  and(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  or(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }
}

export class SelectOperation {
  constructor(
    readonly display: RelationalOperationElement[],
    readonly filter: RelationalOperationElement,
    readonly orderBy: SortOperation[] = [],
    readonly groupBy: RelationalOperationElement[] = [],
    readonly limit?: number,
    readonly table?: Table,
    /**
     * Extra ON conditions for this query's joins (milestoning and property filters), keyed by join node.
     * Held here rather than on the shared JoinOperation, so queries that use the same node can't affect each other.
     */
    readonly joinFilters: ReadonlyMap<JoinTreeNodeOperation, Operation> = new Map(),
  ) {}
}
