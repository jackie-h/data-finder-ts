import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';

const _AT = '2030-01-01 00:00:00';

const ACCOUNTS = [
  [1, 'Alpha Fund'],
  [2, 'Beta Fund'],
  [3, 'Gamma Fund'],
];

// sym, price, is_settled, account_id, in_z, out_z
const TRADES = [
  ['AAPL', 100.0, true,  1],
  ['GOOG', 200.0, true,  1],
  ['MSFT', 300.0, true,  2],
  ['TSLA', 400.0, false, 2],
  ['GS',   500.0, true,  3],
];

let conn: DuckDBConnection;
let instance: DuckDBInstance;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA ref_data');
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  for (const [id, name] of ACCOUNTS) {
    await conn.run(`INSERT INTO ref_data.account_master VALUES (${id}, '${name}', NULL, '2020-01-01', '9999-12-31 23:59:59')`);
  }
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

describe('TradeFinder — group by with average', () => {
  it('average price per account', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.account().name(), tf.price().average()])
      .groupBy(tf.account().name())
      .orderBy(tf.account().name().ascending())
      .toRows();
    const avgs = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(avgs['Alpha Fund']).toBeCloseTo(150.0);
    expect(avgs['Beta Fund']).toBeCloseTo(350.0);
    expect(avgs['Gamma Fund']).toBeCloseTo(500.0);
  });

  it('average price settled trades only', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.account().name(), tf.price().average()], tf.isSettled().isTrue())
      .groupBy(tf.account().name())
      .orderBy(tf.account().name().ascending())
      .toRows();
    const avgs = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(avgs['Alpha Fund']).toBeCloseTo(150.0);
    expect(avgs['Beta Fund']).toBeCloseTo(300.0);
    expect(avgs['Gamma Fund']).toBeCloseTo(500.0);
  });

  it('count per account with group by', async () => {
    const { TradeFinder } = await import('./generated_examples/finance/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, _AT, [tf.account().name(), tf.count()])
      .groupBy(tf.account().name())
      .orderBy(tf.account().name().ascending())
      .toRows();
    const counts = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(counts['Alpha Fund']).toBe(2);
    expect(counts['Beta Fund']).toBe(2);
    expect(counts['Gamma Fund']).toBe(1);
  });
});
