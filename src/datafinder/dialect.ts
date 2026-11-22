/**
 * The SQL a query is written in. The generator writes Postgres by default; a dialect says where another database
 * differs, so the same query can be sent to DuckDB or Databricks.
 *
 * Only what differs is here. Everything the databases share (joins, CASE, window functions, COUNT(DISTINCT), LIKE ...
 * ESCAPE, `||`, typed date literals, `INTERVAL '7' DAY`, ...) is written once by the generator.
 */
import { DatePart, SortDirection, SortOperation } from '../model/relational';

export type DialectName = 'postgres' | 'duckdb' | 'databricks';

export interface SqlDialect {
  readonly name: DialectName;

  /** A name as an identifier, used for the names of the result's columns. */
  quoteIdentifier(name: string): string;

  /** A string as a literal that can never end early, whatever it holds. */
  stringLiteral(value: string): string;

  /** The type a float constant is cast to, so it comes back as a double and not a decimal. */
  readonly doubleType: string;

  /** The ISO day of the week of a date or timestamp, 1 = Monday through 7 = Sunday. */
  isoDayOfWeek(expression: string): string;

  /** Whole `unit`s from `from` to `to`; both are SQL expressions. */
  dateDiff(unit: DatePart, from: string, to: string): string;

  /** Whether `expression` has a match for the regular expression `pattern` anywhere in it; both are SQL expressions. */
  regexMatches(expression: string, pattern: string): string;

  /** The values of a group joined with `separator` (an SQL literal), in the order given (each with its direction). */
  stringAgg(expression: string, separator: string, orderBy: string[]): string;
}

const doubleQuoted = (name: string): string => '"' + name.replaceAll('"', '""') + '"';
const quoted = (value: string): string => "'" + value.replaceAll("'", "''") + "'";

const SECONDS_PER: Partial<Record<DatePart, number>> = { [DatePart.HOUR]: 3600, [DatePart.MINUTE]: 60, [DatePart.SECOND]: 1 };

/**
 * ` ASC` or ` DESC` and where a missing value goes, written every time. The SQL is Postgres, where a missing value is the largest, and each
 * database has a default of its own, so the sort says it and the same rows come in the same order everywhere.
 */
export function sortSuffix(sort: SortOperation): string {
  return (sort.direction === SortDirection.ASC ? ' ASC' : ' DESC') + (sort.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST');
}

export const POSTGRES: SqlDialect = {
  name: 'postgres',
  quoteIdentifier: doubleQuoted,
  stringLiteral: quoted,
  doubleType: 'DOUBLE PRECISION',
  isoDayOfWeek: expression => `EXTRACT(ISODOW FROM ${expression})`,
  dateDiff(unit, from, to) {
    // the number of `unit` boundaries from `from` to `to` (a year is a change of year, a day a change of date, a week the start of a week, on a
    // Monday, an hour a change of hour), as DuckDB's DATE_DIFF counts them for all but a week, in standard operators and EXTRACT, DATE_TRUNC
    // and CAST, which Postgres and the other databases all have, where DATE_DIFF is DuckDB's own
    if (unit === DatePart.YEAR || unit === DatePart.MONTH) {
      const a = `CAST(${from} AS DATE)`;
      const b = `CAST(${to} AS DATE)`;
      const years = `(EXTRACT(YEAR FROM ${b}) - EXTRACT(YEAR FROM ${a}))`;
      if (unit === DatePart.YEAR) return years;
      return `(${years} * 12 + EXTRACT(MONTH FROM ${b}) - EXTRACT(MONTH FROM ${a}))`;
    }
    if (unit === DatePart.DAY) return `(CAST(${to} AS DATE) - CAST(${from} AS DATE))`;
    if (unit === DatePart.WEEK) {   // the Mondays between: the days from the Monday of one week to the Monday of the other, in weeks
      const monday = (date: string) => `CAST(DATE_TRUNC('week', CAST(${date} AS DATE)) AS DATE)`;
      return `CAST((${monday(to)} - ${monday(from)}) / 7 AS BIGINT)`;
    }
    const seconds = SECONDS_PER[unit];
    if (seconds === undefined) {
      throw new Error(`A difference between dates is counted in years, months, weeks, days, hours, minutes or seconds, not ${unit}`);
    }
    const part = unit.toLowerCase();
    return `CAST(EXTRACT(EPOCH FROM (DATE_TRUNC('${part}', CAST(${to} AS TIMESTAMP)) - DATE_TRUNC('${part}', CAST(${from} AS TIMESTAMP)))) / ${seconds} AS BIGINT)`;
  },
  regexMatches: (expression, pattern) => `${expression} ~ ${pattern}`,
  stringAgg: (expression, separator, orderBy) =>
    `STRING_AGG(${expression}, ${separator}${orderBy.length > 0 ? ' ORDER BY ' + orderBy.join(', ') : ''})`,
};

export const DUCKDB: SqlDialect = {
  ...POSTGRES,
  name: 'duckdb',
  doubleType: 'DOUBLE',
  regexMatches: (expression, pattern) => `REGEXP_MATCHES(${expression}, ${pattern})`,
};

export const DATABRICKS: SqlDialect = {
  name: 'databricks',
  // a double-quoted token is a string in Databricks; identifiers take backticks
  quoteIdentifier: name => '`' + name.replaceAll('`', '``') + '`',
  // a backslash starts an escape in a Databricks string literal, and a doubled quote is not one: Spark reads
  // 'it''s' as the two literals 'it' and 's' and joins them, losing the quote. A quote is escaped with a backslash.
  stringLiteral: value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'",
  doubleType: 'DOUBLE',
  isoDayOfWeek: expression => `EXTRACT(DAYOFWEEK_ISO FROM ${expression})`,
  // Databricks' own DATEDIFF counts the boundaries crossed too, in the units the shared form is written in terms of
  dateDiff: (unit, from, to) => `DATEDIFF(${unit}, ${from}, ${to})`,
  // RLIKE searches anywhere in the text
  regexMatches: (expression, pattern) => `(${expression} RLIKE ${pattern})`,
  stringAgg: (expression, separator, orderBy) =>
    `LISTAGG(${expression}, ${separator})${orderBy.length > 0 ? ' WITHIN GROUP (ORDER BY ' + orderBy.join(', ') + ')' : ''}`,
};

const DIALECTS: Record<DialectName, SqlDialect> = { postgres: POSTGRES, duckdb: DUCKDB, databricks: DATABRICKS };

/** A dialect by name, or as given. */
export function dialectOf(dialect: DialectName | SqlDialect): SqlDialect {
  if (typeof dialect !== 'string') return dialect;
  const found = DIALECTS[dialect];
  if (found === undefined) throw new Error(`Unknown SQL dialect '${dialect}': one of ${Object.keys(DIALECTS).join(', ')}`);
  return found;
}
