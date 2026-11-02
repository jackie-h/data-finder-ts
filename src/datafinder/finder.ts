import { ExistsOperation, NotExistsOperation, JoinTreeNodeOperation, JoinOperation, Column, Table } from '../model/relational';
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
 * [from column, table, to column] triple, in order. The tables carry no class, so the steps have no name.
 */
export function viaJoins(parent: JoinTreeNodeOperation | undefined, hops: [Column, Table, Column][]): JoinTreeNodeOperation | undefined {
  let node = parent;
  for (const [source, table, target] of hops) {
    node = new JoinTreeNodeOperation(new JoinOperation('', table, source, target), node, false, true);
  }
  return node;
}
