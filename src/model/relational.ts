export enum ComparisonOperator {
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN_OR_EQUAL_TO = 'LESS_THAN_OR_EQUAL_TO',
  GREATER_THAN_OR_EQUAL_TO = 'GREATER_THAN_OR_EQUAL_TO',
  LIKE = 'LIKE',
  NOT_LIKE = 'NOT_LIKE',
  /** A regular expression searched anywhere in the text. */
  MATCHES = 'MATCHES',
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
  STRING_AGG = 'STRING_AGG',
  COUNT_DISTINCT = 'COUNT_DISTINCT',
  STDDEV_SAMP = 'STDDEV_SAMP',
  STDDEV_POP = 'STDDEV_POP',
  VAR_SAMP = 'VAR_SAMP',
  VAR_POP = 'VAR_POP',
  BOOL_AND = 'BOOL_AND',
  BOOL_OR = 'BOOL_OR',
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
  SIN = 'SIN',
  COS = 'COS',
  TAN = 'TAN',
  ASIN = 'ASIN',
  ACOS = 'ACOS',
  ATAN = 'ATAN',
  ATAN2 = 'ATAN2',
  EXP = 'EXP',
  LOG = 'LOG',
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

import type { MilestoningColumns } from './milestoning';

export abstract class RelationalOperationElement {}

/**
 * Something that can be a column of the result, so can be given a name there:
 * `f.price().sum().alias('Total')`. The name is held by an `Alias` that wraps the column.
 */
export interface Aliasable {
  alias(name: string): Alias;
}

/** Something the result can be ordered by: `f.id().count().ascending()`. */
export interface Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation;
  /** Sort by this expression, largest first. */
  descending(): SortOperation;
}

export abstract class Operation extends RelationalOperationElement implements Aliasable {
  /** Name this column in the result: `f.price().sum().alias('Total')`, `f.age().gt(30).alias('Adult')`. */
  alias(name: string): Alias { return new Alias(this, name); }

  and(other: RelationalOperationElement): Operation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  /** The condition does not hold: `f.name().startsWith('Acme').not()`. */
  not(): Operation { return new NotOperation(this); }

  /** Combine with `other` using OR. A chain reads left to right: `a.or(b).and(c)` is `(a OR b) AND c`. */
  or(other: RelationalOperationElement): Operation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }
}

export class NoOperation extends Operation {
  and(other: RelationalOperationElement): Operation {
    return other as Operation;
  }

  /** No filter matches every row, so there is nothing to negate. */
  not(): Operation { throw new Error('No condition to negate: a query with no filter matches every row'); }

  /** No filter matches every row, so OR-ing anything with it still matches every row. */
  or(_other: RelationalOperationElement): Operation {
    return this;
  }
}

export abstract class ConstantOperation extends RelationalOperationElement implements Aliasable, Sortable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  /** @internal The expression a function of this constant applies to: the constant itself. */
  functionInput(): RelationalOperationElement { return this; }

  /** @internal What a function of this constant is labelled after: its value, as text. */
  functionLabel(): string {
    const value = (this as unknown as { value: unknown }).value;
    if (value instanceof DateOnly) return value.toISOString().slice(0, 10);
    if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
    return String(value);
  }
}

/** A constant that is a number, so it can be an operand of arithmetic: `constant(100).minus(f.price())`. */
export abstract class NumericConstantOperation extends ConstantOperation {
  abstract readonly value: number;

  arithmeticOperand(): RelationalOperationElement { return this; }
  comparisonOperand(): RelationalOperationElement { return this; }
}

export class IntegerConstantOperation extends NumericConstantOperation {
  constructor(readonly value: number) { super(); }
  numberKind(): 'integer' { return 'integer'; }
  aggregateKind(): AggregateConstructor<IntegerAggregateOperation> { return IntegerAggregateOperation; }
}

export class FloatConstantOperation extends NumericConstantOperation {
  constructor(readonly value: number) { super(); }
  numberKind(): 'double' { return 'double'; }
  aggregateKind(): AggregateConstructor<DoubleAggregateOperation> { return DoubleAggregateOperation; }
}

export class StringConstantOperation extends ConstantOperation {
  constructor(readonly value: string) { super(); }
  comparisonOperand(): RelationalOperationElement { return this; }
}

/** Matches a zone-less calendar date such as `2024-06-01`. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, held as UTC midnight. JavaScript has no date-only type, so this marks a `Date`
 * that was given as a date rather than a timestamp, and is rendered as a date literal (`'2024-06-01'`)
 * instead of a timestamp literal (`'2024-06-01 00:00:00'`).
 */
export class DateOnly extends Date {
  /** Only for the types: a plain `Date` is not a `DateOnly`, so `constant(date)` can tell a date from a timestamp. */
  declare readonly dateOnly: true;
}

export class DateConstantOperation extends ConstantOperation {
  constructor(readonly value: Date) { super(); }
  comparisonOperand(): RelationalOperationElement { return this; }
}

export class DateTimeConstantOperation extends ConstantOperation {
  constructor(readonly value: Date) { super(); }
  comparisonOperand(): RelationalOperationElement { return this; }
}

export class DecimalConstantOperation extends NumericConstantOperation {
  constructor(readonly value: number) { super(); }
  numberKind(): 'decimal' { return 'decimal'; }
  aggregateKind(): AggregateConstructor<DecimalAggregateOperation> { return DecimalAggregateOperation; }
}

export class BooleanConstantOperation extends ConstantOperation {
  constructor(readonly value: boolean) { super(); }
  comparisonOperand(): RelationalOperationElement { return this; }
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

/** The condition does not hold: `NOT (element)`. Negating it again gives the condition. */
export class NotOperation extends UnaryOperation {
  not(): Operation { return this.element as Operation; }
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

export class AggregateOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(
    element: RelationalOperationElement,
    readonly operator: AggregateOperator,
    readonly displayName?: string,
    readonly window?: WindowSpecification,
    /** For STRING_AGG: what goes between the values. */
    readonly separator?: string,
    /** For STRING_AGG: the order the values are joined in. */
    readonly orderBy: SortOperation[] = [],
  ) { super(element); }

  arithmeticOperand(): RelationalOperationElement { return this; }
  comparisonOperand(): RelationalOperationElement { return this; }

  /** The same aggregate over a window of rows instead of a group: it keeps its type. */
  over(partitionBy?: RelationalOperationElement[], orderBy?: SortOperation[]): this {
    const kind = this.constructor as new (...args: ConstructorParameters<typeof AggregateOperation>) => this;
    return new kind(this.element, this.operator, this.displayName,
      new WindowSpecification(partitionBy ?? [], orderBy ?? []), this.separator, this.orderBy);
  }
}

/** The constructor of an aggregate, which an expression says it gives. */
export type AggregateConstructor<A extends AggregateOperation> = new (
  element: RelationalOperationElement, operator: AggregateOperator, displayName?: string,
  window?: WindowSpecification, separator?: string, orderBy?: SortOperation[],
) => A;

/** An aggregate of an expression whose type is not known: it takes any comparison. */
export class UntypedAggregateOperation extends AggregateOperation {
  numberKind(): 'unknown' { return 'unknown'; }
}
/** An aggregate that gives a whole number: a count, or the sum, minimum or maximum of integers. */
export class IntegerAggregateOperation extends AggregateOperation {
  numberKind(): 'integer' { return 'integer'; }
}
/** An aggregate that gives a floating-point number: an average, a standard deviation, a variance, or the sum of doubles. */
export class DoubleAggregateOperation extends AggregateOperation {
  numberKind(): 'double' { return 'double'; }
}
/** An aggregate that gives a decimal. */
export class DecimalAggregateOperation extends AggregateOperation {
  numberKind(): 'decimal' { return 'decimal'; }
}
/** An aggregate that gives text: the minimum or maximum of text, or text joined. */
export class StringAggregateOperation extends AggregateOperation {}
/** An aggregate that gives a boolean: `all` or `any` of a condition. */
export class BooleanAggregateOperation extends AggregateOperation {}
/** An aggregate that gives a date. */
export class DateAggregateOperation extends AggregateOperation {}
/** An aggregate that gives a timestamp. */
export class DateTimeAggregateOperation extends AggregateOperation {}

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

export class WindowFunctionOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

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

export class ScalarFunctionOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(
    element: RelationalOperationElement,
    readonly func: ScalarFunction,
    readonly displayName?: string,
    readonly secondArg?: number,
    readonly extraArgs: (string | number | boolean)[] = [],
    /** The type the result is cast to, where the database's function gives another: an integer power is a `BIGINT`. */
    readonly cast?: string,
  ) { super(element); }

  /** This expression as an operand of a comparison. */
  comparisonOperand(): RelationalOperationElement { return this; }
}

export class DateExtractOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(
    element: RelationalOperationElement,
    readonly part: DatePart,
    readonly displayName?: string,
  ) { super(element); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

/** The first day of the week, month, quarter or year that the date falls in, as a date. */
export class DateTruncOperation extends UnaryOperation implements Sortable {
  constructor(
    element: RelationalOperationElement,
    readonly part: DatePart,
    readonly displayName?: string,
  ) { super(element); }

  /** Sort by this expression, earliest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, latest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

export class DateArithmeticOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(
    element: RelationalOperationElement,
    readonly n: number,
    readonly unit: DatePart,
    readonly isAdd: boolean = true,
    readonly displayName?: string,
  ) { super(element); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

export class DateDiffOperation extends UnaryOperation implements Sortable {
  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(
    element: RelationalOperationElement,
    /** What the element is measured against: a date or timestamp, or a column or expression. */
    readonly other: Date | RelationalOperationElement,
    readonly unit: DatePart,
    readonly displayName?: string,
  ) { super(element); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

export class Column extends RelationalOperationElement {
  /**
   * The relation the column belongs to, as in Legend. A Table gives the columns it is made of their owner, so a column
   * that is only in a table's list needs none.
   */
  owner?: Relation;
  /** Whether the column may hold NULL. As in Legend, a primary key is never null. */
  readonly nullable: boolean;

  constructor(
    readonly name: string,
    readonly type: string,
    owner?: Relation,
    readonly primaryKey: boolean = false,
    nullable: boolean = true,
  ) {
    super();
    if (typeof owner === 'string') {
      throw new TypeError(`A column is owned by a Relation, not by the name '${owner}': give the table`);
    }
    this.owner = owner;
    this.nullable = nullable && !primaryKey;
  }

  /** The relation the column belongs to. Throws when it has none: it is not a column of any relation. */
  get ownerRelation(): Relation {
    if (this.owner === undefined) {
      throw new Error(`Column '${this.name}' has no owner: it is not a column of any relation, so there is nothing to read it from`);
    }
    return this.owner;
  }

  /** What the owner is called where it is read: a table's qualified name. */
  get ownerName(): string {
    const owner = this.ownerRelation;
    if (!(owner instanceof NamedRelation)) {
      throw new TypeError(`Column '${this.name}' belongs to ${owner.constructor.name}, which has no name to read it by`);
    }
    return owner.qualifiedName;
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

/**
 * Something rows are read from, as in Legend: it has columns. A table and a query are relations. As in Legend a column
 * is a RelationalOperationElement: a table's are its Columns, a query's are the expressions it shows.
 */
export abstract class Relation {
  abstract get columns(): readonly RelationalOperationElement[];
}

/** A relation that has a name: a table. */
export abstract class NamedRelation extends Relation {
  constructor(readonly name: string) { super(); }

  /** What the relation is called where it is read: a table's name with its schema's. */
  get qualifiedName(): string { return this.name; }
}

export class Table extends NamedRelation {
  private readonly _columnsByName: Map<string, Column> = new Map();
  readonly foreignKeys: ForeignKey[] = [];

  constructor(name: string, columns: Column[], readonly schema?: Schema) {
    super(name);
    for (const col of columns) {
      if (this._columnsByName.has(col.name)) {
        throw new Error(`Duplicate column name '${col.name}' in table '${name}'`);
      }
      this._columnsByName.set(col.name, col);
      col.owner = this;
    }
    schema?.tables.push(this);
  }

  get columns(): Column[] {
    return Array.from(this._columnsByName.values());
  }

  override get qualifiedName(): string {
    if (!this.schema) return this.name;
    if (!this.schema.datastore) return `${this.schema.name}.${this.name}`;
    return `${this.schema.datastore.namespace(this.schema.name)}.${this.name}`;
  }
}

/**
 * A relation under a name where it is used, as in Legend and as ANSI SQL's `<table reference>` with its
 * `<correlation name>`: `(query) AS t1`. It has the columns of the relation it names; what reads those columns says
 * which alias they belong to by its name. A table is already named, so this is for a relation that is not: a query.
 */
export class TableAlias extends NamedRelation {
  /** For a query a class is mapped to with a milestoning scheme: the columns the query gives that milestone it, which the alias owns. */
  milestoningColumns?: MilestoningColumns;
  private _own?: Column[];

  /**
   * `own` are the columns of the alias itself, for a query a class is mapped to: typed columns the alias owns, which a finder's
   * attributes read. Without them the alias has the columns of the relation it names.
   */
  constructor(readonly relation: Relation, name: string, own?: Column[]) {
    super(name);
    if (own !== undefined) {
      this._own = own;
      for (const column of own) column.owner = this;
    }
  }

  get columns(): readonly RelationalOperationElement[] { return this._own ?? this.relation.columns; }

  /** The alias's own column of that name; one it has not got yet is made, owned by the alias. */
  column(name: string, type: string): Column {
    this._own ??= [];
    let found = this._own.find(c => c.name === name);
    if (found === undefined) {
      found = new Column(name, type, this);
      this._own.push(found);
    }
    return found;
  }
}

export class JoinOperation {
  filter?: RelationalOperationElement;
  /** Property-equality filters on the join target (property id -> value), set by a related finder given a filter. */
  filterKwargs: Record<string, unknown> = {};
  /** Maps property ids to [column, type, owner] for `filterKwargs`. */
  filterColumnMap: Record<string, [string, string, Relation]> = {};

  constructor(
    readonly name: string,
    readonly target: Table | TableAlias,
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
    /**
     * True when the property this step follows is to-many, so a value read through it repeats the row. As in
     * Pure, that is the multiplicity of the property, not something the join itself says.
     */
    readonly many: boolean = false,
    /** True when the property this step follows can be missing (its lower bound is 0). */
    readonly optional: boolean = false,
    /**
     * The dates this step was given for the milestoned table it reaches, if any. They are the ones it uses, and the
     * ones every step below it uses unless it is given its own; a step with none uses those of the step above it,
     * and at the top the query's.
     */
    readonly businessDate: Date | null = null,
    readonly processingDatetime: Date | null = null,
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
    private readonly _optional: boolean = false,
  ) { super(); }

  /** Whether the value can be missing: its property is optional, or a navigation on the way to it is. */
  get optional(): boolean {
    for (let node = this.parent; node !== undefined; node = node.parent) {
      if (node.optional) return true;
    }
    return this._optional;
  }
}

export class SortOperation {
  constructor(
    /** What the rows are ordered by: a column, or an expression such as an aggregate. */
    readonly column: RelationalOperationElement,
    readonly direction: SortDirection,
  ) {}
}

export class CountAllOperation extends RelationalOperationElement implements Aliasable, Sortable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  constructor(readonly table: string) { super(); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

/**
 * A column of the result under another name, wrapping the column it names. Only things that can be a
 * column of the result have `alias()` (an `Attribute`, an aggregate, a function, a constant, ...), so a
 * filter cannot be aliased; aliasing an alias replaces its name.
 */
export class Alias extends RelationalOperationElement implements Aliasable, Sortable {
  constructor(readonly element: RelationalOperationElement, readonly name: string) { super(); }

  alias(name: string): Alias { return new Alias(this.element, name); }

  /** Sorts by the column the alias names. */
  ascending(): SortOperation { return new SortOperation(this.element, SortDirection.ASC); }

  /** Sorts by the column the alias names. */
  descending(): SortOperation { return new SortOperation(this.element, SortDirection.DESC); }
}

/** `CASE WHEN condition THEN then ELSE fallback END`; without a `fallback` the value is NULL. */
export class CaseOperation extends Operation {
  constructor(
    readonly condition: RelationalOperationElement,
    readonly then: RelationalOperationElement,
    readonly fallback?: RelationalOperationElement,
    readonly displayName?: string,
  ) { super(); }
}

/** Returned by `RelatedFinder.exists()`. A backend translates it to a join-presence check. */
export class ExistsOperation extends RelationalOperationElement implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  and(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  or(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }

  /** The step reaches no row: `notExists()`. */
  not(): NotExistsOperation { return new NotExistsOperation(this.node); }
}

/** Returned by `RelatedFinder.notExists()`. A backend translates it to a join-absence check. */
export class NotExistsOperation extends RelationalOperationElement implements Aliasable {
  /** Name this column in the result. */
  alias(name: string): Alias { return new Alias(this, name); }

  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  and(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }

  or(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.OR, other);
  }

  /** The step reaches a row: `exists()`. */
  not(): ExistsOperation { return new ExistsOperation(this.node); }
}

/**
 * There is a row of `relation` for which `condition` holds: ANSI SQL's `EXISTS (SELECT 1 FROM <relation> WHERE <condition>)`. The
 * condition reads the columns of the relation and of the row it is asked of (a correlated subquery). It is a condition like any
 * other, so it is combined with `and` / `or` and negated with `not()`, as Legend's `exists` is in a `filter`. (An `ExistsOperation`
 * asks if a property of the class has a value.)
 */
export class RelationExistsOperation extends Operation {
  constructor(readonly relation: Relation, readonly condition: RelationalOperationElement) { super(); }
}

/**
 * What ANSI SQL calls a `<query expression>`: a query that returns rows and can be used where a table is. It is a
 * relation, as Legend's select is: its columns are what it shows. It has no name of its own: a table alias gives it
 * one where it is used. It has no ORDER BY or row limit: a table is a set of rows with no order.
 */
export abstract class QueryExpression extends Relation {}

/** ANSI SQL's join types: `inner`, and the outer joins `left`, `right` and `full`, which keep the rows that find no match. */
export enum JoinKind {
  INNER = 'inner',
  LEFT = 'left',
  RIGHT = 'right',
  FULL = 'full',
}

/**
 * A relation joined on a condition, as ANSI SQL's `<join type> JOIN <table reference> ON <search condition>` and Legend's
 * `Join`: its `target`, the kind of join and the condition `operation`. Every column in the condition is owned by a relation,
 * which says which side of the join it is on. A query holds these for the relations it reads besides its root.
 */
export class RelationJoin {
  constructor(
    readonly name: string,
    readonly target: Relation,
    readonly operation: RelationalOperationElement,
    readonly kind: JoinKind,
  ) {}
}

/**
 * A single SELECT over a root table, as ANSI SQL's `<query specification>`: what to show, which rows qualify, how
 * they are grouped, which groups qualify (HAVING) and whether duplicates are removed (DISTINCT). It has no ORDER BY
 * or row limit; an `OrderedQuerySpecification`, which is run rather than stored, sets them.
 */
export class QuerySpecification extends QueryExpression {
  constructor(
    /** What the query shows. */
    readonly columns: readonly RelationalOperationElement[],
    readonly filter: RelationalOperationElement,
    readonly groupBy: RelationalOperationElement[] = [],
    readonly table?: Relation,
    /**
     * Extra ON conditions for this query's joins (milestoning and property filters), keyed by join node.
     * Held here rather than on the shared JoinOperation, so queries that use the same node can't affect each other.
     */
    readonly joinFilters: ReadonlyMap<JoinTreeNodeOperation, Operation> = new Map(),
    /** Whether each distinct row is returned once (`SELECT DISTINCT`). */
    readonly distinct: boolean = false,
    /** Keeps the groups that satisfy it (`HAVING`). */
    readonly having?: Operation,
    /**
     * Steps the query only asks the existence of, each as the query that stands for its table: the query joins to
     * that instead of to the table, so a parent is not repeated for each row that matches.
     */
    readonly subSelects: ReadonlyMap<JoinTreeNodeOperation, QuerySpecification> = new Map(),
    /** Relations joined to the root on a condition, in the order they are written. */
    readonly joins: readonly RelationJoin[] = [],
  ) { super(); }
}

/**
 * A query specification that is run: it adds the ordering, row limit and offset applied to its result. ANSI SQL calls
 * this a `<cursor specification>`: a `<query expression>` with an `<order by clause>`.
 */
export class OrderedQuerySpecification extends QuerySpecification {
  constructor(
    columns: readonly RelationalOperationElement[],
    filter: RelationalOperationElement,
    readonly orderBy: SortOperation[] = [],
    groupBy: RelationalOperationElement[] = [],
    /** How many rows are returned at most. */
    readonly limit?: number,
    table?: Relation,
    joinFilters: ReadonlyMap<JoinTreeNodeOperation, Operation> = new Map(),
    distinct: boolean = false,
    /** How many rows to skip before the first one returned. */
    readonly offset?: number,
    having?: Operation,
    subSelects: ReadonlyMap<JoinTreeNodeOperation, QuerySpecification> = new Map(),
    joins: readonly RelationJoin[] = [],
  ) { super(columns, filter, groupBy, table, joinFilters, distinct, having, subSelects, joins); }
}

/**
 * Two query expressions whose rows are put together: `left UNION right` (the distinct rows), or `UNION ALL` with `all`.
 * ANSI SQL's `<query expression body>` with a set operator, and Legend's `concatenate`. The two have the same number of
 * columns, and the result's columns are the left one's. Either side can be a union itself.
 *
 * As a query expression it has no ORDER BY or row limit; a query that reads from it, through a table alias, has.
 */
export class UnionOperation extends QueryExpression {
  constructor(readonly left: QueryExpression, readonly right: QueryExpression, readonly all: boolean = false) {
    super();
    if (left.columns.length !== right.columns.length) {
      throw new Error(`A union is of queries with the same columns: ${left.columns.length} and ${right.columns.length} columns`);
    }
  }

  /** The columns of the left side name the result's columns. */
  get columns(): readonly RelationalOperationElement[] { return this.left.columns; }
}

/** Whether `op` holds an aggregate, a window function or a count. */
export function containsAggregateOrWindow(op: unknown): boolean {
  if (op instanceof AggregateOperation || op instanceof WindowFunctionOperation || op instanceof CountAllOperation) return true;
  if (op instanceof BinaryOperation) return containsAggregateOrWindow(op.left) || containsAggregateOrWindow(op.right);
  if (op instanceof UnaryOperation || op instanceof Alias) return containsAggregateOrWindow(op.element);
  return false;
}

/** Whether `op` collapses rows: an aggregate or a count. Window functions keep every row, and so does an aggregate over a window (`max().over()`). */
export function containsAggregate(op: unknown): boolean {
  if (op instanceof AggregateOperation) return op.window === undefined;
  if (op instanceof CountAllOperation) return true;
  if (op instanceof BinaryOperation) return containsAggregate(op.left) || containsAggregate(op.right);
  if (op instanceof UnaryOperation || op instanceof Alias) return containsAggregate(op.element);
  return false;
}

/** A plain value as the constant it compares with. */
export function valueOperand(value: unknown): ConstantOperation {
  if (typeof value === 'boolean') return new BooleanConstantOperation(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? new IntegerConstantOperation(value) : new FloatConstantOperation(value);
  }
  if (typeof value === 'string') return new StringConstantOperation(value);
  if (value instanceof DateOnly) return new DateConstantOperation(value); // before Date: DateOnly is a Date
  if (value instanceof Date) return new DateTimeConstantOperation(value);
  if (value instanceof Interval) return new IntervalConstantOperation(value);
  throw new TypeError(`A value to compare with is a boolean, a finite number, a string, a date or an interval, not ${value === null ? 'null' : typeof value}`);
}

/** The thing to compare or calculate with: an expression as it is, an attribute as its column, a value as a constant. */
export function operandOf(other: unknown): RelationalOperationElement {
  if (other instanceof RelationalOperationElement) return other;
  if (typeof (other as { cwj?: unknown } | null)?.cwj === 'function') return (other as { cwj(): ColumnWithJoin }).cwj();
  return valueOperand(other);
}

/**
 * A date or timestamp as a value: a `Date`, or text such as `'2024-01-15'` that the database reads as one.
 */
export type DateValue = Date | string;

/**
 * An expression that holds a `T`, as the type system sees it. The `valueType` is only there for the types: an
 * expression that can be compared declares it by being `Equatable<T>`, and a comparison takes a `T` or another
 * expression of the same type, so `f.name().eq(f.price())` is a compile error.
 */
export interface Typed<T> {
  readonly valueType?: T;
}

/** What an expression of type `T` is compared with: a value, or an expression (or column) that holds one. */
export type Operand<T> = T | Typed<T>;

/**
 * Equality for an expression, as for a column: `f.name().toUpperCase().eq('ACME')`, `f.name().length().isIn([3, 5])`.
 * The other side is a value or another expression of the same type. Each gives a filter. Mixed into the expressions
 * that have it; an expression that can only be tested for equality (joined text) is only this.
 */
export abstract class Equatable<T> implements Typed<T> {
  declare readonly valueType?: T;

  abstract comparisonOperand(): RelationalOperationElement;

  /** @internal */
  _compared(operator: ComparisonOperator, other: unknown): ComparisonOperation {
    return new ComparisonOperation(this.comparisonOperand(), operator, operandOf(other));
  }

  /** Filter to rows where this expression equals `other`. */
  eq(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.EQUAL, other); }
  /** Filter to rows where this expression does not equal `other`. */
  ne(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.NOT_EQUAL, other); }

  private _constants(values: readonly unknown[]): ConstantOperation[] {
    if (values.length === 0) throw new Error('isIn / isNotIn need at least one value');
    return values.map(valueOperand);
  }

  /** Filter to rows where this expression equals any of `values`: `f.name().substring(0, 4).isIn(['beta', 'Hell'])`. */
  isIn(values: readonly T[]): InOperation { return new InOperation(this.comparisonOperand(), this._constants(values)); }
  /** Filter to rows where this expression equals none of `values`. */
  isNotIn(values: readonly T[]): NotInOperation { return new NotInOperation(this.comparisonOperand(), this._constants(values)); }
}

/**
 * Ordering for an expression of a type that has an order: `f.name().length().gt(10)`, `f.date().plus(1, 'day').lte(d)`.
 * Mixed into the expressions that have it, with `Equatable`.
 */
export abstract class Orderable<T> implements Typed<T> {
  declare readonly valueType?: T;

  abstract comparisonOperand(): RelationalOperationElement;
  abstract _compared(operator: ComparisonOperator, other: unknown): ComparisonOperation;

  /** Filter to rows where this expression is less than `other`. */
  lt(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.LESS_THAN, other); }
  /** Filter to rows where this expression is at most `other`. */
  lte(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, other); }
  /** Filter to rows where this expression is greater than `other`. */
  gt(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.GREATER_THAN, other); }
  /** Filter to rows where this expression is at least `other`. */
  gte(other: Operand<T>): ComparisonOperation { return this._compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, other); }
}

/** Whether a standard deviation or variance is the sample one (`ddof` 1) or the population one (0). */
export function sample(ddof: number): boolean {
  if (ddof !== 0 && ddof !== 1) throw new RangeError(`ddof is 0 (population) or 1 (sample), not ${ddof}`);
  return ddof === 1;
}

/**
 * Pattern tests on an expression that holds text, as on a column: `f.name().toUpperCase().startsWith('AC')`,
 * `f.name().join(',').contains('John')`. Mixed into the expressions that have it.
 */
export abstract class StringPredicates {
  abstract comparisonOperand(): RelationalOperationElement;

  private _like(pattern: string): ComparisonOperation {
    return new ComparisonOperation(this.comparisonOperand(), ComparisonOperator.LIKE, new StringConstantOperation(pattern));
  }

  /** Filter to rows where this text has a match for the regular expression `pattern` anywhere in it, as `RegExp.test`. */
  matches(pattern: string): ComparisonOperation {
    return new ComparisonOperation(this.comparisonOperand(), ComparisonOperator.MATCHES, new StringConstantOperation(pattern));
  }
  /** Filter to rows where this text contains `value`. */
  contains(value: string): ComparisonOperation { return this._like(`%${escapeLike(value)}%`); }
  /** Filter to rows where this text starts with `prefix`. */
  startsWith(prefix: string): ComparisonOperation { return this._like(`${escapeLike(prefix)}%`); }
  /** Filter to rows where this text ends with `suffix`. */
  endsWith(suffix: string): ComparisonOperation { return this._like(`%${escapeLike(suffix)}`); }
}

/**
 * Aggregates of an expression, as a column has them: `f.price().times(f.quantity()).sum()`, `constant(1).sum()`,
 * `when(f.price().gt(10)).then(5.0).otherwise(1.0).sum()`. Mixed into the expressions that have it.
 *
 * `A` is the aggregate that gives the expression's own type, the type of its `sum`, `min` and `max`: an integer
 * expression has an `IntegerAggregateOperation` sum. An expression whose type is not known has an
 * `UntypedAggregateOperation`. A count is an integer, and an average, standard deviation and variance are floating
 * point, whatever the type. A host that knows its type gives `aggregateKind()`.
 */
export abstract class Aggregates<A extends AggregateOperation = UntypedAggregateOperation> {
  /** @internal The aggregate that gives the expression's own type. */
  aggregateKind(): AggregateConstructor<A> { return UntypedAggregateOperation as unknown as AggregateConstructor<A>; }

  private _aggregate<R extends AggregateOperation>(kind: AggregateConstructor<R>, operator: AggregateOperator, label: string): R {
    return new kind(this as unknown as RelationalOperationElement, operator, label + ' Expression');
  }

  /** Sum of the values in the group. */
  sum(): A { return this._aggregate(this.aggregateKind(), AggregateOperator.SUM, 'Sum'); }
  /** Smallest value in the group. */
  min(): A { return this._aggregate(this.aggregateKind(), AggregateOperator.MIN, 'Min'); }
  /** Largest value in the group. */
  max(): A { return this._aggregate(this.aggregateKind(), AggregateOperator.MAX, 'Max'); }
  /** Arithmetic mean of the values in the group. */
  average(): DoubleAggregateOperation { return this._aggregate(DoubleAggregateOperation, AggregateOperator.AVERAGE, 'Average'); }
  /** Number of non-null values in the group. */
  count(): IntegerAggregateOperation { return this._aggregate(IntegerAggregateOperation, AggregateOperator.COUNT, 'Count'); }
  /** Standard deviation of the values in the group: the sample one by default, `ddof = 0` for the population one. */
  std(ddof = 1): DoubleAggregateOperation {
    return this._aggregate(DoubleAggregateOperation, sample(ddof) ? AggregateOperator.STDDEV_SAMP : AggregateOperator.STDDEV_POP, 'Std');
  }
  /** Variance of the values in the group: the sample one by default, `ddof = 0` for the population one. */
  var(ddof = 1): DoubleAggregateOperation {
    return this._aggregate(DoubleAggregateOperation, sample(ddof) ? AggregateOperator.VAR_SAMP : AggregateOperator.VAR_POP, 'Var');
  }
}

/**
 * Aggregates of a condition: `f.quantity().gt(20).all()` is true for a group where every row holds, `.any()` where at
 * least one does. Mixed into the conditions.
 */
export abstract class BooleanAggregates {
  /** True for a group where every row satisfies the condition. */
  all(): BooleanAggregateOperation {
    return new BooleanAggregateOperation(this as unknown as RelationalOperationElement, AggregateOperator.BOOL_AND, 'All Expression');
  }
  /** True for a group where at least one row satisfies the condition. */
  any(): BooleanAggregateOperation {
    return new BooleanAggregateOperation(this as unknown as RelationalOperationElement, AggregateOperator.BOOL_OR, 'Any Expression');
  }
}

/**
 * Mix the methods of the base classes into `derived`, the TypeScript handbook's way to inherit from more than
 * one class: the type side comes from an `interface Derived extends Base {}` beside the class.
 */
export function applyMixins(derived: { prototype: object }, bases: { prototype: object }[]): void {
  for (const base of bases) {
    for (const name of Object.getOwnPropertyNames(base.prototype)) {
      if (name === 'constructor' || Object.prototype.hasOwnProperty.call(derived.prototype, name)) continue;
      Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(base.prototype, name)!);
    }
  }
}

export enum ArithmeticOperator {
  ADD = '+',
  SUBTRACT = '-',
  MULTIPLY = '*',
  DIVIDE = '/',
}

/**
 * The kind of number an expression holds, as SQL types it: a whole number, a floating-point number or a decimal.
 * `unknown` is a number of a kind that is not known, such as one given as a variable of type `number`.
 */
export type NumberKind = 'integer' | 'double' | 'decimal' | 'unknown';

/** What an expression that holds a number says about it: the operand arithmetic takes, and its kind. */
export interface NumericOperand extends Typed<number> {
  arithmeticOperand(): RelationalOperationElement;
  numberKind(): NumberKind;
}

/** A number or a numeric expression: what arithmetic takes on the other side. */
export type ArithmeticOperand = number | NumericOperand;

/**
 * The kind of number an operand is: an expression says; a whole-number literal is an integer and a fractional one a
 * double (`1` and `1.0` are the same number in JavaScript); a `number` that is not a literal is not known.
 */
export type OperandKind<O> = O extends number
  ? (number extends O ? 'unknown' : `${O}` extends `${bigint}` ? 'integer' : 'double')
  : O extends { numberKind(): infer B } ? (B extends NumberKind ? B : 'unknown') : 'unknown';

/** The kind of `a + b`, `a - b` and `a * b`, as SQL gives it: a double if either is, else a decimal if either is, else an integer. */
export type CombinedKind<A extends NumberKind, B extends NumberKind> =
  'unknown' extends A | B ? 'unknown' : 'double' extends A | B ? 'double' : 'decimal' extends A | B ? 'decimal' : 'integer';

/** The kind of `a / b`: always a double. */
export type QuotientKind<A extends NumberKind, B extends NumberKind> = 'unknown' extends A | B ? 'unknown' : 'double';

function combinedKind(a: NumberKind, b: NumberKind): NumberKind {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'double' || b === 'double') return 'double';
  if (a === 'decimal' || b === 'decimal') return 'decimal';
  return 'integer';
}

/**
 * `plus`, `minus`, `times` and `dividedBy` for an expression that holds a number of kind `K`: `f.price().times(f.quantity())`,
 * `f.price().plus(1.5)`, `constant(100).minus(f.price())`. The other operand is a number or another numeric
 * expression. Mixed into the expressions that have it.
 *
 * The result is typed as SQL types it: `+ - *` of two integers is an integer, of an integer and a decimal a
 * decimal, with a double a double; `/` is always a double. A result whose kind is not known is `unknown`, which
 * takes any comparison.
 */
export abstract class Arithmetic<K extends NumberKind> {
  abstract arithmeticOperand(): RelationalOperationElement;
  /** @internal The kind of number this expression holds. */
  abstract numberKind(): K;

  /** Raises if this expression is not a number. */
  assertNumeric(): void {}

  private _arithmetic(operator: ArithmeticOperator, other: ArithmeticOperand): ArithmeticOperation<NumberKind> {
    this.assertNumeric();
    let operand: RelationalOperationElement;
    let otherKind: NumberKind;
    if (typeof other === 'number') {
      if (!Number.isFinite(other)) throw new TypeError('Arithmetic is between numbers and numeric columns, not a non-finite number');
      operand = valueOperand(other);
      otherKind = Number.isInteger(other) ? 'integer' : 'double';
    } else if (other !== null && typeof other === 'object' && typeof other.arithmeticOperand === 'function') {
      (other as unknown as Arithmetic<NumberKind>).assertNumeric?.();
      operand = other.arithmeticOperand();
      otherKind = typeof other.numberKind === 'function' ? other.numberKind() : 'unknown';
    } else {
      throw new TypeError(`Arithmetic is between numbers and numeric columns, not ${other === null ? 'null' : typeof other === 'object' ? (other as object).constructor.name : typeof other}`);
    }
    const kind = operator === ArithmeticOperator.DIVIDE
      ? (this.numberKind() === 'unknown' || otherKind === 'unknown' ? 'unknown' : 'double')
      : combinedKind(this.numberKind(), otherKind);
    return arithmeticOfKind(kind, this.arithmeticOperand(), operator, operand);
  }

  /** `this + other`. */
  plus<O extends ArithmeticOperand>(other: O): ArithmeticOperation<CombinedKind<K, OperandKind<O>>> {
    return this._arithmetic(ArithmeticOperator.ADD, other) as ArithmeticOperation<never>;
  }
  /** `this - other`. */
  minus<O extends ArithmeticOperand>(other: O): ArithmeticOperation<CombinedKind<K, OperandKind<O>>> {
    return this._arithmetic(ArithmeticOperator.SUBTRACT, other) as ArithmeticOperation<never>;
  }
  /** `this * other`. */
  times<O extends ArithmeticOperand>(other: O): ArithmeticOperation<CombinedKind<K, OperandKind<O>>> {
    return this._arithmetic(ArithmeticOperator.MULTIPLY, other) as ArithmeticOperation<never>;
  }
  /** `this / other`: a double. */
  dividedBy<O extends ArithmeticOperand>(other: O): ArithmeticOperation<QuotientKind<K, OperandKind<O>>> {
    return this._arithmetic(ArithmeticOperator.DIVIDE, other) as ArithmeticOperation<never>;
  }
}

/** The aggregate that gives a number of kind `K`. */
export type AggregateOfKind<K extends NumberKind> =
  K extends 'integer' ? IntegerAggregateOperation
  : K extends 'double' ? DoubleAggregateOperation
  : K extends 'decimal' ? DecimalAggregateOperation
  : UntypedAggregateOperation;

/** What an expression of kind `K` is compared with: numbers, whatever the kind; anything if it is not known. */
export type NumberOf<K extends NumberKind> = 'unknown' extends K ? any : number;

/** `left operator right` on numbers, e.g. `price * quantity`. */
export class ArithmeticOperation<K extends NumberKind = NumberKind> extends BinaryOperation implements Sortable {
  constructor(
    left: RelationalOperationElement,
    readonly operator: ArithmeticOperator,
    right: RelationalOperationElement,
    readonly displayName?: string,
  ) { super(left, right); }

  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  arithmeticOperand(): RelationalOperationElement { return this; }
  comparisonOperand(): RelationalOperationElement { return this; }
  /** @internal The kind of number it gives: not known, unless a subclass says. */
  numberKind(): K { return 'unknown' as K; }
}

export interface ArithmeticOperation<K extends NumberKind = NumberKind>
  extends Arithmetic<K>, Equatable<NumberOf<K>>, Orderable<NumberOf<K>>, Aggregates<AggregateOfKind<K>> {}
applyMixins(ArithmeticOperation, [Arithmetic, Equatable, Orderable, Aggregates]);

/** `+ - *` of integers: an integer. Its sum, minimum and maximum are integers. */
export class IntegerArithmeticOperation extends ArithmeticOperation<'integer'> {
  numberKind(): 'integer' { return 'integer'; }
  aggregateKind(): AggregateConstructor<IntegerAggregateOperation> { return IntegerAggregateOperation; }
}

/** Arithmetic with a double, or a division: a double. */
export class DoubleArithmeticOperation extends ArithmeticOperation<'double'> {
  numberKind(): 'double' { return 'double'; }
  aggregateKind(): AggregateConstructor<DoubleAggregateOperation> { return DoubleAggregateOperation; }
}

/** `+ - *` of decimals, or of a decimal and an integer: a decimal. */
export class DecimalArithmeticOperation extends ArithmeticOperation<'decimal'> {
  numberKind(): 'decimal' { return 'decimal'; }
  aggregateKind(): AggregateConstructor<DecimalAggregateOperation> { return DecimalAggregateOperation; }
}

function arithmeticOfKind(
  kind: NumberKind, left: RelationalOperationElement, operator: ArithmeticOperator, right: RelationalOperationElement,
): ArithmeticOperation<NumberKind> {
  switch (kind) {
    case 'integer': return new IntegerArithmeticOperation(left, operator, right);
    case 'double': return new DoubleArithmeticOperation(left, operator, right);
    case 'decimal': return new DecimalArithmeticOperation(left, operator, right);
    default: return new ArithmeticOperation(left, operator, right);
  }
}

/** Text joined end to end. A NULL in any part makes the whole NULL, as with SQL's `||`. */
export class ConcatOperation extends Operation implements Sortable {
  constructor(
    readonly parts: RelationalOperationElement[],
    readonly displayName?: string,
  ) { super(); }

  /** Join more text on the end: `f.first().concat(' ', f.last())`. A concatenation joins into one. */
  concat(...more: ConcatPart[]): ConcatOperation { return concat(this, ...more); }

  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  comparisonOperand(): RelationalOperationElement { return this; }
}

/** What can be joined as text: a string, a text column, a function that gives text, or another concatenation. */
export type ConcatPart = string | { functionInput(): RelationalOperationElement } | ConcatOperation;

/**
 * Join text: `concat(f.name(), ' (', f.category(), ')')`. A string is a constant; a concatenation among the
 * parts is flattened into one.
 */
export function concat(...parts: ConcatPart[]): ConcatOperation {
  const partsOf = (part: ConcatPart): RelationalOperationElement[] => {
    if (part instanceof ConcatOperation) return part.parts;
    if (typeof part === 'string') return [new StringConstantOperation(part)];
    if (part instanceof RelationalOperationElement) return [part];
    if (part !== null && typeof part === 'object' && typeof part.functionInput === 'function') return [part.functionInput()];
    throw new TypeError(`Text is joined with text, not ${part === null ? 'null' : typeof part}`);
  };
  return new ConcatOperation(parts.flatMap(partsOf));
}

export interface ConcatOperation extends Equatable<string>, StringPredicates {}
applyMixins(ConcatOperation, [Equatable, StringPredicates]);

export interface DateExtractOperation extends Equatable<number>, Orderable<number> {}
applyMixins(DateExtractOperation, [Equatable, Orderable]);

export interface DateArithmeticOperation extends Equatable<DateValue>, Orderable<DateValue> {}
applyMixins(DateArithmeticOperation, [Equatable, Orderable]);

export interface DateDiffOperation extends Equatable<number>, Orderable<number> {}
applyMixins(DateDiffOperation, [Equatable, Orderable]);

export interface DateTruncOperation extends Equatable<DateValue>, Orderable<DateValue> {}
applyMixins(DateTruncOperation, [Equatable, Orderable]);

export interface UntypedAggregateOperation extends Arithmetic<'unknown'>, Equatable<any>, Orderable<any>, StringPredicates {}
applyMixins(UntypedAggregateOperation, [Arithmetic, Equatable, Orderable, StringPredicates]);

export interface IntegerAggregateOperation extends Arithmetic<'integer'>, Equatable<number>, Orderable<number> {}
applyMixins(IntegerAggregateOperation, [Arithmetic, Equatable, Orderable]);

export interface DoubleAggregateOperation extends Arithmetic<'double'>, Equatable<number>, Orderable<number> {}
applyMixins(DoubleAggregateOperation, [Arithmetic, Equatable, Orderable]);

export interface DecimalAggregateOperation extends Arithmetic<'decimal'>, Equatable<number>, Orderable<number> {}
applyMixins(DecimalAggregateOperation, [Arithmetic, Equatable, Orderable]);

export interface StringAggregateOperation extends Equatable<string>, StringPredicates {}
applyMixins(StringAggregateOperation, [Equatable, StringPredicates]);

export interface BooleanAggregateOperation extends Equatable<boolean> {}
applyMixins(BooleanAggregateOperation, [Equatable]);

export interface DateAggregateOperation extends Equatable<DateValue>, Orderable<DateValue> {}
applyMixins(DateAggregateOperation, [Equatable, Orderable]);

export interface DateTimeAggregateOperation extends Equatable<DateValue>, Orderable<DateValue> {}
applyMixins(DateTimeAggregateOperation, [Equatable, Orderable]);

export interface CountAllOperation extends Equatable<number>, Orderable<number> {}
applyMixins(CountAllOperation, [Equatable, Orderable]);

// A constant is compared as its type is, and has the aggregates of its type: `constant(1).sum()` is an integer.
// A number also takes part in arithmetic of its own kind: `constant(100).minus(f.price())`.
export interface IntegerConstantOperation extends Arithmetic<'integer'>, Equatable<number>, Orderable<number>, Aggregates<IntegerAggregateOperation> {}
applyMixins(IntegerConstantOperation, [Arithmetic, Equatable, Orderable, Aggregates]);

export interface FloatConstantOperation extends Arithmetic<'double'>, Equatable<number>, Orderable<number>, Aggregates<DoubleAggregateOperation> {}
applyMixins(FloatConstantOperation, [Arithmetic, Equatable, Orderable, Aggregates]);

export interface DecimalConstantOperation extends Arithmetic<'decimal'>, Equatable<number>, Orderable<number>, Aggregates<DecimalAggregateOperation> {}
applyMixins(DecimalConstantOperation, [Arithmetic, Equatable, Orderable, Aggregates]);

export interface StringConstantOperation extends Equatable<string>, StringPredicates, Aggregates {}
applyMixins(StringConstantOperation, [Equatable, StringPredicates, Aggregates]);

export interface DateConstantOperation extends Equatable<DateValue>, Orderable<DateValue>, Aggregates {}
applyMixins(DateConstantOperation, [Equatable, Orderable, Aggregates]);

export interface DateTimeConstantOperation extends Equatable<DateValue>, Orderable<DateValue>, Aggregates {}
applyMixins(DateTimeConstantOperation, [Equatable, Orderable, Aggregates]);

export interface BooleanConstantOperation extends Equatable<boolean>, Aggregates {}
applyMixins(BooleanConstantOperation, [Equatable, Aggregates]);

export interface CaseOperation extends Aggregates {}
applyMixins(CaseOperation, [Aggregates]);

export interface IsNullOperation extends BooleanAggregates {}
applyMixins(IsNullOperation, [BooleanAggregates]);

export interface IsNotNullOperation extends BooleanAggregates {}
applyMixins(IsNotNullOperation, [BooleanAggregates]);

export interface InOperation extends BooleanAggregates {}
applyMixins(InOperation, [BooleanAggregates]);

export interface NotOperation extends BooleanAggregates {}
applyMixins(NotOperation, [BooleanAggregates]);

export interface NotInOperation extends BooleanAggregates {}
applyMixins(NotInOperation, [BooleanAggregates]);

export interface ComparisonOperation extends BooleanAggregates {}
applyMixins(ComparisonOperation, [BooleanAggregates]);

export interface LogicalOperation extends BooleanAggregates {}
applyMixins(LogicalOperation, [BooleanAggregates]);

/**
 * A length of time, as Python's `timedelta` is: what the difference of two timestamps is. `Interval.days(731)`,
 * `Interval.hours(36)`. It has no months or years, as they have no fixed length.
 */
export class Interval {
  constructor(readonly milliseconds: number) {
    if (!Number.isFinite(milliseconds)) throw new RangeError('An interval is a finite length of time');
  }

  static days(n: number): Interval { return new Interval(n * 86_400_000); }
  static hours(n: number): Interval { return new Interval(n * 3_600_000); }
  static minutes(n: number): Interval { return new Interval(n * 60_000); }
  static seconds(n: number): Interval { return new Interval(n * 1000); }
  static milliseconds(n: number): Interval { return new Interval(n); }

  /** The length in seconds, as text with no trailing zeros: `63158400`, `1.5`. */
  totalSeconds(): number { return this.milliseconds / 1000; }
  equals(other: Interval): boolean { return this.milliseconds === other.milliseconds; }
  toString(): string { return `${this.totalSeconds()} seconds`; }
}

/** An interval as a constant: `constant(Interval.days(2))`, or the value an interval is compared with. */
export class IntervalConstantOperation extends ConstantOperation {
  constructor(readonly value: Interval) { super(); }
  comparisonOperand(): RelationalOperationElement { return this; }
}

export interface IntervalConstantOperation extends Equatable<Interval>, Orderable<Interval> {}
applyMixins(IntervalConstantOperation, [Equatable, Orderable]);

/** An aggregate that gives an interval: the smallest or largest of a group's. */
export class IntervalAggregateOperation extends AggregateOperation {}

/**
 * The smallest and largest of a group, for an expression that can be ordered but not summed. They are of the expression's
 * own type: the minimum of an interval is an interval.
 */
export abstract class Extremes<A extends AggregateOperation> {
  /** @internal The aggregate that gives the expression's own type. */
  abstract aggregateKind(): AggregateConstructor<A>;

  /** Smallest value in the group. */
  min(): A { return new (this.aggregateKind())(this as unknown as RelationalOperationElement, AggregateOperator.MIN, 'Min Expression'); }
  /** Largest value in the group. */
  max(): A { return new (this.aggregateKind())(this as unknown as RelationalOperationElement, AggregateOperator.MAX, 'Max Expression'); }
}

/**
 * The time between two timestamps, `left - right`: an interval. It is compared with an `Interval` or another interval and
 * ordered, and its smallest and largest are intervals. It is not a number, so it has no arithmetic, sum or average.
 */
export class IntervalOperation extends BinaryOperation implements Sortable {
  constructor(left: RelationalOperationElement, right: RelationalOperationElement, readonly displayName?: string) {
    super(left, right);
  }

  /** Sort by this expression, smallest first. */
  ascending(): SortOperation { return new SortOperation(this, SortDirection.ASC); }

  /** Sort by this expression, largest first. */
  descending(): SortOperation { return new SortOperation(this, SortDirection.DESC); }

  comparisonOperand(): RelationalOperationElement { return this; }
  aggregateKind(): AggregateConstructor<IntervalAggregateOperation> { return IntervalAggregateOperation; }
}

export interface IntervalOperation extends Equatable<Interval>, Orderable<Interval>, Extremes<IntervalAggregateOperation> {}
applyMixins(IntervalOperation, [Equatable, Orderable, Extremes]);

export interface RelationExistsOperation extends BooleanAggregates {}
applyMixins(RelationExistsOperation, [BooleanAggregates]);
