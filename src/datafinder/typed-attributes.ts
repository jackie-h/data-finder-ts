import { Attribute } from './attribute';
import {
  ComparisonOperation,
  ComparisonOperator,
  Operation,
  StringConstantOperation,
  FloatConstantOperation,
  IntegerConstantOperation,
  DateConstantOperation,
  DateTimeConstantOperation,
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  upper(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.UPPER, 'Upper ' + this.displayName());
  }
  lower(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LOWER, 'Lower ' + this.displayName());
  }
  strip(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.TRIM, 'Strip ' + this.displayName());
  }
  lstrip(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LTRIM, 'LStrip ' + this.displayName());
  }
  rstrip(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.RTRIM, 'RStrip ' + this.displayName());
  }
  length(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LENGTH, 'Length ' + this.displayName());
  }
  reverse(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REVERSE, 'Reverse ' + this.displayName());
  }
  left(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.LEFT, 'Left ' + this.displayName(), n);
  }
  right(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.RIGHT, 'Right ' + this.displayName(), n);
  }
  repeat(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REPEAT, 'Repeat ' + this.displayName(), n);
  }
  replace(fromStr: string, toStr: string): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.REPLACE, 'Replace ' + this.displayName(), undefined, [fromStr, toStr]);
  }
  substring(start: number, length?: number): ScalarFunctionOperation {
    // Python convention: 0-based start; SQL SUBSTRING is 1-based, so add 1
    const args: (number)[] = length !== undefined ? [start + 1, length] : [start + 1];
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.SUBSTRING, 'Substring ' + this.displayName(), undefined, args);
  }

  eq(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new StringConstantOperation(value));
  }
  ne(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new StringConstantOperation(value));
  }
  contains(value: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${value}%`));
  }
  startsWith(prefix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`${prefix}%`));
  }
  endsWith(suffix: string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LIKE, new StringConstantOperation(`%${suffix}`));
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  sum(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.SUM, this.displayName() + ' Sum');
  }
  min(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MIN, this.displayName() + ' Min');
  }
  max(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.MAX, this.displayName() + ' Max');
  }
  average(): AggregateOperation {
    return new AggregateOperation(this.cwj(), AggregateOperator.AVERAGE, this.displayName() + ' Average');
  }
  abs(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.ABS, 'Abs ' + this.displayName());
  }
  ceil(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.CEILING, 'Ceil ' + this.displayName());
  }
  floor(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.FLOOR, 'Floor ' + this.displayName());
  }
  sqrt(): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.SQRT, 'Sqrt ' + this.displayName());
  }
  mod(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.MOD, 'Mod ' + this.displayName(), n);
  }
  power(n: number): ScalarFunctionOperation {
    return new ScalarFunctionOperation(this.cwj(), ScalarFunction.POWER, 'Power ' + this.displayName(), n);
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new FloatConstantOperation(value));
  }
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new FloatConstantOperation(value));
  }
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new FloatConstantOperation(value));
  }
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new FloatConstantOperation(value));
  }
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new FloatConstantOperation(value));
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DecimalConstantOperation(value));
  }
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DecimalConstantOperation(value));
  }
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DecimalConstantOperation(value));
  }
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DecimalConstantOperation(value));
  }
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DecimalConstantOperation(value));
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new IntegerConstantOperation(value));
  }
  ne(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new IntegerConstantOperation(value));
  }
  gt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new IntegerConstantOperation(value));
  }
  lt(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new IntegerConstantOperation(value));
  }
  gte(value: number): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new IntegerConstantOperation(value));
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: boolean): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(value));
  }
  isTrue(): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new BooleanConstantOperation(true));
  }
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
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DateConstantOperation(parseDate(value)));
  }
  ne(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DateConstantOperation(parseDate(value)));
  }
  gt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DateConstantOperation(parseDate(value)));
  }
  lt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DateConstantOperation(parseDate(value)));
  }
  gte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DateConstantOperation(parseDate(value)));
  }
  lte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new DateConstantOperation(parseDate(value)));
  }

  year(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.YEAR, 'Year ' + this.displayName()); }
  month(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MONTH, 'Month ' + this.displayName()); }
  day(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DAY, 'Day ' + this.displayName()); }
  quarter(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.QUARTER, 'Quarter ' + this.displayName()); }
  week(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.WEEK, 'Week ' + this.displayName()); }
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DOW, 'Day Of Week ' + this.displayName()); }

  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, true, 'Add Days ' + this.displayName()); }
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, true, 'Add Months ' + this.displayName()); }
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, true, 'Add Years ' + this.displayName()); }
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, false, 'Subtract Days ' + this.displayName()); }
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, false, 'Subtract Months ' + this.displayName()); }
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, false, 'Subtract Years ' + this.displayName()); }

  diffDays(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.DAY, 'Diff Days ' + this.displayName()); }
  diffMonths(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MONTH, 'Diff Months ' + this.displayName()); }
  diffYears(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.YEAR, 'Diff Years ' + this.displayName()); }
}

export class DateTimeAttribute extends Attribute {
  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
  ) { super(displayName, columnName, columnDbType, owner, parent); }

  eq(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.EQUAL, new DateTimeConstantOperation(parseDate(value)));
  }
  ne(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.NOT_EQUAL, new DateTimeConstantOperation(parseDate(value)));
  }
  gt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN, new DateTimeConstantOperation(parseDate(value)));
  }
  lt(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN, new DateTimeConstantOperation(parseDate(value)));
  }
  gte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, new DateTimeConstantOperation(parseDate(value)));
  }
  lte(value: Date | string): Operation {
    return new ComparisonOperation(this.cwj(), ComparisonOperator.LESS_THAN_OR_EQUAL_TO, new DateTimeConstantOperation(parseDate(value)));
  }

  year(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.YEAR, 'Year ' + this.displayName()); }
  month(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MONTH, 'Month ' + this.displayName()); }
  day(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DAY, 'Day ' + this.displayName()); }
  hour(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.HOUR, 'Hour ' + this.displayName()); }
  minute(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.MINUTE, 'Minute ' + this.displayName()); }
  second(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.SECOND, 'Second ' + this.displayName()); }
  quarter(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.QUARTER, 'Quarter ' + this.displayName()); }
  week(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.WEEK, 'Week ' + this.displayName()); }
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.cwj(), DatePart.DOW, 'Day Of Week ' + this.displayName()); }

  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, true, 'Add Days ' + this.displayName()); }
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, true, 'Add Months ' + this.displayName()); }
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, true, 'Add Years ' + this.displayName()); }
  addHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.HOUR, true, 'Add Hours ' + this.displayName()); }
  addMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MINUTE, true, 'Add Minutes ' + this.displayName()); }
  addSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.SECOND, true, 'Add Seconds ' + this.displayName()); }
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.DAY, false, 'Subtract Days ' + this.displayName()); }
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MONTH, false, 'Subtract Months ' + this.displayName()); }
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.YEAR, false, 'Subtract Years ' + this.displayName()); }
  subtractHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.HOUR, false, 'Subtract Hours ' + this.displayName()); }
  subtractMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.MINUTE, false, 'Subtract Minutes ' + this.displayName()); }
  subtractSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.cwj(), n, DatePart.SECOND, false, 'Subtract Seconds ' + this.displayName()); }

  diffDays(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.DAY, 'Diff Days ' + this.displayName()); }
  diffMonths(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MONTH, 'Diff Months ' + this.displayName()); }
  diffYears(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.YEAR, 'Diff Years ' + this.displayName()); }
  diffHours(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.HOUR, 'Diff Hours ' + this.displayName()); }
  diffMinutes(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.MINUTE, 'Diff Minutes ' + this.displayName()); }
  diffSeconds(other: Date): DateDiffOperation { return new DateDiffOperation(this.cwj(), other, DatePart.SECOND, 'Diff Seconds ' + this.displayName()); }
}
