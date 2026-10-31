/**
 * The SQL a query is written in. The generator writes Postgres by default; a dialect says where another database
 * differs, so the same query can be sent to DuckDB or Databricks.
 *
 * Only what differs is here. Everything the databases share (joins, CASE, window functions, COUNT(DISTINCT), LIKE ...
 * ESCAPE, `||`, typed date literals, `INTERVAL '7' DAY`, ...) is written once by the generator.
 */
import { DatePart, SortDirection } from '../model/relational';

export type DialectName = 'postgres' | 'duckdb' | 'databricks';

export interface SqlDialect {
  readonly name: DialectName;

  /** A name as an identifier, used for the names of the result's columns. */
  quoteIdentifier(name: string): string;

  /** A string as a literal that can never end early, whatever it holds. */
  stringLiteral(value: string): string;

  /**
   * ` ASC` or ` DESC`, with the null placement spelled out where the database's default differs from Postgres
   * (nulls last when ascending, first when descending), so a sort gives the same order everywhere.
   */
  orderDirection(direction: SortDirection): string;

  /** The type a float constant is cast to, so it comes back as a double and not a decimal. */
  readonly doubleType: string;

  /** The day of the week of a date or timestamp, 0 = Sunday through 6 = Saturday. */
  dayOfWeek(expression: string): string;

  /** Whole `unit`s from `from` to `to`; both are SQL expressions. */
  dateDiff(unit: DatePart, from: string, to: string): string;

  /** The values of a group joined with `separator` (an SQL literal), in the order given (each with its direction). */
  stringAgg(expression: string, separator: string, orderBy: string[]): string;
}

const doubleQuoted = (name: string): string => '"' + name.replaceAll('"', '""') + '"';
const quoted = (value: string): string => "'" + value.replaceAll("'", "''") + "'";

const SECONDS_PER: Partial<Record<DatePart, number>> = { [DatePart.HOUR]: 3600, [DatePart.MINUTE]: 60, [DatePart.SECOND]: 1 };

export const POSTGRES: SqlDialect = {
  name: 'postgres',
  quoteIdentifier: doubleQuoted,
  stringLiteral: quoted,
  orderDirection: direction => (direction === SortDirection.ASC ? ' ASC' : ' DESC'),
  doubleType: 'DOUBLE PRECISION',
  dayOfWeek: expression => `EXTRACT(DOW FROM ${expression})`,
  dateDiff(unit, from, to) {
    const start = `CAST(${from} AS TIMESTAMP)`;
    const end = `CAST(${to} AS TIMESTAMP)`;
    switch (unit) {
      case DatePart.DAY: return `(CAST(${to} AS DATE) - CAST(${from} AS DATE))`;
      case DatePart.MONTH:
        return `CAST(EXTRACT(YEAR FROM AGE(${end}, ${start})) * 12 + EXTRACT(MONTH FROM AGE(${end}, ${start})) AS BIGINT)`;
      case DatePart.YEAR: return `CAST(EXTRACT(YEAR FROM AGE(${end}, ${start})) AS BIGINT)`;
      default: {
        const seconds = SECONDS_PER[unit];
        if (seconds === undefined) throw new Error(`Cannot take the difference in ${unit}`);
        return `CAST(FLOOR(EXTRACT(EPOCH FROM (${end} - ${start})) / ${seconds}) AS BIGINT)`;
      }
    }
  },
  stringAgg: (expression, separator, orderBy) =>
    `STRING_AGG(${expression}, ${separator}${orderBy.length > 0 ? ' ORDER BY ' + orderBy.join(', ') : ''})`,
};

export const DUCKDB: SqlDialect = {
  ...POSTGRES,
  name: 'duckdb',
  // DuckDB sorts nulls last whichever way the sort goes
  orderDirection: direction => (direction === SortDirection.ASC ? ' ASC' : ' DESC NULLS FIRST'),
  doubleType: 'DOUBLE',
  dateDiff: (unit, from, to) => `DATE_DIFF('${unit.toLowerCase()}', ${from}, ${to})`,
};

export const DATABRICKS: SqlDialect = {
  name: 'databricks',
  // a double-quoted token is a string in Databricks; identifiers take backticks
  quoteIdentifier: name => '`' + name.replaceAll('`', '``') + '`',
  // a backslash starts an escape in a Databricks string literal, and a doubled quote is not one: Spark reads
  // 'it''s' as the two literals 'it' and 's' and joins them, losing the quote. A quote is escaped with a backslash.
  stringLiteral: value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'",
  // Databricks sorts nulls first when ascending, last when descending
  orderDirection: direction => (direction === SortDirection.ASC ? ' ASC NULLS LAST' : ' DESC NULLS FIRST'),
  doubleType: 'DOUBLE',
  // DAYOFWEEK is 1 = Sunday through 7 = Saturday
  dayOfWeek: expression => `(DAYOFWEEK(${expression}) - 1)`,
  dateDiff: (unit, from, to) => `DATEDIFF(${unit}, ${from}, ${to})`,
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
