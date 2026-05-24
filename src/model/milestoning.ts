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

export class BiTemporalColumns extends MilestoningColumns {
  constructor(
    readonly businessDateFromColumn: Column,
    readonly businessDateToColumn: Column,
    readonly startAtColumn: Column,
    readonly endAtColumn: Column,
    readonly infiniteDatetime?: string,
  ) { super(); }

  columns(): Column[] {
    return [
      this.businessDateFromColumn,
      this.businessDateToColumn,
      this.startAtColumn,
      this.endAtColumn,
    ];
  }
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
