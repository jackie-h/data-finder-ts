import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';

// Padded/cased names to exercise strip and case functions
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
  it('lstrip removes leading whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().lstrip()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('Acme Corp  ');
  });

  it('rstrip removes trailing whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().rstrip()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('  Acme Corp');
  });

  it('reverse reverses the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().reverse()], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('beta corp'.split('').reverse().join(''));
  });

  it('upper uppercases the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().upper()], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('BETA CORP');
  });

  it('lower lowercases the string', async () => {
    const rows = await cf.findAll(null, null, [cf.name().lower()], cf.id().eq(3)).toRows();
    expect(rows[0][0]).toBe('hello world');
  });

  it('strip removes both leading and trailing whitespace', async () => {
    const rows = await cf.findAll(null, null, [cf.name().strip()], cf.id().eq(1)).toRows();
    expect(rows[0][0]).toBe('Acme Corp');
  });

  it('left(4) returns first 4 characters', async () => {
    const rows = await cf.findAll(null, null, [cf.name().left(4)], cf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('beta');
  });
});
