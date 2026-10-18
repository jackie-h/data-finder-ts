import { Attribute } from './attribute';
import { toSql } from './sql-generator';
import {
  Table,
  Operation,
  SortOperation,
  NoOperation,
  RelationalOperationElement,
} from '../model/relational';

export type Row = unknown[];

/** Minimum interface satisfied by both Table (SQL) and GraphQLQuery (GraphQL). */
export interface QueryTarget {
  readonly name: string;
}

export interface QueryRunner {
  select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy?: SortOperation[],
    groupBy?: Attribute[],
    limit?: number,
    businessDateTo?: Date | null,
  ): Promise<Row[]>;
}

let _runner: QueryRunner | null = null;

export function registerRunner(runner: QueryRunner): void { _runner = runner; }
export function clearRunner(): void { _runner = null; }
export function getRunner(): QueryRunner {
  if (!_runner) throw new Error('No query runner registered. Call registerRunner() first.');
  return _runner;
}

export class FinderResult {
  private _orderBy: SortOperation[] = [];
  private _groupBy: Attribute[] = [];
  private _limit?: number;

  constructor(
    private readonly _businessDate: Date | null,
    private readonly _processingDatetime: Date | null,
    private readonly _columns: (Attribute | RelationalOperationElement)[],
    private readonly _table: QueryTarget,
    private readonly _op: RelationalOperationElement,
    private readonly _businessDateTo: Date | null = null,
  ) {}

  orderByOp(...sorts: SortOperation[]): this {
    this._orderBy = sorts;
    return this;
  }

  groupByOp(...attrs: Attribute[]): this {
    this._groupBy = attrs;
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  toSql(): string {
    return toSql(
      this._businessDate,
      this._processingDatetime,
      this._columns,
      this._table as Table,
      this._op,
      this._orderBy,
      this._groupBy,
      this._limit,
      this._businessDateTo,
    );
  }

  async toRows(): Promise<Row[]> {
    return getRunner().select(
      this._businessDate,
      this._processingDatetime,
      this._columns,
      this._table,
      this._op,
      this._orderBy,
      this._groupBy,
      this._limit,
      this._businessDateTo,
    );
  }
}

function convertDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  // Date-only strings (YYYY-MM-DD) must be parsed as UTC to avoid timezone-shift bugs.
  // new Date('2023-01-15') already parses as UTC midnight, so this is consistent.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00Z' : value;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) throw new Error(`Cannot parse date: ${value}`);
  return d;
}

export function convertInputsAndSelect(
  businessDate: Date | string | null,
  processingDatetime: Date | string | null,
  columns: (Attribute | RelationalOperationElement)[],
  table: QueryTarget,
  op: RelationalOperationElement = new NoOperation(),
): FinderResult {
  return new FinderResult(
    convertDate(businessDate),
    convertDate(processingDatetime),
    columns,
    table,
    op,
  );
}

export function convertInputsAndSelectForDateRange(
  businessDateFrom: Date | string,
  businessDateTo: Date | string,
  processingDatetime: Date | string,
  columns: (Attribute | RelationalOperationElement)[],
  table: QueryTarget,
  op: RelationalOperationElement = new NoOperation(),
): FinderResult {
  if (businessDateFrom == null) throw new Error('businessDateFrom is required for findForDateRange');
  if (businessDateTo == null) throw new Error('businessDateTo is required for findForDateRange');
  if (processingDatetime == null) throw new Error('processingValidAt is required for findForDateRange');
  return new FinderResult(
    convertDate(businessDateFrom),
    convertDate(processingDatetime),
    columns,
    table,
    op,
    convertDate(businessDateTo),
  );
}
