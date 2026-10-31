/**
 * Runs a query on a Databricks SQL warehouse through the SQL Statement Execution REST API
 * (`/api/2.0/sql/statements`), which is plain HTTPS and so works from a browser as well as Node.
 *
 * A browser cannot call a Databricks workspace directly, as the workspace does not send CORS headers, so
 * `host` is usually a server of your own that forwards `/api/2.0/sql/…` to the workspace (and may add the
 * credentials, in which case no `token` is needed here).
 */
import { Attribute } from './attribute';
import { DEFAULT_TIMEOUT_MS, QueryRunner, QueryTarget, QueryTimeoutError, Row } from './runner';
import { toSql } from './sql-generator';
import {
  DateOnly,
  Operation,
  RelationalOperationElement,
  SortOperation,
  Table,
} from '../model/relational';

export interface DatabricksConfig {
  /** The workspace URL, or a server that forwards the Statement Execution API to it. No trailing path. */
  host: string;
  /** The SQL warehouse that runs the statements. */
  warehouseId: string;
  /** Sent as the bearer token. A function is called for every request, so a token can be refreshed. */
  token?: string | (() => string | Promise<string>);
  /** The catalog and schema unqualified table names resolve in. */
  catalog?: string;
  schema?: string;
  /** Extra request headers, for a gateway in front of the workspace. */
  headers?: Record<string, string>;
  /** `fetch`, if not the global one. */
  fetch?: typeof fetch;
  /** How long to wait before first asking again whether a statement has finished (it backs off from there). */
  pollIntervalMs?: number;
}

/** A statement Databricks ran and failed, or the API refused. */
export class DatabricksQueryError extends Error {
  constructor(message: string, readonly code?: string, readonly statementId?: string) {
    super(message);
    this.name = 'DatabricksQueryError';
  }
}

interface ColumnInfo { name: string; type_name?: string; type_text?: string }

/** A chunk of rows, as the statement itself carries the first and the chunks endpoint the rest. */
interface ResultData { data_array?: (string | null)[][]; next_chunk_index?: number }

interface StatementResponse {
  statement_id: string;
  status: { state: string; error?: { error_code?: string; message?: string } };
  manifest?: { schema?: { columns?: ColumnInfo[] } };
  result?: ResultData;
}

const API = '/api/2.0/sql/statements';
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** A value as Databricks sends it (text, or null) as the JavaScript value for its column type. */
export function convertValue(text: string | null, typeName: string | undefined): unknown {
  if (text === null || text === undefined) return null;
  switch ((typeName ?? '').toUpperCase()) {
    case 'BYTE': case 'SHORT': case 'INT': return Number(text);
    case 'LONG': {
      const value = BigInt(text);
      return value >= -MAX_SAFE && value <= MAX_SAFE ? Number(value) : value; // exact when it cannot be a number
    }
    case 'FLOAT': case 'DOUBLE': case 'DECIMAL': return Number(text);
    case 'BOOLEAN': return text.toLowerCase() === 'true';
    case 'DATE': return new DateOnly(text + 'T00:00:00Z');
    case 'TIMESTAMP': case 'TIMESTAMP_NTZ': {
      const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
      return new Date(zoned ? text : text.replace(' ', 'T') + 'Z');
    }
    default: return text; // STRING, and anything structured (ARRAY, MAP, STRUCT, BINARY, INTERVAL) as the text sent
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class DatabricksConnect implements QueryRunner {
  readonly dialect = 'databricks' as const;

  /** Names of the columns of the last query that returned. */
  lastColumns: string[] = [];

  constructor(private readonly config: DatabricksConfig) {
    if (!config.host) throw new Error('DatabricksConnect needs the host of a workspace, or of a server in front of it');
    if (!config.warehouseId) throw new Error('DatabricksConnect needs the id of a SQL warehouse');
  }

  async select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy?: SortOperation[],
    groupBy?: Attribute[],
    limit?: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    businessDateTo: Date | null = null,
    distinct: boolean = false,
    offset?: number,
    having?: Operation,
  ): Promise<Row[]> {
    const statement = toSql(
      businessDate, processingDatetime, columns, table as Table, op, orderBy, groupBy, limit,
      businessDateTo, distinct, offset, having, this.dialect,
    );
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let statementId: string | undefined;
    try {
      let response = await this.call('POST', `${API}/`, controller.signal, {
        warehouse_id: this.config.warehouseId,
        statement,
        // the API holds the request for up to 50 s and answers at once if the statement is quicker; a shorter
        // wait than 5 s is not allowed except 0, so poll
        wait_timeout: timeoutMs >= 5000 ? `${Math.min(50, Math.floor(timeoutMs / 1000))}s` : '0s',
        on_wait_timeout: 'CONTINUE',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
        ...(this.config.catalog ? { catalog: this.config.catalog } : {}),
        ...(this.config.schema ? { schema: this.config.schema } : {}),
      });
      statementId = response.statement_id;

      let delay = this.config.pollIntervalMs ?? 250;
      while (response.status.state === 'PENDING' || response.status.state === 'RUNNING') {
        if (Date.now() >= deadline) throw new QueryTimeoutError(timeoutMs);
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
        delay = Math.min(delay * 2, 2000);
        response = await this.call('GET', `${API}/${statementId}`, controller.signal);
      }

      if (response.status.state !== 'SUCCEEDED') {
        const error = response.status.error;
        throw new DatabricksQueryError(
          error?.message ?? `The statement ${response.status.state.toLowerCase()}`, error?.error_code, statementId);
      }
      return await this.rows(response, controller.signal);
    } catch (e) {
      const timedOut = controller.signal.aborted || e instanceof QueryTimeoutError;
      if (timedOut && statementId !== undefined) await this.cancel(statementId);
      if (controller.signal.aborted) throw new QueryTimeoutError(timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The rows of a finished statement, following its chunks. */
  private async rows(first: StatementResponse, signal: AbortSignal): Promise<Row[]> {
    const info = first.manifest?.schema?.columns ?? [];
    this.lastColumns = info.map(c => c.name);
    const rows: Row[] = [];
    const take = (data: (string | null)[][] | undefined) => {
      for (const row of data ?? []) rows.push(row.map((text, i) => convertValue(text, info[i]?.type_name)));
    };
    take(first.result?.data_array);
    let next = first.result?.next_chunk_index;
    while (next !== undefined && next !== null) {
      const chunk = await this.call<ResultData>('GET', `${API}/${first.statement_id}/result/chunks/${next}`, signal);
      take(chunk.data_array);
      next = chunk.next_chunk_index;
    }
    return rows;
  }

  /** Ask Databricks to stop a statement. Best effort: the query is already given up on. */
  private async cancel(statementId: string): Promise<void> {
    try {
      await this.call('POST', `${API}/${statementId}/cancel`, undefined, {});
    } catch {
      // nothing more can be done about it
    }
  }

  private async call<T = StatementResponse>(method: 'GET' | 'POST', path: string, signal: AbortSignal | undefined, body?: object): Promise<T> {
    const { host, token, headers, fetch: custom } = this.config;
    const bearer = typeof token === 'function' ? await token() : token;
    const response = await (custom ?? fetch)(host.replace(/\/+$/, '') + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = undefined; }
    if (!response.ok) {
      const detail = parsed as { error_code?: string; message?: string } | undefined;
      throw new DatabricksQueryError(
        detail?.message ?? `Databricks request failed: ${response.status} ${response.statusText}`, detail?.error_code);
    }
    return parsed as T;
  }
}
