import {
  Column,
  AggregateOperation,
  AggregateOperator,
  ColumnWithJoin,
  SortOperation,
  SortDirection,
  IsNullOperation,
  JoinTreeNodeOperation,
} from '../model/relational';

export abstract class Attribute {
  private readonly _displayName: string;
  private readonly _column: Column;
  private readonly _owner: string;
  private readonly _parent?: JoinTreeNodeOperation;

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
  ) {
    this._displayName = displayName;
    this._column = new Column(columnName, columnDbType, owner);
    this._owner = owner;
    this._parent = parent;
  }

  column(): Column { return this._column; }
  owner(): string { return this._owner; }
  parent(): JoinTreeNodeOperation | undefined { return this._parent; }
  displayName(): string { return this._displayName; }

  cwj(): ColumnWithJoin {
    return new ColumnWithJoin(this._column, this._parent);
  }

  count(): AggregateOperation {
    return new AggregateOperation(
      new ColumnWithJoin(this._column, this._parent),
      AggregateOperator.COUNT,
      this._displayName + ' Count',
    );
  }

  ascending(): SortOperation {
    return new SortOperation(new ColumnWithJoin(this._column, this._parent), SortDirection.ASC);
  }

  descending(): SortOperation {
    return new SortOperation(new ColumnWithJoin(this._column, this._parent), SortDirection.DESC);
  }

  isNull(): IsNullOperation {
    return new IsNullOperation(new ColumnWithJoin(this._column, this._parent));
  }
}
