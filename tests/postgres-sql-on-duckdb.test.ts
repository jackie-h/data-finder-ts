// Port of Python's test_postgres_sql_on_duckdb: the SQL the generator writes is Postgres SQL, which DuckDB runs, and it gives what DuckDB's
// own functions gave (DATE_DIFF, DAYNAME, and an interval of a unit DuckDB has and ANSI has not).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { DUCKDB, POSTGRES } from '../src/datafinder/dialect';
import { intervalString } from '../src/datafinder/sql-generator';
import { DatePart } from '../src/model/relational';

const DATES = ['2023-12-31', '2024-01-01', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31', '2024-04-01', '2024-06-15', '2024-12-31', '2025-01-01',
  '2025-01-05', '2025-01-06', '2025-01-12'];
const TIMES = ['2024-03-10 08:59:59', '2024-03-10 09:00:00', '2024-03-10 09:01:00', '2024-03-10 09:59:59.9', '2024-03-10 10:00:00', '2024-03-11 08:59:59',
  '2024-03-11 09:00:00', '2023-12-31 23:59:59', '2024-01-01 00:00:00', '2024-01-01 00:00:01'];

let instance: DuckDBInstance;
let conn: DuckDBConnection;
beforeAll(async () => { instance = await DuckDBInstance.create(':memory:'); conn = await instance.connect(); });
afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

const value = async (sql: string): Promise<unknown> => (await conn.runAndReadAll(sql)).getRows()[0][0];

describe('a difference of dates counts what DuckDB\'s DATE_DIFF counts', () => {
  it.each([DatePart.YEAR, DatePart.QUARTER, DatePart.MONTH, DatePart.WEEK, DatePart.DAY])('%s', async unit => {
    // every pair of dates in one query, so a thousand statements are not sent
    const pairs = DATES.flatMap(a => DATES.map(b => [a, b] as const));
    const ours = pairs.map(([a, b]) => `SELECT '${a}' AS a, '${b}' AS b, ${POSTGRES.dateDiff(unit, `CAST('${a}' AS DATE)`, `CAST('${b}' AS DATE)`)} AS n`).join(' UNION ALL ');
    const rows = (await conn.runAndReadAll(`SELECT a, b, n, DATE_DIFF('${unit.toLowerCase()}', CAST(a AS DATE), CAST(b AS DATE)) AS native FROM (${ours})`)).getRows();
    expect(rows).toHaveLength(pairs.length);
    for (const [a, b, n, native] of rows) expect(Number(n), `${unit} ${String(a)} ${String(b)}`).toBe(Number(native));
  });

  it.each([DatePart.HOUR, DatePart.MINUTE, DatePart.SECOND])('%s of times', async unit => {
    const pairs = TIMES.flatMap(a => TIMES.map(b => [a, b] as const));
    const ours = pairs.map(([a, b]) => `SELECT '${a}' AS a, '${b}' AS b, ${POSTGRES.dateDiff(unit, `CAST('${a}' AS TIMESTAMP)`, `CAST('${b}' AS TIMESTAMP)`)} AS n`).join(' UNION ALL ');
    const rows = (await conn.runAndReadAll(`SELECT a, b, n, DATE_DIFF('${unit.toLowerCase()}', CAST(a AS TIMESTAMP), CAST(b AS TIMESTAMP)) AS native FROM (${ours})`)).getRows();
    for (const [a, b, n, native] of rows) expect(Number(n), `${unit} ${String(a)} ${String(b)}`).toBe(Number(native));
  });

  it('a difference in microseconds is refused', () => {
    expect(() => POSTGRES.dateDiff(DatePart.MICROSECOND, 'a', 'b')).toThrow(/not MICROSECOND/);
  });
});

describe('an interval in the units ANSI has is the length of time it names', () => {
  const units: [DatePart, string][] = [[DatePart.WEEK, 'WEEK'], [DatePart.QUARTER, 'QUARTER'], [DatePart.MICROSECOND, 'MICROSECOND'], [DatePart.DAY, 'DAY'],
    [DatePart.MONTH, 'MONTH'], [DatePart.SECOND, 'SECOND']];
  for (const n of [1, 5, 300, -7]) {
    it.each(units)(`${n} %s`, async (unit, native) => {
      const ours = await value(`SELECT TIMESTAMP '2024-03-10 08:00:00' + ${intervalString(n, unit)}`);
      expect(ours).toEqual(await value(`SELECT TIMESTAMP '2024-03-10 08:00:00' + ${n} * INTERVAL 1 ${native}`));
    });
  }

  it('only the units ANSI has are written', () => {
    expect(intervalString(2, DatePart.WEEK)).toBe("INTERVAL '14' DAY");
    expect(intervalString(1, DatePart.QUARTER)).toBe("INTERVAL '3' MONTH");
    expect(intervalString(5, DatePart.MICROSECOND)).toBe("INTERVAL '0.000005' SECOND");
    expect(intervalString(-1_500_000, DatePart.MICROSECOND)).toBe("INTERVAL '-1.500000' SECOND");
    expect(intervalString(3, DatePart.HOUR)).toBe("INTERVAL '3' HOUR");
    expect(() => intervalString(1, DatePart.DOW)).toThrow(/not counted in DOW/);
  });
});

describe('the name of a day', () => {
  it('is what DuckDB\'s DAYNAME gives', async () => {
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((name, i) => `WHEN ${i + 1} THEN '${name}'`).join(' ');
    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(Date.UTC(2024, 2, 4 + offset)).toISOString().slice(0, 10);
      expect(await value(`SELECT CASE ${POSTGRES.isoDayOfWeek(`CAST('${day}' AS DATE)`)} ${names} END`)).toBe(await value(`SELECT DAYNAME(DATE '${day}')`));
    }
  });
});

describe('a regular expression', () => {
  const run = (dialect: typeof DUCKDB, text: string, pattern: string) => value(`SELECT ${dialect.regexMatches(`'${text}'`, `'${pattern}'`)}`);

  it('matches anywhere in the text, as it did', async () => {
    expect(await run(DUCKDB, 'Customer X Complaints', 'X.*Compl')).toBe(true);
    expect(await run(DUCKDB, 'abc', '^b')).toBe(false);
    expect(await run(DUCKDB, 'abc', 'b')).toBe(true);
  });

  it('is Postgres\'s ~ in the source SQL', () => {
    expect(POSTGRES.regexMatches('t0.N', "'x'")).toBe("t0.N ~ 'x'");
  });
});
