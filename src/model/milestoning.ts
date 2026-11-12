import { Column, Table, Schema, TableAlias, type Relation } from './relational';

export abstract class MilestoningColumns {
  abstract columns(): Column[];
}

/** A processing range. `processingInfiniteDatetime` is what its end holds in a row that has not ended, or `undefined` when that end is NULL. */
export class ProcessingTemporalColumns extends MilestoningColumns {
  constructor(
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    readonly processingInfiniteDatetime?: string,
  ) { super(); }

  columns(): Column[] { return [this.startAtColumn, this.endAtColumn]; }
}

export class SingleBusinessDateColumn extends MilestoningColumns {
  constructor(readonly businessDateColumn: Column) { super(); }

  columns(): Column[] { return [this.businessDateColumn]; }
}

export class BusinessDateAndProcessingTemporalColumns extends MilestoningColumns {
  constructor(
    readonly businessDateColumn: Column,
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    readonly processingInfiniteDatetime?: string,
  ) { super(); }

  columns(): Column[] {
    return [this.businessDateColumn, this.startAtColumn, this.endAtColumn];
  }
}

/** A processing snapshot: one datetime column holding the processing time a row was taken at, which a query's processing time must equal. */
export class SingleProcessingDatetimeColumn extends MilestoningColumns {
  constructor(readonly processingDatetimeColumn: Column) { super(); }

  columns(): Column[] { return [this.processingDatetimeColumn]; }
}

/**
 * A business date range: a row applies from `businessDateFrom` up to, but not including, `businessDateTo`.
 * `businessInfiniteDatetime` is what the end holds in a row that has not ended, or `undefined` when that end is NULL.
 */
export class BusinessDateRangeColumns extends MilestoningColumns {
  constructor(
    readonly businessDateFromColumn: Column,
    readonly businessDateToColumn: Column,
    readonly businessInfiniteDatetime?: string,
  ) { super(); }

  columns(): Column[] { return [this.businessDateFromColumn, this.businessDateToColumn]; }
}

/** Each axis has its own infinity: one can end in a datetime and the other in a date, or one in an infinity and the other in NULL (`undefined`). */
export class BiTemporalColumns extends BusinessDateRangeColumns {
  constructor(
    businessDateFromColumn: Column,
    businessDateToColumn: Column,
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    readonly processingInfiniteDatetime?: string,
    businessInfiniteDatetime?: string,
  ) { super(businessDateFromColumn, businessDateToColumn, businessInfiniteDatetime); }

  columns(): Column[] {
    return [
      this.businessDateFromColumn,
      this.businessDateToColumn,
      this.startAtColumn,
      this.endAtColumn,
    ];
  }
}

/** Milestoning columns with a processing range (a start and an end): the processing-temporal kinds. */
export type ProcessingRangeColumns = ProcessingTemporalColumns | BusinessDateAndProcessingTemporalColumns | BiTemporalColumns;

export function hasProcessingRange(mc: MilestoningColumns): mc is ProcessingRangeColumns {
  return mc instanceof ProcessingTemporalColumns || mc instanceof BusinessDateAndProcessingTemporalColumns
    || mc instanceof BiTemporalColumns;
}

export class MilestonedTable extends Table {
  constructor(
    name: string,
    columns: Column[],
    readonly milestoningColumns: MilestoningColumns,
    schema?: Schema,
  ) {
    super(name, columns, schema);
    for (const col of milestoningColumns.columns()) {
      col.owner = this;
    }
  }
}

/**
 * The columns that milestone a relation's rows: a milestoned table's, or those of a query a class is mapped to with a milestoning
 * scheme; none for a relation that is not milestoned.
 */
export function milestoningColumnsOf(relation: Relation | undefined): MilestoningColumns | undefined {
  if (relation instanceof MilestonedTable) return relation.milestoningColumns;
  if (relation instanceof TableAlias) return relation.milestoningColumns;
  return undefined;
}
