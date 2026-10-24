/**
 * A processing date input keeps the precision it was given: a date (a DateOnly or a
 * YYYY-MM-DD string) renders as a date literal, a timestamp as a timestamp literal.
 */
import { describe, it, expect } from 'vitest';
import { convertInputsAndSelect } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import { DateTimeAttribute, IntegerAttribute } from '../src/datafinder/typed-attributes';
import { Column, DateOnly, NoOperation, Table } from '../src/model/relational';
import { MilestonedTable, ProcessingTemporalColumns } from '../src/model/milestoning';

function table(): MilestonedTable {
  return new MilestonedTable('trades', [], new ProcessingTemporalColumns(
    new Column('in_z', 'TIMESTAMP', 'trades'), new Column('out_z', 'TIMESTAMP', 'trades'), '9999-12-31 23:59:59',
  ));
}

const id = new IntegerAttribute('Id', 'id', 'INT', 'trades');

function sqlFor(processing: Date | string): string {
  return convertInputsAndSelect(null, processing, [id], table(), new NoOperation()).toSql();
}

describe('processing date rendering', () => {
  it('renders a date string as a date literal', () => {
    const sql = sqlFor('2017-06-11');
    expect(sql).toContain("in_z <= '2017-06-11'");
    expect(sql).toContain("out_z > '2017-06-11'");
    expect(sql).not.toContain('00:00:00');
  });

  it('renders a DateOnly as a date literal', () => {
    expect(sqlFor(new DateOnly('2017-06-11'))).toContain("in_z <= '2017-06-11'");
  });

  it('renders a datetime string as a timestamp literal', () => {
    const sql = sqlFor('2017-06-11 10:30:00');
    expect(sql).toContain("in_z <= '2017-06-11 10:30:00'");
    expect(sql).toContain("out_z > '2017-06-11 10:30:00'");
  });

  it('renders a Date as a timestamp literal, even at midnight', () => {
    expect(sqlFor(new Date('2017-06-11T00:00:00Z'))).toContain("in_z <= '2017-06-11 00:00:00'");
  });

  it('keeps a date string a DateOnly and a datetime string a plain Date', () => {
    const private_ = (r: unknown) => (r as { _processingDatetime: Date })._processingDatetime;
    expect(private_(convertInputsAndSelect(null, '2024-06-01', [], new Table('t', []), new NoOperation()))).toBeInstanceOf(DateOnly);
    expect(private_(convertInputsAndSelect(null, '2024-06-01 00:00:00', [], new Table('t', []), new NoOperation()))).not.toBeInstanceOf(DateOnly);
  });

  it('renders a DateOnly in a hand-built filter', () => {
    const op = new DateTimeAttribute('Start', 'in_z', 'TIMESTAMP', 'trades');
    expect(toSql(null, null, [id], table(), op.lte(new DateOnly('2017-06-11')))).toContain("in_z <= '2017-06-11'");
  });
});

describe('DateTimeAttribute compared with a date', () => {
  const attr = new DateTimeAttribute('Start', 'in_z', 'TIMESTAMP', 'trades');
  const where = (op: ReturnType<typeof attr.eq>) => toSql(null, null, [id], new Table('trades', []), op).split(' WHERE ')[1];

  it('renders a DateOnly or a date string as a date literal', () => {
    expect(where(attr.lte(new DateOnly('2017-06-11')))).toBe("t0.in_z <= '2017-06-11'");
    expect(where(attr.gt('2017-06-11'))).toBe("t0.in_z > '2017-06-11'");
    expect(where(attr.eq('2017-06-11'))).toBe("t0.in_z = '2017-06-11'");
  });

  it('renders a Date as a timestamp literal', () => {
    expect(where(attr.lt(new Date('2017-06-11T10:30:00Z')))).toBe("t0.in_z < '2017-06-11 10:30:00'");
  });
});
