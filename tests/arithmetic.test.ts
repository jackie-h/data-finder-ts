/** Arithmetic between numeric columns. Mirrors TestArithmetic and the Python finance numeric specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { TradeFinder } from './generated_examples/finance/TradeFinder';
import './generated_examples/finance/AccountFinder';
import './generated_examples/finance/BranchFinder';
import './generated_examples/finance/ContractualPositionFinder';
import './generated_examples/finance/InstrumentFinder';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { constant } from '../src/datafinder';
import { toSql } from '../src/datafinder/sql-generator';
import { DoubleAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { ArithmeticOperation, Column, NoOperation, Table } from '../src/model/relational';

const a = new DoubleAttribute('A', 'a', 'DOUBLE', 't');
const b = new DoubleAttribute('B', 'b', 'DOUBLE', 't');
const select = (...columns: Parameters<typeof toSql>[2]) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'DOUBLE', 't'), new Column('b', 'DOUBLE', 't')]), new NoOperation());
const one = (expression: ArithmeticOperation) => select(expression).replace(/^SELECT (.*) AS "Expression" FROM t AS t0$/, '$1');

describe('the SQL', () => {
  it('operators', () => {
    expect(select(a.plus(b), a.minus(b), a.times(b), a.dividedBy(b))).toBe(
      'SELECT t0.a + t0.b AS "Expression",t0.a - t0.b AS "Expression",t0.a * t0.b AS "Expression",' +
      't0.a / t0.b AS "Expression" FROM t AS t0');
  });

  it('a number on either side', () => {
    expect(select(a.times(2), constant(2).times(a), constant(1).minus(a), constant(1.5).dividedBy(a))).toBe(
      'SELECT t0.a * 2 AS "Expression",2 * t0.a AS "Expression",1 - t0.a AS "Expression",' +
      '1.5 / t0.a AS "Expression" FROM t AS t0');
  });

  it.each([
    ['(a + b) * 2', a.plus(b).times(2), '(t0.a + t0.b) * 2'],
    ['a + b * 2', a.plus(b.times(2)), 't0.a + t0.b * 2'],
    ['a * (b + 1)', a.times(b.plus(1)), 't0.a * (t0.b + 1)'],
    ['a - (b - 1)', a.minus(b.minus(1)), 't0.a - (t0.b - 1)'],
    ['(a - b) - 1', a.minus(b).minus(1), 't0.a - t0.b - 1'],
    ['a / (b * 2)', a.dividedBy(b.times(2)), 't0.a / (t0.b * 2)'],
    ['(a / b) * 2', a.dividedBy(b).times(2), 't0.a / t0.b * 2'],
    ['a + (b + 1)', a.plus(b.plus(1)), 't0.a + t0.b + 1'],
  ])('parentheses only where the meaning needs them: %s', (_label, expression, expected) => {
    expect(one(expression)).toBe(expected);
  });

  it('aggregates and functions are operands', () => {
    expect(select(a.sum().times(2))).toBe('SELECT SUM(t0.a) * 2 AS "Expression" FROM t AS t0');
    expect(select(a.abs().plus(b))).toBe('SELECT ABS(t0.a) + t0.b AS "Expression" FROM t AS t0');
  });

  it('is grouped by the other columns when it holds an aggregate', () => {
    expect(select(b, a.sum().dividedBy(a.count())).endsWith('GROUP BY t0.b')).toBe(true);
  });

  it('a string is not a number', () => {
    expect(() => a.plus('x' as never)).toThrow(TypeError);
    expect(() => a.times(true as never)).toThrow(TypeError);
    expect(() => a.times(NaN)).toThrow(TypeError);
  });

  it('a function that gives text is not a number', () => {
    const upper = new StringAttribute('Name', 'name', 'VARCHAR', 't').toUpperCase();
    expect(() => (upper as unknown as { plus(n: number): unknown }).plus(1)).toThrow(/does not give a number/);
    expect(() => a.plus(upper as never)).toThrow(/does not give a number/);
  });

  it('a result can be named, sorted and compared', () => {
    expect(select(a.times(2).alias('Double'))).toBe('SELECT t0.a * 2 AS "Double" FROM t AS t0');
    expect(toSql(null, null, [a], new Table('t', [new Column('a', 'DOUBLE', 't')]), a.times(2).gte(8)).split(' WHERE ')[1]).toBe('t0.a * 2 >= 8');
    expect(toSql(null, null, [a], new Table('t', [new Column('a', 'DOUBLE', 't')]), new NoOperation(), [a.times(2).descending()]))
      .toContain('ORDER BY t0.a * 2 DESC');
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new TradeFinder();
  const AT = '2030-01-01 00:00:00';

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.finance_numeric(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  const goog = () => f.symbol().eq('GOOG');
  const value = async (column: Parameters<typeof f.findAll>[2][number]) => {
    const rows = await f.findAll(null, AT, [column], goog()).toRows();
    return Number(rows[0][0]);
  };

  it('multiplies by a number', async () => {
    const query = f.findAll(null, AT, [f.symbol(), f.price().times(2)], goog());
    expect(query.toSql()).toContain('t0.price * 2');
    expect(await query.toRows()).toEqual([['GOOG', 72]]);
  });

  it('adds a number', async () => { expect(await value(f.price().plus(1.5))).toBe(37.5); });

  it('a number minus a column', async () => {
    const query = f.findAll(null, AT, [constant(100).minus(f.price())], goog());
    expect(query.toSql()).toContain('100 - t0.price');
    expect(Number((await query.toRows())[0][0])).toBe(64);
  });

  it('divides by a number', async () => { expect(await value(f.price().dividedBy(4))).toBe(9); });

  it('a number divided by a column', async () => { expect(await value(constant(72).dividedBy(f.price()))).toBe(2); });

  it('one column times another, across a join', async () => {
    expect(await value(f.price().times(f.account().id()))).toBe(36);
  });

  it('parentheses where the operators need them', async () => {
    const query = f.findAll(null, AT, [f.price().plus(1).times(2)], goog());
    expect(query.toSql()).toContain('(t0.price + 1) * 2');
    expect(Number((await query.toRows())[0][0])).toBe(74);
  });

  it('no parentheses where they are not needed', async () => { expect(await value(f.price().plus(1 * 2))).toBe(38); });

  it('the right side of a subtraction is parenthesised', async () => {
    const query = f.findAll(null, AT, [f.price().minus(f.price().minus(2))], goog());
    expect(query.toSql()).toContain('t0.price - (t0.price - 2)');
    expect(Number((await query.toRows())[0][0])).toBe(2);
  });

  it('arithmetic on a function of a column', async () => {
    const rows = await f.findAll(null, AT, [f.symbol(), f.price().abs().times(2)], f.symbol().eq('AAPL')).toRows();
    expect(rows).toEqual([['AAPL', 51]]);
  });

  it('a text function to a number to arithmetic', async () => {
    expect(await value(f.symbol().toLowerCase().length().plus(1))).toBe(5);
  });

  it('arithmetic on the length of a string', async () => { expect(await value(f.symbol().length().times(10))).toBe(40); });
});

describe('filtering on arithmetic', () => {
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

  it('on arithmetic', async () => {
    const query = f.findAll(null, null, [f.id()], f.id().times(2).gte(8)).orderBy(f.id().ascending());
    expect(query.toSql()).toContain('t0.id * 2 >= 8');
    expect((await query.toRows()).map(r => Number(r[0]))).toEqual([4, 5]);
  });

  it('comparing two expressions', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().length().gt(f.category().length().plus(1))).orderBy(f.id().ascending()).toRows();
    expect(rows.map(r => Number(r[0]))).toEqual([2, 4, 5]);
  });

  it('combined with another filter', async () => {
    const rows = await f.findAll(null, null, [f.id()], f.name().toUpperCase().eq('DELTA LTD').or(f.id().times(1).eq(1))).orderBy(f.id().ascending()).toRows();
    expect(rows.map(r => Number(r[0]))).toEqual([1, 5]);
  });
});
