/** The tree of what a query can show: the properties of a class and, through its relations, those of the classes it reaches. */
import type { ClassMetadata, MappingMetadata, PropertyType } from 'data-finder-ts';

export interface PropertyNode {
  kind: 'property';
  path: string;
  label: string;
  type: PropertyType;
  optional: boolean;
  description?: string;
}

export interface RelationNode {
  kind: 'relation';
  path: string;
  label: string;
  many: boolean;
  optional: boolean;
  target: string;
  /** How many joins from the start class it takes to get here. */
  depth: number;
  /** False when it is deeper than the limit: it is listed, but its contents are not offered. */
  withinDepth: boolean;
}

export type TreeNode = PropertyNode | RelationNode;

export function classNamed(metadata: MappingMetadata, name: string): ClassMetadata {
  const found = metadata.classes.find(c => c.name === name);
  if (found === undefined) throw new Error(`No class '${name}'`);
  return found;
}

/** The nodes directly under a class reached by `prefix` (empty at the start class), properties first. */
export function childrenOf(metadata: MappingMetadata, className: string, prefix: string, depth: number, maxDepth: number): TreeNode[] {
  const cls = classNamed(metadata, className);
  const at = (id: string) => (prefix === '' ? id : `${prefix}.${id}`);
  const properties: PropertyNode[] = cls.properties.map(p => ({
    kind: 'property', path: at(p.id), label: p.label, type: p.type, optional: p.optional, description: p.description,
  }));
  const relations: RelationNode[] = cls.relations.map(r => ({
    kind: 'relation', path: at(r.id), label: r.label, many: r.many, optional: r.optional, target: r.target,
    depth: depth + 1, withinDepth: depth + 1 <= maxDepth,
  }));
  return [...properties, ...relations];
}

/** The class a relation path leads to. */
export function classAt(metadata: MappingMetadata, root: string, relationPath: string): string {
  let current = root;
  for (const step of relationPath === '' ? [] : relationPath.split('.')) {
    const relation = classNamed(metadata, current).relations.find(r => r.id === step);
    if (relation === undefined) throw new Error(`'${relationPath}': ${current} has no relation '${step}'`);
    current = relation.target;
  }
  return current;
}

/** Every property a query can use from this class within the depth limit, with the path of display names that leads to it. */
export function allProperties(metadata: MappingMetadata, root: string, maxDepth: number): (PropertyNode & { trail: string })[] {
  const found: (PropertyNode & { trail: string })[] = [];
  const walk = (className: string, prefix: string, trail: string[], depth: number) => {
    for (const node of childrenOf(metadata, className, prefix, depth, maxDepth)) {
      if (node.kind === 'property') found.push({ ...node, trail: [...trail, node.label].join(' › ') });
      else if (node.withinDepth) walk(node.target, node.path, [...trail, node.label], depth + 1);
    }
  };
  walk(root, '', [], 0);
  return found;
}

/** The display name of a property path, as `Account › Branch › City`. */
export function labelOf(metadata: MappingMetadata, root: string, path: string): string {
  const labels: string[] = [];
  let current = classNamed(metadata, root);
  const steps = path.split('.');
  for (const step of steps.slice(0, -1)) {
    const relation = current.relations.find(r => r.id === step);
    if (relation === undefined) return path;
    labels.push(relation.label);
    current = classNamed(metadata, relation.target);
  }
  labels.push(current.properties.find(p => p.id === steps[steps.length - 1])?.label ?? path);
  return labels.join(' › ');
}

/** Whether any class a query could reach (within the depth limit) has a business date, or a processing time. */
export function datesNeeded(metadata: MappingMetadata, root: string, maxDepth: number): { businessDate: boolean; processingTime: boolean } {
  const needed = { businessDate: false, processingTime: false };
  const seen = new Set<string>();
  const walk = (className: string, depth: number) => {
    const key = `${className}@${depth}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cls = classNamed(metadata, className);
    if (cls.dates?.businessDate) needed.businessDate = true;
    if (cls.dates?.processingTime) needed.processingTime = true;
    if (depth < maxDepth) for (const r of cls.relations) walk(r.target, depth + 1);
  };
  walk(root, 0);
  return needed;
}
