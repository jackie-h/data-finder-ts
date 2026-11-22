/**
 * The SQL is written in Postgres by default, and for DuckDB or Databricks where they differ. Checked three ways:
 * what each dialect writes, that DuckDB runs what it is given, and (to a file, when asked) a corpus that
 * scripts/validate_dialects.py parses with sqlglot in each dialect.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { CORPUS, DIALECTS } from './dialect-corpus';
import { constant } from '../src/datafinder';
import { DATABRICKS, DUCKDB, POSTGRES, dialectOf, sortSuffix } from '../src/datafinder/dialect';
import { intervalString, toSql } from '../src/datafinder/sql-generator';
import { DateAttribute, DoubleAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, DatePart, NoOperation, SortOperation, Table } from '../src/model/relational';

const name = new StringAttribute('Name', 'name', 'VARCHAR', new Table('t', []));
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', new Table('t', []));
const day = new DateAttribute('Day', 'day', 'DATE', new Table('t', []));
const table = new Table('t', [new Column('name', 'VARCHAR', new Table('t', [])), new Column('price', 'DOUBLE', new Table('t', [])), new Column('day', 'DATE', new Table('t', []))]);
const sql = (dialect: 'postgres' | 'duckdb' | 'databricks', column: Parameters<typeof toSql>[2][number], orderBy: Parameters<typeof toSql>[5] = []) =>
  toSql(null, null, [column], table, new NoOperation(), orderBy, [], undefined, null, false, undefined, undefined, dialect);

describe('the default is Postgres', () => {
  it('writes the same as asking for Postgres', () => {
    expect(toSql(null, null, [name.alias('N')], table, new NoOperation())).toBe(sql('postgres', name.alias('N')));
  });

  it('refuses a dialect it does not know', () => {
    expect(() => dialectOf('oracle' as never)).toThrow(/Unknown SQL dialect/);
  });
});

describe('quoting', () => {
  it('a name is a double-quoted identifier in Postgres and DuckDB, backticked in Databricks', () => {
    expect(sql('postgres', name.alias('My Col'))).toBe('SELECT t0.name AS "My Col" FROM t AS t0');
    expect(sql('duckdb', name.alias('My Col'))).toBe('SELECT t0.name AS "My Col" FROM t AS t0');
    expect(sql('databricks', name.alias('My Col'))).toBe('SELECT t0.name AS `My Col` FROM t AS t0');
  });

  it('a quote inside a name is doubled so it cannot end it', () => {
    expect(sql('postgres', name.alias('a"b'))).toContain('AS "a""b"');
    expect(sql('databricks', name.alias('a`b'))).toContain('AS `a``b`');
  });

  it('a backslash and a quote in a string are escaped Databricks\' way (a doubled quote would be lost)', () => {
    expect(POSTGRES.stringLiteral("a\\b'c")).toBe("'a\\b''c'");
    expect(DUCKDB.stringLiteral("a\\b'c")).toBe("'a\\b''c'");
    expect(DATABRICKS.stringLiteral("a\\b'c")).toBe("'a\\\\b\\'c'");
  });
});

describe('a backslash in a LIKE pattern', () => {
  it('names the escape so the backslash is not LIKE\'s own', () => {
    for (const dialect of DIALECTS) {
      const sqlText = toSql(null, null, [name], table, name.contains('a\\b'), [], [], undefined, null, false, undefined, undefined, dialect);
      expect(sqlText, dialect).toContain("ESCAPE '!'");
    }
  });
});

describe('null order', () => {
  it('is spelled out on every sort, whatever the database, so a sort is the same everywhere', () => {
    // a missing value is the smallest value: first when ascending and last when descending
    for (const dialect of ['postgres', 'duckdb', 'databricks'] as const) {
      expect(sql(dialect, name, [name.ascending()]), dialect).toMatch(/ORDER BY t0\.name ASC NULLS FIRST$/);
      expect(sql(dialect, name, [name.descending()]), dialect).toMatch(/ORDER BY t0\.name DESC NULLS LAST$/);
    }
  });

  it('nulls says otherwise', () => {
    expect(sql('postgres', name, [name.ascending({ nulls: 'last' })])).toMatch(/ORDER BY t0\.name ASC NULLS LAST$/);
    expect(sql('postgres', name, [name.descending({ nulls: 'first' })])).toMatch(/ORDER BY t0\.name DESC NULLS FIRST$/);
    expect(() => name.ascending({ nulls: 'middle' as never })).toThrow("nulls is 'first' or 'last'");
  });

  it('applies inside a window and a string aggregate too', () => {
    const windowed = price.rank({ orderBy: price.descending() });
    expect(sql('databricks', windowed)).toContain('ORDER BY t0.price DESC NULLS LAST)');
    expect(sql('databricks', name.join(',', [name.ascending()]))).toContain('WITHIN GROUP (ORDER BY t0.name ASC NULLS FIRST)');
  });
});

describe('what differs', () => {
  it('a selected float is cast to the dialect\'s double, so it comes back as a number', () => {
    expect(sql('postgres', constant(1.5))).toContain('CAST(1.5 AS DOUBLE PRECISION)');
    expect(sql('duckdb', constant(1.5))).toContain('CAST(1.5 AS DOUBLE)');
    expect(sql('databricks', constant(1.5))).toContain('CAST(1.5 AS DOUBLE)');
  });

  it('string aggregate', () => {
    expect(sql('postgres', name.join(', ', [name.ascending()]))).toContain("STRING_AGG(t0.name, ', ' ORDER BY t0.name ASC NULLS FIRST)");
    expect(sql('duckdb', name.join(', ', [name.ascending()]))).toContain("STRING_AGG(t0.name, ', ' ORDER BY t0.name ASC NULLS FIRST)");
    expect(sql('databricks', name.join(', ', [name.ascending()]))).toContain("LISTAGG(t0.name, ', ') WITHIN GROUP (ORDER BY t0.name ASC NULLS FIRST)");
    expect(sql('databricks', name.join('|'))).toContain("LISTAGG(t0.name, '|')");
    expect(sql('databricks', name.join('|'))).not.toContain('WITHIN GROUP');
  });

  it('day of the week is 0 = Sunday everywhere', () => {
    expect(sql('postgres', day.dayOfWeek())).toContain('EXTRACT(DOW FROM t0.day)');
    expect(sql('duckdb', day.dayOfWeek())).toContain('EXTRACT(DOW FROM t0.day)');
    expect(sql('databricks', day.dayOfWeek())).toContain('(DAYOFWEEK(t0.day) - 1)');
  });

  it('other parts of a date are extracted the same way', () => {
    for (const dialect of DIALECTS) expect(sql(dialect, day.year())).toContain('EXTRACT(YEAR FROM t0.day)');
  });

  it('date difference', () => {
    const days = day.diffDays(new Date('2024-01-01'));
    // the SQL is Postgres SQL, which DuckDB runs as it is; Databricks has a DATEDIFF that counts the same boundaries
    expect(sql('duckdb', days)).toContain("(CAST('2024-01-01 00:00:00' AS DATE) - CAST(t0.day AS DATE))");
    expect(sql('databricks', days)).toContain("DATEDIFF(DAY, t0.day, '2024-01-01 00:00:00')");
    expect(sql('postgres', days)).toContain("(CAST('2024-01-01 00:00:00' AS DATE) - CAST(t0.day AS DATE))");
  });

  it.each([DatePart.MONTH, DatePart.YEAR, DatePart.HOUR, DatePart.MINUTE, DatePart.SECOND])('Postgres differences in %s are written', unit => {
    expect(POSTGRES.dateDiff(unit, 'a', 'b')).toMatch(/EXTRACT/);
    expect(POSTGRES.dateDiff(unit, 'a', 'b')).not.toContain('AGE');
  });

  it('a difference in anything else is refused', () => {
    expect(() => POSTGRES.dateDiff(DatePart.MICROSECOND, 'a', 'b')).toThrow(/not MICROSECOND/);
    expect(() => POSTGRES.dateDiff(DatePart.DOW, 'a', 'b')).toThrow(/not DOW/);
    expect(() => POSTGRES.dateDiff(DatePart.QUARTER, 'a', 'b')).toThrow(/not QUARTER/);
  });

});

describe('DuckDB runs what it is given', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new CompanyFinder();

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  const run = async (text: string) => (await conn.runAndReadAll(text)).getRows();

  it('the default (Postgres) SQL for a plain query', async () => {
    const query = f.findAll([f.name(), f.id().times(2).alias('Double')], f.category().eq('Technology')).orderBy(f.id().ascending());
    expect((await run(query.toSql())).map(r => r[0])).toEqual(['Acme Corp', 'Beta Corp']);
  });

  it('a missing value is the smallest: first ascending, last descending', async () => {
    const values = '(VALUES (1), (NULL), (3)) AS v(x)';
    const ordered = async (sort: SortOperation) => (await run(`SELECT x FROM ${values} ORDER BY x` + sortSuffix(sort))).map(r => r[0]);
    expect(await ordered(f.id().ascending())).toEqual([null, 1, 3]);
    expect(await ordered(f.id().descending())).toEqual([3, 1, null]);
    expect(await ordered(f.id().ascending({ nulls: 'last' }))).toEqual([1, 3, null]);
    expect(await ordered(f.id().descending({ nulls: 'first' }))).toEqual([null, 3, 1]);
  });
});

describe('the corpus', () => {
  it('writes every query in every dialect', () => {
    for (const [label, query] of Object.entries(CORPUS)) {
      for (const dialect of DIALECTS) expect(query(dialect), `${label} in ${dialect}`).toMatch(/^SELECT /);
    }
  });

  it.runIf(process.env.DIALECT_CORPUS)('is written to a file for the sqlglot check', () => {
    const out: Record<string, Record<string, string>> = {};
    for (const dialect of DIALECTS) {
      out[dialect] = Object.fromEntries(Object.entries(CORPUS).map(([label, query]) => [label, query(dialect)]));
    }
    const path = process.env.DIALECT_CORPUS!;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out, null, 2));
  });
});

describe('an interval is written in the units ANSI has', () => {
  it('a week is 7 days and a microsecond a millionth of a second', () => {
    expect(intervalString(2, DatePart.WEEK)).toBe("INTERVAL '14' DAY");
    expect(intervalString(5, DatePart.MICROSECOND)).toBe("INTERVAL '0.000005' SECOND");
    expect(intervalString(-1_500_000, DatePart.MICROSECOND)).toBe("INTERVAL '-1.500000' SECOND");
    expect(intervalString(3, DatePart.HOUR)).toBe("INTERVAL '3' HOUR");
  });

  it('a quarter, a day of the week and a day of the year are not a length of time', () => {
    for (const unit of [DatePart.QUARTER, DatePart.DOW, DatePart.DOY]) expect(() => intervalString(1, unit)).toThrow(/not counted in/);
  });
});
