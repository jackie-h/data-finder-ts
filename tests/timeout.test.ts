import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { DEFAULT_TIMEOUT_MS, QueryTimeoutError, registerRunner, clearRunner } from '../src/datafinder/runner';
import type { QueryRunner } from '../src/datafinder/runner';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let cf: CompanyFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);
  await conn.run('CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)');
  await conn.run("INSERT INTO companies SELECT range, 'Company ' || range, 'Cat' || (range % 7) FROM range(5000000)");
  cf = new CompanyFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('FinderResult.timeout', () => {
  it('aborts a slow query with QueryTimeoutError', async () => {
    const slow = cf.findAll(null, null, [cf.id(), cf.name().length(), cf.id().rank({ orderBy: [cf.name().ascending()] })]);
    await expect(slow.timeout(1).toRows()).rejects.toThrow(QueryTimeoutError);
  });

  it('reports the configured timeout in the error', async () => {
    const slow = cf.findAll(null, null, [cf.id(), cf.id().rank({ orderBy: [cf.name().ascending()] })]);
    await expect(slow.timeout(1).toRows()).rejects.toMatchObject({ timeoutMs: 1, message: 'Query exceeded 1ms timeout' });
  });

  it('lets queries finishing inside the timeout complete', async () => {
    const rows = await cf.findAll(null, null, [cf.id()], cf.id().eq(42)).timeout(30_000).toRows();
    expect(rows).toEqual([[42]]);
  });

  it('leaves the connection usable after a timeout', async () => {
    const rows = await cf.findAll(null, null, [cf.name()], cf.id().eq(7)).toRows();
    expect(rows).toEqual([['Company 7']]);
  });
});

describe('timeout passed to the runner', () => {
  it('defaults to 60 seconds and is overridable', async () => {
    const seen: number[] = [];
    const spy: QueryRunner = {
      select: async (_bd, _pd, _cols, _table, _op, _ob, _gb, _limit, timeoutMs) => {
        seen.push(timeoutMs as number);
        return [];
      },
    };
    clearRunner();
    registerRunner(spy);
    await cf.findAll(null, null, [cf.id()]).toRows();
    await cf.findAll(null, null, [cf.id()]).timeout(250).toRows();
    registerDuckDb(conn);
    expect(seen).toEqual([DEFAULT_TIMEOUT_MS, 250]);
    expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
  });
});
