import { aggregatesFor, AGGREGATE_LABELS, resolvePath, type AggregateName, type MappingMetadata } from '@datafinder';
import { labelOf } from '../lib/tree';
import type { QueryState } from '../lib/query';

interface Props {
  metadata: MappingMetadata;
  state: QueryState;
  onChange: (columns: QueryState['columns']) => void;
}

/** The columns the result shows, each as it is or summarised. Columns shown as they are become the group when others are summarised. */
export function ColumnList({ metadata, state, onChange }: Props) {
  if (state.columns.length === 0) return <p className="hint">Tick properties in the tree to add columns.</p>;
  const update = (index: number, aggregate: AggregateName | undefined) =>
    onChange(state.columns.map((c, i) => (i === index ? { path: c.path, ...(aggregate ? { aggregate } : {}) } : c)));
  return (
    <ul className="columns">
      {state.columns.map((c, i) => {
        const type = resolvePath(metadata, state.root, c.path).property.type;
        return (
          <li key={c.path} className="column">
            <span className="column-name" title={labelOf(metadata, state.root, c.path)}>{labelOf(metadata, state.root, c.path)}</span>
            <select aria-label={`Show ${labelOf(metadata, state.root, c.path)} as`} value={c.aggregate ?? ''}
              onChange={e => update(i, (e.target.value || undefined) as AggregateName | undefined)}>
              <option value="">Value</option>
              {aggregatesFor(type).map(a => <option key={a} value={a}>{AGGREGATE_LABELS[a]}</option>)}
            </select>
            <button type="button" className="icon" aria-label={`Remove ${labelOf(metadata, state.root, c.path)}`}
              onClick={() => onChange(state.columns.filter((_, j) => j !== i))}>×</button>
          </li>
        );
      })}
    </ul>
  );
}
