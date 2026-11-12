import {
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
