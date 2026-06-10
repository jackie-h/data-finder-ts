/**
 * Tests for scalar functions, date operations, aggregates, ORDER BY, LIMIT, and filter
 * methods not exercised in the other test files.
 *
 * Uses a self-contained in-memory DuckDB with extra rows for aggregate/sort tests.
 * Finders are imported from tests/generated_markdown (same schema).
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

  await run('CREATE SCHEMA ref_data');
  await run('CREATE SCHEMA trading');

  // 3 accounts for aggregate tests
  await run('CREATE TABLE ref_data.account_master(ID INT, ACCT_NAME VARCHAR)');
  await run("INSERT INTO ref_data.account_master VALUES (1, 'Acme Corp')");
  await run("INSERT INTO ref_data.account_master VALUES (2, 'Beta LLC')");
  await run("INSERT INTO ref_data.account_master VALUES (3, 'Gamma Inc')");

  // 3 trades (all active, no expiry) with variety for sort/filter tests
  await run('CREATE TABLE trading.trades(sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  await run("INSERT INTO trading.trades VALUES ('AAPL', 84.11, true,  1, '2020-01-01', '9999-12-31')");
  await run("INSERT INTO trading.trades VALUES ('GOOG', 200.0,  false, 1, '2020-01-01', '9999-12-31')");
  await run("INSERT INTO trading.trades VALUES ('IBM',  3000.5, true,  2, '2020-01-01', '9999-12-31')");

  // contractual position with a known business date for date-extract tests
  await run('CREATE TABLE trading.contractualposition(DATE DATE, QUANTITY DOUBLE, NPV DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)');
  await run("INSERT INTO trading.contractualposition VALUES ('2023-06-15', 100.0, 500.0, '2023-01-01', '9999-12-31')");

  // price table (required by InstrumentFinder schema)
  await run('CREATE TABLE ref_data.price(SYM VARCHAR, PRICE DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)');
  await run("INSERT INTO ref_data.price VALUES ('AAPL', 150.0, '2020-01-01', '9999-12-31')");
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

// ---------------------------------------------------------------------------
// String scalar functions — SQL shape
// ---------------------------------------------------------------------------
describe('StringAttribute scalar functions (SQL)', () => {
  it('upper() → UPPER(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().upper()]).toSql();
    expect(sql).toContain('UPPER(');
  });

  it('lower() → LOWER(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().lower()]).toSql();
    expect(sql).toContain('LOWER(');
  });

  it('strip() → TRIM(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().strip()]).toSql();
    expect(sql).toContain('TRIM(');
  });

  it('length() → LENGTH(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().length()]).toSql();
    expect(sql).toContain('LENGTH(');
  });

  it('reverse() → REVERSE(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().reverse()]).toSql();
    expect(sql).toContain('REVERSE(');
  });

  it('left(4) → LEFT(..., 4)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().left(4)]).toSql();
    expect(sql).toContain('LEFT(');
    expect(sql).toContain('4');
  });

  it('right(3) → RIGHT(..., 3)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().right(3)]).toSql();
    expect(sql).toContain('RIGHT(');
    expect(sql).toContain('3');
  });

  it('repeat(2) → REPEAT(..., 2)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().repeat(2)]).toSql();
    expect(sql).toContain('REPEAT(');
    expect(sql).toContain('2');
  });

  it('replace(a, b) → REPLACE(...)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().replace('Corp', 'LLC')]).toSql();
    expect(sql).toContain('REPLACE(');
    expect(sql).toContain("'Corp'");
    expect(sql).toContain("'LLC'");
  });

  it('substring(start, len) → SUBSTRING(..., start+1, len)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().substring(0, 4)]).toSql();
    expect(sql).toContain('SUBSTRING(');
    expect(sql).toContain('1');  // 0 → 1-based
    expect(sql).toContain('4');
  });

  it('substring(start) → SUBSTRING(..., start+1)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name().substring(5)]).toSql();
    expect(sql).toContain('SUBSTRING(');
    expect(sql).toContain('6');  // 5 → 6 (1-based)
  });
});

// ---------------------------------------------------------------------------
// String scalar functions — DuckDB execution
// ---------------------------------------------------------------------------
describe('StringAttribute scalar functions (execution)', () => {
  it('upper() returns uppercase name', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().upper()], af.id().eq(1)).toRows();
    expect(rows).toEqual([['ACME CORP']]);
  });

  it('lower() returns lowercase name', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().lower()], af.id().eq(1)).toRows();
    expect(rows).toEqual([['acme corp']]);
  });

  it('length() returns character count', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().length()], af.id().eq(1)).toRows();
    expect(Number(rows[0][0])).toBe(9); // 'Acme Corp' = 9 chars
  });

  it('left(4) returns first 4 chars', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().left(4)], af.id().eq(1)).toRows();
    expect(rows).toEqual([['Acme']]);
  });

  it('right(4) returns last 4 chars', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().right(4)], af.id().eq(1)).toRows();
    expect(rows).toEqual([['Corp']]);
  });

  it('substring(0, 4) returns first 4 chars (0-based)', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name().substring(0, 4)], af.id().eq(1)).toRows();
    expect(rows).toEqual([['Acme']]);
  });
});

// ---------------------------------------------------------------------------
// String filter methods — DuckDB execution
// ---------------------------------------------------------------------------
describe('StringAttribute filter methods', () => {
  it('ne() filters out matching row', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name()], af.name().ne('Acme Corp')).toRows();
    const names = rows.map(r => r[0]);
    expect(names).not.toContain('Acme Corp');
    expect(names.length).toBe(2);
  });

  it('contains() matches substring', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name()], af.name().contains('Corp')).toRows();
    expect(rows).toEqual([['Acme Corp']]);
  });

  it('startsWith() matches prefix', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name()], af.name().startsWith('Acme')).toRows();
    expect(rows).toEqual([['Acme Corp']]);
  });

  it('endsWith() matches suffix', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.name()], af.name().endsWith('LLC')).toRows();
    expect(rows).toEqual([['Beta LLC']]);
  });
});

// ---------------------------------------------------------------------------
// Numeric scalar functions — SQL shape
// ---------------------------------------------------------------------------
describe('NumericAttribute scalar functions (SQL)', () => {
  it('abs() → ABS(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().abs()]).toSql();
    expect(sql).toContain('ABS(');
  });

  it('ceil() → CEILING(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().ceil()]).toSql();
    expect(sql).toContain('CEILING(');
  });

  it('floor() → FLOOR(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().floor()]).toSql();
    expect(sql).toContain('FLOOR(');
  });

  it('sqrt() → SQRT(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().sqrt()]).toSql();
    expect(sql).toContain('SQRT(');
  });

  it('mod(n) → MOD(..., n)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().mod(10)]).toSql();
    expect(sql).toContain('MOD(');
    expect(sql).toContain('10');
  });

  it('power(n) → POWER(..., n)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().power(2)]).toSql();
    expect(sql).toContain('POWER(');
    expect(sql).toContain('2');
  });

  it('round(d) → ROUND(..., d)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().round(2)]).toSql();
    expect(sql).toContain('ROUND(');
    expect(sql).toContain('2');
  });

  it('round() → ROUND(...) no second arg', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().round()]).toSql();
    expect(sql).toMatch(/ROUND\(\s*t\d+\.price\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Numeric scalar functions — DuckDB execution
// ---------------------------------------------------------------------------
describe('NumericAttribute scalar functions (execution)', () => {
  it('round() rounds AAPL price to integer', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().round()], tf.symbol().eq('AAPL')).toRows();
    expect(rows).toEqual([[84]]); // round(84.11) = 84
  });

  it('ceil() rounds AAPL price up', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().ceil()], tf.symbol().eq('AAPL')).toRows();
    expect(rows).toEqual([[85]]); // ceil(84.11) = 85
  });

  it('floor() rounds AAPL price down', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().floor()], tf.symbol().eq('AAPL')).toRows();
    expect(rows).toEqual([[84]]); // floor(84.11) = 84
  });
});

// ---------------------------------------------------------------------------
// Numeric aggregate functions — SQL shape
// ---------------------------------------------------------------------------
describe('NumericAttribute aggregate functions (SQL)', () => {
  it('sum() → SUM(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().sum()]).toSql();
    expect(sql).toContain('SUM(');
  });

  it('min() → MIN(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().min()]).toSql();
    expect(sql).toContain('MIN(');
  });

  it('max() → MAX(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().max()]).toSql();
    expect(sql).toContain('MAX(');
  });

  it('average() → AVG(...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.price().average()]).toSql();
    expect(sql).toContain('AVG(');
  });
});

// ---------------------------------------------------------------------------
// Numeric aggregate functions — DuckDB execution
// ---------------------------------------------------------------------------
describe('NumericAttribute aggregate functions (execution)', () => {
  it('sum() returns total price of all trades', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().sum()]).toRows();
    // AAPL 84.11 + GOOG 200.0 + IBM 3000.5 = 3284.61
    expect(rows.length).toBe(1);
    expect(rows[0][0] as number).toBeCloseTo(3284.61, 1);
  });

  it('min() returns lowest price', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().min()]).toRows();
    expect(rows[0][0] as number).toBeCloseTo(84.11, 2);
  });

  it('max() returns highest price', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.price().max()]).toRows();
    expect(rows[0][0] as number).toBeCloseTo(3000.5, 1);
  });

  it('count() returns total row count', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.count()]).toRows();
    expect(Number(rows[0][0])).toBe(3);
  });

  it('groupByOp + sum() returns per-symbol totals', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.symbol(), tf.price().sum()])
      .groupByOp(tf.symbol())
      .toRows();
    expect(rows.length).toBe(3);
    const bySymbol = Object.fromEntries(rows.map(r => [r[0] as string, r[1] as number]));
    expect(bySymbol['AAPL']).toBeCloseTo(84.11, 2);
    expect(bySymbol['IBM']).toBeCloseTo(3000.5, 1);
  });
});

// ---------------------------------------------------------------------------
// Date extract operations — SQL shape
// ---------------------------------------------------------------------------
describe('DateAttribute extract operations (SQL)', () => {
  it('year() → EXTRACT(YEAR FROM ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().year()]).toSql();
    expect(sql).toContain('EXTRACT(');
    expect(sql).toContain('YEAR');
  });

  it('month() → EXTRACT(MONTH FROM ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().month()]).toSql();
    expect(sql).toContain('EXTRACT(');
    expect(sql).toContain('MONTH');
  });

  it('day() → EXTRACT(DAY FROM ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().day()]).toSql();
    expect(sql).toContain('EXTRACT(');
    expect(sql).toContain('DAY');
  });

  it('quarter() → EXTRACT(QUARTER FROM ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().quarter()]).toSql();
    expect(sql).toContain('QUARTER');
  });

  it('dayOfWeek() → EXTRACT(DOW FROM ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().dayOfWeek()]).toSql();
    expect(sql).toContain('DOW');
  });
});

// ---------------------------------------------------------------------------
// Date extract operations — DuckDB execution
// ---------------------------------------------------------------------------
describe('DateAttribute extract operations (execution)', () => {
  it('year() extracts 2023 from 2023-06-15', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const rows = await cpf.findAll('2023-06-15', null, [cpf.businessDate().year()]).toRows();
    expect(rows.length).toBe(1);
    expect(Number(rows[0][0])).toBe(2023);
  });

  it('month() extracts 6 from 2023-06-15', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const rows = await cpf.findAll('2023-06-15', null, [cpf.businessDate().month()]).toRows();
    expect(Number(rows[0][0])).toBe(6);
  });

  it('day() extracts 15 from 2023-06-15', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const rows = await cpf.findAll('2023-06-15', null, [cpf.businessDate().day()]).toRows();
    expect(Number(rows[0][0])).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Date arithmetic operations — SQL shape
// ---------------------------------------------------------------------------
describe('DateAttribute arithmetic operations (SQL)', () => {
  it('addDays(n) → ... + INTERVAL n DAY', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().addDays(7)]).toSql();
    expect(sql).toContain('INTERVAL');
    expect(sql).toContain('7');
    expect(sql).toContain('DAY');
    expect(sql).toContain('+');
  });

  it('subtractDays(n) → ... - INTERVAL n DAY', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().subtractDays(3)]).toSql();
    expect(sql).toContain('INTERVAL');
    expect(sql).toContain('-');
  });

  it('addMonths(n) → ... + INTERVAL n MONTH', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().addMonths(3)]).toSql();
    expect(sql).toContain('MONTH');
  });
});

// ---------------------------------------------------------------------------
// Date diff operations — SQL shape
// ---------------------------------------------------------------------------
describe('DateAttribute diff operations (SQL)', () => {
  it('diffDays() → DATE_DIFF(day, ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().diffDays(new Date('2024-01-01'))]).toSql();
    expect(sql).toContain('DATE_DIFF(');
    expect(sql).toContain("'day'");
  });

  it('diffMonths() → DATE_DIFF(month, ...)', async () => {
    const { ContractualPositionFinder } = await import('./generated_markdown/ContractualPositionFinder');
    const cpf = new ContractualPositionFinder();
    const sql = cpf.findAll(null, null, [cpf.businessDate().diffMonths(new Date('2024-01-01'))]).toSql();
    expect(sql).toContain("'month'");
  });
});

// ---------------------------------------------------------------------------
// DateTime extract operations — SQL shape (via validFrom)
// ---------------------------------------------------------------------------
describe('DateTimeAttribute extract and arithmetic (SQL)', () => {
  it('hour() → EXTRACT(HOUR FROM ...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.validFrom().hour()]).toSql();
    expect(sql).toContain('EXTRACT(');
    expect(sql).toContain('HOUR');
  });

  it('minute() → EXTRACT(MINUTE FROM ...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.validFrom().minute()]).toSql();
    expect(sql).toContain('MINUTE');
  });

  it('second() → EXTRACT(SECOND FROM ...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.validFrom().second()]).toSql();
    expect(sql).toContain('SECOND');
  });

  it('addHours(n) → ... + INTERVAL n HOUR', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.validFrom().addHours(2)]).toSql();
    expect(sql).toContain('HOUR');
    expect(sql).toContain('2');
    expect(sql).toContain('+');
  });

  it('diffHours() → DATE_DIFF(hour, ...)', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.validFrom().diffHours(new Date('2024-01-01'))]).toSql();
    expect(sql).toContain("'hour'");
  });
});

// ---------------------------------------------------------------------------
// ORDER BY
// ---------------------------------------------------------------------------
describe('ORDER BY', () => {
  it('orderByOp(asc) produces ORDER BY ... ASC in SQL', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.symbol(), tf.price()])
      .orderByOp(tf.price().ascending())
      .toSql();
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('ASC');
  });

  it('orderByOp(desc) produces ORDER BY ... DESC in SQL', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.symbol(), tf.price()])
      .orderByOp(tf.price().descending())
      .toSql();
    expect(sql).toContain('DESC');
  });

  it('ascending() returns rows sorted lowest price first', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.symbol(), tf.price()])
      .orderByOp(tf.price().ascending())
      .toRows();
    expect(rows.length).toBe(3);
    const prices = rows.map(r => r[1] as number);
    expect(prices[0]).toBeCloseTo(84.11, 2);
    expect(prices[1]).toBeCloseTo(200.0, 1);
    expect(prices[2]).toBeCloseTo(3000.5, 1);
  });

  it('descending() returns rows sorted highest price first', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.symbol(), tf.price()])
      .orderByOp(tf.price().descending())
      .toRows();
    expect(rows[0][0]).toBe('IBM');
    expect(rows[0][1] as number).toBeCloseTo(3000.5, 1);
  });
});

// ---------------------------------------------------------------------------
// LIMIT
// ---------------------------------------------------------------------------
describe('LIMIT', () => {
  it('limit() produces LIMIT in SQL', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const sql = tf.findAll(null, null, [tf.symbol()]).limit(1).toSql();
    expect(sql).toContain('LIMIT 1');
  });

  it('limit(1) returns exactly one row', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.symbol()]).limit(1).toRows();
    expect(rows.length).toBe(1);
  });

  it('limit(2) combined with order returns top-2 by price', async () => {
    const { TradeFinder } = await import('./generated_markdown/TradeFinder');
    const tf = new TradeFinder();
    const rows = await tf.findAll(null, null, [tf.symbol(), tf.price()])
      .orderByOp(tf.price().descending())
      .limit(2)
      .toRows();
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('IBM');
    expect(rows[1][0]).toBe('GOOG');
  });
});

// ---------------------------------------------------------------------------
// IsNotNull filter
// ---------------------------------------------------------------------------
describe('IsNotNull filter', () => {
  it('isNotNull() produces IS NOT NULL in SQL', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.name()], af.name().isNotNull()).toSql();
    expect(sql).toContain('IS NOT NULL');
  });

  it('isNotNull() returns all rows when none are null', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.id()], af.name().isNotNull()).toRows();
    expect(rows.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Integer ne() filter
// ---------------------------------------------------------------------------
describe('IntegerAttribute ne() filter', () => {
  it('ne() SQL contains <>', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const sql = af.findAll(null, null, [af.id()], af.id().ne(1)).toSql();
    expect(sql).toContain('<>');
    expect(sql).toContain('1');
  });

  it('ne() execution excludes the filtered id', async () => {
    const { AccountFinder } = await import('./generated_markdown/AccountFinder');
    const af = new AccountFinder();
    const rows = await af.findAll(null, null, [af.id()], af.id().ne(1)).toRows();
    const ids = rows.map(r => r[0]);
    expect(ids).not.toContain(1);
    expect(ids.length).toBe(2);
  });
});
