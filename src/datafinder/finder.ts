import { ExistsOperation, NotExistsOperation, JoinTreeNodeOperation } from '../model/relational';

// Defined in the relational model; re-exported so existing imports keep working.
export { ExistsOperation, NotExistsOperation };

export class RelatedFinder {
  constructor(private readonly _node: JoinTreeNodeOperation) {}

  exists(): ExistsOperation {
    return new ExistsOperation(this._node);
  }

  notExists(): NotExistsOperation {
    return new NotExistsOperation(this._node);
  }
}
