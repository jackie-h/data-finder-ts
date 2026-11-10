/**
 * Functions of a date or a timestamp as methods, shared by a date column and a date constant, as the string and
 * numeric functions are (see scalar-functions.ts): `f.tradeDate().year()`, `constant(new DateOnly('2024-01-31')).addDays(1)`.
 * A host provides `functionInput()` and `functionLabel()`.
 *
 * It also gives the date and timestamp constants these functions, so a module that makes constants loads it.
 */
import {
  DateArithmeticOperation,
  DateConstantOperation,
  DateDiffOperation,
  DateExtractOperation,
  DatePart,
  DateTimeConstantOperation,
  DateTruncOperation,
  RelationalOperationElement,
  applyMixins,
} from '../model/relational';
import { Comparand, comparandOperand } from './attribute';

function diffOther(other: Date | Comparand): Date | RelationalOperationElement {
  return other instanceof Date ? other : comparandOperand(other);
}

/** Functions of a date: parts, the first day of a period, days, months and years added or taken away, and the difference between two dates. */
export abstract class DateFunctions {
  /** @internal The expression the function applies to. */
  abstract functionInput(): RelationalOperationElement;
  /** @internal What a function of this is labelled after. */
  abstract functionLabel(): string;

  /** Extract the four-digit calendar year. */
  year(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.YEAR, 'Year ' + this.functionLabel()); }
  /** Extract the month number (1–12). */
  month(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.MONTH, 'Month ' + this.functionLabel()); }
  /** Extract the day of the month (1–31). */
  day(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.DAY, 'Day ' + this.functionLabel()); }
  /** Extract the quarter (1–4). */
  quarter(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.QUARTER, 'Quarter ' + this.functionLabel()); }
  /** Extract the ISO week number (1–53). */
  week(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.WEEK, 'Week ' + this.functionLabel()); }
  /** Extract the day of the week (0 = Sunday through 6 = Saturday). */
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.DOW, 'Day Of Week ' + this.functionLabel()); }
  /** The date of the first day of the week the date falls in (a Monday). */
  firstDayOfWeek(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.WEEK, 'First Day Of Week ' + this.functionLabel()); }
  /** The date of the first day of the month the date falls in. */
  firstDayOfMonth(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.MONTH, 'First Day Of Month ' + this.functionLabel()); }
  /** The date of the first day of the quarter the date falls in. */
  firstDayOfQuarter(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.QUARTER, 'First Day Of Quarter ' + this.functionLabel()); }
  /** The date of the first day of the year the date falls in. */
  firstDayOfYear(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.YEAR, 'First Day Of Year ' + this.functionLabel()); }

  /** Add `n` days to this date. */
  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, true, 'Add Days ' + this.functionLabel()); }
  /** Add `n` months to this date. */
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, true, 'Add Months ' + this.functionLabel()); }
  /** Add `n` years to this date. */
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, true, 'Add Years ' + this.functionLabel()); }
  /** Subtract `n` days from this date. */
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, false, 'Subtract Days ' + this.functionLabel()); }
  /** Subtract `n` months from this date. */
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, false, 'Subtract Months ' + this.functionLabel()); }
  /** Subtract `n` years from this date. */
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, false, 'Subtract Years ' + this.functionLabel()); }

  /** Number of whole days between this date and `other`. */
  diffDays(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.DAY, 'Diff Days ' + this.functionLabel()); }
  /** Number of whole months between this date and `other`. */
  diffMonths(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.MONTH, 'Diff Months ' + this.functionLabel()); }
  /** Number of whole years between this date and `other`. */
  diffYears(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.YEAR, 'Diff Years ' + this.functionLabel()); }
}

/** Functions of a timestamp: those of a date, with hour, minute and second granularity. */
export abstract class DateTimeFunctions {
  /** @internal The expression the function applies to. */
  abstract functionInput(): RelationalOperationElement;
  /** @internal What a function of this is labelled after. */
  abstract functionLabel(): string;

  /** Extract the four-digit calendar year. */
  year(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.YEAR, 'Year ' + this.functionLabel()); }
  /** Extract the month number (1–12). */
  month(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.MONTH, 'Month ' + this.functionLabel()); }
  /** Extract the day of the month (1–31). */
  day(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.DAY, 'Day ' + this.functionLabel()); }
  /** Extract the hour (0–23). */
  hour(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.HOUR, 'Hour ' + this.functionLabel()); }
  /** Extract the minute (0–59). */
  minute(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.MINUTE, 'Minute ' + this.functionLabel()); }
  /** Extract the second (0–59). */
  second(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.SECOND, 'Second ' + this.functionLabel()); }
  /** Extract the quarter (1–4). */
  quarter(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.QUARTER, 'Quarter ' + this.functionLabel()); }
  /** Extract the ISO week number (1–53). */
  week(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.WEEK, 'Week ' + this.functionLabel()); }
  /** Extract the day of the week (0 = Sunday through 6 = Saturday). */
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.DOW, 'Day Of Week ' + this.functionLabel()); }
  /** The date of the first day of the week the date falls in (a Monday). */
  firstDayOfWeek(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.WEEK, 'First Day Of Week ' + this.functionLabel()); }
  /** The date of the first day of the month the date falls in. */
  firstDayOfMonth(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.MONTH, 'First Day Of Month ' + this.functionLabel()); }
  /** The date of the first day of the quarter the date falls in. */
  firstDayOfQuarter(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.QUARTER, 'First Day Of Quarter ' + this.functionLabel()); }
  /** The date of the first day of the year the date falls in. */
  firstDayOfYear(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.YEAR, 'First Day Of Year ' + this.functionLabel()); }

  /** Add `n` days to this timestamp. */
  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, true, 'Add Days ' + this.functionLabel()); }
  /** Add `n` months to this timestamp. */
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, true, 'Add Months ' + this.functionLabel()); }
  /** Add `n` years to this timestamp. */
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, true, 'Add Years ' + this.functionLabel()); }
  /** Add `n` hours to this timestamp. */
  addHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.HOUR, true, 'Add Hours ' + this.functionLabel()); }
  /** Add `n` minutes to this timestamp. */
  addMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MINUTE, true, 'Add Minutes ' + this.functionLabel()); }
  /** Add `n` seconds to this timestamp. */
  addSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.SECOND, true, 'Add Seconds ' + this.functionLabel()); }
  /** Subtract `n` days from this timestamp. */
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, false, 'Subtract Days ' + this.functionLabel()); }
  /** Subtract `n` months from this timestamp. */
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, false, 'Subtract Months ' + this.functionLabel()); }
  /** Subtract `n` years from this timestamp. */
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, false, 'Subtract Years ' + this.functionLabel()); }
  /** Subtract `n` hours from this timestamp. */
  subtractHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.HOUR, false, 'Subtract Hours ' + this.functionLabel()); }
  /** Subtract `n` minutes from this timestamp. */
  subtractMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MINUTE, false, 'Subtract Minutes ' + this.functionLabel()); }
  /** Subtract `n` seconds from this timestamp. */
  subtractSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.SECOND, false, 'Subtract Seconds ' + this.functionLabel()); }

  /** Number of whole days between this timestamp and `other`. */
  diffDays(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.DAY, 'Diff Days ' + this.functionLabel()); }
  /** Number of whole months between this timestamp and `other`. */
  diffMonths(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.MONTH, 'Diff Months ' + this.functionLabel()); }
  /** Number of whole years between this timestamp and `other`. */
  diffYears(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.YEAR, 'Diff Years ' + this.functionLabel()); }
  /** Number of whole hours between this timestamp and `other`. */
  diffHours(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.HOUR, 'Diff Hours ' + this.functionLabel()); }
  /** Number of whole minutes between this timestamp and `other`. */
  diffMinutes(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.MINUTE, 'Diff Minutes ' + this.functionLabel()); }
  /** Number of whole seconds between this timestamp and `other`. */
  diffSeconds(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.SECOND, 'Diff Seconds ' + this.functionLabel()); }
}

declare module '../model/relational' {
  interface DateConstantOperation extends DateFunctions {}
  interface DateTimeConstantOperation extends DateTimeFunctions {}
}
applyMixins(DateConstantOperation, [DateFunctions]);
applyMixins(DateTimeConstantOperation, [DateTimeFunctions]);
