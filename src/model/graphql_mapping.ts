import { DateOnly, NamedRelation, RelationalOperationElement } from './relational';

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

/** A named query of a GraphQL endpoint: the relation its fields are read from. */
export class GraphQLQuery extends NamedRelation {
  constructor(
    name: string,
    readonly endpoint: GraphQLEndpoint,
    readonly milestone?: GraphQLMilestone,
  ) { super(name); }

  get columns(): readonly RelationalOperationElement[] { return []; }
}

export class GraphQLField {
  constructor(readonly name: string) {}
}

// ---------------------------------------------------------------------------
// Field paths
//
// A column's name is the path of GraphQL fields from the root query to the field, for example
// `manager.projects[]{"code":"ALPHA"}.name`. A segment ending in `[]` is a to-many relation, and a
// trailing JSON object holds the equality filters the relation was navigated with, and, under a name that
// starts with "@", the arguments it takes besides them: the dates it is read at, `{"@asOf":"2021-06-01"}`.
// ---------------------------------------------------------------------------

export interface PathSegment {
  name: string;
  many: boolean;
  filters: Record<string, unknown>;
  /** The arguments the relation takes besides its filters: the dates it is read at, by argument name. */
  args: Record<string, string>;
}

/** A segment's JSON holds its filters by field name and its arguments under a name that starts with "@". */
const ARG_PREFIX = '@';

export function formatPathSegment(
  name: string,
  many = false,
  filters: Record<string, unknown> = {},
  args: Record<string, string> = {},
): string {
  const content = {
    ...filters,
    ...Object.fromEntries(Object.entries(args).map(([key, value]) => [ARG_PREFIX + key, value])),
  };
  return name + (many ? '[]' : '') + (Object.keys(content).length > 0 ? JSON.stringify(content) : '');
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
    let content: Record<string, unknown> = {};
    if (path[i] === '{') {
      const end = endOfJsonObject(path, i);
      content = JSON.parse(path.slice(i, end));
      i = end;
    }
    const filters: Record<string, unknown> = {};
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(content)) {
      if (key.startsWith(ARG_PREFIX)) args[key.slice(ARG_PREFIX.length)] = value as string;
      else filters[key] = value;
    }
    segments.push({ name, many, filters, args });
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

/** The dates a navigation can be given: a date or timestamp, or text in the form the server reads. */
export type NavigationDate = Date | string;

/** A date as the text a query sends: a plain date for a processing time is midnight on that date. */
function argumentValue(value: NavigationDate, processing: boolean): string {
  if (typeof value === 'string') return value;
  const iso = value.toISOString();
  if (!processing) return iso.slice(0, 10);
  return value instanceof DateOnly ? iso.slice(0, 10) + 'T00:00:00' : iso;
}

/**
 * The arguments that read the relation `name` at a date, for the milestone of the query it reaches.
 *
 * Throws a TypeError for a date the query cannot take: a query with no milestone takes none, and one with only a
 * processing time takes no business date.
 */
export function temporalArguments(
  name: string,
  milestone: GraphQLMilestone | undefined,
  businessDate?: NavigationDate | null,
  processingTime?: NavigationDate | null,
): Record<string, string> {
  const args: Record<string, string> = {};
  if (businessDate !== undefined && businessDate !== null) {
    if (milestone instanceof GraphQLBiTemporalMilestone) {
      args[milestone.businessDateArgument] = argumentValue(businessDate, false);
    } else if (milestone instanceof GraphQLBusinessDateMilestone) {
      args[milestone.argumentName] = argumentValue(businessDate, false);
    } else {
      throw new TypeError(`${name} has no business date to be read at`);
    }
  }
  if (processingTime !== undefined && processingTime !== null) {
    if (milestone instanceof GraphQLBiTemporalMilestone) {
      args[milestone.processingArgument] = argumentValue(processingTime, true);
    } else if (milestone instanceof GraphQLProcessingMilestone) {
      args[milestone.argumentName] = argumentValue(processingTime, true);
    } else {
      throw new TypeError(`${name} has no processing time to be read at`);
    }
  }
  return args;
}

/**
 * The path segment for navigating an association with equality filters on the target's properties, read at the
 * dates given if the target query has a milestone.
 * `filters` are keyed by the target's TypeScript property names; `fields` maps those names to GraphQL field names.
 */
export function associationSegment(
  name: string,
  many: boolean,
  filters: Record<string, unknown>,
  fields: Record<string, string>,
  milestone?: GraphQLMilestone,
  dates?: { businessDate?: NavigationDate | null; processingTime?: NavigationDate | null },
): string {
  const unknown = Object.keys(filters).filter(k => !(k in fields)).sort();
  if (unknown.length > 0) {
    throw new TypeError(`Unknown filter ${unknown.join(', ')} for ${name}: expected one of ${Object.keys(fields).sort().join(', ')}`);
  }
  const args = temporalArguments(name, milestone, dates?.businessDate, dates?.processingTime);
  return formatPathSegment(name, many, Object.fromEntries(Object.entries(filters).map(([k, v]) => [fields[k], v])), args);
}
