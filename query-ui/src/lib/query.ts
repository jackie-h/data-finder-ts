/** The state of the query panel, and what it turns into. */
import type { FilterOperator, FilterSpec, MappingMetadata, QuerySpec, SelectSpec, AggregateName } from '@datafinder';
import { operatorsFor, resolvePath } from '@datafinder';
import type { Settings } from './settings';

export interface FilterRow { id: number; path: string; op: FilterOperator; value: string; value2: string }

export interface QueryState {
  root: string;
  columns: { path: string; aggregate?: AggregateName }[];
  filters: FilterRow[];
  businessDate: string;
  processingTime: string;
}

export const emptyQuery = (root: string): QueryState => ({ root, columns: [], filters: [], businessDate: '', processingTime: '' });

/** The paths a query shows as they are, which it groups by when other columns are summed or counted. */
export function groupedBy(state: QueryState): string[] {
  return state.columns.some(c => c.aggregate !== undefined) ? state.columns.filter(c => c.aggregate === undefined).map(c => c.path) : [];
}

/** A filter row with a value to compare with, which is the only kind a query can use. */
export function isComplete(metadata: MappingMetadata, root: string, row: FilterRow): boolean {
  const info = operatorsFor(resolvePath(metadata, root, row.path).property.type).find(o => o.op === row.op);
  if (info === undefined) return false;
  if (info.values === 0) return true;
  if (info.values === 2) return row.value.trim() !== '' && row.value2.trim() !== '';
  return row.value.trim() !== '';
}

/** The description the query builder takes. Filters still without a value are left out, as a half-written one is not a mistake. */
export function toSpec(metadata: MappingMetadata, state: QueryState, settings: Settings): QuerySpec {
  const select: SelectSpec[] = state.columns.map(c => ({ path: c.path, ...(c.aggregate ? { aggregate: c.aggregate } : {}) }));
  const where: FilterSpec[] = state.filters.filter(f => isComplete(metadata, state.root, f)).map(f => ({
    path: f.path, op: f.op, value: f.value, ...(f.op === 'between' ? { value2: f.value2 } : {}),
  }));
  return {
    root: state.root, select, where, limit: settings.rowLimit,
    dates: {
      businessDate: state.businessDate.trim() === '' ? null : state.businessDate.trim(),
      processingTime: state.processingTime.trim() === '' ? null : state.processingTime.trim(),
    },
  };
}
