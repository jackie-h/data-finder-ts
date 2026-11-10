/** A constant has the functions a column of its type has: `constant('Hello').length()`, `constant(16).sqrt()`. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { clearRunner } from '../src/datafinder/runner';
import { constant } from '../src/datafinder';
import {
  DateArithmeticOperation, DateDiffOperation, DateExtractOperation, DateOnly, DateTruncOperation, NoOperation,
  RelationalOperationElement, Table, Column,
} from '../src/model/relational';
import {
  DoubleFunctionOperation, IntegerFunctionOperation, StringFunctionOperation,
} from '../src/datafinder';
import { Attribute } from '../src/datafinder/attribute';
import { toSql } from '../src/datafinder/sql-generator';

const select = (...columns: (Attribute | RelationalOperationElement)[]) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'INT', new Table('t', []))]), new NoOperation());

describe('functions of a constant', () => {
  it('text', () => {
    expect(constant('Hello').toUpperCase()).toBeInstanceOf(StringFunctionOperation);
    expect(constant('Hello').length()).toBeInstanceOf(IntegerFunctionOperation);
    expect(select(constant('Hello').toUpperCase(), constant('Hello').length(), constant('Hello').substring(0, 2)))
      .toBe(`SELECT UPPER('Hello') AS "Upper Hello",LENGTH('Hello') AS "Length Hello",SUBSTRING('Hello', 1, 2) AS "Substring Hello" FROM t AS t0`);
  });

  it('a number keeps its kind, or gives a double, as a column does', () => {
    expect(constant(16).sqrt()).toBeInstanceOf(DoubleFunctionOperation);
    expect(constant(-3).abs()).toBeInstanceOf(IntegerFunctionOperation);
    expect(constant(-3.5).abs()).toBeInstanceOf(DoubleFunctionOperation);
    expect(constant(2).power(3)).toBeInstanceOf(IntegerFunctionOperation); // an integer to a whole power
    expect(constant(2.5).power(2)).toBeInstanceOf(DoubleFunctionOperation);
    expect(select(constant(16).sqrt(), constant(-3).abs(), constant(2).power(3)))
      .toBe(`SELECT SQRT(16) AS "Sqrt 16",ABS(-3) AS "Abs -3",CAST(POWER(2, 3) AS BIGINT) AS "Power 2" FROM t AS t0`);
  });

  it('a function of a constant has the type of a function of a column', () => {
    expect(constant('Hello').length().sum()).toBeDefined();
    expect(constant('Hello').length().gt(3)).toBeDefined();
    expect(constant('Hello').toUpperCase().eq('HELLO')).toBeDefined();
    expect(constant(16).sqrt().times(2)).toBeDefined();
  });

  it('dates', () => {
    const day = constant(new DateOnly('2024-01-31'));
    expect(day.year()).toBeInstanceOf(DateExtractOperation);
    expect(day.addDays(1)).toBeInstanceOf(DateArithmeticOperation);
    expect(day.firstDayOfMonth()).toBeInstanceOf(DateTruncOperation);
    expect(day.diffDays(new Date('2024-03-01'))).toBeInstanceOf(DateDiffOperation);
    expect(select(day.year(), day.firstDayOfMonth(), day.addDays(1)))
      .toBe(`SELECT EXTRACT(YEAR FROM DATE '2024-01-31') AS "Year 2024-01-31",CAST(DATE_TRUNC('month', DATE '2024-01-31') AS DATE) AS "First Day Of Month 2024-01-31",DATE '2024-01-31' + INTERVAL '1' DAY AS "Add Days 2024-01-31" FROM t AS t0`);
  });

  it('timestamps have hours, minutes and seconds', () => {
    const moment = constant(new Date('2024-01-31T08:55:10Z'));
    expect(moment.hour()).toBeInstanceOf(DateExtractOperation);
    expect(moment.addMinutes(5)).toBeInstanceOf(DateArithmeticOperation);
    expect(moment.diffSeconds(new Date('2024-01-31T09:00:00Z'))).toBeInstanceOf(DateDiffOperation);
    expect(select(moment.hour(), moment.addMinutes(5)))
      .toBe(`SELECT EXTRACT(HOUR FROM TIMESTAMP '2024-01-31 08:55:10') AS "Hour 2024-01-31 08:55:10",TIMESTAMP '2024-01-31 08:55:10' + INTERVAL '5' MINUTE AS "Add Minutes 2024-01-31 08:55:10" FROM t AS t0`);
  });

  it('refuses a function the type does not have', () => {
    // never run: it is only here for the compiler
    const refused = () => {
      // @ts-expect-error a number is not text
      constant(1).toUpperCase();
      // @ts-expect-error text is not a number
      constant('x').sqrt();
      // @ts-expect-error a boolean has no functions
      constant(true).toUpperCase();
      // @ts-expect-error a date has no hours
      constant(new DateOnly('2024-01-31')).hour();
    };
    expect(refused).toBeTypeOf('function');
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  it('a function of a constant is a column of the result', async () => {
    const f = new CompanyFinder();
    const rows = await f.findAll([
      f.name(), constant('Hello').toUpperCase(), constant('Hello').length(), constant(16).sqrt(), constant(2).power(10),
      constant(new DateOnly('2024-01-31')).year(), constant(new DateOnly('2024-01-31')).addDays(1),
      constant(new Date('2024-01-31T08:55:10Z')).hour(),
    ]).orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0].slice(1, 6).map(String)).toEqual(['HELLO', '5', '4', '1024', '2024']);
    expect(String(rows[0][7])).toBe('8');
  });
});
