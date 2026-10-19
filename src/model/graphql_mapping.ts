/** The GraphQL argument names an endpoint uses for server-side push-down of filters, sorts and limits. */
export class GraphQLFilterConvention {
  constructor(
    readonly filterArg: string,  // e.g. "where", "filter"
    readonly sortArg: string,    // e.g. "order_by", "orderBy"
    readonly limitArg: string,   // e.g. "limit", "take", "first"
  ) {}
}

export class GraphQLEndpoint {
  constructor(
    readonly url: string,
    readonly filterConvention?: GraphQLFilterConvention,
  ) {}
}

export class GraphQLProcessingMilestone {
  constructor(readonly argumentName: string = 'asOf') {}
}

export class GraphQLBusinessDateMilestone {
  constructor(readonly argumentName: string = 'businessDate') {}
}

export class GraphQLBiTemporalMilestone {
  constructor(
    readonly businessDateArgument: string = 'businessDate',
    readonly processingArgument: string = 'asOf',
  ) {}
}

export type GraphQLMilestone =
  | GraphQLProcessingMilestone
  | GraphQLBusinessDateMilestone
  | GraphQLBiTemporalMilestone;

export class GraphQLQuery {
  constructor(
    readonly name: string,
    readonly endpoint: GraphQLEndpoint,
    readonly milestone?: GraphQLMilestone,
  ) {}
}

export class GraphQLField {
  constructor(readonly name: string) {}
}

// ---------------------------------------------------------------------------
// Field paths
//
// A column's name is the path of GraphQL fields from the root query to the field, for example
// `manager.projects[]{"code":"ALPHA"}.name`. A segment ending in `[]` is a to-many relation, and a
// trailing JSON object holds the equality filters the relation was navigated with.
// ---------------------------------------------------------------------------

export interface PathSegment {
  name: string;
  many: boolean;
  filters: Record<string, unknown>;
}

export function formatPathSegment(name: string, many = false, filters: Record<string, unknown> = {}): string {
  return name + (many ? '[]' : '') + (Object.keys(filters).length > 0 ? JSON.stringify(filters) : '');
}

/** The index just past the JSON object that starts at `start`. */
function endOfJsonObject(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Error(`Invalid field path ${JSON.stringify(text)}: unterminated filters`);
}

export function parseFieldPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    const name = /^[^.[{]+/.exec(path.slice(i))?.[0];
    if (name === undefined) throw new Error(`Invalid field path ${JSON.stringify(path)} at ${i}`);
    i += name.length;
    const many = path.startsWith('[]', i);
    if (many) i += 2;
    let filters: Record<string, unknown> = {};
    if (path[i] === '{') {
      const end = endOfJsonObject(path, i);
      filters = JSON.parse(path.slice(i, end));
      i = end;
    }
    segments.push({ name, many, filters });
    if (i < path.length) {
      if (path[i] !== '.') throw new Error(`Invalid field path ${JSON.stringify(path)} at ${i}`);
      i++;
    }
  }
  return segments;
}

/** The path of field names alone: the key a field has in a flattened row. */
export function plainFieldPath(path: string): string {
  return parseFieldPath(path).map(s => s.name).join('.');
}

/**
 * The path segment for navigating an association with equality filters on the target's properties.
 * `filters` are keyed by the target's TypeScript property names; `fields` maps those names to GraphQL field names.
 */
export function associationSegment(
  name: string,
  many: boolean,
  filters: Record<string, unknown>,
  fields: Record<string, string>,
): string {
  const unknown = Object.keys(filters).filter(k => !(k in fields)).sort();
  if (unknown.length > 0) {
    throw new TypeError(`Unknown filter ${unknown.join(', ')} for ${name}: expected one of ${Object.keys(fields).sort().join(', ')}`);
  }
  return formatPathSegment(name, many, Object.fromEntries(Object.entries(filters).map(([k, v]) => [fields[k], v])));
}
