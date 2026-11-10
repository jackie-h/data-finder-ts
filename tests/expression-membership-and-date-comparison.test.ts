/** `isIn` / `isNotIn` on an expression, and comparing a date part, a date difference or a moved date. */
import { describe, it, expect } from 'vitest';
import { DateAttribute, DateTimeAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, DateOnly, RelationalOperationElement, Table } from '../src/model/relational';

const table = new Table('t', [new Column('D', 'DATE'), new Column('T', 'TIMESTAMP'), new Column('N', 'VARCHAR')]);
const day = new DateAttribute('D', 'D', 'DATE', new Table('t', []));
const moment = new DateTimeAttribute('T', 'T', 'TIMESTAMP', new Table('t', []));
const name = new StringAttribute('N', 'N', 'VARCHAR', new Table('t', []));
const sql = (select: RelationalOperationElement, condition: RelationalOperationElement) => toSql(null, null, [select as never], table, condition);

describe('isIn and isNotIn on an expression', () => {
  it('a text function', () => {
    expect(sql(name, name.substring(0, 4).isIn(['beta', 'Hell']))).toContain("SUBSTRING(t0.N, 1, 4) IN ('beta', 'Hell')");
    expect(sql(name, name.substring(0, 4).isNotIn(['beta']))).toContain("SUBSTRING(t0.N, 1, 4) NOT IN ('beta')");
  });

  it('a date part', () => {
    expect(sql(day, day.year().isIn([2019, 2020]))).toContain('EXTRACT(YEAR FROM t0.D) IN (2019, 2020)');
  });

  it('needs at least one value', () => {
    expect(() => day.year().isIn([])).toThrow(/at least one value/);
  });
});

describe('a date operation is compared as what it gives', () => {
  it('a part of a time is compared with a number', () => {
    expect(sql(moment, moment.hour().gte(9))).toContain('EXTRACT(HOUR FROM t0.T) >= 9');
  });

  it('a difference is compared with a number', () => {
    expect(sql(day, day.diffDays(new DateOnly('2020-02-01')).gte(31))).toContain('>= 31');
  });

  it('a moved date is compared with a date', () => {
    expect(sql(day, day.addDays(1).gt(new DateOnly('2020-01-01')))).toContain("WHERE t0.D + INTERVAL '1' DAY > '2020-01-01'");
  });
});
