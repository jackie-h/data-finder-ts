import { Attribute, AttributeValue } from './attribute';
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
  BooleanConstantOperation,
  DecimalConstantOperation,
  AggregateOperation,
  AggregateOperator,
  ScalarFunction,
  ScalarFunctionOperation,
  DatePart,
  DateExtractOperation,
  DateArithmeticOperation,
  DateDiffOperation,
  JoinTreeNodeOperation,
} from '../model/relational';

export class StringAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new StringConstantOperation(String(value));
  }

  /** Convert every character to uppercase. */
  toUpperCase(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.UPPER, 'Upper ' + this.displayName());
  }
  /** Convert every character to lowercase. */
  toLowerCase(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LOWER, 'Lower ' + this.displayName());
  }
  /** Remove leading and trailing whitespace. */
  trim(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.TRIM, 'Trim ' + this.displayName());
  }
  /** Remove leading whitespace. */
  trimStart(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LTRIM, 'Trim Start ' + this.displayName());
  }
  /** Remove trailing whitespace. */
  trimEnd(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.RTRIM, 'Trim End ' + this.displayName());
  }
  /** Return the number of characters in the string. */
  length(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LENGTH, 'Length ' + this.displayName());
  }
  /** Return the string with characters in reverse order. */
  reverse(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REVERSE, 'Reverse ' + this.displayName());
  }
  /** Return the first `n` characters. */
  left(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LEFT, 'Left ' + this.displayName(), n);
  }
  /** Return the last `n` characters. */
  right(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.RIGHT, 'Right ' + this.displayName(), n);
  }
  /** Return the string repeated `n` times. */
  repeat(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REPEAT, 'Repeat ' + this.displayName(), n);
  }
  /** Replace all occurrences of `fromStr` with `toStr`. */
  replace(fromStr: string, toStr: string): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REPLACE, 'Replace ' + this.displayName(), undefined, [fromStr, toStr]);
  }
  /**
   * Extract a portion of the string.
   * `start` is zero-based (following Python convention); `length` is optional.
   */
  substring(start: number, length?: number): ScalarFunctionOperation {
    // Python convention: 0-based start; SQL SUBSTRING is 1-based, so add 1
    const args: (number)[] = length !== undefined ? [start + 1, length] : [start + 1];
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.SUBSTRING, 'Substring ' + this.displayName(), undefined, args);
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
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${value}%`));
  }
  /** Filter to rows where this attribute begins with `prefix`. */
  startsWith(prefix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`${prefix}%`));
  }
  /** Filter to rows where this attribute ends with `suffix`. */
  endsWith(suffix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${suffix}`));
  }
  /** Filter to rows where this attribute does not contain `value` as a substring. */
  notContains(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_LIKE, new StringConstantOperation(`%${value}%`));
  }
}

export abstract class NumericAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

  /** Sum of all values in the group. */
  sum(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.SUM, 'Sum ' + this.displayName());
  }
  /** Smallest value in the group. */
  min(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MIN, 'Min ' + this.displayName());
  }
  /** Largest value in the group. */
  max(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MAX, 'Max ' + this.displayName());
  }
  /** Arithmetic mean of all values in the group. */
  average(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.AVERAGE, 'Average ' + this.displayName());
  }
  /** Absolute value (distance from zero, always non-negative). */
  abs(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.ABS, 'Abs ' + this.displayName());
  }
  /** Round up to the nearest integer. */
  ceil(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.CEILING, 'Ceil ' + this.displayName());
  }
  /** Round down to the nearest integer. */
  floor(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.FLOOR, 'Floor ' + this.displayName());
  }
  /** Square root. */
  sqrt(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.SQRT, 'Sqrt ' + this.displayName());
  }
  /** Remainder after dividing by `n`. */
  mod(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.MOD, 'Mod ' + this.displayName(), n);
  }
  /** Raise to the power of `n`. */
  power(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.POWER, 'Power ' + this.displayName(), n);
  }
  /** Round to `d` decimal places, or to the nearest integer when `d` is omitted. */
  round(d?: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.ROUND, 'Round ' + this.displayName(), d);
  }
}

export class DoubleAttribute extends NumericAttribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

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
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

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
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

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
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

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

export class DateAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

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
  ) { super(displayName, columnName, columnDbType, owner, parent, embedded); }

  protected toConstant(value: AttributeValue): ConstantOperation {
    return new DateTimeConstantOperation(parseDate(value as Date | string));
  }

  /** Filter to rows where this timestamp equals `value`. */
  eq(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DateTimeConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this timestamp does not equal `value`. */
  ne(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DateTimeConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this timestamp is after `value`. */
  gt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DateTimeConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this timestamp is before `value`. */
  lt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DateTimeConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this timestamp is on or after `value`. */
  gte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DateTimeConstantOperation(parseDate(value)));
  }
  /** Filter to rows where this timestamp is on or before `value`. */
  lte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new DateTimeConstantOperation(parseDate(value)));
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
