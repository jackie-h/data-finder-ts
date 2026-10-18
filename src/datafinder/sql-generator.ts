import { Attribute } from './attribute';
import {
  RelationalOperationElement,
  Operation,
  NoOperation,
  ConstantOperation,
  StringConstantOperation,
  IntegerConstantOperation,
  FloatConstantOperation,
  DateConstantOperation,
  DateTimeConstantOperation,
  BooleanConstantOperation,
  DecimalConstantOperation,
  LogicalOperation,
  LogicalOperator,
  ComparisonOperation,
  ComparisonOperator,
  IsNullOperation,
  IsNotNullOperation,
  AggregateOperation,
  AggregateOperator,
  ScalarFunctionOperation,
  ScalarFunction,
  DateExtractOperation,
  DateArithmeticOperation,
  DateDiffOperation,
  WindowFunction,
  WindowFunctionOperation,
  WindowSpecification,
  Column,
  ColumnWithJoin,
  Table,
  JoinOperation,
  JoinTreeNodeOperation,
  SortOperation,
  SortDirection,
  CountAllOperation,
  UnaryOperation,
} from '../model/relational';
import {
  MilestonedTable,
  BiTemporalColumns,
  BusinessDateAndProcessingTemporalColumns,
  ProcessingTemporalColumns,
  SingleBusinessDateColumn,
} from '../model/milestoning';
import { DateAttribute, DateTimeAttribute } from './typed-attributes';
import { ExistsOperation, NotExistsOperation } from './finder';

class Alias {
  constructor(readonly element: RelationalOperationElement, readonly name: string) {}
}

class TableAlias {
  constructor(readonly table: string, readonly alias: string) {}
}

class TableAliasColumn extends RelationalOperationElement {
  constructor(readonly column: Column, readonly tableAlias: TableAlias) { super(); }
}

class Join {
  constructor(
    readonly source: TableAliasColumn,
    readonly target: TableAliasColumn,
    readonly filterOp?: RelationalOperationElement,
  ) {}
}

class SelectOperation {
  constructor(
    readonly display: (Attribute | RelationalOperationElement)[],
    readonly filter: RelationalOperationElement,
    readonly orderBy: SortOperation[] = [],
    readonly groupBy: Attribute[] = [],
    readonly limit?: number,
    readonly table?: Table,
  ) {}
}

function sqlFormatDatetime(value: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `'${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}'`;
}

function sqlFormatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `'${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}'`;
}

const LOGICAL_OPERATOR_STR: Record<LogicalOperator, string> = {
  [LogicalOperator.AND]: ' AND ',
  [LogicalOperator.OR]: ' OR ',
};

const COMPARISON_OPERATOR_STR: Record<ComparisonOperator, string> = {
  [ComparisonOperator.EQUAL]: ' = ',
  [ComparisonOperator.NOT_EQUAL]: ' <> ',
  [ComparisonOperator.LESS_THAN]: ' < ',
  [ComparisonOperator.GREATER_THAN]: ' > ',
  [ComparisonOperator.LESS_THAN_OR_EQUAL_TO]: ' <= ',
  [ComparisonOperator.GREATER_THAN_OR_EQUAL_TO]: ' >= ',
  [ComparisonOperator.LIKE]: ' LIKE ',
  [ComparisonOperator.NOT_LIKE]: ' NOT LIKE ',
};

const AGGREGATE_SQL_NAMES: Partial<Record<AggregateOperator, string>> = {
  [AggregateOperator.AVERAGE]: 'AVG',
};

const WINDOW_SQL_NAMES: Record<WindowFunction, string> = {
  [WindowFunction.ROW_NUMBER]: 'ROW_NUMBER',
  [WindowFunction.RANK]: 'RANK',
  [WindowFunction.DENSE_RANK]: 'DENSE_RANK',
  [WindowFunction.NTILE]: 'NTILE',
  [WindowFunction.LAG]: 'LAG',
  [WindowFunction.LEAD]: 'LEAD',
  [WindowFunction.FIRST_VALUE]: 'FIRST_VALUE',
  [WindowFunction.LAST_VALUE]: 'LAST_VALUE',
  [WindowFunction.CUME_DIST]: 'CUME_DIST',
  [WindowFunction.PERCENT_RANK]: 'PERCENT_RANK',
};

const SCALAR_SQL_NAMES: Record<ScalarFunction, string> = {
  [ScalarFunction.ABS]: 'ABS',
  [ScalarFunction.CEILING]: 'CEILING',
  [ScalarFunction.FLOOR]: 'FLOOR',
  [ScalarFunction.MOD]: 'MOD',
  [ScalarFunction.POWER]: 'POWER',
  [ScalarFunction.SQRT]: 'SQRT',
  [ScalarFunction.ROUND]: 'ROUND',
  [ScalarFunction.UPPER]: 'UPPER',
  [ScalarFunction.LOWER]: 'LOWER',
  [ScalarFunction.TRIM]: 'TRIM',
  [ScalarFunction.LTRIM]: 'LTRIM',
  [ScalarFunction.RTRIM]: 'RTRIM',
  [ScalarFunction.LENGTH]: 'LENGTH',
  [ScalarFunction.REVERSE]: 'REVERSE',
  [ScalarFunction.LEFT]: 'LEFT',
  [ScalarFunction.RIGHT]: 'RIGHT',
  [ScalarFunction.REPEAT]: 'REPEAT',
  [ScalarFunction.REPLACE]: 'REPLACE',
  [ScalarFunction.SUBSTRING]: 'SUBSTRING',
};

function constantValueString(op: ConstantOperation): string {
  if (op instanceof StringConstantOperation) return "'" + op.value + "'";
  if (op instanceof DateConstantOperation) return sqlFormatDate(op.value);
  if (op instanceof DateTimeConstantOperation) return sqlFormatDatetime(op.value);
  if (op instanceof IntegerConstantOperation) return String(op.value);
  if (op instanceof FloatConstantOperation) return String(op.value);
  if (op instanceof BooleanConstantOperation) return op.value ? 'TRUE' : 'FALSE';
  if (op instanceof DecimalConstantOperation) return String(op.value);
  throw new Error('Unknown constant operation');
}

function windowSpecToString(window: WindowSpecification): string {
  const parts: string[] = [];
  if (window.partitionBy.length > 0) {
    parts.push('PARTITION BY ' + window.partitionBy.map(p => sqlOperationToString(p)).join(', '));
  }
  if (window.orderBy.length > 0) {
    parts.push('ORDER BY ' + window.orderBy.map(s =>
      sqlOperationToString(s.column) + (s.direction === SortDirection.ASC ? ' ASC' : ' DESC'),
    ).join(', '));
  }
  return 'OVER (' + parts.join(' ') + ')';
}

function sqlOperationToString(operation: RelationalOperationElement): string {
  if (operation instanceof TableAliasColumn) {
    return operation.tableAlias.alias + '.' + operation.column.name;
  }
  if (operation instanceof WindowFunctionOperation) {
    const fn = WINDOW_SQL_NAMES[operation.func];
    const parts: string[] = [];
    if (operation.element !== null && operation.element !== undefined) {
      parts.push(sqlOperationToString(operation.element));
    }
    if (operation.secondArg !== undefined) parts.push(String(operation.secondArg));
    for (const arg of operation.extraArgs) {
      parts.push(typeof arg === 'string' ? "'" + arg + "'" : String(arg));
    }
    const sql = fn + '(' + parts.join(', ') + ')';
    return sql + (operation.window !== undefined ? ' ' + windowSpecToString(operation.window) : ' OVER ()');
  }
  if (operation instanceof AggregateOperation) {
    const fn = AGGREGATE_SQL_NAMES[operation.operator] ?? operation.operator;
    let sql = fn + '(' + sqlOperationToString(operation.element) + ')';
    if (operation.window !== undefined) {
      sql += ' ' + windowSpecToString(operation.window);
    }
    return sql;
  }
  if (operation instanceof ScalarFunctionOperation) {
    const fn = SCALAR_SQL_NAMES[operation.func];
    const parts: string[] = [sqlOperationToString(operation.element)];
    if (operation.secondArg !== undefined) parts.push(String(operation.secondArg));
    for (const arg of operation.extraArgs) {
      parts.push(typeof arg === 'string' ? "'" + arg + "'" : String(arg));
    }
    return fn + '(' + parts.join(', ') + ')';
  }
  if (operation instanceof DateExtractOperation) {
    return 'EXTRACT(' + operation.part + ' FROM ' + sqlOperationToString(operation.element) + ')';
  }
  if (operation instanceof DateArithmeticOperation) {
    const op = operation.isAdd ? '+' : '-';
    return sqlOperationToString(operation.element) + ' ' + op + ' INTERVAL ' + operation.n + ' ' + operation.unit;
  }
  if (operation instanceof DateDiffOperation) {
    const otherSql = sqlFormatDatetime(operation.other);
    return "DATE_DIFF('" + operation.unit.toLowerCase() + "', " + sqlOperationToString(operation.element) + ', ' + otherSql + ')';
  }
  if (operation instanceof CountAllOperation) return 'COUNT(*)';
  if (operation instanceof Alias) {
    return sqlOperationToString(operation.element) + ' AS "' + operation.name + '"';
  }
  throw new TypeError('Unknown operation in sqlOperationToString: ' + operation.constructor.name);
}

function embeddedOf(ref: Attribute | ColumnWithJoin): Attribute | ColumnWithJoin | undefined {
  return ref instanceof Attribute ? ref.embedded() : ref.embedded;
}

function findColumn(operation: RelationalOperationElement): ColumnWithJoin {
  if (operation instanceof UnaryOperation) return findColumn(operation.element);
  if (operation instanceof ColumnWithJoin) return operation;
  throw new TypeError('Cannot find ColumnWithJoin in: ' + operation.constructor.name);
}

function openEndClause(
  endAttr: DateTimeAttribute | DateAttribute,
  value: Date,
  infiniteDatetime?: string,
): Operation {
  const gtOp = endAttr instanceof DateTimeAttribute ? endAttr.gt(value) : endAttr.gt(value);
  if (infiniteDatetime === undefined) {
    const colRef = new ColumnWithJoin(endAttr.column(), endAttr.parent());
    return new LogicalOperation(gtOp, LogicalOperator.OR, new IsNullOperation(colRef));
  }
  return gtOp;
}

function buildMilestoningFilterOperation(
  businessDate: Date | null,
  processingDatetime: Date | null,
  table: MilestonedTable,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  const mc = table.milestoningColumns;
  const ops: Operation[] = [];

  if (mc instanceof BiTemporalColumns) {
    if (businessDate !== null) {
      const dateFrom = new DateAttribute('business_date_from', mc.businessDateFromColumn.name, mc.businessDateFromColumn.type, mc.businessDateFromColumn.table!.qualifiedName, joinNode);
      const dateTo = new DateAttribute('business_date_to', mc.businessDateToColumn.name, mc.businessDateToColumn.type, mc.businessDateToColumn.table!.qualifiedName, joinNode);
      ops.push(new LogicalOperation(dateFrom.lte(businessDate), LogicalOperator.AND, openEndClause(dateTo, businessDate, mc.infiniteDatetime)));
    }
    if (processingDatetime !== null) {
      const startAt = new DateTimeAttribute('start_at', mc.startAtColumn.name, mc.startAtColumn.type, mc.startAtColumn.table!.qualifiedName, joinNode);
      const endAt = new DateTimeAttribute('end_at', mc.endAtColumn.name, mc.endAtColumn.type, mc.endAtColumn.table!.qualifiedName, joinNode);
      ops.push(new LogicalOperation(startAt.lte(processingDatetime), LogicalOperator.AND, openEndClause(endAt, processingDatetime, mc.infiniteDatetime)));
    }
  } else if (mc instanceof BusinessDateAndProcessingTemporalColumns) {
    if (businessDate !== null) {
      const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.table!.qualifiedName, joinNode);
      ops.push(businessAtt.eq(businessDate));
    }
    if (processingDatetime !== null) {
      const startAt = new DateTimeAttribute('start_at', mc.startAtColumn.name, mc.startAtColumn.type, mc.startAtColumn.table!.qualifiedName, joinNode);
      const endAt = new DateTimeAttribute('end_at', mc.endAtColumn.name, mc.endAtColumn.type, mc.endAtColumn.table!.qualifiedName, joinNode);
      ops.push(new LogicalOperation(startAt.lte(processingDatetime), LogicalOperator.AND, openEndClause(endAt, processingDatetime, mc.infiniteDatetime)));
    }
  } else if (mc instanceof ProcessingTemporalColumns && processingDatetime !== null) {
    const startAt = new DateTimeAttribute('start_at', mc.startAtColumn.name, mc.startAtColumn.type, mc.startAtColumn.table!.qualifiedName, joinNode);
    const endAt = new DateTimeAttribute('end_at', mc.endAtColumn.name, mc.endAtColumn.type, mc.endAtColumn.table!.qualifiedName, joinNode);
    ops.push(new LogicalOperation(startAt.lte(processingDatetime), LogicalOperator.AND, openEndClause(endAt, processingDatetime, mc.infiniteDatetime)));
  } else if (mc instanceof SingleBusinessDateColumn && businessDate !== null) {
    const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.table!.qualifiedName, joinNode);
    ops.push(businessAtt.eq(businessDate));
  }

  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  return new LogicalOperation(ops[0], LogicalOperator.AND, ops[1]);
}

/**
 * Like buildMilestoningFilterOperation but applies a business-date range filter.
 *
 * Bitemporal tables use interval overlap:
 *   business_date_from_col <= businessDateTo AND business_date_to_col > businessDateFrom
 * Single-date tables:
 *   business_date >= businessDateFrom AND business_date <= businessDateTo
 * Processing-date filtering is point-in-time, as in the normal path.
 */
function buildMilestoningFilterOperationForDateRange(
  businessDateFrom: Date | null,
  businessDateTo: Date | null,
  processingDatetime: Date | null,
  table: MilestonedTable,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  const mc = table.milestoningColumns;
  const ops: Operation[] = [];
  const hasRange = businessDateFrom !== null && businessDateTo !== null;

  const processingOp = (m: BiTemporalColumns | BusinessDateAndProcessingTemporalColumns | ProcessingTemporalColumns): Operation => {
    const startAt = new DateTimeAttribute('start_at', m.startAtColumn.name, m.startAtColumn.type, m.startAtColumn.table!.qualifiedName, joinNode);
    const endAt = new DateTimeAttribute('end_at', m.endAtColumn.name, m.endAtColumn.type, m.endAtColumn.table!.qualifiedName, joinNode);
    return new LogicalOperation(startAt.lte(processingDatetime!), LogicalOperator.AND, openEndClause(endAt, processingDatetime!, m.infiniteDatetime));
  };

  if (mc instanceof BiTemporalColumns) {
    if (hasRange) {
      const dateFrom = new DateAttribute('business_date_from', mc.businessDateFromColumn.name, mc.businessDateFromColumn.type, mc.businessDateFromColumn.table!.qualifiedName, joinNode);
      const dateTo = new DateAttribute('business_date_to', mc.businessDateToColumn.name, mc.businessDateToColumn.type, mc.businessDateToColumn.table!.qualifiedName, joinNode);
      ops.push(new LogicalOperation(dateFrom.lte(businessDateTo!), LogicalOperator.AND, openEndClause(dateTo, businessDateFrom!, mc.infiniteDatetime)));
    }
    if (processingDatetime !== null) ops.push(processingOp(mc));
  } else if (mc instanceof BusinessDateAndProcessingTemporalColumns) {
    if (hasRange) {
      const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.table!.qualifiedName, joinNode);
      ops.push(new LogicalOperation(businessAtt.gte(businessDateFrom!), LogicalOperator.AND, businessAtt.lte(businessDateTo!)));
    }
    if (processingDatetime !== null) ops.push(processingOp(mc));
  } else if (mc instanceof ProcessingTemporalColumns) {
    if (processingDatetime !== null) ops.push(processingOp(mc));
  } else if (mc instanceof SingleBusinessDateColumn && hasRange) {
    const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.table!.qualifiedName, joinNode);
    ops.push(new LogicalOperation(businessAtt.gte(businessDateFrom!), LogicalOperator.AND, businessAtt.lte(businessDateTo!)));
  }

  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  return new LogicalOperation(ops[0], LogicalOperator.AND, ops[1]);
}

type RefVisitor = (ref: Attribute | ColumnWithJoin) => void;

/** Call `visit` for every Attribute/ColumnWithJoin referenced anywhere in `op`. */
function walkRefs(op: RelationalOperationElement | null | undefined, visit: RefVisitor): void {
  if (op === null || op === undefined) return;
  if (op instanceof Attribute || op instanceof ColumnWithJoin) {
    visit(op);
  } else if (op instanceof AggregateOperation) {
    walkRefs(op.element, visit);
    if (op.window) walkWindowSpec(op.window, visit);
  } else if (op instanceof WindowFunctionOperation) {
    if (op.element) walkRefs(op.element, visit);
    if (op.window) walkWindowSpec(op.window, visit);
  } else if (op instanceof ScalarFunctionOperation || op instanceof DateExtractOperation ||
             op instanceof DateArithmeticOperation || op instanceof DateDiffOperation) {
    walkRefs((op as UnaryOperation).element, visit);
  } else if (op instanceof SortOperation) {
    walkRefs(op.column, visit);
  } else if (op instanceof LogicalOperation || op instanceof ComparisonOperation) {
    walkRefs((op as any).left, visit);
    walkRefs((op as any).right, visit);
  }
}

function walkWindowSpec(window: WindowSpecification, visit: RefVisitor): void {
  for (const p of window.partitionBy) walkRefs(p, visit);
  for (const s of window.orderBy) walkRefs(s.column, visit);
}

/**
 * Translate property-equality filters given to a related finder (e.g. `ef.projects({ code: 'ALPHA' })`)
 * into a relational filter on the join node. `columnMap` maps property ids to [column, type, table].
 */
function buildJoinFilterFromProperties(
  node: JoinTreeNodeOperation,
  filter: Record<string, unknown>,
  columnMap: Record<string, [string, string, string]>,
): Operation {
  const ops: Operation[] = [];
  for (const [key, value] of Object.entries(filter)) {
    const entry = columnMap[key];
    if (entry === undefined) {
      throw new Error(`Unknown property '${key}' — valid properties are: ${Object.keys(columnMap).sort().join(', ')}`);
    }
    const [name, type, table] = entry;
    const col = new ColumnWithJoin(new Column(name, type, table), node);
    let constant: ConstantOperation;
    if (typeof value === 'boolean') constant = new BooleanConstantOperation(value);
    else if (typeof value === 'number') constant = Number.isInteger(value) ? new IntegerConstantOperation(value) : new FloatConstantOperation(value);
    else if (value instanceof Date) constant = type.toUpperCase() === 'DATE' ? new DateConstantOperation(value) : new DateTimeConstantOperation(value);
    else constant = new StringConstantOperation(String(value));
    ops.push(new ComparisonOperation(col, ComparisonOperator.EQUAL, constant));
  }
  return ops.reduce((acc, op) => new LogicalOperation(acc, LogicalOperator.AND, op));
}

function buildQueryOperation(
  businessDate: Date | null,
  processingDatetime: Date | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: Table,
  op: RelationalOperationElement,
  orderBy: SortOperation[] = [],
  groupBy: Attribute[] = [],
  limit?: number,
  businessDateTo: Date | null = null,
): SelectOperation {
  let filter = op;
  const milestoningFor = (t: MilestonedTable, node?: JoinTreeNodeOperation) =>
    businessDateTo !== null
      ? buildMilestoningFilterOperationForDateRange(businessDate, businessDateTo, processingDatetime, t, node)
      : buildMilestoningFilterOperation(businessDate, processingDatetime, t, node);

  if (table instanceof MilestonedTable) {
    const milestonedOp = milestoningFor(table);
    if (milestonedOp !== null) {
      filter = filter instanceof NoOperation
        ? milestonedOp
        : new LogicalOperation(filter, LogicalOperator.AND, milestonedOp);
    }
  }

  const requiredJoins = new Set<JoinTreeNodeOperation>();
  const collect: RefVisitor = ref => {
    const parent = ref instanceof Attribute ? ref.parent() : ref.parent;
    if (parent !== undefined) requiredJoins.add(parent);
  };
  for (const col of columns) walkRefs(col, collect);
  for (const expr of groupBy) walkRefs(expr, collect);
  for (const sort of orderBy) walkRefs(sort, collect);
  walkRefs(op, collect);

  for (const node of requiredJoins) {
    let combined: Operation | undefined;
    if (Object.keys(node.join.filterKwargs).length > 0) {
      combined = buildJoinFilterFromProperties(node, node.join.filterKwargs, node.join.filterColumnMap);
    }
    if (node.join.target instanceof MilestonedTable) {
      const milestonedOp = milestoningFor(node.join.target, node);
      if (milestonedOp !== null) {
        combined = combined === undefined ? milestonedOp : new LogicalOperation(combined, LogicalOperator.AND, milestonedOp);
      }
    }
    node.join.filter = combined;
  }

  return new SelectOperation(columns, filter, orderBy, groupBy, limit, table);
}

class SQLQueryGenerator {
  private _select: Alias[] = [];
  private _from: Set<TableAlias> = new Set();
  private _join: Join[] = [];
  private _groupByParts: string[] = [];
  private _orderByParts: string[] = [];
  private _where = '';
  private _limit?: number;
  private _tableAliasIncr = 0;
  private _tableAliasesByTable = new Map<unknown, TableAlias>();
  private _addedJoinIds = new Set<JoinTreeNodeOperation>();
  private _rootTable?: Table;
  private _elidableNodes = new Set<JoinTreeNodeOperation>();

  generate(select: SelectOperation): void {
    this._rootTable = select.table;
    this._elidableNodes = this._computeElidableNodes(select);
    if (this._rootTable !== undefined) {
      this._from.add(this._tableAliasForTable(this._rootTable.qualifiedName, this._rootTable.qualifiedName));
    }
    this.processSelect(select.display);
    this._where = this.buildFilter(select.filter);
    const groupByJoins = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();
    for (const expr of select.groupBy) {
      this._collectRequiredJoins(expr, groupByJoins);
    }
    for (const node of groupByJoins.values()) {
      this._addJoin(node);
    }
    this._groupByParts = select.groupBy.map(a => this._attrToColString(a));
    this._orderByParts = select.orderBy.map(s =>
      this.buildFilter(s.column) + (s.direction === SortDirection.ASC ? ' ASC' : ' DESC'),
    );
    this._limit = select.limit;
  }

  private _attrToColString(attr: Attribute): string {
    const { column, parent } = this._resolve(attr);
    const ta = this._tableAliasForTable(column.owner!, parent ?? column.owner!);
    return ta.alias + '.' + column.name;
  }

  private _collectRequiredJoins(op: RelationalOperationElement | null | undefined, out: Map<JoinTreeNodeOperation, JoinTreeNodeOperation>): void {
    walkRefs(op, ref => {
      const { parent } = this._resolve(ref);
      if (parent !== undefined) out.set(parent, parent);
    });
  }

  /**
   * Determine upfront which join nodes can be satisfied entirely by embedded (join-less) alternates:
   * a node is elidable when every reference to it has an embedded alternate. A reference without one
   * (e.g. a milestoning column) keeps the join for every reference to that node.
   */
  private _computeElidableNodes(select: SelectOperation): Set<JoinTreeNodeOperation> {
    const refsByNode = new Map<JoinTreeNodeOperation, (Attribute | ColumnWithJoin)[]>();
    const record = (ref: Attribute | ColumnWithJoin) => {
      const parent = ref instanceof Attribute ? ref.parent() : ref.parent;
      if (parent === undefined) return;
      const refs = refsByNode.get(parent);
      if (refs) refs.push(ref); else refsByNode.set(parent, [ref]);
    };
    for (const col of select.display) walkRefs(col, record);
    for (const expr of select.groupBy) walkRefs(expr, record);
    for (const sort of select.orderBy) walkRefs(sort, record);
    walkRefs(select.filter, record);

    const elidable = new Set<JoinTreeNodeOperation>();
    for (const [node, refs] of refsByNode) {
      if (refs.every(ref => embeddedOf(ref) !== undefined)) elidable.add(node);
    }
    return elidable;
  }

  /** The (column, parent) a reference should resolve to, substituting its embedded alternate when its join is elided. */
  private _resolve(ref: Attribute | ColumnWithJoin): { column: Column; parent?: JoinTreeNodeOperation } {
    const column = ref instanceof Attribute ? ref.column() : ref.column;
    const parent = ref instanceof Attribute ? ref.parent() : ref.parent;
    if (parent !== undefined && this._elidableNodes.has(parent)) {
      const embedded = embeddedOf(ref);
      if (embedded !== undefined) return this._resolve(embedded);
    }
    return { column, parent };
  }

  private _rewriteWindowSpec(window: WindowSpecification): WindowSpecification {
    const partitionBy = window.partitionBy.map(p => this._rewriteOperation(p));
    const orderBy = window.orderBy.map(s => new SortOperation(this._rewriteOperation(s.column) as ColumnWithJoin, s.direction));
    return new WindowSpecification(partitionBy, orderBy);
  }

  private _rewriteOperation(op: RelationalOperationElement): RelationalOperationElement {
    if (op instanceof Attribute || op instanceof ColumnWithJoin) {
      const { column, parent } = this._resolve(op);
      return new TableAliasColumn(column, this._tableAliasForTable(column.owner!, parent ?? column.owner!));
    }
    if (op instanceof Column) {
      const ta = this._tableAliasForTable(op.owner!, op.owner!);
      return new TableAliasColumn(op, ta);
    }
    if (op instanceof AggregateOperation) {
      return new AggregateOperation(
        this._rewriteOperation(op.element), op.operator, op.displayName,
        op.window ? this._rewriteWindowSpec(op.window) : undefined,
      );
    }
    if (op instanceof WindowFunctionOperation) {
      const el = op.element ? this._rewriteOperation(op.element) : null;
      return new WindowFunctionOperation(el, op.func, op.displayName, op.secondArg, [...op.extraArgs],
        op.window ? this._rewriteWindowSpec(op.window) : undefined);
    }
    if (op instanceof ScalarFunctionOperation) {
      return new ScalarFunctionOperation(this._rewriteOperation(op.element), op.func, op.displayName, op.secondArg, op.extraArgs);
    }
    if (op instanceof DateExtractOperation) {
      return new DateExtractOperation(this._rewriteOperation(op.element), op.part, op.displayName);
    }
    if (op instanceof DateArithmeticOperation) {
      return new DateArithmeticOperation(this._rewriteOperation(op.element), op.n, op.unit, op.isAdd, op.displayName);
    }
    if (op instanceof DateDiffOperation) {
      return new DateDiffOperation(this._rewriteOperation(op.element), (op as DateDiffOperation).other, (op as DateDiffOperation).unit, op.displayName);
    }
    return op;
  }

  private processSelect(cols: (Attribute | RelationalOperationElement)[]): void {
    const requiredJoins = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();

    for (const col of cols) {
      this._collectRequiredJoins(col, requiredJoins);
    }
    for (const node of requiredJoins.values()) {
      this._addJoin(node);
    }

    for (const col of cols) {
      if (col instanceof Attribute) {
        const { column, parent: node } = this._resolve(col);
        let ta: TableAlias;
        if (node !== undefined) {
          ta = this._tableAliasForTable(column.owner!, node);
        } else {
          ta = this._tableAliasForTable(column.owner!, column.owner!);
          this._from.add(ta);
        }
        this._select.push(new Alias(new TableAliasColumn(column, ta), col.displayName()));
      } else if (col instanceof WindowFunctionOperation) {
        const rewritten = this._rewriteOperation(col) as WindowFunctionOperation;
        let alias: string;
        if (col.displayName) {
          alias = col.displayName;
        } else if ([WindowFunction.ROW_NUMBER, WindowFunction.RANK, WindowFunction.DENSE_RANK].includes(col.func)) {
          alias = col.func.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        } else if (col.element) {
          alias = col.func + ' ' + findColumn(col).column.name;
        } else {
          alias = col.func;
        }
        this._select.push(new Alias(rewritten, alias));
      } else if (col instanceof AggregateOperation) {
        const colNested = this._resolve(findColumn(col));
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = col.displayName ?? col.operator + ' ' + findColumn(col).column.name;
        const rewrittenAgg = new AggregateOperation(
          new TableAliasColumn(colNested.column, ta), col.operator, undefined,
          col.window ? this._rewriteWindowSpec(col.window) : undefined,
        );
        this._select.push(new Alias(rewrittenAgg, alias));
      } else if (col instanceof ScalarFunctionOperation) {
        const colNested = this._resolve(findColumn(col));
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = col.displayName ?? col.func + ' ' + findColumn(col).column.name;
        this._select.push(new Alias(
          new ScalarFunctionOperation(new TableAliasColumn(colNested.column, ta), col.func, undefined, col.secondArg, col.extraArgs),
          alias,
        ));
      } else if (col instanceof DateExtractOperation || col instanceof DateArithmeticOperation || col instanceof DateDiffOperation) {
        const colNested = this._resolve(findColumn(col as RelationalOperationElement));
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = (col as DateExtractOperation).displayName ?? findColumn(col as RelationalOperationElement).column.name;
        let aliasedOp: RelationalOperationElement;
        if (col instanceof DateExtractOperation) {
          aliasedOp = new DateExtractOperation(new TableAliasColumn(colNested.column, ta), col.part);
        } else if (col instanceof DateArithmeticOperation) {
          aliasedOp = new DateArithmeticOperation(new TableAliasColumn(colNested.column, ta), col.n, col.unit, col.isAdd);
        } else {
          aliasedOp = new DateDiffOperation(new TableAliasColumn(colNested.column, ta), (col as DateDiffOperation).other, (col as DateDiffOperation).unit);
        }
        this._select.push(new Alias(aliasedOp, alias));
      } else if (col instanceof CountAllOperation) {
        const ta = this._tableAliasForTable(col.table, col.table);
        this._from.add(ta);
        this._select.push(new Alias(col, 'Count'));
      }
    }
  }

  private _addJoin(node: JoinTreeNodeOperation): void {
    if (this._addedJoinIds.has(node)) return;
    if (node.parent !== undefined) this._addJoin(node.parent);
    this._addedJoinIds.add(node);

    const join = node.join;
    const left = join.left;
    const srcTa = this._tableAliasForTable(left.owner!, node.parent ?? left.owner!);
    if (node.parent === undefined) this._from.add(srcTa);
    const sc = new TableAliasColumn(left, srcTa);
    const right = join.right;
    const tc = new TableAliasColumn(right, this._tableAliasForTable(right.owner!, node));
    this._join.push(new Join(sc, tc, join.filter));
  }

  buildFilter(op: RelationalOperationElement): string {
    if (op instanceof NoOperation) return '';
    if (op instanceof ExistsOperation) {
      const col = op.node.join.right;
      return this.buildFilter(new ColumnWithJoin(col, op.node)) + ' IS NOT NULL';
    }
    if (op instanceof NotExistsOperation) {
      const col = op.node.join.right;
      return this.buildFilter(new ColumnWithJoin(col, op.node)) + ' IS NULL';
    }
    if (op instanceof IsNotNullOperation) return this.buildFilter(op.element) + ' IS NOT NULL';
    if (op instanceof IsNullOperation) return this.buildFilter(op.element) + ' IS NULL';
    if (op instanceof LogicalOperation) {
      let left = this.buildFilter(op.left);
      let right = this.buildFilter(op.right);
      if (op.left instanceof LogicalOperation) left = '(' + left + ')';
      if (op.right instanceof LogicalOperation) right = '(' + right + ')';
      return left + LOGICAL_OPERATOR_STR[op.operator] + right;
    }
    if (op instanceof ComparisonOperation) {
      return this.buildFilter(op.left) + COMPARISON_OPERATOR_STR[op.operator] + this.buildFilter(op.right);
    }
    if (op instanceof ConstantOperation) return constantValueString(op);
    if (op instanceof ColumnWithJoin) {
      const { column, parent: node } = this._resolve(op);
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(column.owner!, node);
        this._addJoin(node);
      } else {
        ta = this._tableAliasForTable(column.owner!, column.owner!);
      }
      return ta.alias + '.' + column.name;
    }
    if (op instanceof Column) {
      const ta = this._tableAliasForTable(op.owner!, op.owner!);
      return ta.alias + '.' + op.name;
    }
    throw new Error('Unknown operation in buildFilter: ' + op.constructor.name);
  }

  private _tableAliasForTable(table: string, key: unknown): TableAlias {
    if (this._tableAliasesByTable.has(key)) {
      return this._tableAliasesByTable.get(key)!;
    }
    const ta = new TableAlias(table, 't' + this._tableAliasIncr++);
    this._tableAliasesByTable.set(key, ta);
    return ta;
  }

  buildQueryString(): string {
    const joins = this._join.map(j =>
      ' LEFT OUTER JOIN ' + j.target.tableAlias.table + ' AS ' + j.target.tableAlias.alias +
      ' ON ' + j.source.tableAlias.alias + '.' + j.source.column.name +
      ' = ' + j.target.tableAlias.alias + '.' + j.target.column.name +
      (j.filterOp ? ' AND ' + this.buildFilter(j.filterOp) : ''),
    );

    return 'SELECT ' + this._select.map(ca => sqlOperationToString(ca)).join(',') +
      ' FROM ' + Array.from(this._from).map(ta => ta.table + ' AS ' + ta.alias).join(',') +
      joins.join('') +
      this._buildWhere() +
      this._buildGroupBy() +
      this._buildOrderBy() +
      this._buildLimit();
  }

  private _buildWhere(): string {
    return this._where.length > 0 ? ' WHERE ' + this._where : '';
  }
  private _buildGroupBy(): string {
    return this._groupByParts.length > 0 ? ' GROUP BY ' + this._groupByParts.join(', ') : '';
  }
  private _buildOrderBy(): string {
    return this._orderByParts.length > 0 ? ' ORDER BY ' + this._orderByParts.join(', ') : '';
  }
  private _buildLimit(): string {
    return this._limit !== undefined ? ' LIMIT ' + this._limit : '';
  }
}

export function selectSqlToString(selectOperation: SelectOperation): string {
  const qg = new SQLQueryGenerator();
  qg.generate(selectOperation);
  return qg.buildQueryString();
}

export function toSql(
  businessDate: Date | null,
  processingDatetime: Date | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: Table,
  op: RelationalOperationElement,
  orderBy: SortOperation[] = [],
  groupBy: Attribute[] = [],
  limit?: number,
  businessDateTo: Date | null = null,
): string {
  const selectOp = buildQueryOperation(businessDate, processingDatetime, columns, table, op, orderBy, groupBy, limit, businessDateTo);
  return selectSqlToString(selectOp);
}

export { buildQueryOperation, SelectOperation };
