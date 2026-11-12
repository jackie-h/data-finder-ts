import { useState } from 'react';
import type { MappingMetadata } from '@datafinder';
import { childrenOf } from '../lib/tree';

interface Props {
  metadata: MappingMetadata;
  root: string;
  maxDepth: number;
  selected: string[];
  onToggle: (path: string) => void;
}

/** The properties of the start class and, as each relation is opened, those of the classes it reaches. */
export function PropertyTree({ metadata, root, maxDepth, selected, onToggle }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const list = (className: string, prefix: string, depth: number) => (
    <ul className="tree">
      {childrenOf(metadata, className, prefix, depth, maxDepth).map(node => {
        if (node.kind === 'property') {
          return (
            <li key={node.path} className="node">
              <input type="checkbox" id={`p-${node.path}`} checked={selected.includes(node.path)} onChange={() => onToggle(node.path)} />
              <label htmlFor={`p-${node.path}`} title={node.description}>{node.label}</label>
              <span className="type">{node.type}</span>
            </li>
          );
        }
        const expanded = node.withinDepth && open[node.path] === true;
        return (
          <li key={node.path}>
            <div className={node.withinDepth ? 'node' : 'node limit'}>
              <button type="button" className="twisty" disabled={!node.withinDepth} aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
                onClick={() => setOpen({ ...open, [node.path]: !expanded })}>{expanded ? '▾' : '▸'}</button>
              <span className="relation">{node.label}</span>
              <span className="mult">{node.many ? '*' : node.optional ? '0..1' : '1'}</span>
              {!node.withinDepth && <span className="note-pill">beyond max depth</span>}
            </div>
            {expanded && list(node.target, node.path, node.depth)}
          </li>
        );
      })}
    </ul>
  );

  return list(root, '', 0);
}
