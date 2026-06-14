import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';

// Padded/cased names to exercise trim and case functions
const COMPANIES = [
  [1, '  Acme Corp  ', 'Technology'],
  [2, 'beta corp',     'Manufacturing'],
  [3, 'Hello World',   'Finance'],
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

describe('CompanyFinder — string scalar functions', () => {
  it('trimStart removes leading whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().trimStart()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('Acme Corp  ');
  });

  it('trimEnd removes trailing whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().trimEnd()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('  Acme Corp');
  });

  it('reverse reverses the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().reverse()], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('beta corp'.split('').reverse().join(''));
  });

  it('toUpperCase uppercases the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().toUpperCase()], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('BETA CORP');
  });

  it('toLowerCase lowercases the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().toLowerCase()], cf.id().eq(3)).toRows();
    expect(rows[0][0]).toBe('hello world');
  });

  it('trim removes both leading and trailing whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().trim()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('Acme Corp');
  });

  it('left(4) returns first 4 characters', async () => {
    const rows = await cf.findAll(null, null, [cf.name().left(4)], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('beta');
  });
});
