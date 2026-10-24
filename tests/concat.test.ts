/** Joining text. Mirrors TestConcat and the Python companies and orgchart specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { ConcatOperation, Column, NoOperation, Table, concat } from '../src/model/relational';

const a = new StringAttribute('A', 'a', 'VARCHAR', 't');
const b = new StringAttribute('B', 'b', 'VARCHAR', 't');
const table = new Table('t', [new Column('a', 'VARCHAR', 't'), new Column('b', 'VARCHAR', 't')]);
const select = (...columns: Parameters<typeof toSql>[2]) => toSql(null, null, columns, table, new NoOperation());

describe('the SQL', () => {
  it('two columns', () => {
    expect(select(a.concat(b))).toBe('SELECT t0.a || t0.b AS "Expression" FROM t AS t0');
  });

  it('a string on either side, and a chain is flat', () => {
    expect(select(a.concat(' ', b), concat('>', a), a.concat('!'))).toBe(
      `SELECT t0.a || ' ' || t0.b AS "Expression",'>' || t0.a AS "Expression",t0.a || '!' AS "Expression" FROM t AS t0`);
  });

  it('concatenations join into one', () => {
    expect(select(a.concat('-').concat(b.concat('-')))).toBe(`SELECT t0.a || '-' || t0.b || '-' AS "Expression" FROM t AS t0`);
    expect(select(concat(a.concat('-'), b.concat('-')))).toBe(`SELECT t0.a || '-' || t0.b || '-' AS "Expression" FROM t AS t0`);
  });

  it('functions that give text are parts', () => {
    expect(select(a.toUpperCase().concat(b), concat('x', b.toLowerCase()))).toBe(
      `SELECT UPPER(t0.a) || t0.b AS "Expression",'x' || LOWER(t0.b) AS "Expression" FROM t AS t0`);
  });

  it('escapes a quote in a string part', () => {
    expect(select(a.concat("it's"))).toBe(`SELECT t0.a || 'it''s' AS "Expression" FROM t AS t0`);
  });

  it('a number is not text', () => {
    expect(() => a.concat(1 as never)).toThrow(/Text is joined with text/);
    expect(() => concat(1 as never)).toThrow(TypeError);
  });

  it('a column of numbers still adds', () => {
    const n = new IntegerAttribute('N', 'n', 'INT', 't');
    expect(select(n.plus(1))).toBe('SELECT t0.n + 1 AS "Expression" FROM t AS t0');
  });

  it('is a ConcatOperation that can be named, sorted and compared', () => {
    const joined = a.concat('/', b);
    expect(joined).toBeInstanceOf(ConcatOperation);
    expect(select(joined.alias('Both'))).toContain('AS "Both"');
    expect(toSql(null, null, [a], table, new NoOperation(), [joined.descending()])).toContain("ORDER BY t0.a || '/' || t0.b DESC");
    expect(toSql(null, null, [a], table, joined.eq('x/y')).split(' WHERE ')[1]).toBe("t0.a || '/' || t0.b = 'x/y'");
  });
});

describe('companies against DuckDB', () => {
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

  it('joins columns and text', async () => {
    const query = f.findAll(null, null, [f.name().concat(' (', f.category(), ')')]).orderBy(f.name().ascending()).limit(2);
    expect(query.toSql()).toContain("t0.name || ' (' || t0.category || ')'");
    expect(await query.toRows()).toEqual([['Acme Corp (Technology)'], ['Acme Industries (Manufacturing)']]);
  });

  it('joins text before a column', async () => {
    const rows = await f.findAll(null, null, [concat('Company: ', f.name())]).orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows).toEqual([['Company: Acme Corp']]);
  });

  it('joins a function of a column', async () => {
    const rows = await f.findAll(null, null, [f.name().toUpperCase().concat('/', f.category().toLowerCase())])
      .orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows).toEqual([['ACME CORP/technology']]);
  });

  it('filters on joined text', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().concat('/', f.category()).eq('Beta Corp/Technology')).toRows();
    expect(rows.map(r => Number(r[0]))).toEqual([3]);
  });
});

describe('orgchart against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.orgchart(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('a missing part makes the whole missing', async () => {
    const f = new EmployeeFinder();
    const rows = await f.findAll(null, null, [f.name().concat(' reports to ', f.manager().name())]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([[null], ['Bob reports to Alice'], ['Carol reports to Alice'], ['Dave reports to Bob']]);
  });
});
