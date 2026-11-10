import { Attribute, AttributeValue, Comparand, comparandOperand } from './attribute';
import { DateFunctions, DateTimeFunctions } from './date-functions';
import {
  NumericFunctions, StringFunctions, StringFunctionOperation, IntegerFunctionOperation, DoubleFunctionOperation,
  DecimalFunctionOperation, DateFunctionOperation, BooleanFunctionOperation,
} from './scalar-functions';
import { Relation, Operand, DateValue } from '../model/relational';
import {
  ComparisonOperation,
  ComparisonOperator,
  StringConstantOperation,
  FloatConstantOperation,
  IntegerConstantOperation,
  DateConstantOperation,
  DateTimeConstantOperation,
  ConstantOperation,
  DateOnly,
  escapeLike,
  applyMixins,
  Arithmetic,
  DATE_ONLY_PATTERN,
  BooleanConstantOperation,
  DecimalConstantOperation,
  AggregateOperation,
  AggregateConstructor,
  IntegerAggregateOperation,
  DoubleAggregateOperation,
  DecimalAggregateOperation,
  StringAggregateOperation,
  DateAggregateOperation,
  DateTimeAggregateOperation,
  AggregateOperator,
  SortOperation,
  ScalarFunction,
  ScalarFunctionOperation,
  DatePart,
  DateExtractOperation,
  DateTruncOperation,
  DateArithmeticOperation,
  DateDiffOperation,
  JoinTreeNodeOperation,
  ColumnWithJoin,
  sample,
  RelationalOperationElement,
} from '../model/relational';

/** The other side of a date difference: a value stays as it is, a column or expression becomes its operand. */
function diffOther(other: Date | Comparand): Date | RelationalOperationElement {
  return other instanceof Date ? other : comparandOperand(other);
}

/** The smallest and largest value of a group, for a column that can be ordered but not summed. */
abstract class MinMax<A extends AggregateOperation> {
  abstract cwj(): ColumnWithJoin;
  abstract displayName(): string;
  /** @internal The aggregate that gives this column's own type. */
  abstract aggregateKind(): AggregateConstructor<A>;

  /** Smallest value in the group. */
  min(): A {
    return new (this.aggregateKind())(this.cwj(), AggregateOperator.MIN, 'Min ' + this.displayName());
  }
  /** Largest value in the group. */
  max(): A {
    return new (this.aggregateKind())(this.cwj(), AggregateOperator.MAX, 'Max ' + this.displayName());
  }
}

export class StringAttribute extends Attribute {
  aggregateKind(): AggregateConstructor<StringAggregateOperation> { return StringAggregateOperation; }

  declare readonly valueType?: string;

  /** The value, or `defaultValue` when it is NULL: `.orElse(...)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: string): StringFunctionOperation {
    return new StringFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new StringConstantOperation(String(value));
  }

  /**
   * Join the values of a group into one text with `separator` between them. `orderBy` is the order they are
   * joined in (`[f.name().ascending()]`); without it the order is not defined. Missing values are skipped.
   */
  join(separator: string = '', orderBy: SortOperation[] = []): StringAggregateOperation {
    return new StringAggregateOperation(this.cwj(), AggregateOperator.STRING_AGG, 'Join ' + this.displayName(), undefined, separator, orderBy);
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: Operand<string>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new StringConstantOperation((value as string)));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: Operand<string>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new StringConstantOperation((value as string)));
  }
  /** Filter to rows where this attribute has a match for the regular expression `pattern` anywhere in it. */
  matches(pattern: string): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.MATCHES, new StringConstantOperation(pattern));
  }
  /** Filter to rows where this attribute contains `value` as a substring. */
  contains(value: string): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${escapeLike(value)}%`));
  }
  /** Filter to rows where this attribute begins with `prefix`. */
  startsWith(prefix: string): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`${escapeLike(prefix)}%`));
  }
  /** Filter to rows where this attribute ends with `suffix`. */
  endsWith(suffix: string): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${escapeLike(suffix)}`));
  }
  /** Filter to rows where this attribute does not contain `value` as a substring. */
  notContains(value: string): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_LIKE, new StringConstantOperation(`%${escapeLike(value)}%`));
  }
}

export interface StringAttribute extends MinMax<StringAggregateOperation>, StringFunctions {}
applyMixins(StringAttribute, [MinMax, StringFunctions]);

export abstract class NumericAttribute<A extends AggregateOperation = AggregateOperation> extends Attribute {
  declare readonly valueType?: number;

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  /** Sum of all values in the group. */
  sum(): A {
    return new (this.aggregateKind())(this.cwj(), AggregateOperator.SUM, 'Sum ' + this.displayName());
  }
  /** Arithmetic mean of all values in the group. */
  average(): DoubleAggregateOperation {
    return new DoubleAggregateOperation(this.cwj(), AggregateOperator.AVERAGE, 'Average ' + this.displayName());
  }
  /** Standard deviation of the values in the group: the sample one by default, `ddof = 0` for the population one, as `Series.std`. */
  std(ddof = 1): DoubleAggregateOperation {
    const operator = sample(ddof) ? AggregateOperator.STDDEV_SAMP : AggregateOperator.STDDEV_POP;
    return new DoubleAggregateOperation(this.cwj(), operator, 'Std ' + this.displayName());
  }
  /** Variance of the values in the group: the sample one by default, `ddof = 0` for the population one, as `Series.var`. */
  var(ddof = 1): DoubleAggregateOperation {
    const operator = sample(ddof) ? AggregateOperator.VAR_SAMP : AggregateOperator.VAR_POP;
    return new DoubleAggregateOperation(this.cwj(), operator, 'Var ' + this.displayName());
  }
}

export interface NumericAttribute<A extends AggregateOperation = AggregateOperation> extends MinMax<A> {}
applyMixins(NumericAttribute, [MinMax]);

export class DoubleAttribute extends NumericAttribute<DoubleAggregateOperation> {
  numberKind(): 'double' { return 'double'; }
  aggregateKind(): AggregateConstructor<DoubleAggregateOperation> { return DoubleAggregateOperation; }

  /** @internal A function of this column that gives a double. */
  sameType(func: ScalarFunction, label: string, secondArg?: number): DoubleFunctionOperation {
    return new DoubleFunctionOperation(this.cwj(), func, label, secondArg);
  }

  /** The value, or `defaultValue` when it is NULL: `.orElse(0)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: number): DoubleFunctionOperation {
    return new DoubleFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new FloatConstantOperation(Number(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new FloatConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new FloatConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN, value, () => new FloatConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN, value, () => new FloatConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, value, () => new FloatConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, value, () => new FloatConstantOperation((value as number)));
  }
}

export interface DoubleAttribute extends NumericFunctions<DoubleFunctionOperation>, Arithmetic<'double'> {}
applyMixins(DoubleAttribute, [NumericFunctions, Arithmetic]);

export const FloatAttribute = DoubleAttribute;
export type FloatAttribute = DoubleAttribute;

export class DecimalAttribute extends NumericAttribute<DecimalAggregateOperation> {
  numberKind(): 'decimal' { return 'decimal'; }
  aggregateKind(): AggregateConstructor<DecimalAggregateOperation> { return DecimalAggregateOperation; }

  /** @internal A function of this column that gives a decimal. */
  sameType(func: ScalarFunction, label: string, secondArg?: number): DecimalFunctionOperation {
    return new DecimalFunctionOperation(this.cwj(), func, label, secondArg);
  }

  /** The value, or `defaultValue` when it is NULL: `.orElse(0)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: number): DecimalFunctionOperation {
    return new DecimalFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new DecimalConstantOperation(Number(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new DecimalConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new DecimalConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN, value, () => new DecimalConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN, value, () => new DecimalConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, value, () => new DecimalConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, value, () => new DecimalConstantOperation((value as number)));
  }
}

export interface DecimalAttribute extends NumericFunctions<DecimalFunctionOperation>, Arithmetic<'decimal'> {}
applyMixins(DecimalAttribute, [NumericFunctions, Arithmetic]);

export class IntegerAttribute extends NumericAttribute<IntegerAggregateOperation> {
  numberKind(): 'integer' { return 'integer'; }
  aggregateKind(): AggregateConstructor<IntegerAggregateOperation> { return IntegerAggregateOperation; }

  /** @internal A function of this column that gives a integer. */
  sameType(func: ScalarFunction, label: string, secondArg?: number): IntegerFunctionOperation {
    return new IntegerFunctionOperation(this.cwj(), func, label, secondArg);
  }

  /** The value, or `defaultValue` when it is NULL: `.orElse(0)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: number): IntegerFunctionOperation {
    return new IntegerFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new IntegerConstantOperation(Number(value));
  }

  /** An integer column gives whole numbers, so `power` of it by a whole number is one too. */
  isInteger(): boolean { return true; }


  /** Filter to rows where this attribute equals `value`. */
  eq(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new IntegerConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new IntegerConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN, value, () => new IntegerConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN, value, () => new IntegerConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, value, () => new IntegerConstantOperation((value as number)));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: Operand<number>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, value, () => new IntegerConstantOperation((value as number)));
  }
}

export interface IntegerAttribute extends NumericFunctions<IntegerFunctionOperation>, Arithmetic<'integer'> {}
applyMixins(IntegerAttribute, [NumericFunctions, Arithmetic]);

export class BooleanAttribute extends Attribute {
  declare readonly valueType?: boolean;

  /** The value, or `defaultValue` when it is NULL: `.orElse(...)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: boolean): BooleanFunctionOperation {
    return new BooleanFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new BooleanConstantOperation(Boolean(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: Operand<boolean>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new BooleanConstantOperation((value as boolean)));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: Operand<boolean>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new BooleanConstantOperation((value as boolean) as boolean));
  }
  /** Filter to rows where this attribute is true. */
  isTrue(): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(true));
  }
  /** Filter to rows where this attribute is false. */
  isFalse(): ComparisonOperation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(false));
  }
}

function parseDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`Cannot parse date: ${value}`);
  return d;
}

/**
 * A timestamp comparison value: a `DateOnly` (or a `YYYY-MM-DD` string) is a date literal,
 * any other `Date` or string a timestamp literal.
 */
function temporalConstant(value: Date | string): DateConstantOperation | DateTimeConstantOperation {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) return new DateConstantOperation(new DateOnly(value));
  const date = parseDate(value);
  return date instanceof DateOnly ? new DateConstantOperation(date) : new DateTimeConstantOperation(date);
}

export class DateAttribute extends Attribute {
  aggregateKind(): AggregateConstructor<DateAggregateOperation> { return DateAggregateOperation; }

  declare readonly valueType?: DateValue;

  /** The value, or `defaultValue` when it is NULL: `.orElse(...)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: string): DateFunctionOperation {
    return new DateFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new DateConstantOperation(parseDate(value as Date | string));
  }

  /** Filter to rows where this date equals `value`. */
  eq(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }
  /** Filter to rows where this date does not equal `value`. */
  ne(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }
  /** Filter to rows where this date is after `value`. */
  gt(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }
  /** Filter to rows where this date is before `value`. */
  lt(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }
  /** Filter to rows where this date is on or after `value`. */
  gte(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }
  /** Filter to rows where this date is on or before `value`. */
  lte(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, value, () => new DateConstantOperation(parseDate((value as Date | string))));
  }

}

export class DateTimeAttribute extends Attribute {
  aggregateKind(): AggregateConstructor<DateTimeAggregateOperation> { return DateTimeAggregateOperation; }

  declare readonly valueType?: DateValue;

  /** The value, or `defaultValue` when it is NULL: `.orElse(...)`. Like `COALESCE` in SQL. */
  orElse(defaultValue: string): DateFunctionOperation {
    return new DateFunctionOperation(this.cwj(), ScalarFunction.COALESCE, this.orElseLabel(), undefined, this.orElseArguments(defaultValue));
  }

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: Relation,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
    optional: boolean = false,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable, optional); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return temporalConstant(value as Date | string);
  }

  /** Filter to rows where this timestamp equals `value`. */
  eq(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.EQUAL, value, () => temporalConstant((value as Date | string)));
  }
  /** Filter to rows where this timestamp does not equal `value`. */
  ne(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.NOT_EQUAL, value, () => temporalConstant((value as Date | string)));
  }
  /** Filter to rows where this timestamp is after `value`. */
  gt(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN, value, () => temporalConstant((value as Date | string)));
  }
  /** Filter to rows where this timestamp is before `value`. */
  lt(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN, value, () => temporalConstant((value as Date | string)));
  }
  /** Filter to rows where this timestamp is on or after `value`. */
  gte(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, value, () => temporalConstant((value as Date | string)));
  }
  /** Filter to rows where this timestamp is on or before `value`. */
  lte(value: Operand<DateValue>): ComparisonOperation {
    return this.compared(ComparisonOperator.LESS_THAN_OR_EQUAL_TO, value, () => temporalConstant((value as Date | string)));
  }

}

export interface DateAttribute extends MinMax<DateAggregateOperation>, DateFunctions {}
applyMixins(DateAttribute, [MinMax, DateFunctions]);

export interface DateTimeAttribute extends MinMax<DateTimeAggregateOperation>, DateTimeFunctions {}
applyMixins(DateTimeAttribute, [MinMax, DateTimeFunctions]);
