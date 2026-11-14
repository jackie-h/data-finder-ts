import { operatorsFor, type FilterOperator, type MappingMetadata } from 'data-finder-ts';
import { allProperties } from '../lib/tree';
import type { FilterRow, QueryState } from '../lib/query';

interface Props {
  metadata: MappingMetadata;
  state: QueryState;
  maxDepth: number;
  onChange: (filters: FilterRow[]) => void;
}

let nextId = 1;

export function FilterList({ metadata, state, maxDepth, onChange }: Props) {
  const properties = allProperties(metadata, state.root, maxDepth);
  const byPath = new Map(properties.map(p => [p.path, p]));
  const patch = (id: number, change: Partial<FilterRow>) => onChange(state.filters.map(f => (f.id === id ? { ...f, ...change } : f)));

  const add = () => {
    const first = properties[0];
    if (first === undefined) return;
    onChange([...state.filters, { id: nextId++, path: first.path, op: operatorsFor(first.type, first.optional)[0].op, value: '', value2: '' }]);
  };

  return (
    <div>
      {state.filters.map(f => {
        const property = byPath.get(f.path);
        const operators = property ? operatorsFor(property.type, property.optional) : [];
        const info = operators.find(o => o.op === f.op);
        return (
          <div className="filter" key={f.id}>
            <select className="wide" aria-label="Filter property" value={f.path}
              onChange={e => {
                const next = byPath.get(e.target.value)!;
                patch(f.id, { path: next.path, op: operatorsFor(next.type, next.optional)[0].op, value: '', value2: '' });
              }}>
              {properties.map(p => <option key={p.path} value={p.path}>{p.trail}</option>)}
            </select>
            <select aria-label="Operator" value={f.op} onChange={e => patch(f.id, { op: e.target.value as FilterOperator })}>
              {operators.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {info && info.values !== 0 ? (
              <input type="text" aria-label="Value" value={f.value} placeholder={info.values === 'many' ? 'a, b, c' : 'value'}
                onChange={e => patch(f.id, { value: e.target.value })} />
            ) : <span />}
            {info?.values === 2 && (
              <input type="text" aria-label="Upper value" className="wide" value={f.value2} placeholder="and"
                onChange={e => patch(f.id, { value2: e.target.value })} />
            )}
            <button type="button" className="link wide" onClick={() => onChange(state.filters.filter(x => x.id !== f.id))}>Remove</button>
          </div>
        );
      })}
      <button type="button" onClick={add}>+ Add filter</button>
    </div>
  );
}
