import { ExistsOperation, NotExistsOperation, JoinTreeNodeOperation } from '../model/relational';
import { titleCase } from './naming';

/**
 * The display-name prefix for a column reached through a join: the relation names from the root, so
 * `account().branch().city()` is "Account Branch City" and not just "Branch City".
 */
export function displayPrefix(relationName: string, parentJoin?: JoinTreeNodeOperation): string {
  const names = [relationName];
  for (let node = parentJoin; node !== undefined; node = node.parent) names.push(node.join.name);
  return names.reverse().map(titleCase).join(' ');
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
