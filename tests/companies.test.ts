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

describe('CompanyFinder — count', () => {
  it('counts all rows', async () => {
    const rows = await cf.findAll(null, null, [cf.count()]).toRows();
    expect(Number(rows[0][0])).toBe(5);
  });

  it('counts with eq filter', async () => {
    const rows = await cf.findAll(null, null, [cf.count()], cf.category().eq('Technology')).toRows();
    expect(Number(rows[0][0])).toBe(2);
  });

  it('returns zero when filter has no matches', async () => {
    const rows = await cf.findAll(null, null, [cf.count()], cf.category().eq('Nonexistent')).toRows();
    expect(Number(rows[0][0])).toBe(0);
  });

  it('counts with contains filter', async () => {
    const rows = await cf.findAll(null, null, [cf.count()], cf.name().contains('Corp')).toRows();
    expect(Number(rows[0][0])).toBe(2);
  });

  it('counts name attribute', async () => {
    const rows = await cf.findAll(null, null, [cf.name().count()]).toRows();
    expect(Number(rows[0][0])).toBe(5);
  });

  it('counts attribute with filter', async () => {
    const rows = await cf.findAll(null, null, [cf.name().count()], cf.category().eq('Technology')).toRows();
    expect(Number(rows[0][0])).toBe(2);
  });

  it('counts attribute with ne filter', async () => {
    const rows = await cf.findAll(null, null, [cf.name().count()], cf.category().ne('Technology')).toRows();
    expect(Number(rows[0][0])).toBe(3);
  });
});

describe('CompanyFinder — string operations', () => {
  it('eq returns exact match', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().eq('Acme Corp')).toRows();
    expect(rows.map(r => r[0])).toEqual(['Acme Corp']);
  });

  it('ne excludes matching row', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().ne('Acme Corp')).toRows();
    expect(rows.map(r => r[0])).not.toContain('Acme Corp');
    expect(rows.length).toBe(4);
  });

  it('ne returns all rows when value absent', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().ne('Nonexistent')).toRows();
    expect(rows.length).toBe(5);
  });

  it('contains matches substring', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().contains('Corp')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Acme Corp', 'Beta Corp']));
  });

  it('startsWith matches prefix', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().startsWith('Acme')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Acme Corp', 'Acme Industries']));
  });

  it('endsWith matches suffix', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().endsWith('Corp')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Acme Corp', 'Beta Corp']));
  });

  it('endsWith single result', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.name().endsWith('LLC')).toRows();
    expect(rows.map(r => r[0])).toEqual(['Gamma LLC']);
  });

  it('filters on non-key column with contains', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.category().contains('nology')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Acme Corp', 'Beta Corp']));
  });

  it('filters on non-key column with ne', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.category().ne('Technology')).toRows();
    const names = rows.map(r => r[0]);
    expect(names).not.toContain('Acme Corp');
    expect(names).not.toContain('Beta Corp');
    expect(rows.length).toBe(3);
  });
});

describe('CompanyFinder — sort', () => {
  it('sorts by name ascending', async () => {
    const rows = await cf.findAll(null, null, [cf.name()])
      .orderByOp(cf.name().ascending()).toRows();
    const names = rows.map(r => r[0] as string);
    expect(names).toEqual([...names].sort());
  });

  it('sorts by name descending', async () => {
    const rows = await cf.findAll(null, null, [cf.name()])
      .orderByOp(cf.name().descending()).toRows();
    const names = rows.map(r => r[0] as string);
    expect(names).toEqual([...names].sort().reverse());
  });

  it('sorts by id descending, first row is highest', async () => {
    const rows = await cf.findAll(null, null, [cf.id()])
      .orderByOp(cf.id().descending()).toRows();
    expect(Number(rows[0][0])).toBe(5);
  });

  it('multi-column sort: category asc then name asc', async () => {
    const rows = await cf.findAll(null, null, [cf.name(), cf.category()])
      .orderByOp(cf.category().ascending(), cf.name().ascending()).toRows();
    expect(rows[0][1]).toBe('Finance');
    const financeRows = rows.filter(r => r[1] === 'Finance');
    expect(financeRows[0][0]).toBe('Delta Ltd');
    expect(financeRows[1][0]).toBe('Gamma LLC');
  });

  it('multi-column sort: category asc then name desc', async () => {
    const rows = await cf.findAll(null, null, [cf.name(), cf.category()])
      .orderByOp(cf.category().ascending(), cf.name().descending()).toRows();
    const financeRows = rows.filter(r => r[1] === 'Finance');
    expect(financeRows[0][0]).toBe('Gamma LLC');
    expect(financeRows[1][0]).toBe('Delta Ltd');
  });

  it('sorts filtered results', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.category().eq('Technology'))
      .orderByOp(cf.name().ascending()).toRows();
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('Acme Corp');
    expect(rows[1][0]).toBe('Beta Corp');
  });
});

describe('CompanyFinder — group by', () => {
  it('count per category', async () => {
    const rows = await cf.findAll(null, null, [cf.category(), cf.count()])
      .groupByOp(cf.category()).toRows();
    const counts = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(counts['Technology']).toBe(2);
    expect(counts['Finance']).toBe(2);
    expect(counts['Manufacturing']).toBe(1);
  });

  it('group by returns one row per group', async () => {
    const rows = await cf.findAll(null, null, [cf.category(), cf.count()])
      .groupByOp(cf.category()).toRows();
    expect(rows.length).toBe(3);
  });

  it('group by with filter', async () => {
    const rows = await cf.findAll(null, null, [cf.category(), cf.count()], cf.category().ne('Manufacturing'))
      .groupByOp(cf.category()).toRows();
    expect(rows.length).toBe(2);
    const counts = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(counts['Technology']).toBe(2);
    expect(counts['Finance']).toBe(2);
  });

  it('attribute count per category', async () => {
    const rows = await cf.findAll(null, null, [cf.category(), cf.name().count()])
      .groupByOp(cf.category()).toRows();
    const counts = Object.fromEntries(rows.map(r => [r[0], Number(r[1])]));
    expect(counts['Technology']).toBe(2);
    expect(counts['Finance']).toBe(2);
    expect(counts['Manufacturing']).toBe(1);
  });

  it('group by with order by', async () => {
    const rows = await cf.findAll(null, null, [cf.category(), cf.count()])
      .groupByOp(cf.category()).orderByOp(cf.category().ascending()).toRows();
    const categories = rows.map(r => r[0] as string);
    expect(categories).toEqual([...categories].sort());
  });
});
