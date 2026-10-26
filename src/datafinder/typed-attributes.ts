import { Attribute, AttributeValue } from './attribute';
import { NumericFunctions, StringFunctions } from './scalar-functions';
import {
  ComparisonOperation,
  ComparisonOperator,
  Operation,
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
} from '../model/relational';

/** The smallest and largest value of a group, for a column that can be ordered but not summed. */
abstract class MinMax {
  abstract cwj(): ColumnWithJoin;
  abstract displayName(): string;

  /** Smallest value in the group. */
  min(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MIN, 'Min ' + this.displayName());
  }
  /** Largest value in the group. */
  max(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MAX, 'Max ' + this.displayName());
  }
}

function sample(ddof: number): boolean {
  if (ddof !== 0 && ddof !== 1) throw new RangeError(`ddof is 0 (population) or 1 (sample), not ${ddof}`);
  return ddof === 1;
}

export class StringAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new StringConstantOperation(String(value));
  }

  /**
   * Join the values of a group into one text with `separator` between them. `orderBy` is the order they are
   * joined in (`[f.name().ascending()]`); without it the order is not defined. Missing values are skipped.
   */
  join(separator: string = '', orderBy: SortOperation[] = []): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.STRING_AGG, 'Join ' + this.displayName(), undefined, separator, orderBy);
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new StringConstantOperation(value));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new StringConstantOperation(value));
  }
  /** Filter to rows where this attribute contains `value` as a substring. */
  contains(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${escapeLike(value)}%`));
  }
  /** Filter to rows where this attribute begins with `prefix`. */
  startsWith(prefix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`${escapeLike(prefix)}%`));
  }
  /** Filter to rows where this attribute ends with `suffix`. */
  endsWith(suffix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${escapeLike(suffix)}`));
  }
  /** Filter to rows where this attribute does not contain `value` as a substring. */
  notContains(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_LIKE, new StringConstantOperation(`%${escapeLike(value)}%`));
  }
}

export interface StringAttribute extends MinMax, StringFunctions {}
applyMixins(StringAttribute, [MinMax, StringFunctions]);

export abstract class NumericAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  /** Sum of all values in the group. */
  sum(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.SUM, 'Sum ' + this.displayName());
  }
  /** Arithmetic mean of all values in the group. */
  average(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.AVERAGE, 'Average ' + this.displayName());
  }
  /** Standard deviation of the values in the group: the sample one by default, `ddof = 0` for the population one, as `Series.std`. */
  std(ddof = 1): AggregateOperation {
    const operator = sample(ddof) ? AggregateOperator.STDDEV_SAMP : AggregateOperator.STDDEV_POP;
    return new AggregateOperation(this.cwj(), operator, 'Std ' + this.displayName());
  }
  /** Variance of the values in the group: the sample one by default, `ddof = 0` for the population one, as `Series.var`. */
  var(ddof = 1): AggregateOperation {
    const operator = sample(ddof) ? AggregateOperator.VAR_SAMP : AggregateOperator.VAR_POP;
    return new AggregateOperation(this.cwj(), operator, 'Var ' + this.displayName());
  }
}

export interface NumericAttribute extends MinMax, NumericFunctions, Arithmetic {}
applyMixins(NumericAttribute, [MinMax, NumericFunctions, Arithmetic]);

export class DoubleAttribute extends NumericAttribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new FloatConstantOperation(Number(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new FloatConstantOperation(value));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new FloatConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new FloatConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new FloatConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new FloatConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new FloatConstantOperation(value));
  }
}

export const FloatAttribute = DoubleAttribute;
export type FloatAttribute = DoubleAttribute;

export class DecimalAttribute extends NumericAttribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new DecimalConstantOperation(Number(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DecimalConstantOperation(value));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DecimalConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DecimalConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DecimalConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DecimalConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new DecimalConstantOperation(value));
  }
}

export class IntegerAttribute extends NumericAttribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new IntegerConstantOperation(Number(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new IntegerConstantOperation(value));
  }
  /** Filter to rows where this attribute does not equal `value`. */
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new IntegerConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than `value`. */
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new IntegerConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than `value`. */
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new IntegerConstantOperation(value));
  }
  /** Filter to rows where this attribute is greater than or equal to `value`. */
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new IntegerConstantOperation(value));
  }
  /** Filter to rows where this attribute is less than or equal to `value`. */
  lte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new IntegerConstantOperation(value));
  }
}

export class BooleanAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new BooleanConstantOperation(Boolean(value));
  }

  /** Filter to rows where this attribute equals `value`. */
  eq(value: boolean): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(value));
  }
  /** Filter to rows where this attribute is true. */
  isTrue(): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(true));
  }
  /** Filter to rows where this attribute is false. */
  isFalse(): Operation {
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
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new DateConstantOperation(parseDate(value as Date | string));
  }

  /** Filter to rows where this date equals `value`. */
  eq(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DateConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this date does not equal `value`. */
  ne(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DateConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this date is after `value`. */
  gt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DateConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this date is before `value`. */
  lt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DateConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this date is on or after `value`. */
  gte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DateConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this date is on or before `value`. */
  lte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new DateConstantOperation(parseDate(value)));
  }

  /** Extract the four-digit calendar year. */
  year(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.YEAR, 'Year ' + this.displayName()); }
  /** Extract the month number (1–12). */
  month(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MONTH, 'Month ' + this.displayName()); }
  /** Extract the day of the month (1–31). */
  day(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DAY, 'Day ' + this.displayName()); }
  /** Extract the quarter (1–4). */
  quarter(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.QUARTER, 'Quarter ' + this.displayName()); }
  /** Extract the ISO week number (1–53). */
  week(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.WEEK, 'Week ' + this.displayName()); }
  /** Extract the day of the week (0 = Sunday through 6 = Saturday). */
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DOW, 'Day Of Week ' + this.displayName()); }
  /** The date of the first day of the week the date falls in (a Monday). */
  firstDayOfWeek(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.WEEK, 'First Day Of Week ' + this.displayName()); }
  /** The date of the first day of the month the date falls in. */
  firstDayOfMonth(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.MONTH, 'First Day Of Month ' + this.displayName()); }
  /** The date of the first day of the quarter the date falls in. */
  firstDayOfQuarter(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.QUARTER, 'First Day Of Quarter ' + this.displayName()); }
  /** The date of the first day of the year the date falls in. */
  firstDayOfYear(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.YEAR, 'First Day Of Year ' + this.displayName()); }

  /** Add `n` days to this date. */
  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, true, 'Add Days ' + this.displayName()); }
  /** Add `n` months to this date. */
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, true, 'Add Months ' + this.displayName()); }
  /** Add `n` years to this date. */
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, true, 'Add Years ' + this.displayName()); }
  /** Subtract `n` days from this date. */
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, false, 'Subtract Days ' + this.displayName()); }
  /** Subtract `n` months from this date. */
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, false, 'Subtract Months ' + this.displayName()); }
  /** Subtract `n` years from this date. */
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, false, 'Subtract Years ' + this.displayName()); }

  /** Number of whole days between this date and `other`. */
  diffDays(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.DAY, 'Diff Days ' + this.displayName()); }
  /** Number of whole months between this date and `other`. */
  diffMonths(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MONTH, 'Diff Months ' + this.displayName()); }
  /** Number of whole years between this date and `other`. */
  diffYears(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.YEAR, 'Diff Years ' + this.displayName()); }
}

export class DateTimeAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded, nullable); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return temporalConstant(value as Date | string);
  }

  /** Filter to rows where this timestamp equals `value`. */
  eq(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, temporalConstant(value));
  }
  /** Filter to rows where this timestamp does not equal `value`. */
  ne(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, temporalConstant(value));
  }
  /** Filter to rows where this timestamp is after `value`. */
  gt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, temporalConstant(value));
  }
  /** Filter to rows where this timestamp is before `value`. */
  lt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, temporalConstant(value));
  }
  /** Filter to rows where this timestamp is on or after `value`. */
  gte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, temporalConstant(value));
  }
  /** Filter to rows where this timestamp is on or before `value`. */
  lte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, temporalConstant(value));
  }

  /** Extract the four-digit calendar year. */
  year(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.YEAR, 'Year ' + this.displayName()); }
  /** Extract the month number (1–12). */
  month(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MONTH, 'Month ' + this.displayName()); }
  /** Extract the day of the month (1–31). */
  day(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DAY, 'Day ' + this.displayName()); }
  /** Extract the hour (0–23). */
  hour(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.HOUR, 'Hour ' + this.displayName()); }
  /** Extract the minute (0–59). */
  minute(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MINUTE, 'Minute ' + this.displayName()); }
  /** Extract the second (0–59). */
  second(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.SECOND, 'Second ' + this.displayName()); }
  /** Extract the quarter (1–4). */
  quarter(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.QUARTER, 'Quarter ' + this.displayName()); }
  /** Extract the ISO week number (1–53). */
  week(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.WEEK, 'Week ' + this.displayName()); }
  /** Extract the day of the week (0 = Sunday through 6 = Saturday). */
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DOW, 'Day Of Week ' + this.displayName()); }
  /** The date of the first day of the week the date falls in (a Monday). */
  firstDayOfWeek(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.WEEK, 'First Day Of Week ' + this.displayName()); }
  /** The date of the first day of the month the date falls in. */
  firstDayOfMonth(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.MONTH, 'First Day Of Month ' + this.displayName()); }
  /** The date of the first day of the quarter the date falls in. */
  firstDayOfQuarter(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.QUARTER, 'First Day Of Quarter ' + this.displayName()); }
  /** The date of the first day of the year the date falls in. */
  firstDayOfYear(): DateTruncOperation { return new DateTruncOperation(this.cwj(), DatePart.YEAR, 'First Day Of Year ' + this.displayName()); }

  /** Add `n` days to this timestamp. */
  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, true, 'Add Days ' + this.displayName()); }
  /** Add `n` months to this timestamp. */
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, true, 'Add Months ' + this.displayName()); }
  /** Add `n` years to this timestamp. */
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, true, 'Add Years ' + this.displayName()); }
  /** Add `n` hours to this timestamp. */
  addHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.HOUR, true, 'Add Hours ' + this.displayName()); }
  /** Add `n` minutes to this timestamp. */
  addMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MINUTE, true, 'Add Minutes ' + this.displayName()); }
  /** Add `n` seconds to this timestamp. */
  addSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.SECOND, true, 'Add Seconds ' + this.displayName()); }
  /** Subtract `n` days from this timestamp. */
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, false, 'Subtract Days ' + this.displayName()); }
  /** Subtract `n` months from this timestamp. */
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, false, 'Subtract Months ' + this.displayName()); }
  /** Subtract `n` years from this timestamp. */
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, false, 'Subtract Years ' + this.displayName()); }
  /** Subtract `n` hours from this timestamp. */
  subtractHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.HOUR, false, 'Subtract Hours ' + this.displayName()); }
  /** Subtract `n` minutes from this timestamp. */
  subtractMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MINUTE, false, 'Subtract Minutes ' + this.displayName()); }
  /** Subtract `n` seconds from this timestamp. */
  subtractSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.SECOND, false, 'Subtract Seconds ' + this.displayName()); }

  /** Number of whole days between this timestamp and `other`. */
  diffDays(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.DAY, 'Diff Days ' + this.displayName()); }
  /** Number of whole months between this timestamp and `other`. */
  diffMonths(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MONTH, 'Diff Months ' + this.displayName()); }
  /** Number of whole years between this timestamp and `other`. */
  diffYears(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.YEAR, 'Diff Years ' + this.displayName()); }
  /** Number of whole hours between this timestamp and `other`. */
  diffHours(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.HOUR, 'Diff Hours ' + this.displayName()); }
  /** Number of whole minutes between this timestamp and `other`. */
  diffMinutes(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MINUTE, 'Diff Minutes ' + this.displayName()); }
  /** Number of whole seconds between this timestamp and `other`. */
  diffSeconds(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.SECOND, 'Diff Seconds ' + this.displayName()); }
}

export interface DateAttribute extends MinMax {}
applyMixins(DateAttribute, [MinMax]);

export interface DateTimeAttribute extends MinMax {}
applyMixins(DateTimeAttribute, [MinMax]);
