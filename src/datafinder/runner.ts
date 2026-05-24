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

export interface QueryRunner {
  select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: Table,
    op: RelationalOperationElement,
    orderBy?: SortOperation[],
    groupBy?: Attribute[],
    limit?: number,
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
    private readonly _table: Table,
    private readonly _op: RelationalOperationElement,
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
      this._table,
      this._op,
      this._orderBy,
      this._groupBy,
      this._limit,
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
  table: Table,
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
