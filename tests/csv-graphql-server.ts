/**
 * A mock GraphQL server that serves rows from in-memory tables, so the shared specs can run against
 * the GraphQL backend. It understands the Hasura-style `where`, `order_by` and `limit` arguments plus
 * the `asOf` and `businessDate` milestoning arguments.
 *
 * Mirrors datafinder_graphql/tests/csv_graphql_server.py from the Python project.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import { examplePath } from './spec-harness';

type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Load CSV data
// ---------------------------------------------------------------------------

/** Parse CSV text (RFC 4180: quoted cells may contain commas, quotes and newlines) into one object per row. */
function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { record.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(cell); cell = '';
      records.push(record); record = [];
    } else cell += c;
  }
  if (cell !== '' || record.length > 0) { record.push(cell); records.push(record); }
  const [header, ...rows] = records.filter(r => !(r.length === 1 && r[0] === ''));
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function readCsv(name: string): Row[] {
  return parseCsv(fs.readFileSync(examplePath(name), 'utf8'));
}

/** Milliseconds since the epoch of "2024-01-01 12:00:00", "2024-01-01T12:00:00(.000)(Z)" or "2024-01-01", read as UTC. */
function parseDt(text: string): number {
  const s = text.trim().replace(' ', 'T').replace(/Z$/, '');
  const ms = Date.parse(/T/.test(s) ? s + 'Z' : s + 'T00:00:00Z');
  if (Number.isNaN(ms)) throw new Error(`Cannot parse datetime: ${JSON.stringify(text)}`);
  return ms;
}

function parseDtOrNull(text: string): number | null {
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(text) ? parseDt(text) : null;
}

function filterProcessing(rows: Row[], asOf: number, inCol: string, outCol: string): Row[] {
  return rows.filter(row => {
    // a missing end means the row is open-ended
    const out = row[outCol] ? parseDt(row[outCol]) : Infinity;
    return parseDt(row[inCol]) <= asOf && asOf < out;
  });
}

function extractArg(query: string, argName: string): string | null {
  return new RegExp(`${argName}:\\s*"([^"]+)"`).exec(query)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Hasura where / order_by / limit parsing
// ---------------------------------------------------------------------------

/** Extract a balanced {…} or […] value for a named arg from a GraphQL query string. */
function extractBalanced(s: string, argName: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']';
  const m = new RegExp(`${argName}:\\s*\\${open}`).exec(s);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

type Token = string | { kind: 'str' | 'num' | 'bool' | 'null' | 'id'; value: any };

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (' \t\n\r,'.includes(c)) i++;
    else if ('{}[]:'.includes(c)) { tokens.push(c); i++; }
    else if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      tokens.push({ kind: 'str', value: JSON.parse(s.slice(i, j + 1)) });
      i = j + 1;
    } else if (/\d/.test(c) || (c === '-' && /\d/.test(s[i + 1] ?? ''))) {
      let j = i;
      while (j < s.length && '0123456789.-'.includes(s[j])) j++;
      tokens.push({ kind: 'num', value: Number(s.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /\w/.test(s[j])) j++;
      const word = s.slice(i, j);
      tokens.push(word === 'true' ? { kind: 'bool', value: true }
        : word === 'false' ? { kind: 'bool', value: false }
        : word === 'null' ? { kind: 'null', value: null }
        : { kind: 'id', value: word });
      i = j;
    } else i++;
  }
  return tokens;
}

function parseValue(tokens: Token[], pos: number): [any, number] {
  const tok = tokens[pos];
  if (tok === undefined) return [null, pos];
  if (tok === '{') return parseObject(tokens, pos);
  if (tok === '[') return parseArray(tokens, pos);
  if (typeof tok === 'object') return [tok.value, pos + 1];
  return [null, pos + 1];
}

function parseObject(tokens: Token[], pos: number): [Row, number] {
  pos++; // skip '{'
  const obj: Row = {};
  while (pos < tokens.length && tokens[pos] !== '}') {
    const tok = tokens[pos];
    if (typeof tok !== 'object' || tok.kind !== 'id') break;
    pos++;
    if (tokens[pos] === ':') pos++;
    let value: any;
    [value, pos] = parseValue(tokens, pos);
    obj[tok.value] = value;
  }
  if (tokens[pos] === '}') pos++;
  return [obj, pos];
}

function parseArray(tokens: Token[], pos: number): [any[], number] {
  pos++; // skip '['
  const arr: any[] = [];
  while (pos < tokens.length && tokens[pos] !== ']') {
    let value: any;
    [value, pos] = parseValue(tokens, pos);
    arr.push(value);
  }
  if (tokens[pos] === ']') pos++;
  return [arr, pos];
}

/** A request the mock server rejects, as a real server would with a GraphQL error. */
class GraphQLServerError extends Error {}

/** Bring a row value and a where-clause value to the same type so they can be compared. */
function comparable(raw: any, target: any): [any, any] {
  if (typeof target === 'boolean') return [typeof raw === 'string' ? raw.toLowerCase() === 'true' : Boolean(raw), target];
  if (typeof target === 'number') {
    const n = Number(raw);
    return [Number.isNaN(n) ? raw : n, target];
  }
  if (typeof target === 'string' && typeof raw === 'string') {
    const dtTarget = parseDtOrNull(target);
    const dtRaw = parseDtOrNull(raw);
    if (dtTarget !== null && dtRaw !== null) return [dtRaw, dtTarget];
  }
  return [raw, target];
}

function likeToRegex(pattern: string): RegExp {
  const body = [...pattern].map(ch => ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${body}$`, 's');
}

function evalLeaf(opName: string, raw: any, target: any): boolean {
  if (opName === '_is_null') return (raw === null || raw === undefined) === target;
  if (raw === null || raw === undefined) return false; // comparing null is never true, as in SQL
  if (opName === '_like') return likeToRegex(String(target)).test(String(raw));
  if (opName === '_nlike') return !likeToRegex(String(target)).test(String(raw));
  const [a, b] = comparable(raw, target);
  switch (opName) {
    case '_eq': return a === b;
    case '_neq': return a !== b;
    case '_lt': return a < b;
    case '_lte': return a <= b;
    case '_gt': return a > b;
    case '_gte': return a >= b;
  }
  throw new GraphQLServerError(`field '${opName}' not found in type: 'Boolean_comparison_exp'`);
}

function evalWhere(where: Row, row: Row): boolean {
  if ('_and' in where) return where._and.every((sub: Row) => evalWhere(sub, row));
  if ('_or' in where) return where._or.some((sub: Row) => evalWhere(sub, row));
  if ('_not' in where) return !evalWhere(where._not, row);
  for (const [field, cond] of Object.entries(where)) {
    if (cond === null || typeof cond !== 'object') throw new GraphQLServerError(`expected an object for '${field}'`);
    const raw = row[field];
    const keys = Object.keys(cond);
    if (keys.length > 0 && keys.every(k => k.startsWith('_'))) {
      if (!Object.entries(cond).every(([opName, target]) => evalLeaf(opName, raw, target))) return false;
    } else if (Array.isArray(raw)) {
      // on a list of objects a condition matches a row when any of them does
      if (!raw.some(item => evalWhere(cond as Row, item))) return false;
    } else if (raw === null || raw === undefined || !evalWhere(cond as Row, raw)) {
      // a condition on a nested object matches only rows that have one, as a join would
      return false;
    }
  }
  return true;
}

function applyWhere(rows: Row[], query: string): Row[] {
  const whereStr = extractBalanced(query, 'where', '{');
  if (!whereStr) return rows;
  const [where] = parseObject(tokenize(whereStr), 0);
  return rows.filter(r => evalWhere(where, r));
}

/** { a: { b: asc } } gives [["a", "b"], "asc"]. */
function orderPath(item: any): [string[], string] {
  const path: string[] = [];
  while (item !== null && typeof item === 'object' && Object.keys(item).length === 1) {
    const [[field, inner]] = Object.entries(item);
    path.push(field);
    item = inner;
  }
  if (path.length === 0 || (item !== 'asc' && item !== 'desc')) throw new GraphQLServerError('invalid order_by expression');
  return [path, item];
}

function valueAt(row: Row, path: string[]): any {
  let value: any = row;
  for (const part of path) {
    if (Array.isArray(value)) throw new GraphQLServerError('order_by on an array relationship needs an aggregate');
    if (value === null || typeof value !== 'object') return null;
    value = value[part];
  }
  if (Array.isArray(value)) throw new GraphQLServerError('order_by on an array relationship needs an aggregate');
  return value ?? null;
}

function applyOrderBy(rows: Row[], query: string): Row[] {
  const orderStr = extractBalanced(query, 'order_by', '[');
  if (!orderStr) return rows;
  const [orderList] = parseArray(tokenize(orderStr), 0);
  for (const item of [...orderList].reverse()) {
    const [path, direction] = orderPath(item);
    const sign = direction === 'desc' ? -1 : 1;
    // nulls sort last when ascending, so first when descending
    rows = [...rows].sort((a, b) => {
      const x = valueAt(a, path);
      const y = valueAt(b, path);
      const nulls = (x === null ? 1 : 0) - (y === null ? 1 : 0);
      return sign * (nulls || (x < y ? -1 : x > y ? 1 : 0));
    });
  }
  return rows;
}

function applyLimit(rows: Row[], query: string): Row[] {
  const m = /\blimit:\s*(\d+)/.exec(query);
  return m ? rows.slice(0, Number(m[1])) : rows;
}

// ---------------------------------------------------------------------------
// Tables and server
// ---------------------------------------------------------------------------

/** A nested object resolved from a milestoned set of rows, as of the query's asOf (null if none is live). */
export interface NestedVersions {
  foreignKey: string; // row key holding the id of the nested object
  versions: Row[];    // each has an "id", plus _in_z / _out_z when the nested object is milestoned
}

/**
 * Rows served for one root query field. Keys starting with "_" are internal: they are used for
 * milestoning and never returned.
 */
export interface GraphQLTable {
  rows: Row[];
  processingMilestoned?: boolean;   // the root query accepts asOf, filtering on the rows' _in_z / _out_z
  businessDateKey?: string;         // the root query accepts businessDate, matching this row key
  nested?: Record<string, NestedVersions>;
}

/** Each field maps to its sub-selection (null for a scalar) and the text of its arguments. */
type Selection = { [name: string]: { sub: Selection | null; args: string } };

/** Parse "{ a b { c } d(arg: 1) { e } }" into {a: {sub: null, args: ""}, b: {sub: {c: ...}, args: ""}, d: {..., args: "arg: 1"}}. */
function parseSelection(s: string, pos = 0): [Selection, number] {
  const fields: Selection = {};
  pos++; // skip '{'
  while (pos < s.length && s[pos] !== '}') {
    if (' \t\n\r,'.includes(s[pos])) { pos++; continue; }
    const m = /\w+/y;
    m.lastIndex = pos;
    const found = m.exec(s);
    if (!found) throw new GraphQLServerError(`cannot parse the selection at ${pos}`);
    const name = found[0];
    pos = m.lastIndex;
    while (' \t\n\r'.includes(s[pos] ?? 'x')) pos++;
    let args = '';
    if (s[pos] === '(') {
      const argsStart = pos + 1;
      let depth = 0;
      while (pos < s.length) {
        if (s[pos] === '"') {
          for (pos++; s[pos] !== '"'; pos++) if (s[pos] === '\\') pos++;
        } else if (s[pos] === '(') depth++;
        else if (s[pos] === ')' && --depth === 0) { args = s.slice(argsStart, pos); pos++; break; }
        pos++;
      }
      while (' \t\n\r'.includes(s[pos] ?? 'x')) pos++;
    }
    let sub: Selection | null = null;
    if (s[pos] === '{') [sub, pos] = parseSelection(s, pos);
    fields[name] = { sub, args };
  }
  return [fields, pos + 1];
}

/** Return only the requested fields, as a server does. */
function select(value: any, selection: Selection | null): any {
  if (selection === null) return value;
  if (Array.isArray(value)) return value.map(item => select(item, selection));
  if (value === null || value === undefined) return null;
  return Object.fromEntries(Object.entries(selection).map(([name, { sub, args }]) => [name, selectField(value[name], sub, args)]));
}

function selectField(value: any, selection: Selection | null, args: string): any {
  if (args) {
    // a list relationship takes where, order_by and limit; an object relationship takes no arguments
    if (!Array.isArray(value)) throw new GraphQLServerError('field does not accept arguments');
    value = applyLimit(applyOrderBy(applyWhere(value, args), args), args);
  }
  return select(value, selection);
}

function resolveNested(rows: Row[], nested: Record<string, NestedVersions>, asOfStr: string | null): Row[] {
  const asOf = asOfStr ? parseDt(asOfStr) : null;

  const resolve = (spec: NestedVersions, row: Row): Row | null => {
    let candidates = spec.versions.filter(v => v.id === row[spec.foreignKey]);
    if (asOf !== null) {
      candidates = [
        ...candidates.filter(v => !('_in_z' in v)),
        ...filterProcessing(candidates.filter(v => '_in_z' in v), asOf, '_in_z', '_out_z'),
      ];
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((best, v) => ((v._in_z ?? '') > (best._in_z ?? '') ? v : best));
  };

  return rows.map(row => ({
    ...row,
    ...Object.fromEntries(Object.entries(nested).map(([name, spec]) => [name, resolve(spec, row)])),
  }));
}

function serveQuery(tables: Record<string, GraphQLTable>, query: string): Row {
  const [selection] = parseSelection(query.slice(query.indexOf('{')));
  const roots = Object.entries(selection);
  if (roots.length !== 1) throw new GraphQLServerError('expected a single root field');
  const [[name, { sub, args }]] = roots;
  if (!(name in tables)) return {};
  const table = tables[name];
  let rows = table.rows;
  // the arguments of the root field alone: a nested field's where must not filter the root rows
  if (table.businessDateKey) {
    const businessDate = extractArg(args, 'businessDate');
    if (businessDate) rows = rows.filter(r => r[table.businessDateKey!] === businessDate);
  }
  if (table.processingMilestoned) {
    const asOf = extractArg(args, 'asOf');
    if (asOf) rows = filterProcessing(rows, parseDt(asOf), '_in_z', '_out_z');
  }
  if (table.nested) rows = resolveNested(rows, table.nested, extractArg(args, 'asOf'));
  rows = applyWhere(rows, args);
  rows = applyOrderBy(rows, args);
  rows = applyLimit(rows, args);
  return { [name]: select(rows, sub) };
}

export async function startGraphQLServer(tables: Record<string, GraphQLTable>): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let response: Row;
      try {
        response = { data: serveQuery(tables, JSON.parse(body).query ?? '') };
      } catch (e) {
        if (!(e instanceof GraphQLServerError)) throw e;
        response = { errors: [{ message: e.message }] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}/graphql` };
}

// ---------------------------------------------------------------------------
// Tables built from CSV files
// ---------------------------------------------------------------------------

type Convert = 'str' | 'int' | 'float';
/** A CSV column, or a [column, type] pair when the value is not text. */
export type FieldSpec = string | [string, Convert];

const CONVERTERS: Record<Convert, (raw: string) => unknown> = { str: String, int: Number, float: Number };

/**
 * Build a table from a CSV file. `fields` maps each GraphQL field to its CSV column; `internal` does the
 * same for the keys that are never returned (foreign keys). An empty CSV cell is null.
 */
export function csvTable(
  csvName: string,
  fields: Record<string, FieldSpec>,
  internal: Record<string, FieldSpec> = {},
  options: Omit<GraphQLTable, 'rows'> = {},
): GraphQLTable {
  const pick = (row: Row, spec: FieldSpec) => {
    const [column, type] = typeof spec === 'string' ? [spec, 'str' as Convert] : spec;
    return row[column] === '' ? null : CONVERTERS[type](row[column]);
  };
  const rows = readCsv(csvName).map(r => ({
    ...Object.fromEntries(Object.entries(fields).map(([field, spec]) => [field, pick(r, spec)])),
    ...Object.fromEntries(Object.entries(internal).map(([key, spec]) => [key, pick(r, spec)])),
  }));
  return { rows, ...options };
}

// ---------------------------------------------------------------------------
// Finance data, shaped as GraphQL responses
// ---------------------------------------------------------------------------

export function financeTables(
  accountsCsv = 'finance_accounts.csv',
  tradesCsv = 'finance_trades.csv',
  branchesCsv = 'finance_branches.csv',
): Record<string, GraphQLTable> {
  const branches = readCsv(branchesCsv).map(r => ({ id: Number(r.ID), city: r.CITY }));
  const branchIndex = new Map(branches.map(b => [b.id, b]));
  const versions = readCsv(accountsCsv).map(r => ({
    id: Number(r.ID),
    name: r.ACCT_NAME,
    branch: branchIndex.get(Number(r.BRANCH_ID)),
    _in_z: r.in_z ?? '1900-01-01 00:00:00',
    _out_z: r.out_z ?? '9999-12-31 23:59:59',
  }));
  // the account query is not milestoned: GraphQL serves only the current (latest) version of each
  const current = new Map<number, Row>();
  for (const v of [...versions].sort((a, b) => (a._in_z < b._in_z ? -1 : a._in_z > b._in_z ? 1 : 0))) current.set(v.id, v);
  const accounts = [...current.values()].map(v => ({ id: v.id, name: v.name, branch: v.branch }));

  const trades = readCsv(tradesCsv).map(r => ({
    symbol: r.sym,
    price: Number(r.price),
    isSettled: r.is_settled.toLowerCase() === 'true',
    validFrom: r.in_z,
    validTo: r.out_z,
    _account_id: Number(r.account_id),
    _in_z: r.in_z,
    _out_z: r.out_z,
  }));

  const positions = readCsv('finance_positions.csv').map(r => ({
    businessDate: r.DATE,
    quantity: Number(r.QUANTITY),
    npv: Number(r.NPV),
    _in_z: r.in_z,
    _out_z: r.out_z,
  }));

  return {
    accounts: { rows: accounts },
    branches: { rows: branches },
    trades: { rows: trades, processingMilestoned: true, nested: { account: { foreignKey: '_account_id', versions } } },
    contractualPositions: { rows: positions, processingMilestoned: true, businessDateKey: 'businessDate' },
  };
}
