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
  AggregateOperation,
  AggregateOperator,
  ScalarFunctionOperation,
  ScalarFunction,
  DateExtractOperation,
  DateArithmeticOperation,
  DateDiffOperation,
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

function sqlOperationToString(operation: RelationalOperationElement): string {
  if (operation instanceof TableAliasColumn) {
    return operation.tableAlias.alias + '.' + operation.column.name;
  }
  if (operation instanceof AggregateOperation) {
    const fn = AGGREGATE_SQL_NAMES[operation.operator] ?? operation.operator;
    return fn + '(' + sqlOperationToString(operation.element) + ')';
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

function buildQueryOperation(
  businessDate: Date | null,
  processingDatetime: Date | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: Table,
  op: RelationalOperationElement,
  orderBy: SortOperation[] = [],
  groupBy: Attribute[] = [],
  limit?: number,
): SelectOperation {
  let filter = op;

  if (table instanceof MilestonedTable) {
    const milestonedOp = buildMilestoningFilterOperation(businessDate, processingDatetime, table);
    if (milestonedOp !== null) {
      filter = filter instanceof NoOperation
        ? milestonedOp
        : new LogicalOperation(filter, LogicalOperator.AND, milestonedOp);
    }
  }

  const requiredJoins: JoinTreeNodeOperation[] = [];
  const requiredJoinIds = new Set<JoinTreeNodeOperation>();

  for (const col of columns) {
    if (col instanceof CountAllOperation) continue;
    let node: JoinTreeNodeOperation | undefined;
    if (col instanceof Attribute) {
      node = col.parent();
    } else {
      node = findColumn(col as RelationalOperationElement).parent;
    }
    if (node !== undefined && !requiredJoinIds.has(node)) {
      requiredJoinIds.add(node);
      requiredJoins.push(node);
    }
  }

  for (const node of requiredJoins) {
    if (node.join.target instanceof MilestonedTable) {
      const milestonedOp = buildMilestoningFilterOperation(businessDate, processingDatetime, node.join.target, node);
      if (milestonedOp !== null) {
        node.join.filter = milestonedOp;
      }
    }
  }

  return new SelectOperation(columns, filter, orderBy, groupBy, limit);
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

  generate(select: SelectOperation): void {
    this.processSelect(select.display);
    this._where = this.buildFilter(select.filter);
    this._groupByParts = select.groupBy.map(a => this._attrToColString(a));
    this._orderByParts = select.orderBy.map(s =>
      this.buildFilter(s.column) + (s.direction === SortDirection.ASC ? ' ASC' : ' DESC'),
    );
    this._limit = select.limit;
  }

  private _attrToColString(attr: Attribute): string {
    const node = attr.parent();
    const ta = this._tableAliasForTable(attr.owner(), node ?? attr.owner());
    return ta.alias + '.' + attr.column().name;
  }

  private processSelect(cols: (Attribute | RelationalOperationElement)[]): void {
    const requiredJoinIds = new Set<JoinTreeNodeOperation>();
    const requiredJoins: JoinTreeNodeOperation[] = [];

    const require = (node: JoinTreeNodeOperation | undefined) => {
      if (node !== undefined && !requiredJoinIds.has(node)) {
        requiredJoinIds.add(node);
        requiredJoins.push(node);
      }
    };

    for (const col of cols) {
      if (col instanceof Attribute) {
        const node = col.parent();
        let ta: TableAlias;
        if (node !== undefined) {
          require(node);
          ta = this._tableAliasForTable(col.owner(), node);
        } else {
          ta = this._tableAliasForTable(col.owner(), col.owner());
          this._from.add(ta);
        }
        this._select.push(new Alias(new TableAliasColumn(col.column(), ta), col.displayName()));
      } else if (col instanceof AggregateOperation) {
        const colNested = findColumn(col);
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          require(node);
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = col.displayName ?? col.operator + ' ' + colNested.column.name;
        this._select.push(new Alias(
          new AggregateOperation(new TableAliasColumn(colNested.column, ta), col.operator),
          alias,
        ));
      } else if (col instanceof ScalarFunctionOperation) {
        const colNested = findColumn(col);
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          require(node);
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = col.displayName ?? col.func + ' ' + colNested.column.name;
        this._select.push(new Alias(
          new ScalarFunctionOperation(new TableAliasColumn(colNested.column, ta), col.func, undefined, col.secondArg, col.extraArgs),
          alias,
        ));
      } else if (col instanceof DateExtractOperation || col instanceof DateArithmeticOperation || col instanceof DateDiffOperation) {
        const colNested = findColumn(col as RelationalOperationElement);
        const node = colNested.parent;
        let ta: TableAlias;
        if (node !== undefined) {
          require(node);
          ta = this._tableAliasForTable(colNested.column.owner!, node);
        } else {
          ta = this._tableAliasForTable(colNested.column.owner!, colNested.column.owner!);
          this._from.add(ta);
        }
        const alias = (col as DateExtractOperation).displayName ?? colNested.column.name;
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

    for (const node of requiredJoins) {
      this._addJoin(node);
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
      const node = op.parent;
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(op.column.owner!, node);
        this._addJoin(node);
      } else {
        ta = this._tableAliasForTable(op.column.owner!, op.column.owner!);
      }
      return ta.alias + '.' + op.column.name;
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
): string {
  const selectOp = buildQueryOperation(businessDate, processingDatetime, columns, table, op, orderBy, groupBy, limit);
  return selectSqlToString(selectOp);
}

export { buildQueryOperation, SelectOperation };
