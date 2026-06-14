import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { PriceFinder } from './generated_examples/null_end_milestoning/PriceFinder';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let pf: PriceFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA mkt');
  await conn.run('CREATE TABLE mkt.prices (sym VARCHAR, price DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)');
  // AAPL and MSFT: open-ended (NULL out_z — currently active)
  await conn.run("INSERT INTO mkt.prices VALUES ('AAPL', 150.0, '2020-01-01', NULL)");
  await conn.run("INSERT INTO mkt.prices VALUES ('MSFT', 300.0, '2020-01-01', NULL)");
  // GOOG: expired 2022-01-01
  await conn.run("INSERT INTO mkt.prices VALUES ('GOOG', 2800.0, '2020-01-01', '2022-01-01')");

  pf = new PriceFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('PriceFinder — null-end milestoning', () => {
  it('returns NULL-ended rows as active', async () => {
    const rows = await pf.findAll(null, '2024-06-01', [pf.symbol(), pf.price()]).toRows();
    const syms = new Set(rows.map(r => r[0]));
    expect(syms).toContain('AAPL');
    expect(syms).toContain('MSFT');
  });

  it('excludes expired row after its end date', async () => {
    const rows = await pf.findAll(null, '2024-06-01', [pf.symbol()]).toRows();
    expect(rows.map(r => r[0])).not.toContain('GOOG');
  });

  it('includes expired row when querying before its end date', async () => {
    const rows = await pf.findAll(null, '2021-06-01', [pf.symbol()]).toRows();
    const syms = new Set(rows.map(r => r[0]));
    expect(syms).toContain('AAPL');
    expect(syms).toContain('MSFT');
    expect(syms).toContain('GOOG');
  });

  it('NULL-ended rows remain visible across time', async () => {
    for (const year of [2021, 2023, 2099]) {
      const rows = await pf.findAll(null, `${year}-01-01`, [pf.symbol()]).toRows();
      expect(rows.map(r => r[0])).toContain('AAPL');
    }
  });
});
