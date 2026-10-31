/** Aggregates of an expression, and all and any of a condition. Mirrors TestAggregatesOfExpressions. */
import { describe, it, expect } from 'vitest';
import { constant, when } from '../src/datafinder';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const table = new Table('t', [new Column('a', 'INT', 't'), new Column('b', 'INT', 't')]);
const sql = (...columns: RelationalOperationElement[]) => toSql(null, null, columns as never, table, new NoOperation());
const a = new IntegerAttribute('A', 'a', 'INT', 't');
const b = new IntegerAttribute('B', 'b', 'INT', 't');

describe('aggregates of expressions', () => {
  it('sum of arithmetic', () => {
    expect(sql(a.times(b).sum())).toBe('SELECT SUM(t0.a * t0.b) AS "Sum Expression" FROM t AS t0');
  });

  it('sum of a constant', () => {
    expect(sql(constant(1).sum())).toBe('SELECT SUM(1) AS "Sum Expression" FROM t AS t0');
  });

  it('aggregate of a conditional', () => {
    expect(sql(when(a.gt(3)).then(5.5).otherwise(1.5).sum().alias('Profit')))
      .toBe('SELECT SUM(CASE WHEN t0.a > 3 THEN 5.5 ELSE 1.5 END) AS "Profit" FROM t AS t0');
  });

  it('std and var of an expression follow ddof', () => {
    expect(sql(a.plus(1).std(0), a.plus(1).var()))
      .toBe('SELECT STDDEV_POP(t0.a + 1) AS "Std Expression",VAR_SAMP(t0.a + 1) AS "Var Expression" FROM t AS t0');
  });

  it('all and any of a condition', () => {
    expect(sql(a.gt(3).all().alias('All'), a.gt(3).any().alias('Any')))
      .toBe('SELECT BOOL_AND(t0.a > 3) AS "All",BOOL_OR(t0.a > 3) AS "Any" FROM t AS t0');
  });

  it('a grouped aggregate of an expression groups by the other columns', () => {
    expect(sql(b, a.times(2).sum()).endsWith('GROUP BY t0.b')).toBe(true);
  });
});
