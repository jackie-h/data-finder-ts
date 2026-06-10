/**
 * End-to-end tests using finders generated from the finance markdown mapping.
 * Mirrors datafinder_ibis_duckdb/tests/test_e2e_markdown.py from the Python project.
 *
 * Schema uses in_z/out_z for processing temporal columns (matching finance_mapping.md).
 * Generate the finders with: python3 example/generate_from_markdown.py
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';

let conn: DuckDBConnection;
let instance: DuckDBInstance;

async function run(sql: string): Promise<void> {
  await conn.run(sql);
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await run('CREATE SCHEMA trading');
  await run('CREATE SCHEMA ref_data');

  await run(`CREATE TABLE ref_data.account_master(ID INT, ACCT_NAME VARCHAR)`);
  await run(`INSERT INTO ref_data.account_master VALUES (1, 'Acme Corp')`);

  await run(`CREATE TABLE ref_data.price(SYM VARCHAR, PRICE DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)`);
  await run(`INSERT INTO ref_data.price VALUES ('AAPL', 150.0, '2020-01-01', '9999-12-31')`);
  await run(`INSERT INTO ref_data.price VALUES ('GOOG', 2800.0, '2020-01-01', '2022-01-01')`);

  await run(`CREATE TABLE trading.trades(sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)`);
  // AAPL: active and settled
  await run(`INSERT INTO trading.trades VALUES ('AAPL', 84.11, true, 1, '2020-01-01', '9999-12-31')`);
  // GOOG: expired before 2022, not settled
  await run(`INSERT INTO trading.trades VALUES ('GOOG', 200.0, false, 1, '2020-01-01', '2022-01-01')`);

  await run(`CREATE TABLE trading.contractualposition(DATE DATE, QUANTITY DOUBLE, NPV DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)`);
  // Row 1: business_date=2023-01-15, active from 2023-01-15 onward
  await run(`INSERT INTO trading.contractualposition VALUES ('2023-01-15', 100.0, 500.0, '2023-01-15', '9999-12-31')`);
  // Row 2: business_date=2023-01-15, superseded at 2023-01-15 (processing expired)
  await run(`INSERT INTO trading.contractualposition VALUES ('2023-01-15', 90.0, 450.0, '2023-01-10', '2023-01-15')`);
  // Row 3: business_date=2023-01-16, active
  await run(`INSERT INTO trading.contractualposition VALUES ('2023-01-16', 200.0, 1000.0, '2023-01-16', '9999-12-31')`);
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('AccountFinder (markdown-generated)', () => {
  it('finds account by id', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();

    const rows = await af.findAll(null, null, [af.id(), af.name()], af.id().eq(1)).toRows();
    expect(rows).toEqual([[1, 'Acme Corp']]);
  });

  it('returns all accounts without filter', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();

    const rows = await af.findAll(null, null, [af.id(), af.name()]).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][1]).toBe('Acme Corp');
  });
});

describe('InstrumentFinder (markdown-generated, processing temporal)', () => {
  it('returns both instruments active in 2021', async () => {
    const { InstrumentFinder } = await import('./generated_markdown/InstrumentFinder');
    const inf = new InstrumentFinder();

    const rows = await inf.findAll(null, '2021-06-01 12:00:00', [inf.symbol(), inf.price()]).toRows();
    expect(rows.length).toBe(2);
    const syms = rows.map(r => r[0] as string);
    expect(syms).toContain('AAPL');
    expect(syms).toContain('GOOG');
  });

  it('filters expired GOOG record after 2022', async () => {
    const { InstrumentFinder } = await import('./generated_markdown/InstrumentFinder');
    const inf = new InstrumentFinder();

    const rows = await inf.findAll(null, '2023-01-01 12:00:00', [inf.symbol(), inf.price()]).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
    expect(rows[0][1]).toBeCloseTo(150.0, 1);
  });

  it('exposes validFrom and validTo milestoning attributes', async () => {
    const { InstrumentFinder } = await import('./generated_markdown/InstrumentFinder');
    const inf = new InstrumentFinder();
    // Milestoning properties use the camelCase mapping ID (from finance_mapping.md)
    expect(inf.validFrom()).toBeTruthy();
    expect(inf.validTo()).toBeTruthy();
  });
});

describe('TradeFinder (markdown-generated, processing temporal)', () => {
  it('returns both trades active in 2021', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(null, '2021-06-01 12:00:00', [tf.symbol(), tf.price()]).toRows();
    expect(rows.length).toBe(2);
    const syms = rows.map(r => r[0] as string);
    expect(syms).toContain('AAPL');
    expect(syms).toContain('GOOG');
  });

  it('filters expired GOOG after 2022', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(null, '2023-01-01 12:00:00', [tf.symbol(), tf.price()]).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
    expect(rows[0][1]).toBeCloseTo(84.11, 2);
  });

  it('filters by symbol', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(
      null, new Date(),
      [tf.symbol(), tf.price()],
      tf.symbol().eq('AAPL'),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][1]).toBeCloseTo(84.11, 2);
  });

  it('filters by boolean isSettled', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(
      null, new Date(),
      [tf.symbol(), tf.isSettled()],
      tf.isSettled().isTrue(),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
  });

  it('forward join: trade symbol and account name', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(
      null, new Date(),
      [tf.symbol(), tf.account().name()],
      tf.symbol().eq('AAPL'),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
    expect(rows[0][1]).toBe('Acme Corp');
  });

  it('forward join: milestoning filters expired records, leaving only AAPL', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(
      null, '2023-01-01 12:00:00',
      [tf.symbol(), tf.account().name()],
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
    expect(rows[0][1]).toBe('Acme Corp');
  });

  it('forward join: both trades visible before GOOG expiry', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();

    const rows = await tf.findAll(
      null, '2021-06-01 12:00:00',
      [tf.symbol(), tf.account().name()],
    ).toRows();

    expect(rows.length).toBe(2);
    const syms = rows.map(r => r[0] as string);
    expect(syms).toContain('AAPL');
    expect(syms).toContain('GOOG');
    const accountNames = rows.map(r => r[1] as string);
    expect(accountNames.every(n => n === 'Acme Corp')).toBe(true);
  });
});

describe('AccountFinder reverse association (markdown-generated)', () => {
  it('traverses Account → trades (no milestoning filter, both trades returned)', async () => {
    // Import TradeFinder first so it registers TradeRelatedFinder in the finder registry
    await import('./generated_markdown/TradeFinder');
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();

    const rows = await af.findAll(
      null, null,
      [af.name(), af.trades().symbol()],
    ).toRows();

    // No processing filter on Account, so both AAPL and GOOG trades are returned
    expect(rows.length).toBe(2);
    const names = rows.map(r => r[0] as string);
    expect(names.every(n => n === 'Acme Corp')).toBe(true);
    const syms = rows.map(r => r[1] as string);
    expect(syms).toContain('AAPL');
    expect(syms).toContain('GOOG');
  });

  it('traverses Account → trades with filter on trade symbol', async () => {
    await import('./generated_markdown/TradeFinder');
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();

    const rows = await af.findAll(
      null, null,
      [af.name(), af.trades().symbol()],
      af.trades().symbol().eq('AAPL'),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('Acme Corp');
    expect(rows[0][1]).toBe('AAPL');
  });
});

describe('ContractualPositionFinder (markdown-generated, business_date + processing)', () => {
  it('returns active row for business_date=2023-01-15 at current processing time', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();

    const rows = await cpf.findAll(
      '2023-01-15', new Date(),
      [cpf.quantity(), cpf.npv()],
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBeCloseTo(100.0, 1);
  });

  it('excludes row for a different business_date', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();

    const rows = await cpf.findAll(
      '2023-01-15', new Date(),
      [cpf.quantity()],
    ).toRows();

    const quantities = rows.map(r => r[0] as number);
    expect(quantities).not.toContain(200.0);
  });

  it('excludes processing-expired row (quantity=90 superseded at 2023-01-15)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();

    const rows = await cpf.findAll(
      '2023-01-15', new Date(),
      [cpf.quantity()],
    ).toRows();

    const quantities = rows.map(r => r[0] as number);
    expect(quantities).not.toContain(90.0);
  });

  it('processing time travel: expired row (quantity=90) visible before supersession', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();

    const rows = await cpf.findAll(
      '2023-01-15', '2023-01-12 12:00:00',
      [cpf.quantity()],
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBeCloseTo(90.0, 1);
  });
});
