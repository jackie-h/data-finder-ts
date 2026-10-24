import { Attribute } from './attribute';
import { DEFAULT_TIMEOUT_MS, QueryRunner, QueryTarget, QueryTimeoutError, Row } from './runner';
import {
  ColumnWithJoin,
  ComparisonOperation,
  ComparisonOperator,
  ConstantOperation,
  DateConstantOperation,
  DateTimeConstantOperation,
  IsNotNullOperation,
  Alias,
  InOperation,
  NotInOperation,
  IsNullOperation,
  LogicalOperation,
  LogicalOperator,
  NoOperation,
  RelationalOperationElement,
  SortDirection,
  SortOperation,
  LIKE_ESCAPE,
  StringConstantOperation,
} from '../model/relational';
import {
  parseFieldPath,
  plainFieldPath,
  GraphQLQuery,
  GraphQLFilterConvention,
  GraphQLProcessingMilestone,
  GraphQLBusinessDateMilestone,
  GraphQLBiTemporalMilestone,
} from '../model/graphql_mapping';

/**
 * A query the GraphQL runner cannot answer.
 *
 * The runner does not compensate on the client for what the server cannot do: it fails instead of
 * returning rows that differ from what the same query returns on another backend.
 */
export class GraphQLUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphQLUnsupportedError';
  }
}

/** A filter, sort or limit that cannot be expressed as arguments to the GraphQL server. */
export class GraphQLPushdownError extends GraphQLUnsupportedError {
  constructor(message: string) {
    super(message);
    this.name = 'GraphQLPushdownError';
  }
}

/**
 * A query that needs the result computed on the client (an aggregate, a function, a window, a group by).
 * The runner leaves that to the server rather than computing it, which another backend would do differently.
 */
export class GraphQLClientComputationError extends GraphQLUnsupportedError {
  constructor(message: string) {
    super(message);
    this.name = 'GraphQLClientComputationError';
  }
}

// ---------------------------------------------------------------------------
// Field paths. A to-many relation is marked "[]": "projects[].name" is the name of each project.
// ---------------------------------------------------------------------------

/** A field path without its to-many markers and filters: "manager.projects[].name" is "manager.projects.name". */
function plain(name: string): string {
  return plainFieldPath(name);
}

function isMany(element: unknown): boolean {
  return element instanceof ColumnWithJoin && parseFieldPath(element.column.name).some(seg => seg.many);
}

/** The field path of a selected column, with to-many markers; strict mode only selects plain attributes. */
function rawName(col: Attribute | RelationalOperationElement): string {
  if (col instanceof Attribute) return col.column().name;
  throw new GraphQLClientComputationError(`The GraphQL runner does not support ${col.constructor.name} columns: it does not compute them on the client`);
}

function fieldName(element: unknown, what: string): string {
  if (!(element instanceof ColumnWithJoin)) {
    throw new GraphQLPushdownError(
      `Cannot push ${what} to the server: ${(element as object)?.constructor?.name} is not a plain field`);
  }
  return plain(element.column.name);
}

// ---------------------------------------------------------------------------
// Server-side push: filter / sort / limit become GraphQL arguments
// ---------------------------------------------------------------------------

const CMP_OPS: Partial<Record<ComparisonOperator, string>> = {
  [ComparisonOperator.EQUAL]: '_eq',
  [ComparisonOperator.NOT_EQUAL]: '_neq',
  [ComparisonOperator.LESS_THAN]: '_lt',
  [ComparisonOperator.GREATER_THAN]: '_gt',
  [ComparisonOperator.LESS_THAN_OR_EQUAL_TO]: '_lte',
  [ComparisonOperator.GREATER_THAN_OR_EQUAL_TO]: '_gte',
  [ComparisonOperator.LIKE]: '_like',
  [ComparisonOperator.NOT_LIKE]: '_nlike',
};

/** A LIKE pattern in the escape convention of the model (`!`) in the server's (backslash). */
export function likeForServer(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === LIKE_ESCAPE && i + 1 < pattern.length) {
      out += (pattern[i + 1] === LIKE_ESCAPE ? '' : '\\') + pattern[i + 1];
      i++;
    } else {
      out += c === '\\' ? '\\\\' : c;
    }
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Serialize a plain value (a relation filter) to an inline GraphQL argument literal. */
function gqlLiteral(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Serialize a constant to an inline GraphQL argument literal. */
function gqlValue(constant: ConstantOperation): string {
  if (constant instanceof DateConstantOperation) return `"${formatDate(constant.value)}"`;
  if (constant instanceof DateTimeConstantOperation) return `"${constant.value.toISOString()}"`;
  const value = (constant as unknown as { value: unknown }).value;
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Wrap inner in the object path for a nested field: "a.b" gives "{ a: { b: inner } }". */
function nest(field: string, inner: string): string {
  return field.split('.').reverse().reduce((out, part) => `{ ${part}: ${out} }`, inner);
}

/** Translate a filter to a GraphQL where-object. Throws if any part cannot be expressed. */
function opToWhereClause(op: RelationalOperationElement | null | undefined): string | null {
  if (op == null || op instanceof NoOperation) return null;
  if (op instanceof ComparisonOperation) {
    const gqlOp = CMP_OPS[op.operator];
    if (gqlOp === undefined) throw new GraphQLPushdownError(`Cannot push comparison ${op.operator} to the server`);
    const field = fieldName(op.left, 'a filter');
    if (!(op.right instanceof ConstantOperation)) {
      throw new GraphQLPushdownError('Cannot push a filter comparing two fields to the server');
    }
    const isLike = op.operator === ComparisonOperator.LIKE || op.operator === ComparisonOperator.NOT_LIKE;
    const value = isLike && op.right instanceof StringConstantOperation
      ? new StringConstantOperation(likeForServer(op.right.value))
      : op.right;
    return nest(field, `{ ${gqlOp}: ${gqlValue(value)} }`);
  }
  if (op instanceof LogicalOperation) {
    const left = opToWhereClause(op.left);
    const right = opToWhereClause(op.right);
    const logical = op.operator === LogicalOperator.AND ? '_and' : '_or';
    return `{ ${logical}: [${left}, ${right}] }`;
  }
  if (op instanceof InOperation || op instanceof NotInOperation) {
    const field = fieldName(op.element, 'a filter');
    const values = op.values.map(gqlValue).join(', ');
    if (op instanceof InOperation) return nest(field, `{ _in: [${values}] }`);
    const notIn = nest(field, `{ _nin: [${values}] }`);
    // a server's _nin skips nulls as SQL does, so a nullable field has to match its nulls explicitly
    if ((op.element as ColumnWithJoin).column.nullable) return `{ _or: [${notIn}, ${nest(field, '{ _is_null: true }')}] }`;
    return notIn;
  }
  if (op instanceof IsNullOperation) return nest(fieldName(op.element, 'a null check'), '{ _is_null: true }');
  if (op instanceof IsNotNullOperation) return nest(fieldName(op.element, 'a null check'), '{ _is_null: false }');
  throw new GraphQLPushdownError(`Cannot push ${op.constructor.name} to the server`);
}

/** Translate the sorts to a GraphQL order-by array. Throws if any part cannot be expressed. */
function toOrderByClause(orderBy: SortOperation[] | undefined): string | null {
  if (!orderBy || orderBy.length === 0) return null;
  const parts = orderBy.map(so => {
    if (!(so instanceof SortOperation)) {
      throw new GraphQLPushdownError(`Cannot push sort by ${(so as object).constructor.name} to the server`);
    }
    if (isMany(so.column)) {
      throw new GraphQLPushdownError(
        'Cannot push a sort on a to-many relation to the server: select the column too');
    }
    return nest(fieldName(so.column, 'a sort'), so.direction === SortDirection.ASC ? 'asc' : 'desc');
  });
  return `[${parts.join(', ')}]`;
}

/** The GraphQL query arguments for the filter, sort and limit, using the endpoint's filter convention. */
export function buildServerArgs(
  op: RelationalOperationElement | null | undefined,
  orderBy: SortOperation[] | undefined,
  limit: number | undefined,
  convention: GraphQLFilterConvention | undefined,
): string[] {
  const where = opToWhereClause(op);
  const orderByStr = toOrderByClause(orderBy);
  if (where === null && orderByStr === null && limit === undefined) return [];
  if (!convention) {
    throw new GraphQLPushdownError(
      'The endpoint declares no filter convention, so filters, sorts and limits cannot be pushed to the server');
  }
  const args: string[] = [];
  if (where) args.push(`${convention.filterArg}: ${where}`);
  if (orderByStr) args.push(`${convention.sortArg}: ${orderByStr}`);
  if (limit !== undefined) args.push(`${convention.limitArg}: ${limit}`);
  return args;
}

// ---------------------------------------------------------------------------
// To-many relations
// ---------------------------------------------------------------------------

/** The field paths a filter refers to, with to-many markers. */
function opRawNames(op: RelationalOperationElement | null | undefined): Set<string> {
  if (op instanceof ComparisonOperation && op.left instanceof ColumnWithJoin) return new Set([op.left.column.name]);
  if (op instanceof LogicalOperation) return new Set([...opRawNames(op.left), ...opRawNames(op.right)]);
  if ((op instanceof IsNullOperation || op instanceof IsNotNullOperation ||
       op instanceof InOperation || op instanceof NotInOperation) && op.element instanceof ColumnWithJoin) {
    return new Set([op.element.column.name]);
  }
  return new Set();
}

/** The plain path to the first to-many relation on a field path, or null. */
function relationOf(raw: string): string | null {
  const names: string[] = [];
  for (const seg of parseFieldPath(raw)) {
    names.push(seg.name);
    if (seg.many) return names.join('.');
  }
  return null;
}

/** Whether the rows are expanded by a to-many relation, throwing if the server cannot answer the query as is. */
export function checkExpansion(
  op: RelationalOperationElement | null | undefined,
  columns: (Attribute | RelationalOperationElement)[],
  limit: number | undefined,
): boolean {
  const selected = columns.map(rawName);
  const expands = selected.some(raw => relationOf(raw) !== null);
  if (expands && limit !== undefined) {
    throw new GraphQLUnsupportedError(
      'A limit cannot be pushed to the server for rows expanded by a to-many relation');
  }
  // a server filters the parents on a to-many condition but returns all of their children
  for (const raw of opRawNames(op)) {
    const relation = relationOf(raw);
    if (relation === null) continue;
    if (selected.some(sel => plain(sel).startsWith(relation + '.'))) {
      throw new GraphQLUnsupportedError(
        `Cannot filter and select the same to-many relation (${relation}): ` +
        "the server returns all of a matching parent's children");
    }
  }
  return expands;
}

type FlatRow = Record<string, unknown>;

/**
 * Flatten a nested row into dotted keys. A to-many relation expands the row into one row per child, as a
 * join does, or into a single row without the relation's fields when it has no children.
 */
export function flattenRows(row: Record<string, unknown>, prefix = ''): FlatRow[] {
  let rows: FlatRow[] = [{}];
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k;
    let children: FlatRow[];
    if (Array.isArray(v)) {
      children = v.flatMap(item => flattenRows(item as Record<string, unknown>, key));
      if (children.length === 0) children = [{}];
    } else if (v !== null && typeof v === 'object') {
      children = flattenRows(v as Record<string, unknown>, key);
    } else {
      children = [{ [key]: v }];
    }
    rows = rows.flatMap(r => children.map(c => ({ ...r, ...c })));
  }
  return rows;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : (a as number | string) > (b as number | string) ? 1 : 0;
}

/** Sort rows that a to-many relation expanded: the server can only order the parents. */
export function sortExpanded(rows: FlatRow[], orderBy: SortOperation[]): FlatRow[] {
  const keys = orderBy.map(so => {
    const field = fieldName(so.column, 'a sort');
    if (!rows.some(r => field in r)) {
      throw new GraphQLUnsupportedError('Rows expanded by a to-many relation can only be sorted by selected columns');
    }
    return { field, sign: so.direction === SortDirection.ASC ? 1 : -1 };
  });
  return [...rows].sort((a, b) => {
    for (const { field, sign } of keys) {
      const c = compareValues(a[field], b[field]);
      if (c !== 0) return sign * c;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// GraphQL request helpers
// ---------------------------------------------------------------------------

interface FieldNode {
  children: Map<string, FieldNode>;
  many: boolean;
  filters?: Record<string, unknown>;
}

function filtersToWhere(filters: Record<string, unknown>): string {
  const conditions = Object.entries(filters).map(([name, value]) => `{ ${name}: { _eq: ${gqlLiteral(value)} } }`);
  return conditions.length === 1 ? conditions[0] : `{ _and: [${conditions.join(', ')}] }`;
}

/**
 * The selection set for the columns: "account.branch.city" selects city inside branch inside account.
 * A relation navigated with filters takes them as a where argument.
 */
export function buildFieldsStr(
  columns: (Attribute | RelationalOperationElement)[],
  convention?: GraphQLFilterConvention,
): string {
  const root = new Map<string, FieldNode>();
  for (const col of columns) {
    let children = root;
    for (const seg of parseFieldPath(rawName(col))) {
      let node = children.get(seg.name);
      if (!node) children.set(seg.name, node = { children: new Map(), many: seg.many });
      node.many = seg.many;
      if (node.filters === undefined) node.filters = seg.filters;
      else if (JSON.stringify(node.filters) !== JSON.stringify(seg.filters)) {
        throw new GraphQLUnsupportedError(`The relation ${seg.name} is selected with different filters`);
      }
      children = node.children;
    }
  }

  const render = (children: Map<string, FieldNode>): string => [...children].map(([name, node]) => {
    let args = '';
    if (node.filters && Object.keys(node.filters).length > 0) {
      if (!node.many) {
        throw new GraphQLPushdownError(
          `Cannot filter the to-one relation ${name} on the server: only a list can take a where argument`);
      }
      if (!convention) {
        throw new GraphQLPushdownError(
          'The endpoint declares no filter convention, so a relation cannot be filtered on the server');
      }
      args = `(${convention.filterArg}: ${filtersToWhere(node.filters)})`;
    }
    return node.children.size > 0 ? `${name}${args} { ${render(node.children)} }` : `${name}${args}`;
  }).join(' ');

  return render(root);
}

function buildTemporalArgs(
  businessDate: Date | null,
  processingDatetime: Date | null,
  milestone: GraphQLQuery['milestone'],
): string[] {
  if (!milestone) return [];
  const args: string[] = [];
  if (milestone instanceof GraphQLBiTemporalMilestone) {
    if (businessDate) args.push(`${milestone.businessDateArgument}: "${formatDate(businessDate)}"`);
    if (processingDatetime) args.push(`${milestone.processingArgument}: "${processingDatetime.toISOString()}"`);
  } else if (milestone instanceof GraphQLBusinessDateMilestone) {
    if (businessDate) args.push(`${milestone.argumentName}: "${formatDate(businessDate)}"`);
  } else if (milestone instanceof GraphQLProcessingMilestone) {
    if (processingDatetime) args.push(`${milestone.argumentName}: "${processingDatetime.toISOString()}"`);
  }
  return args;
}

async function fetchRows(
  query: GraphQLQuery,
  fieldsStr: string,
  businessDate: Date | null,
  processingDatetime: Date | null,
  timeoutMs: number,
  serverArgs: string[],
): Promise<Record<string, unknown>[]> {
  const argParts = [...buildTemporalArgs(businessDate, processingDatetime, query.milestone), ...serverArgs];
  const args = argParts.length > 0 ? `(${argParts.join(', ')})` : '';
  const queryStr = `{ ${query.name}${args} { ${fieldsStr} } }`;

  let response: Response;
  try {
    response = await fetch(query.endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryStr }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new QueryTimeoutError(timeoutMs);
    throw e;
  }

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { data?: Record<string, Record<string, unknown>[]>; errors?: unknown };
  if (result.errors) throw new Error(`GraphQL server returned errors: ${JSON.stringify(result.errors)}`);
  return result.data?.[query.name] ?? [];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class GraphQLConnect implements QueryRunner {
  /** Display names of the columns of the last query that returned. */
  lastColumns: string[] = [];

  async select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    selected: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy?: SortOperation[],
    groupBy?: Attribute[],
    limit?: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    businessDateTo: Date | null = null,
  ): Promise<Row[]> {
    // an alias only names the column in the result: read the column, then name it
    const columns = selected.map(c => c instanceof Alias ? c.element : c);
    const query = table as GraphQLQuery;
    // validates that every column is a plain field before anything is sent
    const fieldsStr = buildFieldsStr(columns, query.endpoint.filterConvention);
    if (groupBy && groupBy.length > 0) {
      throw new GraphQLClientComputationError('The GraphQL runner does not support group by: aggregation is not computed on the client');
    }

    const isDateRange = businessDateTo !== null && businessDate !== null;
    if (isDateRange && ((orderBy?.length ?? 0) > 0 || limit !== undefined)) {
      throw new GraphQLPushdownError(
        'A sort or limit cannot be pushed to the server for a date range: each date is a separate query');
    }

    const expands = checkExpansion(op, columns, limit);
    // the server can only order the parents, so rows expanded by a to-many relation are sorted afterwards
    const sortAfter = expands && (orderBy ?? []).some(so => isMany(so.column));
    const serverArgs = buildServerArgs(op, sortAfter ? undefined : orderBy, limit, query.endpoint.filterConvention);

    let rows: Record<string, unknown>[];
    if (isDateRange) {
      rows = [];
      for (let t = businessDate!.getTime(); t <= businessDateTo!.getTime(); t += DAY_MS) {
        rows.push(...await fetchRows(query, fieldsStr, new Date(t), processingDatetime, timeoutMs, serverArgs));
      }
    } else {
      rows = await fetchRows(query, fieldsStr, businessDate, processingDatetime, timeoutMs, serverArgs);
    }

    let flat = rows.flatMap(row => flattenRows(row));
    if (sortAfter) flat = sortExpanded(flat, orderBy ?? []);
    // a nested field is absent from every row when its parent object is null in all of them
    const fields = columns.map(c => plain(rawName(c)));
    this.lastColumns = selected.map(c => c instanceof Alias ? c.name : (c as Attribute).displayName());
    return flat.map(row => fields.map(f => row[f] ?? null));
  }
}
