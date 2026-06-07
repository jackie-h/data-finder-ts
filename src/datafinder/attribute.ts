import {
  Column,
  AggregateOperation,
  AggregateOperator,
  ColumnWithJoin,
  SortOperation,
  SortDirection,
  IsNullOperation,
  IsNotNullOperation,
  JoinTreeNodeOperation,
  WindowFunction,
  WindowFunctionOperation,
  WindowSpecification,
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

  isNotNull(): IsNotNullOperation {
    return new IsNotNullOperation(new ColumnWithJoin(this._column, this._parent));
  }

  private _windowSpec(
    partitionBy?: ColumnWithJoin | ColumnWithJoin[],
    orderBy?: SortOperation | SortOperation[],
  ): WindowSpecification {
    const pb = partitionBy === undefined ? [] : Array.isArray(partitionBy) ? partitionBy : [partitionBy];
    const ob = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return new WindowSpecification(pb, ob);
  }

  rank(opts: {
    method?: 'min' | 'dense' | 'first';
    pct?: boolean;
    partitionBy?: ColumnWithJoin | ColumnWithJoin[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    const { method = 'min', pct = false, partitionBy, orderBy } = opts;
    let func: WindowFunction;
    let name: string;
    if (pct) {
      if (method === 'max' as string) { func = WindowFunction.CUME_DIST; name = 'Cume Dist'; }
      else { func = WindowFunction.PERCENT_RANK; name = 'Percent Rank'; }
    } else if (method === 'first') { func = WindowFunction.ROW_NUMBER; name = 'Row Number'; }
    else if (method === 'dense') { func = WindowFunction.DENSE_RANK; name = 'Dense Rank'; }
    else { func = WindowFunction.RANK; name = 'Rank'; }
    return new WindowFunctionOperation(null, func, name, undefined, [], this._windowSpec(partitionBy, orderBy));
  }

  qcut(buckets: number, opts: {
    partitionBy?: ColumnWithJoin | ColumnWithJoin[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(null, WindowFunction.NTILE, 'Quantile', buckets, [],
      this._windowSpec(opts.partitionBy, opts.orderBy));
  }

  shift(periods = 1, opts: {
    fillValue?: string | number;
    partitionBy?: ColumnWithJoin | ColumnWithJoin[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    const extraArgs: (string | number)[] = opts.fillValue !== undefined ? [opts.fillValue] : [];
    const func = periods >= 0 ? WindowFunction.LAG : WindowFunction.LEAD;
    const label = periods >= 0 ? 'Lag' : 'Lead';
    return new WindowFunctionOperation(
      new ColumnWithJoin(this._column, this._parent),
      func,
      label + ' ' + this._displayName,
      Math.abs(periods),
      extraArgs,
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }

  first(opts: {
    partitionBy?: ColumnWithJoin | ColumnWithJoin[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(
      new ColumnWithJoin(this._column, this._parent),
      WindowFunction.FIRST_VALUE,
      'First ' + this._displayName,
      undefined, [],
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }

  last(opts: {
    partitionBy?: ColumnWithJoin | ColumnWithJoin[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(
      new ColumnWithJoin(this._column, this._parent),
      WindowFunction.LAST_VALUE,
      'Last ' + this._displayName,
      undefined, [],
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }
}
