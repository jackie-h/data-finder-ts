/**
 * What a query tool needs to know about a mapping without reading its finders: the classes with their display names,
 * the properties each holds and the relations each reaches, by the name of the finder method that gives each. The
 * generator writes one `<Mapping>Metadata.ts` per mapping with this shape.
 */

/** A primitive property's type, as the model names it. */
export type PropertyType = 'String' | 'Integer' | 'Float' | 'Double' | 'Decimal' | 'Boolean' | 'Date' | 'DateTime';

export interface PropertyMetadata {
  id: string;
  /** The finder method that gives the attribute. */
  accessor: string;
  /** The display name. */
  label: string;
  type: PropertyType;
  optional: boolean;
  description?: string;
}

export interface RelationMetadata {
  id: string;
  /** The finder method that gives the related finder. */
  accessor: string;
  label: string;
  /** The name of the class it reaches. */
  target: string;
  many: boolean;
  optional: boolean;
  description?: string;
}

export interface ClassMetadata {
  name: string;
  /** The class name as words. */
  label: string;
  description?: string;
  properties: PropertyMetadata[];
  relations: RelationMetadata[];
  /** The dates a query of the class is given, `null` when the class has no milestoning. */
  dates: { businessDate: boolean; processingTime: boolean } | null;
}

export interface MappingMetadata {
  name: string;
  /** The name of the generated context class that holds a finder for each class. */
  context: string;
  classes: ClassMetadata[];
}
