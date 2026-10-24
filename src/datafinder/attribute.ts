import {
  Column,
  AggregateOperation,
  AggregateOperator,
  ColumnWithJoin,
  SortOperation,
  SortDirection,
  IsNullOperation,
  IsNotNullOperation,
  InOperation,
  NotInOperation,
  ConstantOperation,
  JoinTreeNodeOperation,
  Alias,
  WindowFunction,
  WindowFunctionOperation,
  WindowSpecification,
} from '../model/relational';

/** A value an attribute can be compared with in `isIn` / `isNotIn`. */
export type AttributeValue = string | number | boolean | Date;

export abstract class Attribute {
  private readonly _displayName: string;
  private readonly _column: Column;
  private readonly _owner: string;
  private readonly _parent?: JoinTreeNodeOperation;
  private readonly _embedded?: Attribute;

  constructor(
    displayName: string,
    columnName: string,
    columnDbType: string,
    owner: string,
    parent?: JoinTreeNodeOperation,
    embedded?: Attribute,
    nullable: boolean = true,
  ) {
    this._displayName = displayName;
    this._column = new Column(columnName, columnDbType, owner, false, nullable);
    this._owner = owner;
    this._parent = parent;
    this._embedded = embedded;
  }

  column(): Column { return this._column; }
  owner(): string { return this._owner; }
  parent(): JoinTreeNodeOperation | undefined { return this._parent; }
  displayName(): string { return this._displayName; }

  /** Alternate attribute on a flat column of the owning table, used in place of this one when its join is elided. */
  embedded(): Attribute | undefined { return this._embedded; }

  cwj(): ColumnWithJoin {
    return new ColumnWithJoin(this._column, this._parent, this._embedded?.cwj());
  }

  /** Count the number of non-null values. Use in a projection with `groupBy` to aggregate per group. */
  count(): AggregateOperation {
    return new AggregateOperation(
      this.cwj(),
      AggregateOperator.COUNT,
      this._displayName + ' Count',
    );
  }

  /** Name this column in the result: `f.price().sum().alias('Total')`. */
  alias(name: string): Alias {
    return new Alias(this, name);
  }

  /** Sort this attribute in ascending order. Pass to `orderBy` or a window function's `orderBy`. */
  ascending(): SortOperation {
    return new SortOperation(this.cwj(), SortDirection.ASC);
  }

  /** Sort this attribute in descending order. Pass to `orderBy` or a window function's `orderBy`. */
  descending(): SortOperation {
    return new SortOperation(this.cwj(), SortDirection.DESC);
  }

  /** Filter to rows where this attribute has no value. */
  isNull(): IsNullOperation {
    return new IsNullOperation(this.cwj());
  }

  /** Filter to rows where this attribute has a value. */
  isNotNull(): IsNotNullOperation {
    return new IsNotNullOperation(this.cwj());
  }

  /** Wrap a value as a constant of this attribute's type. Overridden by the typed attributes. */
  protected toConstant(_value: AttributeValue): ConstantOperation {
    throw new TypeError(`${this.constructor.name} does not support isIn / isNotIn`);
  }

  private _constants(values: readonly AttributeValue[]): ConstantOperation[] {
    const constants = values.map(v => this.toConstant(v));
    if (constants.length === 0) throw new Error('isIn / isNotIn need at least one value');
    return constants;
  }

  /** Filter to rows where this attribute equals any of `values`. */
  isIn(values: readonly AttributeValue[]): InOperation {
    return new InOperation(this.cwj(), this._constants(values));
  }

  /** Filter to rows where this attribute equals none of `values`. Rows with no value are excluded, as in SQL. */
  isNotIn(values: readonly AttributeValue[]): NotInOperation {
    return new NotInOperation(this.cwj(), this._constants(values));
  }

  private _windowSpec(
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[],
    orderBy?: SortOperation | SortOperation[],
  ): WindowSpecification {
    const pbArr = partitionBy === undefined ? [] : Array.isArray(partitionBy) ? partitionBy : [partitionBy];
    const pb = pbArr.map(x => x instanceof Attribute ? x.cwj() : x);
    const ob = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return new WindowSpecification(pb, ob);
  }

  /**
   * Assign a rank to each row within the ordered window, following pandas `Series.rank` conventions.
   *
   * `method` controls tie-breaking (default `'min'`):
   * - `'min'`   — tied rows share the lowest rank; the next rank skips.
   * - `'dense'` — like `'min'` but ranks are contiguous (no gaps).
   * - `'first'` — each row gets a unique sequential integer (no ties).
   * - `'max'`   — only meaningful with `pct: true` (see below).
   *
   * When `pct: true` the result is a relative rank between 0 and 1:
   * - `method: 'min'` (default) → fraction of values strictly below this row (PERCENT_RANK).
   * - `method: 'max'` → fraction of values at or below this row (cumulative distribution).
   *
   * `partitionBy` restarts the ranking within each group of distinct values.
   */
  rank(opts: {
    method?: 'min' | 'dense' | 'first' | 'max';
    pct?: boolean;
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    const { method = 'min', pct = false, partitionBy, orderBy } = opts;
    let func: WindowFunction;
    let name: string;
    if (pct) {
      if (method === 'max') { func = WindowFunction.CUME_DIST; name = 'Cume Dist'; }
      else { func = WindowFunction.PERCENT_RANK; name = 'Percent Rank'; }
    } else if (method === 'first') { func = WindowFunction.ROW_NUMBER; name = 'Row Number'; }
    else if (method === 'dense') { func = WindowFunction.DENSE_RANK; name = 'Dense Rank'; }
    else { func = WindowFunction.RANK; name = 'Rank'; }
    return new WindowFunctionOperation(null, func, name, undefined, [], this._windowSpec(partitionBy, orderBy));
  }

  /**
   * Split rows into `buckets` equal-sized quantile bins ordered by `orderBy`.
   * Each row receives a bucket number from 1 (lowest) to `buckets` (highest).
   * Named after `pandas.qcut`.
   */
  qcut(buckets: number, opts: {
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(null, WindowFunction.NTILE, 'Quantile', buckets, [],
      this._windowSpec(opts.partitionBy, opts.orderBy));
  }

  /**
   * Return the value of this attribute from `periods` rows earlier (positive) or later (negative)
   * within the ordered window, following `pandas.Series.shift`.
   * Rows with no neighbour at the given offset return `null` (or `fillValue` if provided).
   */
  shift(periods = 1, opts: {
    fillValue?: string | number;
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    const extraArgs: (string | number)[] = opts.fillValue !== undefined ? [opts.fillValue] : [];
    const func = periods >= 0 ? WindowFunction.LAG : WindowFunction.LEAD;
    const label = periods >= 0 ? 'Lag' : 'Lead';
    return new WindowFunctionOperation(
      this.cwj(),
      func,
      label + ' ' + this._displayName,
      Math.abs(periods),
      extraArgs,
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }

  /**
   * Return the first value of this attribute in the window frame.
   * Use `partitionBy` to restart the frame for each group.
   */
  first(opts: {
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(
      this.cwj(),
      WindowFunction.FIRST_VALUE,
      'First ' + this._displayName,
      undefined, [],
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }

  /**
   * Return the last value of this attribute in the window frame.
   * Use `partitionBy` to restart the frame for each group.
   */
  last(opts: {
    partitionBy?: Attribute | ColumnWithJoin | (Attribute | ColumnWithJoin)[];
    orderBy?: SortOperation | SortOperation[];
  } = {}): WindowFunctionOperation {
    return new WindowFunctionOperation(
      this.cwj(),
      WindowFunction.LAST_VALUE,
      'Last ' + this._displayName,
      undefined, [],
      this._windowSpec(opts.partitionBy, opts.orderBy),
    );
  }
}
