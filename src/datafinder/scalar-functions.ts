/**
 * Scalar functions as methods, shared by attributes and by the results of other functions, so they chain:
 * `f.name().toUpperCase().length()`.
 *
 * TypeScript has no multiple inheritance, so each group of functions is a class whose methods are mixed into
 * every host with `applyMixins` (the handbook's pattern), the type side being an `interface Host extends Group {}`
 * beside the host. A host provides `functionInput()` and `functionLabel()`: an attribute reads its column and is
 * labelled by its display name; a function result is itself the input and is labelled by its own name.
 */
import {
  ConcatOperation,
  ConcatPart,
  RelationalOperationElement,
  concat,
  ScalarFunction,
  ScalarFunctionOperation,
  applyMixins,
  Equatable,
  Orderable,
  Arithmetic,
  StringPredicates,
  DateValue,
  StringConstantOperation,
  IntegerConstantOperation,
  FloatConstantOperation,
  DecimalConstantOperation,
  Aggregates,
  AggregateConstructor,
  IntegerAggregateOperation,
  DoubleAggregateOperation,
  DecimalAggregateOperation,
  DateAggregateOperation,
  UntypedAggregateOperation,
} from '../model/relational';

/** What a function result gives its own functions: it is their input, and their label is its own name. */
abstract class FunctionResult extends ScalarFunctionOperation {
  functionInput(): RelationalOperationElement { return this; }
  functionLabel(): string { return labelOf(this); }
}

/** A function result that gives text, which has the string functions too: `f.name().toUpperCase().length()`. Compared for equality with text, as a text column is, and has no order. */
export class StringFunctionOperation extends FunctionResult {}

/** A function result that gives a number, which has the numeric functions too. The kinds are below. */
export abstract class NumericFunctionOperation extends FunctionResult {
  arithmeticOperand(): RelationalOperationElement { return this; }
}

/** A function that gives a whole number (`length`, or `abs` of an integer): compared with numbers. */
export class IntegerFunctionOperation extends NumericFunctionOperation {
  numberKind(): 'integer' { return 'integer'; }
  aggregateKind(): AggregateConstructor<IntegerAggregateOperation> { return IntegerAggregateOperation; }

  isInteger(): boolean { return true; }

  sameType(func: ScalarFunction, label: string, secondArg?: number, extraArgs: (string | number | boolean)[] = []): IntegerFunctionOperation {
    return new IntegerFunctionOperation(this, func, label, secondArg, extraArgs);
  }
}

/** A function that gives a floating-point number (`sqrt`, `power`, or `abs` of a double). */
export class DoubleFunctionOperation extends NumericFunctionOperation {
  numberKind(): 'double' { return 'double'; }
  aggregateKind(): AggregateConstructor<DoubleAggregateOperation> { return DoubleAggregateOperation; }

  sameType(func: ScalarFunction, label: string, secondArg?: number, extraArgs: (string | number | boolean)[] = []): DoubleFunctionOperation {
    return new DoubleFunctionOperation(this, func, label, secondArg, extraArgs);
  }
}

/** A function that gives a decimal (`abs` of a decimal column). */
export class DecimalFunctionOperation extends NumericFunctionOperation {
  numberKind(): 'decimal' { return 'decimal'; }
  aggregateKind(): AggregateConstructor<DecimalAggregateOperation> { return DecimalAggregateOperation; }

  sameType(func: ScalarFunction, label: string, secondArg?: number, extraArgs: (string | number | boolean)[] = []): DecimalFunctionOperation {
    return new DecimalFunctionOperation(this, func, label, secondArg, extraArgs);
  }
}

/** A function that gives a date or timestamp (`orElse` of a date column): compared with dates. */
export class DateFunctionOperation extends FunctionResult {
  aggregateKind(): AggregateConstructor<DateAggregateOperation> { return DateAggregateOperation; }
}

/** A function that gives a boolean (`orElse` of a boolean column): compared for equality. */
export class BooleanFunctionOperation extends FunctionResult {}

function labelOf(operation: ScalarFunctionOperation): string {
  return operation.displayName ?? operation.func.charAt(0) + operation.func.slice(1).toLowerCase();
}

function stringFunction(
  element: RelationalOperationElement, func: ScalarFunction, label: string,
  secondArg?: number, extraArgs: (string | number)[] = [],
): StringFunctionOperation {
  return new StringFunctionOperation(element, func, label, secondArg, extraArgs);
}

export function integerFunction(
  element: RelationalOperationElement, func: ScalarFunction, label: string, secondArg?: number, cast?: string,
): IntegerFunctionOperation {
  return new IntegerFunctionOperation(element, func, label, secondArg, [], cast);
}

export function doubleFunction(
  element: RelationalOperationElement, func: ScalarFunction, label: string, secondArg?: number,
): DoubleFunctionOperation {
  return new DoubleFunctionOperation(element, func, label, secondArg);
}

/** Functions of text. */
export abstract class StringFunctions {
  /** @internal The expression the function applies to. */
  abstract functionInput(): RelationalOperationElement;
  /** @internal What a function of this is labelled after. */
  abstract functionLabel(): string;

  /** Join text on the end: `f.first().concat(' ', f.last())`. A NULL part makes the whole NULL. */
  concat(...more: ConcatPart[]): ConcatOperation {
    return concat(this as unknown as ConcatPart, ...more);
  }

  /** Convert every character to uppercase. */
  toUpperCase(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.UPPER, 'Upper ' + this.functionLabel());
  }
  /** Convert every character to lowercase. */
  toLowerCase(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.LOWER, 'Lower ' + this.functionLabel());
  }
  /** Remove leading and trailing whitespace. */
  trim(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.TRIM, 'Trim ' + this.functionLabel());
  }
  /** Remove leading whitespace. */
  trimStart(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.LTRIM, 'Trim Start ' + this.functionLabel());
  }
  /** Remove trailing whitespace. */
  trimEnd(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.RTRIM, 'Trim End ' + this.functionLabel());
  }
  /** Return the number of characters in the string. */
  length(): IntegerFunctionOperation {
    return integerFunction(this.functionInput(), ScalarFunction.LENGTH, 'Length ' + this.functionLabel());
  }
  /** Return the string with characters in reverse order. */
  reverse(): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.REVERSE, 'Reverse ' + this.functionLabel());
  }
  /** Return the first `n` characters. */
  left(n: number): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.LEFT, 'Left ' + this.functionLabel(), n);
  }
  /** Return the last `n` characters. */
  right(n: number): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.RIGHT, 'Right ' + this.functionLabel(), n);
  }
  /** Return the string repeated `n` times. */
  repeat(n: number): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.REPEAT, 'Repeat ' + this.functionLabel(), n);
  }
  /** Replace all occurrences of `fromStr` with `toStr`. */
  replace(fromStr: string, toStr: string): StringFunctionOperation {
    return stringFunction(this.functionInput(), ScalarFunction.REPLACE, 'Replace ' + this.functionLabel(), undefined, [fromStr, toStr]);
  }
  /**
   * Extract a portion of the string.
   * `start` is zero-based (following Python convention); `length` is optional.
   */
  substring(start: number, length?: number): StringFunctionOperation {
    // Python convention: 0-based start; SQL SUBSTRING is 1-based, so add 1
    const args = length !== undefined ? [start + 1, length] : [start + 1];
    return stringFunction(this.functionInput(), ScalarFunction.SUBSTRING, 'Substring ' + this.functionLabel(), undefined, args);
  }
}

/**
 * Functions of a number, where `R` is the kind of number the host is. `abs`, `ceil`, `floor`, `mod` and `round` keep
 * it: an integer stays an integer, a decimal a decimal. `sqrt`, `power`, the logarithm, exponential and the
 * trigonometric functions give a double, as SQL does. A host provides `functionInput()`, `functionLabel()` and
 * `sameType()`, which makes a result of its own kind.
 */
export abstract class NumericFunctions<R extends NumericFunctionOperation> {
  /** @internal The expression the function applies to. */
  abstract functionInput(): RelationalOperationElement;
  /** @internal What a function of this is labelled after. */
  abstract functionLabel(): string;
  /** @internal A function of this that gives a number of the same kind. */
  abstract sameType(func: ScalarFunction, label: string, secondArg?: number): R;
  /** @internal Whether this gives whole numbers, so a whole power of it does too. */
  isInteger(): boolean { return false; }

  /** Absolute value (distance from zero, always non-negative). */
  abs(): R {
    return this.sameType(ScalarFunction.ABS, 'Abs ' + this.functionLabel());
  }
  /** Round up to the nearest integer. */
  ceil(): R {
    return this.sameType(ScalarFunction.CEILING, 'Ceil ' + this.functionLabel());
  }
  /** Round down to the nearest integer. */
  floor(): R {
    return this.sameType(ScalarFunction.FLOOR, 'Floor ' + this.functionLabel());
  }
  /** Square root. */
  sqrt(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.SQRT, 'Sqrt ' + this.functionLabel());
  }
  /** Sine of the value (in radians). */
  sin(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.SIN, 'Sin ' + this.functionLabel());
  }
  /** Cosine of the value (in radians). */
  cos(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.COS, 'Cos ' + this.functionLabel());
  }
  /** Tangent of the value (in radians). */
  tan(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.TAN, 'Tan ' + this.functionLabel());
  }
  /** Inverse sine, in radians. */
  asin(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.ASIN, 'Asin ' + this.functionLabel());
  }
  /** Inverse cosine, in radians. */
  acos(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.ACOS, 'Acos ' + this.functionLabel());
  }
  /** Inverse tangent, in radians. */
  atan(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.ATAN, 'Atan ' + this.functionLabel());
  }
  /** atan2(value, `x`), in radians. */
  atan2(x: number): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.ATAN2, 'Atan2 ' + this.functionLabel(), x);
  }
  /** e raised to the value. */
  exp(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.EXP, 'Exp ' + this.functionLabel());
  }
  /** Natural logarithm of the value. */
  log(): DoubleFunctionOperation {
    return doubleFunction(this.functionInput(), ScalarFunction.LOG, 'Log ' + this.functionLabel());
  }
  /** Remainder after dividing by `n`. */
  mod(n: number): R {
    return this.sameType(ScalarFunction.MOD, 'Mod ' + this.functionLabel(), n);
  }
  /**
   * Raise to the power of `n`. An integer raised to a whole, non-negative `n` is an integer, as in JavaScript's `**`
   * on whole numbers; SQL's `POWER` gives a double, so the result is cast to `BIGINT`. Any other power is a double.
   */
  power(n: number): IntegerFunctionOperation | DoubleFunctionOperation {
    const label = 'Power ' + this.functionLabel();
    if (this.isInteger() && Number.isInteger(n) && n >= 0) {
      return integerFunction(this.functionInput(), ScalarFunction.POWER, label, n, 'BIGINT');
    }
    return doubleFunction(this.functionInput(), ScalarFunction.POWER, label, n);
  }
  /** Round to `d` decimal places, or to the nearest integer when `d` is omitted. */
  round(d?: number): R {
    return this.sameType(ScalarFunction.ROUND, 'Round ' + this.functionLabel(), d);
  }
}

export interface StringFunctionOperation extends Equatable<string>, StringPredicates, StringFunctions, Aggregates<UntypedAggregateOperation> {}
applyMixins(StringFunctionOperation, [Equatable, StringPredicates, StringFunctions, Aggregates]);

export interface IntegerFunctionOperation extends Equatable<number>, Orderable<number>, Arithmetic<'integer'>, NumericFunctions<IntegerFunctionOperation>, Aggregates<IntegerAggregateOperation> {}
applyMixins(IntegerFunctionOperation, [Equatable, Orderable, Arithmetic, NumericFunctions, Aggregates]);

export interface DoubleFunctionOperation extends Equatable<number>, Orderable<number>, Arithmetic<'double'>, NumericFunctions<DoubleFunctionOperation>, Aggregates<DoubleAggregateOperation> {}
applyMixins(DoubleFunctionOperation, [Equatable, Orderable, Arithmetic, NumericFunctions, Aggregates]);

export interface DecimalFunctionOperation extends Equatable<number>, Orderable<number>, Arithmetic<'decimal'>, NumericFunctions<DecimalFunctionOperation>, Aggregates<DecimalAggregateOperation> {}
applyMixins(DecimalFunctionOperation, [Equatable, Orderable, Arithmetic, NumericFunctions, Aggregates]);

export interface DateFunctionOperation extends Equatable<DateValue>, Orderable<DateValue>, Aggregates<DateAggregateOperation> {}
applyMixins(DateFunctionOperation, [Equatable, Orderable, Aggregates]);

export interface BooleanFunctionOperation extends Equatable<boolean>, Aggregates {}
applyMixins(BooleanFunctionOperation, [Equatable, Aggregates]);

// A constant has the functions a column of its type has: `constant('Hello').length()`, `constant(16).sqrt()`.
// A function of a constant is applied to the constant and named for the function and the value: `Upper Hello`.
declare module '../model/relational' {
  interface StringConstantOperation extends StringFunctions {}
  interface IntegerConstantOperation extends NumericFunctions<IntegerFunctionOperation> {}
  interface FloatConstantOperation extends NumericFunctions<DoubleFunctionOperation> {}
  interface DecimalConstantOperation extends NumericFunctions<DecimalFunctionOperation> {}
}
applyMixins(StringConstantOperation, [StringFunctions]);
applyMixins(IntegerConstantOperation, [NumericFunctions]);
applyMixins(FloatConstantOperation, [NumericFunctions]);
applyMixins(DecimalConstantOperation, [NumericFunctions]);

IntegerConstantOperation.prototype.sameType = function (func, label, secondArg) {
  return new IntegerFunctionOperation(this, func, label, secondArg);
};
IntegerConstantOperation.prototype.isInteger = () => true;
FloatConstantOperation.prototype.sameType = function (func, label, secondArg) {
  return new DoubleFunctionOperation(this, func, label, secondArg);
};
DecimalConstantOperation.prototype.sameType = function (func, label, secondArg) {
  return new DecimalFunctionOperation(this, func, label, secondArg);
};
