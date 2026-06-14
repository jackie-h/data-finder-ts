import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { PositionFinder } from './generated_examples/positions/PositionFinder';

const _D1 = '2024-03-15';
const _D2 = '2024-07-20';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let pf: PositionFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE TABLE positions (id INT, trade_date DATE, npv DOUBLE)');
  await conn.run(`INSERT INTO positions VALUES (1, '${_D1}', 500.0)`);
  await conn.run(`INSERT INTO positions VALUES (2, '${_D2}', 800.0)`);
  await conn.run(`INSERT INTO positions VALUES (3, '2024-11-05', 1200.0)`);
  pf = new PositionFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('PositionFinder — date functions', () => {
  it('week() extracts ISO week number', async () => {
    const rows = await pf.findAll(null, null, [pf.tradeDate().week()], pf.id().eq(1)).toRows();
    // 2024-03-15 is ISO week 11
    expect(Number(rows[0][0])).toBe(11);
  });

  it('addYears(1) adds one year to date', async () => {
    const rows = await pf.findAll(null, null, [pf.tradeDate().addYears(1)], pf.id().eq(1)).toRows();
    const result = String(rows[0][0]);
    expect(result).toContain('2025-03-15');
  });

  it('diffYears() computes difference in years', async () => {
    const rows = await pf.findAll(
      null, null,
      [pf.tradeDate().diffYears(new Date('2026-03-15'))],
      pf.id().eq(1),
    ).toRows();
    expect(Number(rows[0][0])).toBe(2);
  });
});
