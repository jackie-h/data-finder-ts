/**
 * Scalar functions chain, and an expression can be compared like a column. Mirrors the Python specs for
 * chaining functions and filtering on a function of a column.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { TradeFinder } from './generated_examples/finance/TradeFinder';
import './generated_examples/finance/AccountFinder';
import './generated_examples/finance/BranchFinder';
import './generated_examples/finance/ContractualPositionFinder';
import './generated_examples/finance/InstrumentFinder';
import { StringFunctionOperation, NumericFunctionOperation } from '../src/datafinder';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { ComparisonOperation, Column, NoOperation, Table } from '../src/model/relational';

const name = new StringAttribute('Name', 'name', 'VARCHAR', 't');
const price = new IntegerAttribute('Price', 'price', 'INT', 't');
const table = new Table('t', [new Column('name', 'VARCHAR', 't'), new Column('price', 'INT', 't')]);
const select = (...columns: Parameters<typeof toSql>[2]) => toSql(null, null, columns, table, new NoOperation());
const where = (op: ComparisonOperation) => toSql(null, null, [name], table, op).split(' WHERE ')[1];

describe('functions chain', () => {
  it('a text function of a text function', () => {
    expect(select(name.toUpperCase().replace('A', 'X'))).toBe(`SELECT REPLACE(UPPER(t0.name), 'A', 'X') AS "Replace Upper Name" FROM t AS t0`);
  });

  it('a number function of a text function, labelled after the whole chain', () => {
    expect(select(name.toUpperCase().length())).toBe('SELECT LENGTH(UPPER(t0.name)) AS "Length Upper Name" FROM t AS t0');
  });

  it('numeric functions chain', () => {
    expect(select(price.sqrt().floor())).toBe('SELECT FLOOR(SQRT(t0.price)) AS "Floor Sqrt Price" FROM t AS t0');
    expect(select(price.sqrt().power(2))).toBe('SELECT POWER(SQRT(t0.price), 2) AS "Power Sqrt Price" FROM t AS t0');
  });

  it('an argument is kept at each step', () => {
    expect(select(name.toLowerCase().left(4))).toBe('SELECT LEFT(LOWER(t0.name), 4) AS "Left Lower Name" FROM t AS t0');
    expect(select(name.substring(1, 3).toUpperCase())).toBe('SELECT UPPER(SUBSTRING(t0.name, 2, 3)) AS "Upper Substring Name" FROM t AS t0');
  });

  it('a function result is typed by what it gives', () => {
    expect(name.toUpperCase()).toBeInstanceOf(StringFunctionOperation);
    expect(name.length()).toBeInstanceOf(NumericFunctionOperation);
    expect(price.abs()).toBeInstanceOf(NumericFunctionOperation);
  });

  it('can be named and sorted like any other column', () => {
    expect(select(name.toUpperCase().length().alias('N'))).toBe('SELECT LENGTH(UPPER(t0.name)) AS "N" FROM t AS t0');
  });
});

describe('comparing an expression', () => {
  it('compares with a value', () => {
    expect(where(name.toUpperCase().eq('ACME CORP'))).toBe("UPPER(t0.name) = 'ACME CORP'");
    expect(where(name.length().gt(10))).toBe('LENGTH(t0.name) > 10');
    expect(where(name.toLowerCase().ne('acme corp'))).toBe("LOWER(t0.name) <> 'acme corp'");
    expect(where(name.length().lte(3))).toBe('LENGTH(t0.name) <= 3');
    expect(where(name.length().gte(3))).toBe('LENGTH(t0.name) >= 3');
    expect(where(name.length().lt(3))).toBe('LENGTH(t0.name) < 3');
  });

  it('compares with another expression, or an attribute', () => {
    expect(where(name.length().gt(price.abs()))).toBe('LENGTH(t0.name) > ABS(t0.price)');
    expect(where(name.length().gt(price))).toBe('LENGTH(t0.name) > t0.price');
  });

  it('escapes a quote in the value', () => {
    expect(where(name.toUpperCase().eq("O'BRIEN"))).toBe("UPPER(t0.name) = 'O''BRIEN'");
  });

  it('refuses a value it cannot compare with', () => {
    expect(() => name.length().eq([1] as never)).toThrow(TypeError);
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

  const plain = (rows: unknown[][]) => rows.map(r => r.map(v => typeof v === 'bigint' ? Number(v) : v));

  it('text functions chain', async () => {
    const query = f.findAll(null, null, [f.name().toUpperCase().length()]).orderBy(f.name().ascending()).limit(2);
    expect(query.toSql()).toContain('LENGTH(UPPER(t0.name))');
    expect(plain(await query.toRows())).toEqual([[9], [15]]);
  });

  it('a text function of a text function', async () => {
    const rows = await f.findAll(null, null, [f.name().toUpperCase().replace('ACME', 'X')]).orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows).toEqual([['X CORP']]);
  });

  it('slices the result of a function', async () => {
    const rows = await f.findAll(null, null, [f.name().toLowerCase().left(4)]).orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows).toEqual([['acme']]);
  });

  it('filters on a function of a column', async () => {
    const query = f.findAll(null, null, [f.name()], f.name().toUpperCase().eq('ACME CORP'));
    expect(query.toSql()).toContain("UPPER(t0.name) = 'ACME CORP'");
    expect(await query.toRows()).toEqual([['Acme Corp']]);
  });

  it('filters on the length of a column', async () => {
    const rows = await f.findAll(null, null, [f.name()], f.name().length().gt(10)).orderBy(f.name().ascending()).toRows();
    expect(rows).toEqual([['Acme Industries']]);
  });

  it('not equal on an expression', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().toLowerCase().ne('acme corp')).orderBy(f.id().ascending()).limit(2).toRows();
    expect(plain(rows)).toEqual([[2], [3]]);
  });

  it('compares two expressions', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().length().gt(f.category().length())).orderBy(f.id().ascending()).toRows();
    expect(plain(rows)).toEqual([[2], [4], [5]]);
  });

  it('combines with another filter', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().toUpperCase().eq('DELTA LTD').or(f.id().eq(1))).orderBy(f.id().ascending()).toRows();
    expect(plain(rows)).toEqual([[1], [5]]);
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

  it('filters on a function of a related column', async () => {
    const f = new EmployeeFinder();
    const rows = await f.findAll(null, null, [f.name()], f.manager().name().toUpperCase().eq('ALICE')).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Bob'], ['Carol']]);
  });
});

describe('finance against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const AT = '2030-01-01 00:00:00';

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.finance_numeric(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('numeric functions chain', async () => {
    const f = new TradeFinder();
    const query = f.findAll(null, AT, [f.price().sqrt().floor()], f.symbol().eq('GOOG'));
    expect(query.toSql()).toContain('FLOOR(SQRT(t0.price))');
    expect(await query.toRows()).toEqual([[6]]);
  });

  it('numeric functions chain with an argument', async () => {
    const f = new TradeFinder();
    const rows = await f.findAll(null, AT, [f.price().sqrt().power(2)], f.symbol().eq('GOOG')).toRows();
    expect(Number(rows[0][0])).toBeCloseTo(36);
  });
});
