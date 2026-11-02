import { Column, Table, Schema } from './relational';

export abstract class MilestoningColumns {
  abstract columns(): Column[];
}

export class ProcessingTemporalColumns extends MilestoningColumns {
  constructor(
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    readonly infiniteDatetime?: string,
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
    readonly infiniteDatetime?: string,
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

/** A business date range: a row applies from `businessDateFrom` up to, but not including, `businessDateTo`. */
export class BusinessDateRangeColumns extends MilestoningColumns {
  constructor(
    readonly businessDateFromColumn: Column,
    readonly businessDateToColumn: Column,
    readonly infiniteDatetime?: string,
  ) { super(); }

  columns(): Column[] { return [this.businessDateFromColumn, this.businessDateToColumn]; }
}

export class BiTemporalColumns extends BusinessDateRangeColumns {
  constructor(
    businessDateFromColumn: Column,
    businessDateToColumn: Column,
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    infiniteDatetime?: string,
  ) { super(businessDateFromColumn, businessDateToColumn, infiniteDatetime); }

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
      col.table = this;
    }
  }
}
