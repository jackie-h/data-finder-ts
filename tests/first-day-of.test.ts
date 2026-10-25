/** firstDayOfWeek / Month / Quarter / Year truncate a date to the start of its period. Mirrors the Python positions specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { PositionFinder } from './generated_examples/positions/PositionFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { DateAttribute, DateTimeAttribute } from '../src/datafinder/typed-attributes';
import { Column, DateOnly, DateTruncOperation, NoOperation, Table } from '../src/model/relational';

const date = new DateAttribute('Day', 'day', 'DATE', 't');
const at = new DateTimeAttribute('At', 'at', 'TIMESTAMP', 't');
const table = new Table('t', [new Column('day', 'DATE', 't'), new Column('at', 'TIMESTAMP', 't')]);
const select = (...columns: Parameters<typeof toSql>[2]) => toSql(null, null, columns, table, new NoOperation());

describe('the SQL', () => {
  it('truncates a date', () => {
    expect(select(date.firstDayOfWeek(), date.firstDayOfMonth(), date.firstDayOfQuarter(), date.firstDayOfYear())).toBe(
      `SELECT CAST(DATE_TRUNC('week', t0.day) AS DATE) AS "First Day Of Week Day",` +
      `CAST(DATE_TRUNC('month', t0.day) AS DATE) AS "First Day Of Month Day",` +
      `CAST(DATE_TRUNC('quarter', t0.day) AS DATE) AS "First Day Of Quarter Day",` +
      `CAST(DATE_TRUNC('year', t0.day) AS DATE) AS "First Day Of Year Day" FROM t AS t0`);
  });

  it('truncates a timestamp to a date', () => {
    expect(select(at.firstDayOfMonth())).toBe(`SELECT CAST(DATE_TRUNC('month', t0.at) AS DATE) AS "First Day Of Month At" FROM t AS t0`);
  });

  it('is a DateTruncOperation that can be named, sorted and compared', () => {
    expect(date.firstDayOfYear()).toBeInstanceOf(DateTruncOperation);
    expect(select(date.firstDayOfYear().alias('Start'))).toContain('AS "Start"');
    expect(toSql(null, null, [date], table, new NoOperation(), [date.firstDayOfMonth().descending()]))
      .toContain(`ORDER BY CAST(DATE_TRUNC('month', t0.day) AS DATE) DESC`);
  });

  it('is compared with a date', () => {
    const sql = toSql(null, null, [date], table, date.firstDayOfMonth().eq(new DateOnly('2024-07-01')));
    expect(sql.split(' WHERE ')[1]).toBe(`CAST(DATE_TRUNC('month', t0.day) AS DATE) = '2024-07-01'`);
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new PositionFinder();

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.positions(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  const first = async (column: Parameters<typeof f.findAll>[2][number], id: number) => {
    const rows = await f.findAll(null, null, [column], f.id().eq(id)).toRows();
    return String(rows[0][0]);
  };

  it('first day of week (a Monday)', async () => { expect(await first(f.tradeDate().firstDayOfWeek(), 1)).toContain('2024-03-11'); });
  it('first day of month', async () => { expect(await first(f.tradeDate().firstDayOfMonth(), 2)).toContain('2024-07-01'); });
  it('first day of quarter', async () => { expect(await first(f.tradeDate().firstDayOfQuarter(), 3)).toContain('2024-10-01'); });
  it('first day of year', async () => { expect(await first(f.tradeDate().firstDayOfYear(), 3)).toContain('2024-01-01'); });

  it('filters on the first day of the month', async () => {
    const query = f.findAll(null, null, [f.id()], f.tradeDate().firstDayOfMonth().eq(new DateOnly('2024-07-01')));
    expect(query.toSql()).toContain(`CAST(DATE_TRUNC('month', t0.trade_date) AS DATE) = '2024-07-01'`);
    expect((await query.toRows()).map(r => Number(r[0]))).toEqual([2]);
  });
});
