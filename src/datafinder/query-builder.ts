/**
 * Builds a finder query from a plain description, so a tool can ask without writing code: the columns to show, the
 * filters, the group by, the order and the dates. Paths walk the relations of the mapping's metadata, `account.branch.city`
 * being the property `city` of the class reached through `account` and then `branch`. Nothing here touches a database:
 * the result is a `FinderResult`, whose `toSql()` is what is sent and whose `toRows()` runs it on the registered runner.
 */
import { NoOperation, type Operation } from '../model/relational';
import type { Attribute } from './attribute';
import type { ClassMetadata, MappingMetadata, PropertyMetadata, PropertyType } from './metadata';
import type { FinderResult } from './runner';

export type AggregateName = 'sum' | 'average' | 'min' | 'max' | 'count' | 'countDistinct';

export type FilterOperator =
  | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'between'
  | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'isIn' | 'isNotIn' | 'isNull' | 'isNotNull' | 'isTrue' | 'isFalse';

export interface SelectSpec {
  path: string;
  /** Sum, count, ... of the property per group. */
  aggregate?: AggregateName;
  /** The name of the column in the result. */
  as?: string;
}

export interface FilterSpec {
  path: string;
  op: FilterOperator;
  /** The value to compare with: the lower bound for `between`, a list for `isIn`. */
  value?: unknown;
  /** The upper bound of `between`. */
  value2?: unknown;
}

export interface OrderSpec {
  path: string;
  aggregate?: AggregateName;
  direction?: 'asc' | 'desc';
}

export interface QuerySpec {
  /** The name of the class to start from. */
  root: string;
  select: SelectSpec[];
  where?: FilterSpec[];
  /** The properties to group by. With none, a query that sums or counts groups by the columns it shows as they are. */
  groupBy?: string[];
  orderBy?: OrderSpec[];
  limit?: number;
  /** The dates the query is read at: those of the milestoned classes it reaches. */
  dates?: { businessDate?: string | Date | null; processingTime?: string | Date | null };
}

/** A path that does not lead to a property, an operator the property's type does not have, and the like. */
export class QuerySpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuerySpecError';
  }
}

export interface OperatorInfo { op: FilterOperator; label: string; values: 0 | 1 | 2 | 'many' }

const TEXT_OPS: OperatorInfo[] = [
  { op: 'eq', label: 'is', values: 1 }, { op: 'ne', label: 'is not', values: 1 },
  { op: 'contains', label: 'contains', values: 1 }, { op: 'notContains', label: 'does not contain', values: 1 },
  { op: 'startsWith', label: 'starts with', values: 1 }, { op: 'endsWith', label: 'ends with', values: 1 },
  { op: 'isIn', label: 'is one of', values: 'many' }, { op: 'isNotIn', label: 'is none of', values: 'many' },
];
const ORDERED_OPS: OperatorInfo[] = [
  { op: 'eq', label: '=', values: 1 }, { op: 'ne', label: '≠', values: 1 },
  { op: 'gt', label: '>', values: 1 }, { op: 'gte', label: '≥', values: 1 },
  { op: 'lt', label: '<', values: 1 }, { op: 'lte', label: '≤', values: 1 },
  { op: 'between', label: 'between', values: 2 },
  { op: 'isIn', label: 'is one of', values: 'many' },
];
const NULL_OPS: OperatorInfo[] = [
  { op: 'isNull', label: 'is empty', values: 0 }, { op: 'isNotNull', label: 'is not empty', values: 0 },
];

/** The operators a filter on a property of this type can use, in the order to offer them. */
export function operatorsFor(type: PropertyType, optional = true): OperatorInfo[] {
  const base = type === 'String' ? TEXT_OPS
    : type === 'Boolean' ? [{ op: 'isTrue', label: 'is true', values: 0 }, { op: 'isFalse', label: 'is false', values: 0 }] as OperatorInfo[]
    : ORDERED_OPS;
  return optional ? [...base, ...NULL_OPS] : base;
}

const NUMERIC: PropertyType[] = ['Integer', 'Float', 'Double', 'Decimal'];

/** The aggregates a property of this type can have in a result. */
export function aggregatesFor(type: PropertyType): AggregateName[] {
  if (NUMERIC.includes(type)) return ['sum', 'average', 'min', 'max', 'count', 'countDistinct'];
  if (type === 'Boolean') return ['count', 'countDistinct'];
  return ['min', 'max', 'count', 'countDistinct'];
}

export const AGGREGATE_LABELS: Record<AggregateName, string> = {
  sum: 'Sum', average: 'Average', min: 'Min', max: 'Max', count: 'Count', countDistinct: 'Count Distinct',
};

/** Where a path leads: the relations walked on the way and the property at the end. */
export interface ResolvedPath {
  relations: { accessor: string; target: ClassMetadata }[];
  property: PropertyMetadata;
}

export function classOf(metadata: MappingMetadata, name: string): ClassMetadata {
  const found = metadata.classes.find(c => c.name === name);
  if (found === undefined) throw new QuerySpecError(`The mapping has no class '${name}'`);
  return found;
}

export function resolvePath(metadata: MappingMetadata, root: string, path: string): ResolvedPath {
  const steps = path.split('.');
  let current = classOf(metadata, root);
  const relations: ResolvedPath['relations'] = [];
  for (const step of steps.slice(0, -1)) {
    const relation = current.relations.find(r => r.id === step);
    if (relation === undefined) throw new QuerySpecError(`'${path}': ${current.name} has no relation '${step}'`);
    current = classOf(metadata, relation.target);
    relations.push({ accessor: relation.accessor, target: current });
  }
  const last = steps[steps.length - 1];
  const property = current.properties.find(p => p.id === last);
  if (property === undefined) throw new QuerySpecError(`'${path}': ${current.name} has no property '${last}'`);
  return { relations, property };
}

type Dynamic = Record<string, (...args: unknown[]) => unknown>;

/** Builds the query. `finder` is the finder of the spec's root class, as held by the mapping's context. */
export function buildQuery(finder: unknown, metadata: MappingMetadata, spec: QuerySpec): FinderResult {
  const root = classOf(metadata, spec.root);
  if (spec.select.length === 0) throw new QuerySpecError('Select at least one column');
  const dates = spec.dates === undefined ? undefined
    : { businessDate: spec.dates.businessDate ?? null, processingTime: spec.dates.processingTime ?? null };

  const attributeAt = (path: string): { attribute: Attribute; type: PropertyType; optional: boolean } => {
    const { relations, property } = resolvePath(metadata, spec.root, path);
    let current = finder as Dynamic;
    for (const step of relations) {
      current = current[step.accessor](undefined, step.target.dates === null ? undefined : dates) as Dynamic;
    }
    return { attribute: current[property.accessor]() as Attribute, type: property.type, optional: property.optional };
  };

  const aggregated = (attribute: Attribute, type: PropertyType, aggregate: AggregateName): unknown => {
    if (!aggregatesFor(type).includes(aggregate)) throw new QuerySpecError(`A ${type} property has no ${aggregate}`);
    return (attribute as unknown as Dynamic)[aggregate]();
  };

  const plain = spec.select.filter(s => s.aggregate === undefined).map(s => s.path);
  const hasAggregate = spec.select.some(s => s.aggregate !== undefined);
  const groupPaths = spec.groupBy !== undefined && spec.groupBy.length > 0 ? spec.groupBy : hasAggregate ? plain : [];
  for (const path of plain) {
    if (groupPaths.length > 0 && !groupPaths.includes(path)) {
      throw new QuerySpecError(`'${path}' is shown but neither grouped nor summarised`);
    }
  }

  const columns = spec.select.map(s => {
    const { attribute, type } = attributeAt(s.path);
    const element = (s.aggregate === undefined ? attribute : aggregated(attribute, type, s.aggregate)) as Attribute;
    const label = s.as ?? (s.aggregate === undefined ? undefined : `${AGGREGATE_LABELS[s.aggregate]} ${attribute.displayName()}`);
    return label === undefined ? element : element.alias(label);
  });

  let condition: Operation = new NoOperation();
  const filters = (spec.where ?? []).map(f => filterOperation(f, attributeAt(f.path)));
  for (const op of filters) condition = condition instanceof NoOperation ? op : condition.and(op) as Operation;

  const dynamicRoot = finder as Dynamic;
  const result = (root.dates === null
    ? dynamicRoot.findAll(columns, condition)
    : dynamicRoot.findAll(dates?.businessDate ?? null, dates?.processingTime ?? null, columns, condition)) as FinderResult;

  if (groupPaths.length > 0) result.groupBy(...groupPaths.map(p => attributeAt(p).attribute));
  if (spec.orderBy !== undefined && spec.orderBy.length > 0) {
    result.orderBy(...spec.orderBy.map(o => {
      const { attribute, type } = attributeAt(o.path);
      const element = (o.aggregate === undefined ? attribute : aggregated(attribute, type, o.aggregate)) as Attribute;
      return o.direction === 'desc' ? element.descending() : element.ascending();
    }));
  }
  if (spec.limit !== undefined) result.limit(spec.limit);
  return result;
}

function coerce(type: PropertyType, value: unknown): unknown {
  if (NUMERIC.includes(type)) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (String(value).trim() === '' || Number.isNaN(n)) throw new QuerySpecError(`'${String(value)}' is not a number`);
    return n;
  }
  if (type === 'Boolean') return value === true || String(value).toLowerCase() === 'true';
  return typeof value === 'string' || value instanceof Date ? value : String(value);
}

function filterOperation(f: FilterSpec, target: { attribute: Attribute; type: PropertyType; optional: boolean }): Operation {
  const { attribute, type } = target;
  const info = operatorsFor(type).find(o => o.op === f.op);
  if (info === undefined) throw new QuerySpecError(`A ${type} property cannot be filtered with ${f.op}`);
  const method = attribute as unknown as Dynamic;
  if (info.values === 0) return method[f.op]() as Operation;
  if (info.values === 'many') {
    const list = Array.isArray(f.value) ? f.value : String(f.value ?? '').split(',').map(v => v.trim()).filter(v => v !== '');
    if (list.length === 0) throw new QuerySpecError(`${f.op} needs at least one value`);
    return method[f.op](list.map(v => coerce(type, v))) as Operation;
  }
  if (f.op === 'between') {
    return (method.gte(coerce(type, f.value)) as Operation).and(method.lte(coerce(type, f.value2)) as Operation) as Operation;
  }
  return method[f.op](coerce(type, f.value)) as Operation;
}
