import { RelationalOperationElement, LogicalOperation, LogicalOperator, JoinTreeNodeOperation } from '../model/relational';

export class ExistsOperation extends RelationalOperationElement {
  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  andOp(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }
}

export class NotExistsOperation extends RelationalOperationElement {
  constructor(readonly node: JoinTreeNodeOperation) { super(); }

  andOp(other: RelationalOperationElement): LogicalOperation {
    return new LogicalOperation(this, LogicalOperator.AND, other);
  }
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
