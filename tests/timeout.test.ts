/**
 * FinderResult.timeout and the runners that enforce it. Mirrors the Python project's
 * datafinder/tests/test_runner.py (TestFinderResultTimeout) and TestDuckDbTimeout: the unit tests need
 * no database, and the runner tests replace the SQL generator / network so the query is slow by
 * construction rather than by how fast the machine happens to be.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { DuckDbRunner } from './duckdb-runner';
import { GraphQLConnect } from '../src/datafinder/graphql-runner';
import {
  DEFAULT_TIMEOUT_MS,
  QueryRunner,
  QueryTimeoutError,
  clearRunner,
  convertInputsAndSelect,
  registerRunner,
} from '../src/datafinder/runner';
import { NoOperation, Table } from '../src/model/relational';
import { GraphQLEndpoint, GraphQLQuery } from '../src/model/graphql_mapping';

vi.mock('../src/datafinder/sql-generator', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/datafinder/sql-generator')>()),
  // Sum ten billion generated rows: runs for far longer than any timeout used below.
  toSql: () => 'SELECT sum(i) FROM range(10000000000) t(i)',
}));

const table = new Table('trades', []);
const makeResult = () => convertInputsAndSelect(null, null, [], table, new NoOperation());

/** A runner that records the timeout it is handed. */
function spyRunner(seen: number[]): QueryRunner {
  return {
    select: async (_bd, _pd, _cols, _table, _op, _ob, _gb, _limit, timeoutMs) => {
      seen.push(timeoutMs as number);
      return [];
    },
  };
}

afterEach(() => {
  clearRunner();
  vi.unstubAllGlobals();
});

describe('FinderResult.timeout', () => {
  it('defaults to sixty seconds', async () => {
    const seen: number[] = [];
    registerRunner(spyRunner(seen));
    await makeResult().toRows();
    expect(seen).toEqual([60_000]);
    expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  it('passes the configured value to the runner, including sub-second values', async () => {
    const seen: number[] = [];
    registerRunner(spyRunner(seen));
    await makeResult().timeout(1000).toRows();
    await makeResult().timeout(100).toRows();
    expect(seen).toEqual([1000, 100]);
  });

  it('returns the result for chaining', () => {
    const result = makeResult();
    expect(result.timeout(500)).toBe(result);
  });
});

describe('DuckDbRunner timeout', () => {
  const run = async (timeoutMs: number) => {
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      await new DuckDbRunner(conn).select(null, null, [], table, new NoOperation(), [], [], undefined, timeoutMs);
    } finally {
      conn.disconnectSync();
      instance.closeSync();
    }
  };

  it('interrupts the query and throws QueryTimeoutError', async () => {
    await expect(run(50)).rejects.toThrow(QueryTimeoutError);
  });

  it('reports the configured timeout in the error', async () => {
    await expect(run(50)).rejects.toMatchObject({ timeoutMs: 50, message: 'Query exceeded 50ms timeout' });
  });

  it('leaves the connection usable afterwards', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      await expect(new DuckDbRunner(conn).select(null, null, [], table, new NoOperation(), [], [], undefined, 50))
        .rejects.toThrow(QueryTimeoutError);
      const result = await conn.run('SELECT 42');
      expect(result.getChunk(0).getRows()).toEqual([[42]]);
    } finally {
      conn.disconnectSync();
      instance.closeSync();
    }
  });
});

describe('GraphQLConnect timeout', () => {
  const query = new GraphQLQuery('accounts', new GraphQLEndpoint('http://localhost:0/graphql'));

  /** A server that never answers: the request only ends when the abort signal fires. */
  const stubHangingFetch = () =>
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));

  it('aborts the request and throws QueryTimeoutError', async () => {
    stubHangingFetch();
    await expect(new GraphQLConnect().select(null, null, [], query, new NoOperation(), [], [], undefined, 20))
      .rejects.toMatchObject({ name: 'QueryTimeoutError', timeoutMs: 20, message: 'Query exceeded 20ms timeout' });
  });

  it('applies the timeout set on the FinderResult', async () => {
    stubHangingFetch();
    registerRunner(new GraphQLConnect());
    await expect(convertInputsAndSelect(null, null, [], query, new NoOperation()).timeout(20).toRows())
      .rejects.toThrow(QueryTimeoutError);
  });
});
