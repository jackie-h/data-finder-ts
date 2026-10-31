/** count_all, standard deviation, variance, and min and max of text and dates. Mirrors TestMoreAggregates. */
import { describe, it, expect } from 'vitest';
import { countAll } from '../src/datafinder';
import { toSql } from '../src/datafinder/sql-generator';
import { DateAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const table = new Table('t', [new Column('a', 'INT', 't'), new Column('s', 'VARCHAR', 't'), new Column('d', 'DATE', 't')]);
const sql = (...columns: RelationalOperationElement[]) => toSql(null, null, columns as never, table, new NoOperation());

describe('more aggregates', () => {
  const a = new IntegerAttribute('A', 'a', 'INT', 't');

  it('countAll is COUNT(*)', () => {
    expect(sql(countAll())).toBe('SELECT COUNT(*) AS "Count" FROM t AS t0');
  });

  it('standard deviation is the sample one unless asked', () => {
    expect(sql(a.std())).toBe('SELECT STDDEV_SAMP(t0.a) AS "Std A" FROM t AS t0');
    expect(sql(a.std(0))).toBe('SELECT STDDEV_POP(t0.a) AS "Std A" FROM t AS t0');
  });

  it('variance is the sample one unless asked', () => {
    expect(sql(a.var())).toBe('SELECT VAR_SAMP(t0.a) AS "Var A" FROM t AS t0');
    expect(sql(a.var(0))).toBe('SELECT VAR_POP(t0.a) AS "Var A" FROM t AS t0');
  });

  it('ddof is zero or one', () => {
    expect(() => a.std(2)).toThrow(RangeError);
    expect(() => a.var(2)).toThrow(RangeError);
  });

  it('min and max work on text and dates', () => {
    const s = new StringAttribute('S', 's', 'VARCHAR', 't');
    const d = new DateAttribute('D', 'd', 'DATE', 't');
    expect(sql(s.min(), d.max())).toBe('SELECT MIN(t0.s) AS "Min S",MAX(t0.d) AS "Max D" FROM t AS t0');
  });
});
