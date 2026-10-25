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
} from '../model/relational';

/** A function result that gives text, which has the string functions too: `f.name().toUpperCase().length()`. */
export class StringFunctionOperation extends ScalarFunctionOperation {
  functionInput(): RelationalOperationElement { return this; }
  functionLabel(): string { return labelOf(this); }
}

/** A function result that gives a number, which has the numeric functions too. */
export class NumericFunctionOperation extends ScalarFunctionOperation {
  functionInput(): RelationalOperationElement { return this; }
  functionLabel(): string { return labelOf(this); }
}

function labelOf(operation: ScalarFunctionOperation): string {
  return operation.displayName ?? operation.func.charAt(0) + operation.func.slice(1).toLowerCase();
}

function stringFunction(
  element: RelationalOperationElement, func: ScalarFunction, label: string,
  secondArg?: number, extraArgs: (string | number)[] = [],
): StringFunctionOperation {
  return new StringFunctionOperation(element, func, label, secondArg, extraArgs);
}

function numberFunction(
  element: RelationalOperationElement, func: ScalarFunction, label: string, secondArg?: number,
): NumericFunctionOperation {
  return new NumericFunctionOperation(element, func, label, secondArg);
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
  length(): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.LENGTH, 'Length ' + this.functionLabel());
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

/** Functions of a number. */
export abstract class NumericFunctions {
  /** @internal The expression the function applies to. */
  abstract functionInput(): RelationalOperationElement;
  /** @internal What a function of this is labelled after. */
  abstract functionLabel(): string;

  /** Absolute value (distance from zero, always non-negative). */
  abs(): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.ABS, 'Abs ' + this.functionLabel());
  }
  /** Round up to the nearest integer. */
  ceil(): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.CEILING, 'Ceil ' + this.functionLabel());
  }
  /** Round down to the nearest integer. */
  floor(): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.FLOOR, 'Floor ' + this.functionLabel());
  }
  /** Square root. */
  sqrt(): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.SQRT, 'Sqrt ' + this.functionLabel());
  }
  /** Remainder after dividing by `n`. */
  mod(n: number): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.MOD, 'Mod ' + this.functionLabel(), n);
  }
  /** Raise to the power of `n`. */
  power(n: number): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.POWER, 'Power ' + this.functionLabel(), n);
  }
  /** Round to `d` decimal places, or to the nearest integer when `d` is omitted. */
  round(d?: number): NumericFunctionOperation {
    return numberFunction(this.functionInput(), ScalarFunction.ROUND, 'Round ' + this.functionLabel(), d);
  }
}

export interface StringFunctionOperation extends StringFunctions {}
applyMixins(StringFunctionOperation, [StringFunctions]);

export interface NumericFunctionOperation extends NumericFunctions {}
applyMixins(NumericFunctionOperation, [NumericFunctions]);
