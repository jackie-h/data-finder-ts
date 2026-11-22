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
  CurrentDateOperation,
  CurrentTimestampOperation,
  DayOfWeek,
  IntervalOperation,
  RecentDayOfWeekOperation,
  ScalarFunction,
  RelationalOperationElement,
  applyMixins,
} from '../model/relational';
import { Comparand, comparandOperand } from './attribute';
import { StringFunctionOperation, stringFunction } from './scalar-functions';

function diffOther(other: Date | Comparand): Date | RelationalOperationElement {
  return other instanceof Date ? other : comparandOperand(other);
}

/**
 * What a date and a timestamp have the same way: the parts of a date, the first day of a period, the most recent and the previous day of the week,
 * days, weeks, months and years added or taken away, and the difference between two in those units. A host provides `functionInput()` and
 * `functionLabel()`.
 */
export abstract class CalendarFunctions {
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
  dayOfWeek(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.ISODOW, 'Day Of Week ' + this.functionLabel()); }
  /** Extract the day of the year (1–366). */
  dayOfYear(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.DOY, 'Day Of Year ' + this.functionLabel()); }
  /** The name of the day of the week: `Monday` ... `Sunday`. */
  dayOfWeekName(): StringFunctionOperation { return stringFunction(this.functionInput(), ScalarFunction.DAY_NAME, 'Day Of Week Name ' + this.functionLabel()); }
  /** The date part: a timestamp without its time of day. */
  date(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.DAY, 'Date ' + this.functionLabel()); }

  /** The date of the first day of the week this falls in (a Monday). */
  firstDayOfWeek(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.WEEK, 'First Day Of Week ' + this.functionLabel()); }
  /** The date of the first day of the month this falls in. */
  firstDayOfMonth(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.MONTH, 'First Day Of Month ' + this.functionLabel()); }
  /** The date of the first day of the quarter this falls in. */
  firstDayOfQuarter(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.QUARTER, 'First Day Of Quarter ' + this.functionLabel()); }
  /** The date of the first day of the year this falls in. */
  firstDayOfYear(): DateTruncOperation { return new DateTruncOperation(this.functionInput(), DatePart.YEAR, 'First Day Of Year ' + this.functionLabel()); }
  /** The date of `day` on or before this: the date itself if it is that day. */
  mostRecentDayOfWeek(day: DayOfWeek): RecentDayOfWeekOperation { return new RecentDayOfWeekOperation(this.functionInput(), day, true, 'Most Recent Day Of Week ' + this.functionLabel()); }
  /** The date of `day` before this: a week before, if it is that day. */
  previousDayOfWeek(day: DayOfWeek): RecentDayOfWeekOperation { return new RecentDayOfWeekOperation(this.functionInput(), day, false, 'Previous Day Of Week ' + this.functionLabel()); }

  /** Add `n` days. */
  addDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, true, 'Add Days ' + this.functionLabel()); }
  /** Add `n` weeks. */
  addWeeks(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.WEEK, true, 'Add Weeks ' + this.functionLabel()); }
  /** Add `n` months. */
  addMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, true, 'Add Months ' + this.functionLabel()); }
  /** Add `n` years. */
  addYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, true, 'Add Years ' + this.functionLabel()); }
  /** Subtract `n` days. */
  subtractDays(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.DAY, false, 'Subtract Days ' + this.functionLabel()); }
  /** Subtract `n` weeks. */
  subtractWeeks(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.WEEK, false, 'Subtract Weeks ' + this.functionLabel()); }
  /** Subtract `n` months. */
  subtractMonths(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MONTH, false, 'Subtract Months ' + this.functionLabel()); }
  /** Subtract `n` years. */
  subtractYears(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.YEAR, false, 'Subtract Years ' + this.functionLabel()); }

  /** Number of whole days between this and `other`. */
  diffDays(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.DAY, 'Diff Days ' + this.functionLabel()); }
  /**
   * Number of weeks that start between this and `other`, as a week starts on a Monday: from a Sunday to the next day is 1, and from a
   * Monday to the Sunday after it is 0. It is negative when `other` is earlier.
   */
  diffWeeks(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.WEEK, 'Diff Weeks ' + this.functionLabel()); }
  /** Number of whole months between this and `other`. */
  diffMonths(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.MONTH, 'Diff Months ' + this.functionLabel()); }
  /** Number of whole years between this and `other`. */
  diffYears(other: Date | Comparand): DateDiffOperation { return new DateDiffOperation(this.functionInput(), diffOther(other), DatePart.YEAR, 'Diff Years ' + this.functionLabel()); }
}

/** Functions of a date. */
export abstract class DateFunctions extends CalendarFunctions {}

/** Functions of a timestamp: those of a date, with hour, minute, second and microsecond granularity. */
export abstract class DateTimeFunctions extends CalendarFunctions {
  /** Extract the hour (0–23). */
  hour(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.HOUR, 'Hour ' + this.functionLabel()); }
  /** Extract the minute (0–59). */
  minute(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.MINUTE, 'Minute ' + this.functionLabel()); }
  /** Extract the second (0–59). */
  second(): DateExtractOperation { return new DateExtractOperation(this.functionInput(), DatePart.SECOND, 'Second ' + this.functionLabel()); }

  /** Add `n` hours to this timestamp. */
  addHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.HOUR, true, 'Add Hours ' + this.functionLabel()); }
  /** Add `n` minutes to this timestamp. */
  addMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MINUTE, true, 'Add Minutes ' + this.functionLabel()); }
  /** Add `n` seconds to this timestamp. */
  addSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.SECOND, true, 'Add Seconds ' + this.functionLabel()); }
  /** Add `n` microseconds to this timestamp. */
  addMicroseconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MICROSECOND, true, 'Add Microseconds ' + this.functionLabel()); }
  /** Subtract `n` hours from this timestamp. */
  subtractHours(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.HOUR, false, 'Subtract Hours ' + this.functionLabel()); }
  /** Subtract `n` minutes from this timestamp. */
  subtractMinutes(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MINUTE, false, 'Subtract Minutes ' + this.functionLabel()); }
  /** Subtract `n` seconds from this timestamp. */
  subtractSeconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.SECOND, false, 'Subtract Seconds ' + this.functionLabel()); }
  /** Subtract `n` microseconds from this timestamp. */
  subtractMicroseconds(n: number): DateArithmeticOperation { return new DateArithmeticOperation(this.functionInput(), n, DatePart.MICROSECOND, false, 'Subtract Microseconds ' + this.functionLabel()); }

  /**
   * The time between `other` and this timestamp, `this - other`, as an interval: `f.validTo().minus(f.validFrom())`. It is compared with
   * an `Interval` (`.gt(Interval.days(30))`), and its `min()` and `max()` are intervals. It is not a number: for a number of days or
   * seconds use `diffDays` or `diffSeconds`.
   */
  minus(other: Date | Comparand): IntervalOperation {
    return new IntervalOperation(this.functionInput(), other instanceof Date ? new DateTimeConstantOperation(other) : comparandOperand(other), 'Interval ' + this.functionLabel());
  }

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
  interface CurrentDateOperation extends DateFunctions {}
  interface CurrentTimestampOperation extends DateTimeFunctions {}
}
applyMixins(DateConstantOperation, [DateFunctions]);
applyMixins(DateTimeConstantOperation, [DateTimeFunctions]);
applyMixins(CurrentDateOperation, [DateFunctions]);
applyMixins(CurrentTimestampOperation, [DateTimeFunctions]);
