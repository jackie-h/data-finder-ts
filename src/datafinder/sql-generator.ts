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
  InOperation,
  NotInOperation,
  NotOperation,
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
  DatePart,
  CountAllOperation,
  UnaryOperation,
  Alias,
  LIKE_ESCAPE,
  ExistsOperation,
  NotExistsOperation,
  QuerySpecification,
  OrderedQuerySpecification,
  BinaryOperation,
  CaseOperation,
  ConcatOperation,
  DateTruncOperation,
  ArithmeticOperation,
  ArithmeticOperator,
  containsAggregate,
  containsAggregateOrWindow,
  Relation,
  NamedRelation,
  TableAlias,
} from '../model/relational';
import {
  MilestonedTable,
  BiTemporalColumns,
  BusinessDateAndProcessingTemporalColumns,
  BusinessDateRangeColumns,
  MilestoningColumns,
  ProcessingTemporalColumns,
  SingleBusinessDateColumn,
  SingleProcessingDatetimeColumn,
  hasProcessingRange,
} from '../model/milestoning';
import { DateAttribute, DateTimeAttribute } from './typed-attributes';
import { DialectName, SqlDialect, dialectOf } from './dialect';

class TableAliasColumn extends RelationalOperationElement {
  constructor(readonly column: Column, readonly tableAlias: TableAlias) { super(); }
}

class Join {
  constructor(
    readonly source: TableAliasColumn,
    readonly target: TableAliasColumn,
    readonly filterOp?: RelationalOperationElement,
  ) {}

  /** `source = target`, written with the key column first as Legend writes a join defined as key = foreign key. */
  condition(): string {
    let [first, second] = [this.source, this.target];
    if (second.column.primaryKey && !first.column.primaryKey) [first, second] = [second, first];
    return first.tableAlias.name + '.' + first.column.name + ' = ' + second.tableAlias.name + '.' + second.column.name;
  }
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
  [ComparisonOperator.MATCHES]: ' MATCHES ',   // written by the dialect, see buildFilter
};

const AGGREGATE_SQL_NAMES: Partial<Record<AggregateOperator, string>> = {
  [AggregateOperator.AVERAGE]: 'AVG',
};

/**
 * Comparisons that are never true for a missing value. Legend guards these on an optional property with IS NOT NULL;
 * it does not guard `=` (which a missing value never matches either) or `<>`.
 */
const GUARDED_COMPARISONS = new Set<ComparisonOperator>([
  ComparisonOperator.LESS_THAN, ComparisonOperator.GREATER_THAN, ComparisonOperator.LESS_THAN_OR_EQUAL_TO,
  ComparisonOperator.GREATER_THAN_OR_EQUAL_TO, ComparisonOperator.LIKE,
]);

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
  [ScalarFunction.COALESCE]: 'COALESCE',
  [ScalarFunction.SIN]: 'SIN',
  [ScalarFunction.COS]: 'COS',
  [ScalarFunction.TAN]: 'TAN',
  [ScalarFunction.ASIN]: 'ASIN',
  [ScalarFunction.ACOS]: 'ACOS',
  [ScalarFunction.ATAN]: 'ATAN',
  [ScalarFunction.ATAN2]: 'ATAN2',
  [ScalarFunction.EXP]: 'EXP',
  [ScalarFunction.LOG]: 'LN',
};

function constantValueString(op: ConstantOperation, d: SqlDialect): string {
  if (op instanceof StringConstantOperation) return d.stringLiteral(op.value);
  if (op instanceof DateConstantOperation) return sqlFormatDate(op.value);
  if (op instanceof DateTimeConstantOperation) return sqlFormatDatetime(op.value);
  if (op instanceof IntegerConstantOperation) return String(op.value);
  if (op instanceof FloatConstantOperation) return Number.isInteger(op.value) && Math.abs(op.value) < 1e21 ? op.value.toFixed(1) : String(op.value); // 200.0, so it stays a float
  if (op instanceof BooleanConstantOperation) return op.value ? 'TRUE' : 'FALSE';
  if (op instanceof DecimalConstantOperation) return String(op.value);
  throw new Error('Unknown constant operation');
}

/**
 * A constant in the select list. A bare quoted literal would come back as text, so dates are typed, and a
 * bare 1.5 would come back as a DECIMAL, so a float is cast to DOUBLE.
 */
function selectedConstantString(op: ConstantOperation, d: SqlDialect): string {
  if (op instanceof FloatConstantOperation) return 'CAST(' + constantValueString(op, d) + ' AS ' + d.doubleType + ')';
  if (op instanceof DateTimeConstantOperation) return 'TIMESTAMP ' + constantValueString(op, d);
  if (op instanceof DateConstantOperation) return 'DATE ' + constantValueString(op, d);
  return constantValueString(op, d);
}

function windowSpecToString(window: WindowSpecification, d: SqlDialect): string {
  const parts: string[] = [];
  if (window.partitionBy.length > 0) {
    parts.push('PARTITION BY ' + window.partitionBy.map(p => sqlOperationToString(p, d)).join(', '));
  }
  if (window.orderBy.length > 0) {
    parts.push('ORDER BY ' + window.orderBy.map(s =>
      sqlOperationToString(s.column, d) + d.orderDirection(s.direction),
    ).join(', '));
  }
  return 'OVER (' + parts.join(' ') + ')';
}

const ARITHMETIC_PRECEDENCE: Record<ArithmeticOperator, number> = {
  [ArithmeticOperator.ADD]: 1,
  [ArithmeticOperator.SUBTRACT]: 1,
  [ArithmeticOperator.MULTIPLY]: 2,
  [ArithmeticOperator.DIVIDE]: 2,
};

/**
 * Whether `child` must be parenthesised as an operand of `parent`: it binds more loosely than the parent, or it
 * is the right operand of a - or / and binds equally (a - (b - c) is not a - b - c).
 */
export function arithmeticNeedsParentheses(parent: ArithmeticOperation, child: RelationalOperationElement, onRight: boolean): boolean {
  if (!(child instanceof ArithmeticOperation)) return false;
  const here = ARITHMETIC_PRECEDENCE[parent.operator];
  const there = ARITHMETIC_PRECEDENCE[child.operator];
  return there < here || (there === here && onRight
    && (parent.operator === ArithmeticOperator.SUBTRACT || parent.operator === ArithmeticOperator.DIVIDE));
}

function operandString(operation: RelationalOperationElement, d: SqlDialect): string {
  return operation instanceof ConstantOperation ? constantValueString(operation, d) : sqlOperationToString(operation, d);
}

/**
 * A condition or CASE already written as SQL, to be selected as a column. It is rendered while the query is being
 * built, where its columns can be resolved to table aliases, not when the text of the select is put together.
 */
class RenderedSql extends RelationalOperationElement {
  constructor(readonly sql: string) { super(); }
}

function isCondition(op: unknown): boolean {
  return op instanceof ComparisonOperation || op instanceof LogicalOperation || op instanceof IsNullOperation
    || op instanceof IsNotNullOperation || op instanceof InOperation || op instanceof NotInOperation
    || op instanceof ExistsOperation || op instanceof NotExistsOperation || op instanceof NotOperation;
}

function sqlOperationToString(operation: RelationalOperationElement, d: SqlDialect): string {
  if (operation instanceof TableAliasColumn) {
    return operation.tableAlias.name + '.' + operation.column.name;
  }
  if (operation instanceof WindowFunctionOperation) {
    const fn = WINDOW_SQL_NAMES[operation.func];
    const parts: string[] = [];
    if (operation.element !== null && operation.element !== undefined) {
      parts.push(sqlOperationToString(operation.element, d));
    }
    if (operation.secondArg !== undefined) parts.push(String(operation.secondArg));
    for (const arg of operation.extraArgs) {
      parts.push(typeof arg === 'string' ? d.stringLiteral(arg) : String(arg));
    }
    const sql = fn + '(' + parts.join(', ') + ')';
    return sql + (operation.window !== undefined ? ' ' + windowSpecToString(operation.window, d) : ' OVER ()');
  }
  if (operation instanceof AggregateOperation && operation.operator === AggregateOperator.COUNT_DISTINCT) {
    return 'COUNT(DISTINCT ' + sqlOperationToString(operation.element, d) + ')';
  }
  if (operation instanceof AggregateOperation && operation.operator === AggregateOperator.STRING_AGG) {
    let sql = d.stringAgg(
      sqlOperationToString(operation.element, d),
      d.stringLiteral(operation.separator ?? ''),
      operation.orderBy.map(s => sqlOperationToString(s.column, d) + d.orderDirection(s.direction)),
    );
    if (operation.window !== undefined) sql += ' ' + windowSpecToString(operation.window, d);
    return sql;
  }
  if (operation instanceof AggregateOperation) {
    const fn = AGGREGATE_SQL_NAMES[operation.operator] ?? operation.operator;
    let sql = fn + '(' + sqlOperationToString(operation.element, d) + ')';
    if (operation.window !== undefined) {
      sql += ' ' + windowSpecToString(operation.window, d);
    }
    return sql;
  }
  if (operation instanceof ScalarFunctionOperation) {
    const fn = SCALAR_SQL_NAMES[operation.func];
    const parts: string[] = [sqlOperationToString(operation.element, d)];
    if (operation.secondArg !== undefined) parts.push(String(operation.secondArg));
    for (const arg of operation.extraArgs) {
      parts.push(typeof arg === 'string' ? d.stringLiteral(arg) : String(arg));
    }
    const sql = fn + '(' + parts.join(', ') + ')';
    return operation.cast ? 'CAST(' + sql + ' AS ' + operation.cast + ')' : sql;
  }
  if (operation instanceof DateExtractOperation) {
    const element = sqlOperationToString(operation.element, d);
    return operation.part === DatePart.DOW ? d.dayOfWeek(element) : 'EXTRACT(' + operation.part + ' FROM ' + element + ')';
  }
  if (operation instanceof DateTruncOperation) {
    return "CAST(DATE_TRUNC('" + operation.part.toLowerCase() + "', " + sqlOperationToString(operation.element, d) + ') AS DATE)';
  }
  if (operation instanceof DateArithmeticOperation) {
    const op = operation.isAdd ? '+' : '-';
    return sqlOperationToString(operation.element, d) + ' ' + op + " INTERVAL '" + operation.n + "' " + operation.unit;
  }
  if (operation instanceof DateDiffOperation) {
    const other = operation.other instanceof RelationalOperationElement
      ? sqlOperationToString(operation.other, d)
      : 'TIMESTAMP ' + sqlFormatDatetime(operation.other);
    return d.dateDiff(operation.unit, sqlOperationToString(operation.element, d), other);
  }
  if (operation instanceof CountAllOperation) return 'COUNT(*)';
  if (operation instanceof ConstantOperation) return selectedConstantString(operation, d);
  if (operation instanceof RenderedSql) return operation.sql;
  if (operation instanceof ConcatOperation) return operation.parts.map(part => operandString(part, d)).join(' || ');
  if (operation instanceof ArithmeticOperation) {
    let left = operandString(operation.left, d);
    let right = operandString(operation.right, d);
    if (arithmeticNeedsParentheses(operation, operation.left, false)) left = '(' + left + ')';
    if (arithmeticNeedsParentheses(operation, operation.right, true)) right = '(' + right + ')';
    return left + ' ' + operation.operator + ' ' + right;
  }
  if (operation instanceof Alias) {
    return sqlOperationToString(operation.element, d) + ' AS ' + d.quoteIdentifier(operation.name);
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

/** The operations ANDed together left to right, ignoring the missing ones; null if there are none. */
function andAll(ops: (Operation | null)[]): Operation | null {
  const present = ops.filter((op): op is Operation => op !== null);
  if (present.length === 0) return null;
  return present.slice(1).reduce<Operation>((left, right) => new LogicalOperation(left, LogicalOperator.AND, right), present[0]);
}

/** The table's processing range contains the processing time, or its processing snapshot column equals it. */
function processingPredicate(
  mc: MilestoningColumns,
  processingDatetime: Date | null,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  if (processingDatetime === null) return null;
  if (mc instanceof SingleProcessingDatetimeColumn) {
    return snapshotAttribute(mc, joinNode).eq(processingDatetime);
  }
  if (!hasProcessingRange(mc)) return null;
  const startAt = new DateTimeAttribute('start_at', mc.startAtColumn.name, mc.startAtColumn.type, mc.startAtColumn.ownerRelation, joinNode);
  const endAt = new DateTimeAttribute('end_at', mc.endAtColumn.name, mc.endAtColumn.type, mc.endAtColumn.ownerRelation, joinNode);
  return new LogicalOperation(startAt.lte(processingDatetime), LogicalOperator.AND, openEndClause(endAt, processingDatetime, mc.infiniteDatetime));
}

function snapshotAttribute(mc: SingleProcessingDatetimeColumn, joinNode?: JoinTreeNodeOperation): DateTimeAttribute {
  const column = mc.processingDatetimeColumn;
  return new DateTimeAttribute('processing_datetime', column.name, column.type, column.ownerRelation, joinNode);
}

/** The table's processing range overlaps the processing range, or its processing snapshot column is within it. */
function processingRangePredicate(
  mc: MilestoningColumns,
  processingFrom: Date,
  processingTo: Date,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  if (mc instanceof SingleProcessingDatetimeColumn) {
    const snapshot = snapshotAttribute(mc, joinNode);
    return new LogicalOperation(snapshot.gte(processingFrom), LogicalOperator.AND, snapshot.lte(processingTo));
  }
  if (!hasProcessingRange(mc)) return null;
  const startAt = new DateTimeAttribute('start_at', mc.startAtColumn.name, mc.startAtColumn.type, mc.startAtColumn.ownerRelation, joinNode);
  const endAt = new DateTimeAttribute('end_at', mc.endAtColumn.name, mc.endAtColumn.type, mc.endAtColumn.ownerRelation, joinNode);
  return new LogicalOperation(startAt.lte(processingTo), LogicalOperator.AND, openEndClause(endAt, processingFrom, mc.infiniteDatetime));
}

/** The table's business range contains the business date, or its business date column equals it. */
function businessPredicate(
  mc: MilestoningColumns,
  businessDate: Date | null,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  if (businessDate === null) return null;
  if (mc instanceof BusinessDateRangeColumns) {
    const dateFrom = new DateAttribute('business_date_from', mc.businessDateFromColumn.name, mc.businessDateFromColumn.type, mc.businessDateFromColumn.ownerRelation, joinNode);
    const dateTo = new DateAttribute('business_date_to', mc.businessDateToColumn.name, mc.businessDateToColumn.type, mc.businessDateToColumn.ownerRelation, joinNode);
    return new LogicalOperation(dateFrom.lte(businessDate), LogicalOperator.AND, openEndClause(dateTo, businessDate, mc.infiniteDatetime));
  }
  if (mc instanceof BusinessDateAndProcessingTemporalColumns || mc instanceof SingleBusinessDateColumn) {
    const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.ownerRelation, joinNode);
    return businessAtt.eq(businessDate);
  }
  return null;
}

/** The table's business range overlaps the business date range, or its business date column is within it. */
function businessRangePredicate(
  mc: MilestoningColumns,
  businessDateFrom: Date | null,
  businessDateTo: Date | null,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  if (businessDateFrom === null || businessDateTo === null) return null;
  if (mc instanceof BusinessDateRangeColumns) {
    const dateFrom = new DateAttribute('business_date_from', mc.businessDateFromColumn.name, mc.businessDateFromColumn.type, mc.businessDateFromColumn.ownerRelation, joinNode);
    const dateTo = new DateAttribute('business_date_to', mc.businessDateToColumn.name, mc.businessDateToColumn.type, mc.businessDateToColumn.ownerRelation, joinNode);
    return new LogicalOperation(dateFrom.lte(businessDateTo), LogicalOperator.AND, openEndClause(dateTo, businessDateFrom, mc.infiniteDatetime));
  }
  if (mc instanceof BusinessDateAndProcessingTemporalColumns || mc instanceof SingleBusinessDateColumn) {
    const businessAtt = new DateAttribute('business_date', mc.businessDateColumn.name, mc.businessDateColumn.type, mc.businessDateColumn.ownerRelation, joinNode);
    return new LogicalOperation(businessAtt.gte(businessDateFrom), LogicalOperator.AND, businessAtt.lte(businessDateTo));
  }
  return null;
}

/** The milestoning filter for a point in time: the processing range, then the business range, ANDed together. */
function buildMilestoningFilterOperation(
  businessDate: Date | null,
  processingDatetime: Date | null,
  table: MilestonedTable,
  joinNode?: JoinTreeNodeOperation,
): Operation | null {
  const mc = table.milestoningColumns;
  return andAll([processingPredicate(mc, processingDatetime, joinNode), businessPredicate(mc, businessDate, joinNode)]);
}

/**
 * Like buildMilestoningFilterOperation but applies a business-date range filter.
 *
 * Bitemporal tables use interval overlap:
 *   business_date_from_col <= businessDateTo AND business_date_to_col > businessDateFrom
 * Single-date tables:
 *   business_date >= businessDateFrom AND business_date <= businessDateTo
 * Processing-date filtering is point-in-time, as in the normal path, unless `processingDatetimeTo` is given: then
 * `processingDatetime` to `processingDatetimeTo` is a range, which a processing range overlaps and a processing
 * snapshot column is within.
 */
function buildMilestoningFilterOperationForDateRange(
  businessDateFrom: Date | null,
  businessDateTo: Date | null,
  processingDatetime: Date | null,
  table: MilestonedTable,
  joinNode?: JoinTreeNodeOperation,
  processingDatetimeTo: Date | null = null,
): Operation | null {
  const mc = table.milestoningColumns;
  const processing = processingDatetime !== null && processingDatetimeTo !== null
    ? processingRangePredicate(mc, processingDatetime, processingDatetimeTo, joinNode)
    : processingPredicate(mc, processingDatetime, joinNode);
  return andAll([
    processing,
    businessRangePredicate(mc, businessDateFrom, businessDateTo, joinNode),
  ]);
}

type RefVisitor = (ref: Attribute | ColumnWithJoin) => void;

type NodeVisitor = (node: JoinTreeNodeOperation) => void;

/**
 * Call `visit` for every Attribute/ColumnWithJoin referenced anywhere in `op`, and `visitExists` for the
 * join node of every exists()/notExists(). The latter are not attribute references, so they don't count
 * against whether other references to the same node can be satisfied by an embedded alternate.
 */
function walkRefs(
  op: RelationalOperationElement | null | undefined,
  visit: RefVisitor,
  visitExists?: NodeVisitor,
): void {
  if (op === null || op === undefined) return;
  if (op instanceof Attribute || op instanceof ColumnWithJoin) {
    visit(op);
  } else if (op instanceof ExistsOperation || op instanceof NotExistsOperation) {
    visitExists?.(op.node);
  } else if (op instanceof AggregateOperation) {
    walkRefs(op.element, visit, visitExists);
    if (op.window) walkWindowSpec(op.window, visit, visitExists);
    for (const sort of op.orderBy) walkRefs(sort, visit, visitExists);
  } else if (op instanceof WindowFunctionOperation) {
    if (op.element) walkRefs(op.element, visit, visitExists);
    if (op.window) walkWindowSpec(op.window, visit, visitExists);
  } else if (op instanceof DateDiffOperation) {
    walkRefs(op.element, visit, visitExists);
    if (op.other instanceof RelationalOperationElement) walkRefs(op.other, visit, visitExists);
  } else if (op instanceof ScalarFunctionOperation || op instanceof DateExtractOperation || op instanceof DateTruncOperation ||
             op instanceof DateArithmeticOperation ||
             op instanceof IsNullOperation || op instanceof IsNotNullOperation ||
             op instanceof InOperation || op instanceof NotInOperation || op instanceof NotOperation) {
    walkRefs((op as UnaryOperation).element, visit, visitExists);
  } else if (op instanceof Alias) {
    walkRefs(op.element, visit, visitExists);
  } else if (op instanceof ConcatOperation) {
    for (const part of op.parts) walkRefs(part, visit, visitExists);
  } else if (op instanceof ArithmeticOperation) {
    walkRefs(op.left, visit, visitExists);
    walkRefs(op.right, visit, visitExists);
  } else if (op instanceof CaseOperation) {
    walkRefs(op.condition, visit, visitExists);
    walkRefs(op.then, visit, visitExists);
    walkRefs(op.fallback, visit, visitExists);
  } else if (op instanceof SortOperation) {
    walkRefs(op.column, visit, visitExists);
  } else if (op instanceof LogicalOperation || op instanceof ComparisonOperation) {
    walkRefs((op as any).left, visit, visitExists);
    walkRefs((op as any).right, visit, visitExists);
  }
}

function walkWindowSpec(window: WindowSpecification, visit: RefVisitor, visitExists?: NodeVisitor): void {
  for (const p of window.partitionBy) walkRefs(p, visit, visitExists);
  for (const s of window.orderBy) walkRefs(s.column, visit, visitExists);
}

/**
 * Translate property-equality filters given to a related finder (e.g. `ef.projects({ code: 'ALPHA' })`)
 * into a relational filter on the join node. `columnMap` maps property ids to [column, type, table].
 */
function buildJoinFilterFromProperties(
  node: JoinTreeNodeOperation | undefined,
  filter: Record<string, unknown>,
  columnMap: Record<string, [string, string, Relation]>,
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
    else if (typeof value === 'number') {
      // 100 for a DOUBLE column is the float 100.0, which JavaScript cannot tell from the integer 100
      const floating = /^(DOUBLE|FLOAT|REAL)/i.test(type);
      constant = Number.isInteger(value) && !floating ? new IntegerConstantOperation(value) : new FloatConstantOperation(value);
    }
    else if (value instanceof Date) constant = type.toUpperCase() === 'DATE' ? new DateConstantOperation(value) : new DateTimeConstantOperation(value);
    else constant = new StringConstantOperation(String(value));
    ops.push(new ComparisonOperation(col, ComparisonOperator.EQUAL, constant));
  }
  return ops.reduce((acc, op) => new LogicalOperation(acc, LogicalOperator.AND, op));
}

/**
 * The nodes plus every ancestor, each once, ancestors first. The SQL generator joins a node's
 * ancestors whenever it joins the node, so each of them needs its join filter set too, not only the
 * nodes an expression refers to directly.
 */
function withAncestors(nodes: Iterable<JoinTreeNodeOperation>): JoinTreeNodeOperation[] {
  const ordered = new Set<JoinTreeNodeOperation>();
  const add = (node: JoinTreeNodeOperation): void => {
    if (ordered.has(node)) return;
    if (node.parent !== undefined) add(node.parent);
    ordered.add(node);
  };
  for (const node of nodes) add(node);
  return [...ordered];
}

/**
 * The steps the query reaches only to ask whether a row exists (`exists` or `notExists`).
 *
 * Joining such a step repeats the parent once per matching row. A step the query also reads a value through is left
 * as a join: those values are one row per child, and the existence then holds for a child with those values. Nor can
 * a step stand for a query when a step below it is reached through it, or when its join has a filter object of its
 * own, whose columns are not known to be the table's. A step given property values, as in `product({ id: 2 })`, can:
 * they are conditions on the table. A to-one step cannot repeat a row, so it stays a join.
 */
function existsOnlyNodes(expressions: (RelationalOperationElement | undefined)[]): JoinTreeNodeOperation[] {
  const required = new Set<JoinTreeNodeOperation>();
  const referenced = new Set<JoinTreeNodeOperation>();
  const collect: RefVisitor = ref => {
    const parent = ref instanceof Attribute ? ref.parent() : ref.parent;
    if (parent !== undefined) { required.add(parent); referenced.add(parent); }
  };
  const collectNode: NodeVisitor = node => required.add(node);
  for (const expression of expressions) walkRefs(expression, collect, collectNode);
  const ancestors = new Set<JoinTreeNodeOperation>();
  for (const node of required) {
    for (let parent = node.parent; parent !== undefined; parent = parent.parent) ancestors.add(parent);
  }
  return [...required].filter(node =>
    node.many && !referenced.has(node) && !ancestors.has(node) && node.join.filter === undefined);
}

/**
 * The business date, its range end, the processing time and its range end for the table a step reaches.
 *
 * A step uses the dates it was given, else those of the nearest step above it that was given any, else the query's.
 * Each axis is taken separately, and a date given to a step is a point in time, so it ends any range the query asked
 * for on that axis.
 */
function datesForNode(
  node: JoinTreeNodeOperation,
  businessDate: Date | null,
  businessDateTo: Date | null,
  processingDatetime: Date | null,
  processingDatetimeTo: Date | null,
): { businessDate: Date | null; businessDateTo: Date | null; processingDatetime: Date | null; processingDatetimeTo: Date | null } {
  let explicitBusiness: Date | null = null;
  let explicitProcessing: Date | null = null;
  for (let step: JoinTreeNodeOperation | undefined = node; step !== undefined; step = step.parent) {
    if (explicitBusiness === null) explicitBusiness = step.businessDate;
    if (explicitProcessing === null) explicitProcessing = step.processingDatetime;
  }
  if (explicitBusiness !== null) { businessDate = explicitBusiness; businessDateTo = null; }
  if (explicitProcessing !== null) { processingDatetime = explicitProcessing; processingDatetimeTo = null; }
  return { businessDate, businessDateTo, processingDatetime, processingDatetimeTo };
}

function buildQuerySpecification(
  businessDate: Date | null,
  processingDatetime: Date | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: Table,
  op: RelationalOperationElement,
  orderBy: SortOperation[] = [],
  groupBy: Attribute[] = [],
  limit?: number,
  businessDateTo: Date | null = null,
  distinct: boolean = false,
  offset?: number,
  having?: Operation,
  processingDatetimeTo: Date | null = null,
): OrderedQuerySpecification {
  let filter = op;
  const milestoningFor = (t: MilestonedTable, node?: JoinTreeNodeOperation) => {
    const dates = node === undefined
      ? { businessDate, businessDateTo, processingDatetime, processingDatetimeTo }
      : datesForNode(node, businessDate, businessDateTo, processingDatetime, processingDatetimeTo);
    return dates.businessDateTo !== null || dates.processingDatetimeTo !== null
      ? buildMilestoningFilterOperationForDateRange(dates.businessDate, dates.businessDateTo, dates.processingDatetime, t, node, dates.processingDatetimeTo)
      : buildMilestoningFilterOperation(dates.businessDate, dates.processingDatetime, t, node);
  };

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
  const collectNode: NodeVisitor = node => requiredJoins.add(node);
  for (const col of columns) walkRefs(col, collect, collectNode);
  for (const expr of groupBy) walkRefs(expr, collect, collectNode);
  for (const sort of orderBy) walkRefs(sort, collect, collectNode);
  walkRefs(op, collect, collectNode);

  const joinFilters = new Map<JoinTreeNodeOperation, Operation>();
  for (const node of withAncestors(requiredJoins)) {
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
    if (combined !== undefined) joinFilters.set(node, combined);
  }

  // for each step only asked the existence of: `SELECT DISTINCT <join column> FROM <its table>`, with the table's
  // milestoning at the dates the step uses. Distinct on the join column makes it at most one row for a parent, however
  // many rows of the table match. Property values the step was given are conditions of the query, on the table's own columns.
  const subSelects = new Map<JoinTreeNodeOperation, QuerySpecification>();
  for (const node of existsOnlyNodes([...columns, ...groupBy, ...orderBy, op, having])) {
    const right = node.join.right;
    const dates = datesForNode(node, businessDate, businessDateTo, processingDatetime, processingDatetimeTo);
    const values = node.join.filterKwargs;
    const condition = Object.keys(values).length > 0
      ? buildJoinFilterFromProperties(undefined, values, node.join.filterColumnMap)
      : new NoOperation();
    subSelects.set(node, buildQuerySpecification(
      dates.businessDate, dates.processingDatetime, [new Alias(right, right.name)], node.join.target, condition,
      [], [], undefined, dates.businessDateTo, true, undefined, undefined, dates.processingDatetimeTo));
  }

  return new OrderedQuerySpecification(columns, filter, orderBy, groupBy, limit, table, joinFilters, distinct, offset, having, subSelects);
}

/**
 * Whether `child` must be parenthesised where it is an operand of `parent`.
 *
 * A logical operation nested in one with a different operator is parenthesised: OR inside AND would
 * otherwise change meaning, and AND inside OR is easier to read. The same operator needs none, since
 * AND and OR are associative, so a AND (b AND c) is a AND b AND c.
 */
export function needsParentheses(parent: LogicalOperation, child: RelationalOperationElement): boolean {
  return child instanceof LogicalOperation && child.operator !== parent.operator;
}

/** Whether a value is read through a to-many association, so it repeats the row it is read for. */
function reachesToMany(op: RelationalOperationElement): boolean {
  if (op instanceof ColumnWithJoin) {
    for (let node = op.parent; node !== undefined; node = node.parent) if (node.many) return true;
    return false;
  }
  if (op instanceof UnaryOperation || op instanceof Alias) return reachesToMany(op.element);
  if (op instanceof BinaryOperation) return reachesToMany(op.left) || reachesToMany(op.right);
  return false;
}

/** A column with any alias around it taken off. */
function unaliased(op: unknown): unknown {
  return op instanceof Alias ? unaliased(op.element) : op;
}

class SQLQueryGenerator {
  constructor(private readonly _dialect: SqlDialect, firstAlias: number = 0) {
    this._tableAliasIncr = firstAlias;
  }

  private _select: Alias[] = [];
  private _from: Set<TableAlias> = new Set();
  private _join: Join[] = [];
  private _groupByParts: string[] = [];
  private _having = '';
  private _orderByParts: string[] = [];
  private _where = '';
  private _limit?: number;
  private _distinct = false;
  private _offset?: number;
  private _tableAliasIncr: number;
  private _tableAliasesByTable = new Map<unknown, TableAlias>();
  private _addedJoinIds = new Set<JoinTreeNodeOperation>();
  private _rootTable?: Table;
  private _elidableNodes = new Set<JoinTreeNodeOperation>();
  private _joinFilters: ReadonlyMap<JoinTreeNodeOperation, Operation> = new Map();
  private _subSelects: ReadonlyMap<JoinTreeNodeOperation, QuerySpecification> = new Map();

  generate(query: QuerySpecification): void {
    // a query that is only stored has no order, limit or offset
    const ordered = query instanceof OrderedQuerySpecification ? query : undefined;
    this._rootTable = query.table;
    this._elidableNodes = this._computeElidableNodes(query);
    this._joinFilters = query.joinFilters;
    this._subSelects = query.subSelects;
    if (this._rootTable !== undefined) {
      this._from.add(this._tableAliasForTable(this._rootTable));
    }
    this.processSelect([...query.columns]);
    this._where = this.buildFilter(this._guarded(query.filter));
    const groupByJoins = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();
    for (const expr of query.groupBy) {
      this._collectRequiredJoins(expr, groupByJoins);
    }
    for (const node of groupByJoins.values()) {
      this._addJoin(node);
    }
    this._groupByParts = this._groupByPartsFor(query);
    this._having = '';
    if (query.having !== undefined) {
      const havingJoins = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();
      this._collectRequiredJoins(query.having, havingJoins);
      for (const node of havingJoins.values()) this._addJoin(node);
      // HAVING filters the grouped result, which Legend does not guard: it is a filter on projected columns
      this._having = this.buildFilter(query.having);
    }
    this._orderByParts = (ordered?.orderBy ?? []).map(s =>
      this._sortExpression(s.column) + this._dialect.orderDirection(s.direction),
    );
    this._limit = ordered?.limit;
    this._distinct = query.distinct;
    this._offset = ordered?.offset;
  }

  /**
   * The GROUP BY of a query: the grouping it was given, else the grouping its columns imply.
   *
   * Columns that are not aggregated are what the aggregates are computed for, so a query that selects both is
   * grouped by those columns (as a DataFrame's `groupby(columns).agg(...)` does). An aggregate read through a
   * to-many association is computed for each row of the root table, as Legend does, so the root's primary key
   * is grouped by too. A query that selects only aggregates over the root's own columns is not grouped: the
   * aggregate covers every row. A constant needs no grouping: a bare
   * `GROUP BY 7` would be a column position.
   */
  private _groupByPartsFor(query: QuerySpecification): string[] {
    if (query.groupBy.length > 0) return query.groupBy.map(a => this._attrToColString(a as Attribute));
    const aggregates = query.columns.filter(containsAggregate);
    if (aggregates.length === 0) return [];
    const perRoot = query.table !== undefined && aggregates.some(reachesToMany);
    const keys = perRoot ? query.table!.columns.filter(c => c.primaryKey).map(c => this._columnToString(c)) : [];
    const grouped = query.columns
      .map((column, i) => ({ column, shown: this._select[i] }))
      .filter(({ column }) => !containsAggregateOrWindow(column) && !(unaliased(column) instanceof ConstantOperation))
      .map(({ shown }) => sqlOperationToString(shown.element, this._dialect));
    return [...new Set([...keys, ...grouped])];
  }

  /** What a sort orders by: a column, or an expression such as an aggregate. */
  private _sortExpression(expression: RelationalOperationElement): string {
    if (expression instanceof ColumnWithJoin || expression instanceof Attribute) return this.buildFilter(expression);
    return sqlOperationToString(this._rewriteOperation(expression), this._dialect);
  }

  private _columnToString(column: Column): string {
    return this._tableAliasForTable(column.ownerRelation).name + '.' + column.name;
  }

  private _attrToColString(attr: Attribute): string {
    const { column, parent } = this._resolve(attr);
    const ta = this._tableAliasForTable(column.ownerRelation, parent);
    return ta.name + '.' + column.name;
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
  private _computeElidableNodes(query: QuerySpecification): Set<JoinTreeNodeOperation> {
    const refsByNode = new Map<JoinTreeNodeOperation, (Attribute | ColumnWithJoin)[]>();
    const record = (ref: Attribute | ColumnWithJoin) => {
      const parent = ref instanceof Attribute ? ref.parent() : ref.parent;
      if (parent === undefined) return;
      const refs = refsByNode.get(parent);
      if (refs) refs.push(ref); else refsByNode.set(parent, [ref]);
    };
    for (const col of query.columns) walkRefs(col, record);
    for (const expr of query.groupBy) walkRefs(expr, record);
    for (const sort of query instanceof OrderedQuerySpecification ? query.orderBy : []) walkRefs(sort, record);
    walkRefs(query.filter, record);

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

  /**
   * The condition with an explicit `IS NOT NULL` before each ordering or pattern comparison on a value that can be
   * missing, as Legend writes it for what a query asks of a class. The guard changes no row. It is not added to a
   * join's own filter (its milestoning dates and property values) or to HAVING, which are not that, so they are
   * never passed through here.
   */
  private _guarded(op: RelationalOperationElement): RelationalOperationElement {
    if (op instanceof LogicalOperation) {
      return new LogicalOperation(this._guarded(op.left), op.operator, this._guarded(op.right));
    }
    if (op instanceof ComparisonOperation && GUARDED_COMPARISONS.has(op.operator) && op.left instanceof ColumnWithJoin
      && this._resolveOptional(op.left)) {
      return new LogicalOperation(new IsNotNullOperation(op.left), LogicalOperator.AND, op);
    }
    return op;
  }

  /** Whether the value `op` reads can be missing, in the join or embedded form that is used for it. */
  private _resolveOptional(op: ColumnWithJoin): boolean {
    if (op.parent !== undefined && this._elidableNodes.has(op.parent) && op.embedded !== undefined) {
      return this._resolveOptional(op.embedded);
    }
    return op.optional;
  }

  private _rewriteWindowSpec(window: WindowSpecification): WindowSpecification {
    const partitionBy = window.partitionBy.map(p => this._rewriteOperation(p));
    const orderBy = window.orderBy.map(s => new SortOperation(this._rewriteOperation(s.column) as ColumnWithJoin, s.direction));
    return new WindowSpecification(partitionBy, orderBy);
  }

  private _rewriteOperation(op: RelationalOperationElement): RelationalOperationElement {
    if (op instanceof Attribute || op instanceof ColumnWithJoin) {
      const { column, parent } = this._resolve(op);
      return new TableAliasColumn(column, this._tableAliasForTable(column.ownerRelation, parent));
    }
    if (op instanceof Column) {
      const ta = this._tableAliasForTable(op.ownerRelation);
      return new TableAliasColumn(op, ta);
    }
    if (op instanceof AggregateOperation) {
      return new AggregateOperation(
        this._rewriteOperation(op.element), op.operator, op.displayName,
        op.window ? this._rewriteWindowSpec(op.window) : undefined,
        op.separator, op.orderBy.map(s => new SortOperation(this._rewriteOperation(s.column), s.direction)),
      );
    }
    if (op instanceof CaseOperation) return new RenderedSql(this._caseSql(op));
    if (isCondition(op)) return new RenderedSql(this.buildFilter(op as Operation)); // a condition inside an expression, such as the argument of an aggregate
    if (op instanceof ConcatOperation) return new ConcatOperation(op.parts.map(part => this._rewriteOperation(part)), op.displayName);
    if (op instanceof ArithmeticOperation) {
      return new ArithmeticOperation(this._rewriteOperation(op.left), op.operator, this._rewriteOperation(op.right), op.displayName);
    }
    if (op instanceof WindowFunctionOperation) {
      const el = op.element ? this._rewriteOperation(op.element) : null;
      return new WindowFunctionOperation(el, op.func, op.displayName, op.secondArg, [...op.extraArgs],
        op.window ? this._rewriteWindowSpec(op.window) : undefined);
    }
    if (op instanceof ScalarFunctionOperation) {
      return new ScalarFunctionOperation(this._rewriteOperation(op.element), op.func, op.displayName, op.secondArg, op.extraArgs, op.cast, op.integer);
    }
    if (op instanceof DateExtractOperation) {
      return new DateExtractOperation(this._rewriteOperation(op.element), op.part, op.displayName);
    }
    if (op instanceof DateTruncOperation) {
      return new DateTruncOperation(this._rewriteOperation(op.element), op.part, op.displayName);
    }
    if (op instanceof DateArithmeticOperation) {
      return new DateArithmeticOperation(this._rewriteOperation(op.element), op.n, op.unit, op.isAdd, op.displayName);
    }
    if (op instanceof DateDiffOperation) {
      const other = op.other instanceof RelationalOperationElement ? this._rewriteOperation(op.other) : op.other;
      return new DateDiffOperation(this._rewriteOperation(op.element), other, op.unit, op.displayName);
    }
    return op;
  }

  /** The CASE written out now: its condition can only be rendered while the query is being built. */
  private _caseSql(op: CaseOperation): string {
    const branch = (value: RelationalOperationElement): string =>
      value instanceof ConstantOperation ? constantValueString(value, this._dialect) : sqlOperationToString(this._rewriteOperation(value), this._dialect);
    let sql = 'CASE WHEN ' + this.buildFilter(this._guarded(op.condition)) + ' THEN ' + branch(op.then);
    if (op.fallback !== undefined) sql += ' ELSE ' + branch(op.fallback);
    return sql + ' END';
  }

  private processSelect(cols: (Attribute | RelationalOperationElement)[]): void {
    const requiredJoins = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();

    // each column is read before any join is added, so the table a column is read from is named before the tables
    // the join to it passes through
    for (const col of cols) {
      this._collectRequiredJoins(col, requiredJoins);
      this._selectColumn(col);
    }
    for (const node of requiredJoins.values()) {
      this._addJoin(node);
    }
  }

  /** Add one column to the select list. An alias reads the column it wraps, then names the entry. */
  private _selectColumn(col: Attribute | RelationalOperationElement): void {
    if (col instanceof Alias) {
      this._selectColumn(col.element);
      const read = this._select.pop()!;
      this._select.push(new Alias(read.element, col.name));
    } else if (col instanceof Attribute) {
      const { column, parent: node } = this._resolve(col);
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(column.ownerRelation, node);
      } else {
        ta = this._tableAliasForTable(column.ownerRelation);
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
    } else if (col instanceof AggregateOperation && !(col.element instanceof ColumnWithJoin)) {
      // an aggregate of an expression: rewritten as a whole, so every column in it is resolved
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? 'Expression'));
    } else if (col instanceof AggregateOperation) {
      const colNested = this._resolve(findColumn(col));
      const node = colNested.parent;
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(colNested.column.ownerRelation, node);
      } else {
        ta = this._tableAliasForTable(colNested.column.ownerRelation);
        this._from.add(ta);
      }
      const alias = col.displayName ?? col.operator + ' ' + findColumn(col).column.name;
      const rewrittenAgg = new AggregateOperation(
        new TableAliasColumn(colNested.column, ta), col.operator, undefined,
        col.window ? this._rewriteWindowSpec(col.window) : undefined,
        col.separator, col.orderBy.map(s => new SortOperation(this._rewriteOperation(s.column), s.direction)),
      );
      this._select.push(new Alias(rewrittenAgg, alias));
    } else if (col instanceof ScalarFunctionOperation) {
      // rewritten as a whole, so a function of a function keeps every step
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? col.func + ' ' + findColumn(col).column.name));
    } else if (col instanceof DateDiffOperation) {
      // rewritten as a whole: either side may be a column or an expression
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? findColumn(col).column.name));
    } else if (col instanceof Column) {
      const ta = this._tableAliasForTable(col.ownerRelation);
      this._from.add(ta);
      this._select.push(new Alias(new TableAliasColumn(col, ta), col.name));
    } else if (col instanceof DateExtractOperation || col instanceof DateArithmeticOperation) {
      const colNested = this._resolve(findColumn(col as RelationalOperationElement));
      const node = colNested.parent;
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(colNested.column.ownerRelation, node);
      } else {
        ta = this._tableAliasForTable(colNested.column.ownerRelation);
        this._from.add(ta);
      }
      const alias = (col as DateExtractOperation).displayName ?? findColumn(col as RelationalOperationElement).column.name;
      let aliasedOp: RelationalOperationElement;
      if (col instanceof DateExtractOperation) {
        aliasedOp = new DateExtractOperation(new TableAliasColumn(colNested.column, ta), col.part);
      } else if (col instanceof DateArithmeticOperation) {
        aliasedOp = new DateArithmeticOperation(new TableAliasColumn(colNested.column, ta), col.n, col.unit, col.isAdd);
      } else {
        throw new Error('unreachable');
      }
      this._select.push(new Alias(aliasedOp, alias));
    } else if (col instanceof CaseOperation) {
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? 'Expression'));
    } else if (col instanceof ConcatOperation) {
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? 'Expression'));
    } else if (col instanceof ArithmeticOperation) {
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? 'Expression'));
    } else if (col instanceof DateTruncOperation) {
      this._select.push(new Alias(this._rewriteOperation(col), col.displayName ?? findColumn(col).column.name));
    } else if (isCondition(col)) {
      this._select.push(new Alias(new RenderedSql(this.buildFilter(this._guarded(col))), 'Expression'));
    } else if (col instanceof ConstantOperation) {
      this._select.push(new Alias(col, 'Constant'));
    } else if (col instanceof CountAllOperation) {
      if (col.table !== '') this._from.add(this._tableAliasForTable(new Table(col.table, [])));
      this._select.push(new Alias(col, 'Count'));
    }
  }

  private _addJoin(node: JoinTreeNodeOperation): void {
    if (this._addedJoinIds.has(node)) return;
    if (node.parent !== undefined) this._addJoin(node.parent);
    this._addedJoinIds.add(node);

    const join = node.join;
    const left = join.left;
    const srcTa = this._tableAliasForTable(left.ownerRelation, node.parent);
    if (node.parent === undefined) this._from.add(srcTa);
    const sc = new TableAliasColumn(left, srcTa);
    const right = join.right;
    const tc = new TableAliasColumn(right, this._tableAliasForTable(right.ownerRelation, node));
    // a sub-select carries the step's filter itself, so it is not repeated in the ON clause
    const queryFilter = tc.tableAlias.relation instanceof QuerySpecification ? undefined : this._joinFilters.get(node);
    const filterOp = join.filter !== undefined && queryFilter !== undefined
      ? new LogicalOperation(join.filter as Operation, LogicalOperator.AND, queryFilter)
      : join.filter ?? queryFilter;
    this._join.push(new Join(sc, tc, filterOp));
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
    if (op instanceof InOperation) {
      return this.buildFilter(op.element) + ' IN (' + op.values.map(value => constantValueString(value, this._dialect)).join(', ') + ')';
    }
    if (op instanceof NotInOperation) {
      const column = this.buildFilter(op.element);
      const sql = column + ' NOT IN (' + op.values.map(value => constantValueString(value, this._dialect)).join(', ') + ')';
      // NULL NOT IN (...) is not true in SQL, so a nullable column has to match its NULLs explicitly
      if (op.element instanceof ColumnWithJoin && this._resolve(op.element).column.nullable) {
        return '(' + sql + ' OR ' + column + ' IS NULL)';
      }
      return sql;
    }
    if (op instanceof NotOperation) return 'NOT (' + this.buildFilter(op.element) + ')';
    if (op instanceof IsNotNullOperation) return this.buildFilter(op.element) + ' IS NOT NULL';
    if (op instanceof IsNullOperation) return this.buildFilter(op.element) + ' IS NULL';
    if (op instanceof LogicalOperation) {
      let left = this.buildFilter(op.left);
      let right = this.buildFilter(op.right);
      if (needsParentheses(op, op.left)) left = '(' + left + ')';
      if (needsParentheses(op, op.right)) right = '(' + right + ')';
      return left + LOGICAL_OPERATOR_STR[op.operator] + right;
    }
    if (op instanceof ComparisonOperation && op.operator === ComparisonOperator.MATCHES) {
      return this._dialect.regexMatches(this.buildFilter(op.left), this.buildFilter(op.right));
    }
    if (op instanceof ComparisonOperation) {
      let sql = this.buildFilter(op.left) + COMPARISON_OPERATOR_STR[op.operator] + this.buildFilter(op.right);
      if ((op.operator === ComparisonOperator.LIKE || op.operator === ComparisonOperator.NOT_LIKE)
        && op.right instanceof StringConstantOperation
        && (op.right.value.includes(LIKE_ESCAPE) || op.right.value.includes('\\'))) {
        // the pattern has a literal %, _ or escape character in it, or a backslash, which Postgres and Databricks
        // would otherwise take as LIKE's own escape
        sql += " ESCAPE '" + LIKE_ESCAPE + "'";
      }
      return sql;
    }
    if (op instanceof ConstantOperation) return constantValueString(op, this._dialect);
    if (op instanceof ScalarFunctionOperation || op instanceof ArithmeticOperation || op instanceof ConcatOperation
        || op instanceof DateTruncOperation || op instanceof DateExtractOperation || op instanceof DateArithmeticOperation
        || op instanceof DateDiffOperation || op instanceof AggregateOperation || op instanceof CountAllOperation) {
      // an expression compared in a filter needs its columns' joins, then is written as in a select list
      const required = new Map<JoinTreeNodeOperation, JoinTreeNodeOperation>();
      this._collectRequiredJoins(op, required);
      for (const node of required.values()) this._addJoin(node);
      return sqlOperationToString(this._rewriteOperation(op), this._dialect);
    }
    if (op instanceof ColumnWithJoin) {
      const { column, parent: node } = this._resolve(op);
      let ta: TableAlias;
      if (node !== undefined) {
        ta = this._tableAliasForTable(column.ownerRelation, node);
        this._addJoin(node);
      } else {
        ta = this._tableAliasForTable(column.ownerRelation);
      }
      return ta.name + '.' + column.name;
    }
    if (op instanceof Column) {
      const ta = this._tableAliasForTable(op.ownerRelation);
      return ta.name + '.' + op.name;
    }
    throw new Error('Unknown operation in buildFilter: ' + op.constructor.name);
  }

  /** The alias a relation is read under: one per join node, and one per table (by its qualified name) outside a join. */
  private _tableAliasForTable(table: Relation, key?: JoinTreeNodeOperation): TableAlias {
    if (!(table instanceof NamedRelation)) throw new TypeError('A relation read by name needs a name: ' + table.constructor.name);
    const cacheKey = key ?? table.qualifiedName;
    if (this._tableAliasesByTable.has(cacheKey)) {
      return this._tableAliasesByTable.get(cacheKey)!;
    }
    const subSelect = key instanceof JoinTreeNodeOperation ? this._subSelects.get(key) : undefined;
    const ta = new TableAlias(subSelect ?? table, 't' + this._tableAliasIncr++);
    this._tableAliasesByTable.set(cacheKey, ta);
    return ta;
  }

  /** What follows FROM or JOIN: the table's name, or the query in parentheses, written by a generator of its own that numbers its aliases after this one's. */
  private _relationSql(alias: TableAlias): string {
    const relation = alias.relation;
    if (relation instanceof Table) return relation.qualifiedName;
    if (!(relation instanceof QuerySpecification)) throw new TypeError('Cannot read ' + relation.constructor.name + ' in a query');
    const nested = new SQLQueryGenerator(this._dialect, this._tableAliasIncr);
    nested.generate(relation);
    this._tableAliasIncr = nested._tableAliasIncr;
    return '(' + nested.buildQueryString() + ')';
  }

  buildQueryString(): string {
    const joins = this._join.map(j =>
      ' LEFT OUTER JOIN ' + this._relationSql(j.target.tableAlias) + ' AS ' + j.target.tableAlias.name +
      ' ON (' + j.condition() +
      (j.filterOp ? ' AND ' + this.buildFilter(j.filterOp) : '') + ')',
    );

    return (this._distinct ? 'SELECT DISTINCT ' : 'SELECT ') + this._select.map(ca => sqlOperationToString(ca, this._dialect)).join(',') +
      ' FROM ' + Array.from(this._from).map(ta => this._relationSql(ta) + ' AS ' + ta.name).join(',') +
      joins.join('') +
      this._buildWhere() +
      this._buildGroupBy() +
      this._buildHaving() +
      this._buildOrderBy() +
      this._buildLimit() +
      this._buildOffset();
  }

  private _buildWhere(): string {
    return this._where.length > 0 ? ' WHERE ' + this._where : '';
  }
  private _buildGroupBy(): string {
    return this._groupByParts.length > 0 ? ' GROUP BY ' + this._groupByParts.join(', ') : '';
  }
  private _buildHaving(): string {
    return this._having.length > 0 ? ' HAVING ' + this._having : '';
  }
  private _buildOrderBy(): string {
    return this._orderByParts.length > 0 ? ' ORDER BY ' + this._orderByParts.join(', ') : '';
  }
  private _buildOffset(): string {
    return this._offset !== undefined ? ' OFFSET ' + this._offset : '';
  }

  private _buildLimit(): string {
    return this._limit !== undefined ? ' LIMIT ' + this._limit : '';
  }
}

export function querySqlToString(query: OrderedQuerySpecification, dialect: DialectName | SqlDialect = 'postgres'): string {
  const qg = new SQLQueryGenerator(dialectOf(dialect));
  qg.generate(query);
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
  distinct: boolean = false,
  offset?: number,
  having?: Operation,
  dialect: DialectName | SqlDialect = 'postgres',
  processingDatetimeTo: Date | null = null,
): string {
  const query = buildQuerySpecification(businessDate, processingDatetime, columns, table, op, orderBy, groupBy, limit, businessDateTo, distinct, offset, having, processingDatetimeTo);
  return querySqlToString(query, dialect);
}

export { buildQuerySpecification };
