import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';

const _AT = '2030-01-01 00:00:00';

// sym, price, is_settled, account_id
const TRADES = [
  ['AAPL', -25.5, true,  1],
  ['GOOG',  36.0, true,  1],
  ['MSFT', 100.4, true,  1],
  ['TSLA',   9.0, false, 1],
];

let conn: DuckDBConnection;
let instance: DuckDBInstance;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA ref_data');
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR)');
  await conn.run("INSERT INTO ref_data.account_master VALUES (1, 'Fund A')");
  await conn.run(`CREATE TABLE trading.trades (
    sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT,
    in_z TIMESTAMP, out_z TIMESTAMP
  )`);
  for (const [sym, price, settled, acct] of TRADES) {
    await conn.run(`INSERT INTO trading.trades VALUES ('${sym}', ${price}, ${settled}, ${acct}, '2020-01-01', '9999-12-31')`);
  }
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('TradeFinder — numeric scalar functions', () => {
  it('abs() returns absolute value of negative price', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.symbol(), tf.price().abs()], tf.symbol().eq('AAPL')).toRows();
    expect(Number(rows[0][1])).toBeCloseTo(25.5);
  });

  it('round() with no args rounds to nearest integer', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.symbol(), tf.price().round()], tf.symbol().eq('MSFT')).toRows();
    expect(Number(rows[0][1])).toBe(100);
  });

  it('round(1) rounds to 1 decimal place', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.symbol(), tf.price().round(1)], tf.symbol().eq('AAPL')).toRows();
    expect(Number(rows[0][1])).toBeCloseTo(-25.5, 1);
  });

  it('ceil() rounds up', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.symbol(), tf.price().ceil()], tf.symbol().eq('GOOG')).toRows();
    expect(Number(rows[0][1])).toBe(36);
  });

  it('floor() rounds down', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.symbol(), tf.price().floor()], tf.symbol().eq('MSFT')).toRows();
    expect(Number(rows[0][1])).toBe(100);
  });
});
