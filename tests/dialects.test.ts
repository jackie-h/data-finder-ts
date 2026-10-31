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
import { DATABRICKS, DUCKDB, POSTGRES, dialectOf } from '../src/datafinder/dialect';
import { toSql } from '../src/datafinder/sql-generator';
import { DateAttribute, DoubleAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, DatePart, NoOperation, SortDirection, Table } from '../src/model/relational';

const name = new StringAttribute('Name', 'name', 'VARCHAR', 't');
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', 't');
const day = new DateAttribute('Day', 'day', 'DATE', 't');
const table = new Table('t', [new Column('name', 'VARCHAR', 't'), new Column('price', 'DOUBLE', 't'), new Column('day', 'DATE', 't')]);
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
  it('is spelled out where the database differs from Postgres, so a sort is the same everywhere', () => {
    const asc = [name.ascending()];
    const desc = [name.descending()];
    expect(sql('postgres', name, asc)).toMatch(/ORDER BY t0\.name ASC$/);
    expect(sql('postgres', name, desc)).toMatch(/ORDER BY t0\.name DESC$/);
    expect(sql('duckdb', name, asc)).toMatch(/ORDER BY t0\.name ASC$/);
    expect(sql('duckdb', name, desc)).toMatch(/ORDER BY t0\.name DESC NULLS FIRST$/);
    expect(sql('databricks', name, asc)).toMatch(/ORDER BY t0\.name ASC NULLS LAST$/);
    expect(sql('databricks', name, desc)).toMatch(/ORDER BY t0\.name DESC NULLS FIRST$/);
  });

  it('applies inside a window and a string aggregate too', () => {
    const windowed = price.rank({ orderBy: price.descending() });
    expect(sql('databricks', windowed)).toContain('ORDER BY t0.price DESC NULLS FIRST)');
    expect(sql('databricks', name.join(',', [name.ascending()]))).toContain('WITHIN GROUP (ORDER BY t0.name ASC NULLS LAST)');
  });
});

describe('what differs', () => {
  it('a selected float is cast to the dialect\'s double, so it comes back as a number', () => {
    expect(sql('postgres', constant(1.5))).toContain('CAST(1.5 AS DOUBLE PRECISION)');
    expect(sql('duckdb', constant(1.5))).toContain('CAST(1.5 AS DOUBLE)');
    expect(sql('databricks', constant(1.5))).toContain('CAST(1.5 AS DOUBLE)');
  });

  it('string aggregate', () => {
    expect(sql('postgres', name.join(', ', [name.ascending()]))).toContain("STRING_AGG(t0.name, ', ' ORDER BY t0.name ASC)");
    expect(sql('duckdb', name.join(', ', [name.ascending()]))).toContain("STRING_AGG(t0.name, ', ' ORDER BY t0.name ASC)");
    expect(sql('databricks', name.join(', ', [name.ascending()]))).toContain("LISTAGG(t0.name, ', ') WITHIN GROUP (ORDER BY t0.name ASC NULLS LAST)");
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
    expect(sql('duckdb', days)).toContain("DATE_DIFF('day', t0.day, TIMESTAMP '2024-01-01 00:00:00')");
    expect(sql('databricks', days)).toContain("DATEDIFF(DAY, t0.day, TIMESTAMP '2024-01-01 00:00:00')");
    expect(sql('postgres', days)).toContain("(CAST(TIMESTAMP '2024-01-01 00:00:00' AS DATE) - CAST(t0.day AS DATE))");
  });

  it.each([DatePart.MONTH, DatePart.YEAR, DatePart.HOUR, DatePart.MINUTE, DatePart.SECOND])('Postgres differences in %s are written', unit => {
    expect(POSTGRES.dateDiff(unit, 'a', 'b')).toMatch(/AGE|EPOCH/);
    expect(() => POSTGRES.dateDiff(DatePart.DOW, 'a', 'b')).toThrow(/Cannot take the difference/);
  });

  it('direction text', () => {
    expect(POSTGRES.orderDirection(SortDirection.ASC)).toBe(' ASC');
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
    const query = f.findAll(null, null, [f.name(), f.id().times(2).alias('Double')], f.category().eq('Technology')).orderBy(f.id().ascending());
    expect((await run(query.toSql())).map(r => r[0])).toEqual(['Acme Corp', 'Beta Corp']);
  });

  it('the Postgres date difference, whole units', async () => {
    const days = await run(`SELECT ${POSTGRES.dateDiff(DatePart.DAY, "DATE '2024-03-01'", "TIMESTAMP '2024-03-11 00:00:00'")}`);
    expect(Number(days[0][0])).toBe(10);
    const months = await run(`SELECT ${POSTGRES.dateDiff(DatePart.MONTH, "DATE '2024-01-15'", "TIMESTAMP '2024-04-14 00:00:00'")}`);
    expect(Number(months[0][0])).toBe(2);
    const years = await run(`SELECT ${POSTGRES.dateDiff(DatePart.YEAR, "DATE '2020-06-01'", "TIMESTAMP '2024-05-31 00:00:00'")}`);
    expect(Number(years[0][0])).toBe(3);
    const hours = await run(`SELECT ${POSTGRES.dateDiff(DatePart.HOUR, "TIMESTAMP '2024-03-01 00:00:00'", "TIMESTAMP '2024-03-01 05:59:59'")}`);
    expect(Number(hours[0][0])).toBe(5);
  });

  it('DESC puts NULLs first, as Postgres does', async () => {
    const rows = await run('SELECT x FROM (VALUES (1), (NULL), (3)) AS v(x) ORDER BY x' + DUCKDB.orderDirection(SortDirection.DESC));
    expect(rows.map(r => r[0])).toEqual([null, 3, 1]);
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
