/** An integer raised to a whole, non-negative power is an integer: SQL's POWER gives a double, so it is cast to BIGINT. */
import { describe, it, expect } from 'vitest';
import { DecimalAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const table = new Table('t', [new Column('i', 'INT')]);
const sql = (column: RelationalOperationElement) => toSql(null, null, [column as never], table, new NoOperation());
const integer = new IntegerAttribute('I', 'i', 'INT', new Table('t', []));

describe('power', () => {
  it('of an integer by a whole, non-negative number is cast to BIGINT', () => {
    expect(sql(integer.power(2))).toContain('CAST(POWER(t0.i, 2) AS BIGINT)');
    expect(sql(integer.power(0))).toContain('CAST(POWER(t0.i, 0) AS BIGINT)');
  });

  it('of an integer by a negative or fractional number is a double', () => {
    expect(sql(integer.power(-1))).not.toContain('CAST');
    expect(sql(integer.power(0.5))).not.toContain('CAST');
  });

  it('of a double or a decimal is a double', () => {
    expect(sql(new DoubleAttribute('D', 'i', 'DOUBLE', new Table('t', [])).power(2))).not.toContain('CAST');
    expect(sql(new DecimalAttribute('N', 'i', 'DECIMAL', new Table('t', [])).power(2))).not.toContain('CAST');
  });

  it('keeps an integer an integer through abs, ceil, floor and mod, and through the length of a text', () => {
    expect(sql(integer.abs().power(2))).toContain('CAST(POWER(ABS(t0.i), 2) AS BIGINT)');
    expect(sql(integer.mod(3).power(2))).toContain('CAST(POWER(MOD(t0.i, 3), 2) AS BIGINT)');
    expect(sql(new StringAttribute('S', 'i', 'VARCHAR', new Table('t', [])).length().power(2))).toContain('CAST(POWER(LENGTH(t0.i), 2) AS BIGINT)');
  });

  it('is a double after a function that gives one', () => {
    expect(sql(integer.sqrt().power(2))).not.toContain('CAST');
  });
});
