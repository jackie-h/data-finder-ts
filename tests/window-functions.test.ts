import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';

const COMPANIES = [
  [1, 'Acme Corp',       'Technology'],
  [2, 'Acme Industries', 'Manufacturing'],
  [3, 'Beta Corp',       'Technology'],
  [4, 'Gamma LLC',       'Finance'],
  [5, 'Delta Ltd',       'Finance'],
];

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let cf: CompanyFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)');
  for (const [id, name, cat] of COMPANIES) {
    await conn.run(`INSERT INTO companies VALUES (${id}, '${name}', '${cat}')`);
  }
  cf = new CompanyFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('CompanyFinder — window functions: rank', () => {
  it('rank min assigns sequential ranks 1–5', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().rank({ orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    const ranks = rows.map(r => Number(r[1]));
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it('rank dense with partition_by category restarts within each group', async () => {
    const rows = await cf.findAll(null, null, [
      cf.id(),
      cf.id().rank({ method: 'dense', partitionBy: [cf.category()], orderBy: [cf.id().ascending()] }),
    ]).orderByOp(cf.id().ascending()).toRows();
    const ranks = rows.map(r => Number(r[1]));
    expect(ranks).toEqual([1, 1, 2, 1, 2]);
  });

  it('rank method first (ROW_NUMBER) assigns unique sequential integers', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().rank({ method: 'first', orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    const ranks = rows.map(r => Number(r[1]));
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it('rank pct (PERCENT_RANK) returns 0.0–1.0 range', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().rank({ pct: true, orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    const pcts = rows.map(r => Number(r[1]));
    expect(pcts).toEqual([0.0, 0.25, 0.5, 0.75, 1.0]);
  });

  it('rank pct method max (CUME_DIST) returns cumulative distribution', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().rank({ pct: true, method: 'max' as 'min', orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    const dists = rows.map(r => Number(r[1]));
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach((expected, i) => expect(dists[i]).toBeCloseTo(expected, 5));
  });
});

describe('CompanyFinder — window functions: shift (lag/lead)', () => {
  it('shift(1) LAG returns previous id, null for first row', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().shift(1, { orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    expect(rows[0][1]).toBeNull();
    expect(Number(rows[1][1])).toBe(1);
    expect(Number(rows[2][1])).toBe(2);
    expect(Number(rows[3][1])).toBe(3);
    expect(Number(rows[4][1])).toBe(4);
  });

  it('shift(-1) LEAD returns next id, null for last row', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().shift(-1, { orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    expect(Number(rows[0][1])).toBe(2);
    expect(Number(rows[1][1])).toBe(3);
    expect(Number(rows[2][1])).toBe(4);
    expect(Number(rows[3][1])).toBe(5);
    expect(rows[4][1]).toBeNull();
  });
});

describe('CompanyFinder — window functions: qcut', () => {
  it('qcut(2) splits 5 rows into 2 buckets (3 in bucket 1, 2 in bucket 2)', async () => {
    const rows = await cf.findAll(null, null, [cf.id(), cf.id().qcut(2, { orderBy: [cf.id().ascending()] })])
      .orderByOp(cf.id().ascending()).toRows();
    const buckets = rows.map(r => Number(r[1]));
    expect(buckets).toEqual([1, 1, 1, 2, 2]);
  });
});

describe('CompanyFinder — window functions: first/last', () => {
  it('first() per category returns min id in each group', async () => {
    const rows = await cf.findAll(null, null, [
      cf.id(), cf.category(),
      cf.id().first({ partitionBy: [cf.category()], orderBy: [cf.id().ascending()] }),
    ]).orderByOp(cf.id().ascending()).toRows();
    const firstIds = rows.map(r => Number(r[2]));
    // Technology:1, Manufacturing:2, Technology:1, Finance:4, Finance:4
    expect(firstIds).toEqual([1, 2, 1, 4, 4]);
  });

  it('last() per category returns max id in each group', async () => {
    const rows = await cf.findAll(null, null, [
      cf.id(), cf.category(),
      cf.id().last({ partitionBy: [cf.category()], orderBy: [cf.id().ascending()] }),
    ]).orderByOp(cf.id().ascending()).toRows();
    const lastIds = rows.map(r => Number(r[2]));
    // Technology:3, Manufacturing:2, Technology:3, Finance:5, Finance:5
    expect(lastIds).toEqual([1, 2, 3, 4, 5]);
  });
});
