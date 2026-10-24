/** Expressions that are not a column of a finder: values to select next to the columns. */
import {
  BooleanConstantOperation,
  ConstantOperation,
  DateConstantOperation,
  DateOnly,
  DateTimeConstantOperation,
  FloatConstantOperation,
  IntegerConstantOperation,
  StringConstantOperation,
} from '../model/relational';

/**
 * A fixed value as a column: `f.findAll(null, null, [f.name(), constant('EU').alias('Region')])`.
 * A `DateOnly` is a date and any other `Date` a timestamp. It is named "Constant" unless `alias` gives it a name.
 */
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
