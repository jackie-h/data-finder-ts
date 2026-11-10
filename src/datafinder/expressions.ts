/** Expressions that are not a column of a finder: values to select next to the columns. */
import {
  BooleanConstantOperation,
  CountAllOperation,
  ConstantOperation,
  DateConstantOperation,
  DateOnly,
  DateTimeConstantOperation,
  FloatConstantOperation,
  IntegerConstantOperation,
  NumericConstantOperation,
  StringConstantOperation,
} from '../model/relational';
import './scalar-functions'; // a constant has the functions of its type
import './date-functions';

/**
 * A fixed value as a column: `f.findAll(null, null, [f.name(), constant('EU').alias('Region')])`.
 * A number is an integer constant or a float one, which takes part in arithmetic: `constant(100).minus(f.price())`.
 * A whole-number literal is an integer and a fractional one a float, as `1` and `1.0` are the same number in JavaScript.
 * A `DateOnly` is a date and any other `Date` a timestamp. It is named "Constant" unless `alias` gives it a name.
 */
export function constant<N extends number>(value: N): number extends N
  ? IntegerConstantOperation | FloatConstantOperation
  : `${N}` extends `${bigint}` ? IntegerConstantOperation : FloatConstantOperation;
export function constant(value: string): StringConstantOperation;
export function constant(value: boolean): BooleanConstantOperation;
export function constant(value: DateOnly): DateConstantOperation;
export function constant(value: Date): DateTimeConstantOperation;
export function constant(value: boolean | string | Date): ConstantOperation;
export function constant(value: boolean | number | string | Date): ConstantOperation;
export function constant(value: boolean | number | string | Date): ConstantOperation {
  if (typeof value === 'boolean') return new BooleanConstantOperation(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? new IntegerConstantOperation(value) : new FloatConstantOperation(value);
  }
  if (typeof value === 'string') return new StringConstantOperation(value);
  if (value instanceof DateOnly) return new DateConstantOperation(value); // before Date: DateOnly is a Date
  if (value instanceof Date) return new DateTimeConstantOperation(value);
  throw new TypeError(`A constant column holds a boolean, a finite number, a string or a date, not ${value === null ? 'null' : typeof value}`);
}

/**
 * The number of rows in the group, `COUNT(*)`: `f.findAll(null, null, [f.category(), countAll()]).groupBy(f.category())`.
 * Unlike `count()` of a column it also counts rows where that column is missing.
 */
export function countAll(): CountAllOperation {
  return new CountAllOperation('');
}
