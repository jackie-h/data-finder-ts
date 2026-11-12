import {
  ExistsOperation, NotExistsOperation, JoinTreeNodeOperation, JoinOperation, Column, Table, TableAlias, LogicalOperation, LogicalOperator,
  NamedRelation, Operation, Relation,
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

  column(name: string, type: string): Column { return new Column(name, type, this.relation); }
}

/**
 * What a join has besides its key columns: a condition over the columns of the two tables, which say which side they are on. A join
 * of a table to itself has the same table on both sides, so its condition is a function of the two sides,
 * `(plain, target) => ...`, as Legend's `personTable.MANAGERID = {target}.ID`: `plain` makes the columns of the table the join starts
 * from, and `target` those of the one it reaches.
 */
export type JoinCondition = Operation | ((plain: JoinSide, target: JoinSide) => Operation);

/** The name a join's `{target}` side is given when the table is joined to itself. */
export const TARGET_SIDE = '{target}';

function sameTable(a: Relation, b: Relation): boolean {
  return a === b || (a instanceof NamedRelation && b instanceof NamedRelation && a.qualifiedName === b.qualifiedName);
}

/**
 * Give a join its condition, ANDed into its ON beside its key columns. `reverse` is that the join is followed from the other
 * end, which matters only to a join of a table to itself: the sides trade places.
 */
export function applyJoinCondition(join: JoinOperation, condition: JoinCondition, reverse = false): void {
  const selfJoin = sameTable(join.left.ownerRelation, join.target);
  let resolved: Operation;
  if (typeof condition === 'function') {
    if (!selfJoin) throw new Error(`Join '${join.name}' joins ${join.target.name} to another table: its condition is not one of a self join`);
    const parent = new JoinSide(join.left.ownerRelation);
    const joined = new JoinSide(new TableAlias(join.target, TARGET_SIDE));
    resolved = reverse ? condition(joined, parent) : condition(parent, joined);
  } else {
    if (selfJoin) throw new Error(`Join '${join.name}' joins ${join.target.name} to itself: its condition needs to say which side each column is on`);
    resolved = condition;
  }
  join.filter = join.filter === undefined ? resolved : new LogicalOperation(join.filter, LogicalOperator.AND, resolved);
}

export function viaJoins(
  parent: JoinTreeNodeOperation | undefined,
  hops: [Column, Table, Column, JoinCondition?][],
  businessDate: Date | null = null,
  processingDatetime: Date | null = null,
): JoinTreeNodeOperation | undefined {
  let node = parent;
  for (const [source, table, target, condition] of hops) {
    const join = new JoinOperation('', table, source, target);
    if (condition !== undefined) applyJoinCondition(join, condition);
    node = new JoinTreeNodeOperation(join, node, false, true, businessDate, processingDatetime);
  }
  return node;
}
