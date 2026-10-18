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
  await conn.run("INSERT INTO companies VALUES (7, 'Company 7', 'Tech'), (42, 'Company 42', 'Finance')");
  cf = new CompanyFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('FinderResult.timeout', () => {
  describe('against a query that takes far longer than the timeout', () => {
    // `companies` becomes a view over ten billion generated rows, so summing the ids runs for
    // far longer than the test's own 5s limit however fast the machine is. The query returns one row, so nothing large is ever read.
    const SHORT_TIMEOUT_MS = 50;
    const slow = () => cf.findAll(null, null, [cf.id().sum()]);

    beforeAll(async () => {
      await conn.run('ALTER TABLE companies RENAME TO companies_small');
      await conn.run(`CREATE VIEW companies AS
        SELECT ((range * 7919) % 1000003)::INT AS id, 'Company' AS name, 'Cat' AS category FROM range(10000000000)`);
    });

    afterAll(async () => {
      await conn.run('DROP VIEW companies');
      await conn.run('ALTER TABLE companies_small RENAME TO companies');
    });

    it('aborts with QueryTimeoutError', async () => {
      await expect(slow().timeout(SHORT_TIMEOUT_MS).toRows()).rejects.toThrow(QueryTimeoutError);
    });

    it('reports the configured timeout in the error', async () => {
      await expect(slow().timeout(SHORT_TIMEOUT_MS).toRows()).rejects.toMatchObject({
        timeoutMs: SHORT_TIMEOUT_MS,
        message: `Query exceeded ${SHORT_TIMEOUT_MS}ms timeout`,
      });
    });
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
