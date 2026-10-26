/**
 * DatabricksConnect against a scripted fake of the SQL Statement Execution API. What it sends is checked against
 * the API's request shape, and what it reads against the shape of its responses; a real warehouse is not involved.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { DatabricksConnect, DatabricksQueryError, convertValue } from '../src/datafinder/databricks-runner';
import { QueryTimeoutError, clearRunner, registerRunner } from '../src/datafinder/runner';
import { DateOnly } from '../src/model/relational';

interface Sent { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }

/** A fake fetch that answers each request from `answer` and records it. */
function fake(answer: (sent: Sent, count: number) => { status?: number; body: unknown }) {
  const requests: Sent[] = [];
  const fetchFake = (async (url: string, init: RequestInit) => {
    const sent: Sent = {
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    requests.push(sent);
    const { status = 200, body } = answer(sent, requests.length);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: fetchFake, requests };
}

const columns = (...names: [string, string][]) => ({
  schema: { column_count: names.length, columns: names.map(([name, type_name], position) => ({ name, type_name, position })) },
});

const succeeded = (rows: (string | null)[][], cols: [string, string][], extra: object = {}) => ({
  statement_id: 'st-1',
  status: { state: 'SUCCEEDED' },
  manifest: columns(...cols),
  result: { data_array: rows, ...extra },
});

const f = new CompanyFinder();
const config = { host: 'https://dbc-1.cloud.databricks.com', warehouseId: 'wh-9', token: 'tok', pollIntervalMs: 1 };
const query = () => f.findAll(null, null, [f.name().alias('Company')], f.category().eq('Technology')).orderBy(f.name().descending());

afterEach(() => clearRunner());

describe('what it sends', () => {
  it('posts the statement, in Databricks SQL, to the warehouse', async () => {
    const { fetch, requests } = fake(() => ({ body: succeeded([['Acme Corp']], [['Company', 'STRING']]) }));
    registerRunner(new DatabricksConnect({ ...config, fetch, catalog: 'main', schema: 'sales' }));
    await query().toRows();

    expect(requests).toHaveLength(1);
    const [post] = requests;
    expect(post.method).toBe('POST');
    expect(post.url).toBe('https://dbc-1.cloud.databricks.com/api/2.0/sql/statements/');
    expect(post.headers.Authorization).toBe('Bearer tok');
    expect(post.body).toMatchObject({
      warehouse_id: 'wh-9', wait_timeout: '50s', on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE', format: 'JSON_ARRAY', catalog: 'main', schema: 'sales',
    });
    expect(post.body!.statement).toBe(query().toSql('databricks'));
    expect(post.body!.statement).toContain('AS `Company`');
    expect(post.body!.statement).toContain('ORDER BY t0.name DESC NULLS FIRST');
  });

  it('leaves out the catalog, schema and token when there are none', async () => {
    const { fetch, requests } = fake(() => ({ body: succeeded([], [['Company', 'STRING']]) }));
    registerRunner(new DatabricksConnect({ host: 'https://proxy.example/db/', warehouseId: 'w', fetch }));
    await query().toRows();
    const [post] = requests;
    expect(post.url).toBe('https://proxy.example/db/api/2.0/sql/statements/');
    expect(post.headers.Authorization).toBeUndefined();
    expect(post.body).not.toHaveProperty('catalog');
    expect(post.body).not.toHaveProperty('schema');
  });

  it('asks for the wait the timeout allows, up to the API\'s 50 seconds', async () => {
    const waits: unknown[] = [];
    const { fetch } = fake(sent => { waits.push(sent.body?.wait_timeout); return { body: succeeded([], [['Company', 'STRING']]) }; });
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    await query().timeout(20_000).toRows();
    await query().timeout(2_000).toRows();
    await query().timeout(120_000).toRows();
    expect(waits).toEqual(['20s', '0s', '50s']);
  });

  it('asks for each call the token function gives', async () => {
    let n = 0;
    const { fetch, requests } = fake((_s, count) => ({
      body: count === 1 ? { statement_id: 'st-1', status: { state: 'RUNNING' } } : succeeded([], [['Company', 'STRING']]),
    }));
    registerRunner(new DatabricksConnect({ ...config, fetch, token: async () => `t${++n}` }));
    await query().toRows();
    expect(requests.map(r => r.headers.Authorization)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('refuses a config with no host or no warehouse', () => {
    expect(() => new DatabricksConnect({ host: '', warehouseId: 'w' })).toThrow(/host/);
    expect(() => new DatabricksConnect({ host: 'h', warehouseId: '' })).toThrow(/warehouse/);
  });
});

describe('what it reads', () => {
  it('turns each value into its column\'s type, and reports the column names', async () => {
    const cols: [string, string][] = [['n', 'INT'], ['big', 'LONG'], ['x', 'DOUBLE'], ['d', 'DECIMAL'], ['b', 'BOOLEAN'],
      ['day', 'DATE'], ['at', 'TIMESTAMP'], ['s', 'STRING'], ['gone', 'STRING']];
    const { fetch } = fake(() => ({
      body: succeeded([['7', '9007199254740993', '1.5', '2.25', 'true', '2024-07-01', '2024-07-01T08:30:00.000Z', 'hello', null]], cols),
    }));
    const runner = new DatabricksConnect({ ...config, fetch });
    registerRunner(runner);
    const [row] = await query().toRows();
    expect(row).toEqual([7, 9007199254740993n, 1.5, 2.25, true, new DateOnly('2024-07-01T00:00:00Z'), new Date('2024-07-01T08:30:00Z'), 'hello', null]);
    expect(row[5]).toBeInstanceOf(DateOnly);
    expect(runner.lastColumns).toEqual(['n', 'big', 'x', 'd', 'b', 'day', 'at', 's', 'gone']);
  });

  it('a long that fits a number is a number', () => {
    expect(convertValue('42', 'LONG')).toBe(42);
    expect(convertValue('-9007199254740993', 'LONG')).toBe(-9007199254740993n);
  });

  it('a timestamp with no zone is read as UTC; structured values stay text', () => {
    expect(convertValue('2024-07-01 08:30:00', 'TIMESTAMP_NTZ')).toEqual(new Date('2024-07-01T08:30:00Z'));
    expect(convertValue('[1,2]', 'ARRAY')).toBe('[1,2]');
    expect(convertValue('false', 'BOOLEAN')).toBe(false);
  });

  it('no rows is an empty result', async () => {
    const { fetch } = fake(() => ({ body: { statement_id: 'st-1', status: { state: 'SUCCEEDED' }, manifest: columns(['Company', 'STRING']) } }));
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    expect(await query().toRows()).toEqual([]);
  });

  it('follows the chunks of a large result', async () => {
    const { fetch, requests } = fake((sent) => {
      if (sent.method === 'POST') return { body: succeeded([['a'], ['b']], [['Company', 'STRING']], { next_chunk_index: 1 }) };
      if (sent.url.endsWith('/chunks/1')) return { body: { chunk_index: 1, data_array: [['c']], next_chunk_index: 2 } };
      return { body: { chunk_index: 2, data_array: [['d']] } };
    });
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    expect(await query().toRows()).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(requests.map(r => r.url.split('/statements')[1])).toEqual(['/', '/st-1/result/chunks/1', '/st-1/result/chunks/2']);
  });

  it('waits for a statement that is still running', async () => {
    const { fetch, requests } = fake((_s, count) => ({
      body: count < 3 ? { statement_id: 'st-1', status: { state: count === 1 ? 'PENDING' : 'RUNNING' } } : succeeded([['Acme Corp']], [['Company', 'STRING']]),
    }));
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    expect(await query().toRows()).toEqual([['Acme Corp']]);
    expect(requests.map(r => `${r.method} ${r.url.split('/statements')[1]}`)).toEqual(['POST /', 'GET /st-1', 'GET /st-1']);
  });
});

describe('when it goes wrong', () => {
  it('a failed statement is an error with Databricks\' code and message', async () => {
    const { fetch } = fake(() => ({
      body: { statement_id: 'st-1', status: { state: 'FAILED', error: { error_code: 'BAD_REQUEST', message: 'PARSE_SYNTAX_ERROR near x' } } },
    }));
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    const failure = await query().toRows().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DatabricksQueryError);
    expect(failure).toMatchObject({ code: 'BAD_REQUEST', message: 'PARSE_SYNTAX_ERROR near x', statementId: 'st-1' });
  });

  it('a request the API refuses is an error with its message', async () => {
    const { fetch } = fake(() => ({ status: 401, body: { error_code: 'UNAUTHENTICATED', message: 'Invalid access token' } }));
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    await expect(query().toRows()).rejects.toMatchObject({ name: 'DatabricksQueryError', code: 'UNAUTHENTICATED', message: 'Invalid access token' });
  });

  it('a response that is not JSON still gives the status', async () => {
    const fetchFake = (async () => new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })) as unknown as typeof fetch;
    registerRunner(new DatabricksConnect({ ...config, fetch: fetchFake }));
    await expect(query().toRows()).rejects.toThrow(/502 Bad Gateway/);
  });

  it('a statement that outlasts the timeout is cancelled and reported as a timeout', async () => {
    const { fetch, requests } = fake(sent => (
      sent.url.endsWith('/cancel') ? { body: {} } : { body: { statement_id: 'st-1', status: { state: 'RUNNING' } } }
    ));
    registerRunner(new DatabricksConnect({ ...config, fetch }));
    await expect(query().timeout(40).toRows()).rejects.toBeInstanceOf(QueryTimeoutError);
    const last = requests[requests.length - 1];
    expect(last.method).toBe('POST');
    expect(last.url).toMatch(/\/api\/2\.0\/sql\/statements\/st-1\/cancel$/);
  });

  it('a request that never answers is aborted at the timeout', async () => {
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason ?? new Error('aborted')));
    })) as unknown as typeof fetch;
    registerRunner(new DatabricksConnect({ ...config, fetch: hanging }));
    await expect(query().timeout(30).toRows()).rejects.toBeInstanceOf(QueryTimeoutError);
  });
});
