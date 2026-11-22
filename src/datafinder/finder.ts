import {
  ColumnWithJoin, RelationalOperationElement,
  ExistsOperation, NotExistsOperation, JoinTreeNodeOperation, JoinOperation, Column, Table, TableAlias, LogicalOperation, LogicalOperator,
  Operation, Relation, JoinKind,
} from '../model/relational';
import { titleCase } from './naming';

/**
 * The display-name prefix for a column reached through a join: the relation names from the root, so
 * `account().branch().city()` is "Account Branch City" and not just "Branch City".
 */
export function displayPrefix(relationName: string, parentJoin?: JoinTreeNodeOperation): string {
  const names = [relationName];
  for (let node = parentJoin; node !== undefined; node = node.parent) names.push(node.join.name);
  return names.reverse().filter(name => name !== '').map(titleCase).join(' ');
}

export class RelatedFinder {
  constructor(private readonly _node: JoinTreeNodeOperation) {}

  exists(): ExistsOperation {
    return new ExistsOperation(this._node);
  }

  notExists(): NotExistsOperation {
    return new NotExistsOperation(this._node);
  }
}

/**
 * The dates a navigation is read at, when they are not the query's: `f.account(undefined, { processingTime: ... })`.
 * They are the ones used for the milestoned table it reaches and for every step below it unless it is given its own.
 */
export interface NavigationDates {
  businessDate?: Date | string | null;
  processingTime?: Date | string | null;
}

/**
 * The step a property mapped through other tables hangs from: `parent` followed by a step through each hop, a
 * [from column, table, to column] triple, in order. The tables carry no class, so the steps have no name. The dates the
 * property was given are those of each step through a table on the way, as they are of the step that follows.
 */
/** One side of a join of a table to itself, to say which of its columns a condition reads. */
export class JoinSide {
  constructor(private readonly relation: Relation) {}

  column(name: string, type: string): Column {
    return this.relation instanceof TableAlias ? this.relation.column(name, type) : new Column(name, type, this.relation);
  }
}

/**
 * What a join has besides its key columns: a condition over the columns of the two tables, which say which side they are on. A join
 * of a table to itself has the same table on both sides, so its condition is a function of the two sides,
 * `(plain, target) => ...`, as Legend's `personTable.MANAGERID = {target}.ID`: `plain` makes the columns of the table the join starts
 * from, and `target` those of the one it reaches.
 */
export type JoinCondition = Operation | ((plain: JoinSide, target: JoinSide) => Operation);

/**
 * `table` joined where its `target` column equals the `source` column of what is joined from, and where `condition` holds besides,
 * as Legend's join `firmTable.ID = personTable.FIRMID and firmTable.FLAG is null`. The condition reads the columns of the two
 * tables, which say which side they are on.
 *
 * A join of a table to itself has the same table on both sides, so its condition is a function of the two sides, as Legend's
 * `personTable.MANAGERID = {target}.ID`. `reverse` is that the join is followed from the other end, so the sides trade places.
 */
export function keysJoin(
  name: string, table: Table | TableAlias, source: Column, target: Column, kind: JoinKind, condition?: JoinCondition, reverse = false,
): JoinOperation {
  const join = JoinOperation.onKeys(name, table, source, target, kind);
  if (condition === undefined) return join;
  let resolved: Operation;
  if (typeof condition === 'function') {
    if (!(join.target instanceof TableAlias)) {
      throw new Error(`Join '${name}' joins ${table.name} to another table: its condition is not one of a self join`);
    }
    const parent = new JoinSide(source.ownerRelation);
    const joined = new JoinSide(join.target);
    resolved = reverse ? condition(joined, parent) : condition(parent, joined);
  } else if (join.target !== table) {
    throw new Error(`Join '${name}' joins ${table.name} to itself: its condition needs to say which side each column is on`);
  } else {
    resolved = condition;
  }
  return new JoinOperation(name, join.target, new LogicalOperation(join.operation, LogicalOperator.AND, resolved), kind);
}

export function viaJoins(
  parent: JoinTreeNodeOperation | undefined,
  hops: [Column, Table, Column, JoinCondition?][],
  businessDate: Date | null = null,
  processingDatetime: Date | null = null,
): JoinTreeNodeOperation | undefined {
  let node = parent;
  for (const [source, table, target, condition] of hops) {
    node = new JoinTreeNodeOperation(keysJoin('', table, source, target, JoinKind.LEFT, condition), node, false, true, businessDate, processingDatetime);
  }
  return node;
}

const identities = new WeakMap<object, number>();
let identityCount = 0;
/** A number for an object that is only equal to itself. */
function identityOf(value: object): number {
  const known = identities.get(value);
  if (known !== undefined) return known;
  identities.set(value, ++identityCount);
  return identityCount;
}

/**
 * What a condition says, apart from the objects that say it, so two conditions that say the same compare equal: the same operations over the
 * same columns of the same tables and the same values. A column of `own`, the navigation the condition is on, is "own" whichever copy of the
 * navigation it was written on; a column of any other step is that step, so a condition that reads another step is the same only as one that
 * reads that very step.
 */
function structureOf(value: unknown, own: JoinTreeNodeOperation, depth = 0): unknown {
  if (value instanceof ColumnWithJoin) {
    const relation = value.column.ownerRelation;
    return ['column', value.column.name, relation.constructor.name, (relation as { name?: string }).name ?? null,
      value.parent === own ? 'own' : value.parent === undefined ? null : identityOf(value.parent), structureOf(value.embedded, own, depth + 1)];
  }
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return ['date', value.getTime()];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return [typeof value, String(value)];
  if (Array.isArray(value)) return value.map(each => structureOf(each, own, depth + 1));
  if (value instanceof RelationalOperationElement && depth < 16) {
    return [value.constructor.name, Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, each]) => [name, structureOf(each, own, depth + 1)])];
  }
  return typeof value === 'object' ? ['object', identityOf(value)] : null;
}

/** The text of what the conditions say, to tell whether a navigation has been filtered by them before. */
export function conditionsKey(conditions: readonly Operation[], own: JoinTreeNodeOperation): string {
  return JSON.stringify(conditions.map(each => structureOf(each, own)));
}

/** The conditions all held: they are ANDed. */
export function allOf(conditions: readonly Operation[]): Operation {
  return conditions.reduce((left, right) => new LogicalOperation(left, LogicalOperator.AND, right));
}
