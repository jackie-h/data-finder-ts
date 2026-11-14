import { MilestonedTable } from './milestoning';
import {
  Alias, Column, NoOperation, QuerySpecification, type RelationalOperationElement, Table, containsAggregate, containsAggregateOrWindow,
} from './relational';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Raised when a view definition can't be made reproducible or unambiguous. */
export class ViewDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewDefinitionError';
  }
}

function checkIdentifier(kind: string, value: unknown): void {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new ViewDefinitionError(`${kind} ${JSON.stringify(value)} must be a plain identifier (letters, digits, underscores)`);
  }
}

/**
 * A SQL view definition: a named query specification over a root table, with no dates.
 *
 * A view can hold what ANSI SQL allows in a view's query expression, which is everything a QuerySpecification has: joins, a
 * filter, grouping, aggregates and window functions. It has no ORDER BY or row limit.
 *
 * Its columns are the projection plus the root table's milestoning columns, so consumers choose the point in time when they
 * query it. If the view is grouped, the root's milestoning columns are grouped by too, so each group is a set of rows with the
 * same validity.
 *
 * Construction checks what can be checked from the definition alone. Whether its joins can be pinned to the root row's point in
 * time depends on how the joins are resolved, so that is checked by the SQL generator (`checkViewJoins`).
 *
 * Python's View is also a NamedRelation; one class cannot extend two here, so it has the name and schema itself.
 */
export class View extends QuerySpecification {
  declare readonly table: Table;
  readonly projection: readonly Alias[];
  readonly name: string;
  readonly schema: string;

  constructor(name: string, schema: string, table: Table, projection: readonly Alias[], filter?: RelationalOperationElement, groupBy: RelationalOperationElement[] = []) {
    checkIdentifier('View name', name);
    checkIdentifier('Schema name', schema);
    const milestoning = table instanceof MilestonedTable ? table.milestoningColumns.columns() : [];
    const milestoningAliases = milestoning.map(c => new Alias(new Column(c.name, c.type, table), c.name));
    const grouped = [...groupBy];
    if (grouped.length > 0 || projection.some(column => containsAggregate(column))) {
      grouped.push(...milestoningAliases.map(alias => alias.element));
    }
    super([...projection, ...milestoningAliases], filter ?? new NoOperation(), grouped, table);
    this.projection = [...projection];
    this.name = name;
    this.schema = schema;
    this.validate();
  }

  get qualifiedName(): string { return this.schema + '.' + this.name; }

  /** Projected column names followed by the root's milestoning columns. */
  columnNames(): string[] {
    return this.columns.map(column => (column as Alias).name);
  }

  private validate(): void {
    if (this.projection.length === 0) throw new ViewDefinitionError('A view needs at least one projected column');
    for (const column of this.projection) {
      if (!(column instanceof Alias)) {
        throw new ViewDefinitionError(`Every projected column needs a name, not a bare ${(column as object).constructor.name}`);
      }
    }
    if (containsAggregateOrWindow(this.filter)) throw new ViewDefinitionError("A view's filter can't contain aggregates, windows or counts");
    if (this.groupBy.some(expression => containsAggregateOrWindow(expression))) {
      throw new ViewDefinitionError("A view can't group by aggregates, windows or counts");
    }
    const names = this.columnNames().map(n => n.toLowerCase());
    const duplicates = [...new Set(names.filter(n => names.filter(m => m === n).length > 1))].sort();
    if (duplicates.length > 0) throw new ViewDefinitionError(`Projected columns resolve to the same name: ${JSON.stringify(duplicates)}`);
  }
}
