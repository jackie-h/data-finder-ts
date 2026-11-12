/**
 * A result as a relation: the rows a `findAll(...)` returns have named columns, and a query over it (a `concatenate`, and
 * what orders and limits that) reads them as it reads a table's.
 *
 * As in Legend, where `concatenate` takes relations and returns one, the result is a query over a query: the two results
 * are a `UNION`, and ordering the union is a `SELECT ... FROM (<union>) ORDER BY ...`.
 */
import {
  AggregateOperation,
  AggregateOperator,
  Alias,
  ArithmeticOperation,
  BooleanConstantOperation,
  CaseOperation,
  Column,
  ColumnWithJoin,
  ConcatOperation,
  ConstantOperation,
  CountAllOperation,
  DateArithmeticOperation,
  DateConstantOperation,
  DateDiffOperation,
  DateExtractOperation,
  DateTimeConstantOperation,
  DateTruncOperation,
  DecimalConstantOperation,
  FloatConstantOperation,
  IntegerConstantOperation,
  IntervalConstantOperation,
  IntervalOperation,
  Operation,
  RelationalOperationElement,
  ScalarFunctionOperation,
  StringConstantOperation,
  TableAlias,
  WindowFunctionOperation,
} from '../model/relational';
import { Attribute } from './attribute';
import { displayAlias } from './sql-generator';
import { toSnakeCase } from './naming';
import { StringFunctionOperation } from './scalar-functions';
import { typedAttribute } from './typed-attributes';

type ConstantClass = abstract new (...args: never[]) => ConstantOperation;
const CONSTANT_TYPES: [ConstantClass, string][] = [
  [IntegerConstantOperation, 'BIGINT'], [FloatConstantOperation, 'DOUBLE'], [StringConstantOperation, 'VARCHAR'],
  [DateConstantOperation, 'DATE'], [DateTimeConstantOperation, 'TIMESTAMP'], [DecimalConstantOperation, 'DECIMAL'],
  [BooleanConstantOperation, 'BOOLEAN'], [IntervalConstantOperation, 'INTERVAL'],
];
const NUMBER_TYPES: Record<string, string> = { integer: 'BIGINT', double: 'DOUBLE', decimal: 'DECIMAL' };

/** The name a column of a result has for the step after it: the name it was given, or its display name in snake_case (as a view names its columns). */
export function columnName(element: RelationalOperationElement | Attribute): string {
  return element instanceof Alias ? element.name : toSnakeCase(displayAlias(element));
}

/** The database type of what a result column holds, so a query over the result can compare it as that type. */
export function columnType(element: RelationalOperationElement | Attribute): string {
  if (element instanceof Alias) return columnType(element.element);
  if (element instanceof Attribute) return element.column().type;
  if (element instanceof ColumnWithJoin) return element.column.type;
  if (element instanceof Column) return element.type;
  if (element instanceof CountAllOperation) return 'BIGINT';
  if (element instanceof IntervalOperation) return 'INTERVAL'; // before the number kinds: it is not a number
  const kind = (element as { numberKind?: () => string }).numberKind?.();
  if (kind !== undefined && kind in NUMBER_TYPES) return NUMBER_TYPES[kind];
  if (element instanceof AggregateOperation) {
    if (element.operator === AggregateOperator.COUNT || element.operator === AggregateOperator.COUNT_DISTINCT) return 'BIGINT';
    if (element.operator === AggregateOperator.STRING_AGG) return 'VARCHAR';
    if ([AggregateOperator.MIN, AggregateOperator.MAX, AggregateOperator.SUM].includes(element.operator)) return columnType(element.element);
    if (element.operator === AggregateOperator.BOOL_AND || element.operator === AggregateOperator.BOOL_OR) return 'BOOLEAN';
    return 'DOUBLE';
  }
  if (element instanceof WindowFunctionOperation) return element.element ? columnType(element.element) : 'BIGINT';
  if (element instanceof ConstantOperation) return CONSTANT_TYPES.find(([kind]) => element instanceof kind)?.[1] ?? 'VARCHAR';
  if (element instanceof CaseOperation) return columnType(element.then);
  if (element instanceof ConcatOperation || element instanceof StringFunctionOperation) return 'VARCHAR';
  if (element instanceof DateExtractOperation || element instanceof DateDiffOperation) return 'BIGINT';
  if (element instanceof DateArithmeticOperation || element instanceof DateTruncOperation) return columnType(element.element);
  if (element instanceof ScalarFunctionOperation) return columnType(element.element); // an untyped one, such as orElse: what it is applied to
  if (element instanceof ArithmeticOperation) return 'DOUBLE'; // one of unknown kind
  if (element instanceof Operation) return 'BOOLEAN'; // a condition shown as a column
  return 'VARCHAR';
}

/**
 * The columns of a relation under a name, as a query that reads from it sees them: a typed attribute for each, named as
 * `columnName` names it and owned by the alias.
 */
export function attributes(alias: TableAlias): Map<string, Attribute> {
  const names = alias.columns.map(columnName);
  const duplicates = [...new Set(names.filter(n => names.filter(m => m === n).length > 1))].sort();
  if (duplicates.length > 0) {
    throw new Error(`A result needs each column named once, but ${JSON.stringify(duplicates)} are repeated: name them with alias()`);
  }
  return new Map(alias.columns.map((element, i) => [names[i], typedAttribute(names[i], columnType(element), alias)]));
}
