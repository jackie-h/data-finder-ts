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

export abstract class Operation extends RelationalOperationElement {
  andOp(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }
}

export class NoOperation extends RelationalOperationElement {}

export abstract class ConstantOperation extends RelationalOperationElement {}

export class IntegerConstantOperation extends ConstantOperation {
  constructor(readonly value: number) { super(); }
}

export class FloatConstantOperation extends ConstantOperation {
  constructor(readonly value: number) { super(); }
}

export class StringConstantOperation extends ConstantOperation {
  constructor(readonly value: string) { super(); }
}

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

export class AggregateOperation extends UnaryOperation {
  constructor(
    element: RelationalOperationElement,
    readonly operator: AggregateOperator,
    readonly displayName?: string,
  ) { super(element); }
}

export class ScalarFunctionOperation extends UnaryOperation {
  constructor(
    element: RelationalOperationElement,
    readonly func: ScalarFunction,
    readonly displayName?: string,
    readonly secondArg?: number,
    readonly extraArgs: (string | number)[] = [],
  ) { super(element); }
}

export class DateExtractOperation extends UnaryOperation {
  constructor(
    element: RelationalOperationElement,
    readonly part: DatePart,
    readonly displayName?: string,
  ) { super(element); }
}

export class DateArithmeticOperation extends UnaryOperation {
  constructor(
    element: RelationalOperationElement,
    readonly n: number,
    readonly unit: DatePart,
    readonly isAdd: boolean = true,
    readonly displayName?: string,
  ) { super(element); }
}

export class DateDiffOperation extends UnaryOperation {
  constructor(
    element: RelationalOperationElement,
    readonly other: Date,
    readonly unit: DatePart,
    readonly displayName?: string,
  ) { super(element); }
}

export class Column extends RelationalOperationElement {
  table?: Table;

  constructor(
    readonly name: string,
    readonly type: string,
    readonly owner?: string,
    readonly primaryKey: boolean = false,
  ) { super(); }
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
  constructor(
    readonly column: Column,
    readonly parent?: JoinTreeNodeOperation,
  ) { super(); }
}

export class SortOperation {
  constructor(
    readonly column: ColumnWithJoin,
    readonly direction: SortDirection,
  ) {}
}

export class CountAllOperation extends RelationalOperationElement {
  constructor(readonly table: string) { super(); }
}
