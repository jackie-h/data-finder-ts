/**
 * The SQL a query is written in. The generator writes Postgres by default; a dialect says where another database
 * differs, so the same query can be sent to DuckDB or Databricks.
 *
 * Only what differs is here. Everything the databases share (joins, CASE, window functions, COUNT(DISTINCT), LIKE ...
 * ESCAPE, `||`, typed date literals, `INTERVAL '7' DAY`, ...) is written once by the generator.
 */
import { DatePart, ScalarFunction, SortDirection, SortOperation, VectorValue } from '../model/relational';

export type DialectName = 'postgres' | 'duckdb' | 'databricks';

/** What a joined group is ordered by: the SQL of the key, and which way, and where a missing value goes. */
export interface StringAggKey {
  readonly expression: string;
  readonly descending: boolean;
  readonly nullsFirst: boolean;
}

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

  /** The distance (or the inner product) between the vector column `column` and `vector`, which is written as a literal. */
  vectorDistance(metric: ScalarFunction, column: string, vector: VectorValue): string;

  /**
   * A date or timestamp moved by an interval, `element + interval` or `element - interval`: in Spark a date moved by an interval is a date,
   * and in Postgres it is a timestamp, so Databricks makes it a timestamp first.
   */
  dateArithmetic(element: string, operator: '+' | '-', interval: string): string;

  /**
   * The values of a group joined with `separator` (an SQL literal), in the order given. `windowed` is that the aggregate is over a window,
   * not a group.
   */
  stringAgg(expression: string, separator: string, orderBy: StringAggKey[], windowed: boolean): string;

  /** Whether a `SELECT DISTINCT` is ordered by the names of the columns it selects, as Databricks needs once the columns are aliased. */
  readonly distinctOrderedByName: boolean;
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

const keySql = (key: StringAggKey): string => `${key.expression}${key.descending ? ' DESC' : ' ASC'}${key.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`;

const number = (value: number): string => (Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value));

/** A vector as pgvector has it: a list of numbers cast to `VECTOR(n)`. */
const pgvectorLiteral = (vector: VectorValue): string => `CAST(ARRAY[${vector.values.map(number).join(', ')}] AS VECTOR(${vector.length}))`;

const PGVECTOR_FUNCTIONS: Partial<Record<ScalarFunction, string>> = {
  [ScalarFunction.COSINE_DISTANCE]: 'COSINE_DISTANCE', [ScalarFunction.L2_DISTANCE]: 'L2_DISTANCE', [ScalarFunction.INNER_PRODUCT]: 'INNER_PRODUCT',
};

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
  // pgvector's functions of that name
  vectorDistance: (metric, column, vector) => `${PGVECTOR_FUNCTIONS[metric]}(${column}, ${pgvectorLiteral(vector)})`,
  dateArithmetic: (element, operator, interval) => `${element} ${operator} ${interval}`,
  stringAgg: (expression, separator, orderBy) =>
    `STRING_AGG(${expression}, ${separator}${orderBy.length > 0 ? ' ORDER BY ' + orderBy.map(keySql).join(', ') : ''})`,
  distinctOrderedByName: false,
};

export const DUCKDB: SqlDialect = {
  ...POSTGRES,
  name: 'duckdb',
  doubleType: 'DOUBLE',
  regexMatches: (expression, pattern) => `REGEXP_MATCHES(${expression}, ${pattern})`,
  // a VECTOR(n) is DuckDB's FLOAT[n], and its ARRAY_* functions give a missing distance for a missing vector, where the LIST_* functions raise an
  // error; they give a float, which is cast to a double as the other engines give
  vectorDistance(metric, column, vector) {
    const fn = { [ScalarFunction.COSINE_DISTANCE]: 'ARRAY_COSINE_DISTANCE', [ScalarFunction.L2_DISTANCE]: 'ARRAY_DISTANCE', [ScalarFunction.INNER_PRODUCT]: 'ARRAY_INNER_PRODUCT' }[metric as never];
    return `CAST(${fn}(${column}, CAST(ARRAY[${vector.values.map(number).join(', ')}] AS FLOAT[${vector.length}])) AS DOUBLE)`;
  },
};

export const DATABRICKS: SqlDialect = {
  name: 'databricks',
  // a double-quoted token is a string in Databricks; identifiers take backticks
  quoteIdentifier: name => '`' + name.replaceAll('`', '``') + '`',
  // a backslash starts an escape in a Databricks string literal, and a doubled quote is not one: Spark reads
  // 'it''s' as the two literals 'it' and 's' and joins them, losing the quote. A quote is escaped with a backslash.
  stringLiteral: value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'",
  doubleType: 'DOUBLE',
  // Spark spells the ISO day of the week DOW_ISO
  isoDayOfWeek: expression => `EXTRACT(DOW_ISO FROM ${expression})`,
  // the Postgres forms, where Spark does what Postgres does not: the days between two dates are DATEDIFF (a date minus a date is an interval in
  // Spark), and the seconds between two timestamps are UNIX_SECONDS (a timestamp minus a timestamp is an interval, which EXTRACT(EPOCH) cannot read)
  dateDiff(unit, from, to) {
    if (unit === DatePart.YEAR || unit === DatePart.MONTH) return POSTGRES.dateDiff(unit, from, to);
    const days = (a: string, b: string) => `DATEDIFF(DAY, CAST(${a} AS DATE), CAST(${b} AS DATE))`;
    if (unit === DatePart.DAY) return `(${days(from, to)})`;
    if (unit === DatePart.WEEK) {   // the days from the Monday of one week to the Monday of the other, in weeks
      const monday = (date: string) => `DATE_TRUNC('week', CAST(${date} AS DATE))`;
      return `CAST((${days(monday(from), monday(to))}) / 7 AS BIGINT)`;
    }
    const seconds = SECONDS_PER[unit];
    if (seconds === undefined) {
      throw new Error(`A difference between dates is counted in years, months, weeks, days, hours, minutes or seconds, not ${unit}`);
    }
    const part = unit.toLowerCase();
    const epoch = (time: string) => `UNIX_SECONDS(DATE_TRUNC('${part}', CAST(${time} AS TIMESTAMP)))`;
    return `CAST((${epoch(to)} - ${epoch(from)}) / ${seconds} AS BIGINT)`;
  },
  // a date moved by an interval is a date in Spark, and a timestamp in Postgres
  dateArithmetic: (element, operator, interval) =>
    `${/^(CAST\(.* AS TIMESTAMP\)|TIMESTAMP '[^']*')$/.test(element) ? element : `CAST(${element} AS TIMESTAMP)`} ${operator} ${interval}`,
  // REGEXP_LIKE searches anywhere in the text
  regexMatches: (expression, pattern) => `REGEXP_LIKE(${expression}, ${pattern})`,
  // Spark orders a SELECT DISTINCT by the names it selects the columns under
  distinctOrderedByName: true,
  // Spark 3.5 has no vector functions: a distance is computed over the arrays (a VECTOR(n) is an ARRAY<FLOAT>)
  vectorDistance(metric, column, vector) {
    const literal = `CAST(ARRAY(${vector.values.map(number).join(', ')}) AS ARRAY<FLOAT>)`;
    const dot = (a: string, b: string) => `AGGREGATE(ZIP_WITH(${a}, ${b}, (x, y) -> CAST(x AS DOUBLE) * y), CAST(0 AS DOUBLE), (acc, v) -> acc + v)`;
    if (metric === ScalarFunction.INNER_PRODUCT) return dot(column, literal);
    if (metric === ScalarFunction.L2_DISTANCE) {
      return `SQRT(AGGREGATE(ZIP_WITH(${column}, ${literal}, (x, y) -> POWER(CAST(x AS DOUBLE) - y, 2)), CAST(0 AS DOUBLE), (acc, v) -> acc + v))`;
    }
    return `(1 - ${dot(column, literal)} / (SQRT(${dot(column, column)}) * SQRT(${dot(literal, literal)})))`;
  },
  // Spark 3.5 has no LISTAGG (4.0 has): the values are collected, sorted by the keys with a comparator, and joined. A null value is left out, as
  // STRING_AGG leaves it, and a null key is ordered as the sort says. Over a window it is the aggregate of Databricks.
  stringAgg(expression, separator, orderBy, windowed) {
    if (windowed) {
      return `LISTAGG(${expression}, ${separator})${orderBy.length > 0 ? ' WITHIN GROUP (ORDER BY ' + orderBy.map(keySql).join(', ') + ')' : ''}`;
    }
    if (orderBy.length === 0) return `ARRAY_JOIN(COLLECT_LIST(${expression}), ${separator})`;
    const fields = [`${expression} AS v`, ...orderBy.map((key, i) => `${key.expression} AS k${i}`)].join(', ');
    const comparisons = orderBy.map((key, i) => {
      const [before, after] = key.descending ? ['1', '-1'] : ['-1', '1'];
      const [first, last] = key.nullsFirst ? ['-1', '1'] : ['1', '-1'];
      const [l, r] = [`l.k${i}`, `r.k${i}`];
      return `NULLIF(CASE WHEN ${l} IS NULL AND ${r} IS NULL THEN 0 WHEN ${l} IS NULL THEN ${first} WHEN ${r} IS NULL THEN ${last} `
        + `WHEN ${l} < ${r} THEN ${before} WHEN ${l} > ${r} THEN ${after} ELSE 0 END, 0)`;
    });
    return `ARRAY_JOIN(TRANSFORM(ARRAY_SORT(COLLECT_LIST(CASE WHEN ${expression} IS NOT NULL THEN STRUCT(${fields}) END), `
      + `(l, r) -> COALESCE(${comparisons.join(', ')}, 0)), s -> s.v), ${separator})`;
  },
};

const DIALECTS: Record<DialectName, SqlDialect> = { postgres: POSTGRES, duckdb: DUCKDB, databricks: DATABRICKS };

/** A dialect by name, or as given. */
export function dialectOf(dialect: DialectName | SqlDialect): SqlDialect {
  if (typeof dialect !== 'string') return dialect;
  const found = DIALECTS[dialect];
  if (found === undefined) throw new Error(`Unknown SQL dialect '${dialect}': one of ${Object.keys(DIALECTS).join(', ')}`);
  return found;
}
