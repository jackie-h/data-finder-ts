import json
import os
import re

from jinja2 import Environment, FileSystemLoader

from model.m3 import PrimitiveType, Property, Association
from model.mapping import (
    Mapping,
    MilestonePropertyMapping,
    ProcessingDateMilestonesPropertyMapping,
    SingleBusinessDateMilestonePropertyMapping,
    BusinessDateAndProcessingMilestonePropertyMapping,
    BiTemporalMilestonePropertyMapping,
    BusinessDateRangeMilestonePropertyMapping,
    SingleProcessingDatetimeMilestonePropertyMapping,
)
from model.relational import Column, Table
from model.relational_mapping import Join, EmbeddedSetMapping

_TS_RESERVED = {
    # JavaScript reserved words — cannot be used as identifiers
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
    'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
    'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'while',
    'with', 'yield',
    # TypeScript strict-mode reserved
    'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'static',
}


def is_primitive(prop: Property) -> bool:
    return isinstance(prop.type, PrimitiveType)


def has_processing_temporal(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, ProcessingDateMilestonesPropertyMapping)


def has_uni_business_temporal(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, SingleBusinessDateMilestonePropertyMapping)


def has_business_date_and_processing(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, BusinessDateAndProcessingMilestonePropertyMapping)


def has_bitemporal(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, BiTemporalMilestonePropertyMapping)


def has_business_date_range(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, BusinessDateRangeMilestonePropertyMapping) and not isinstance(mapping, BiTemporalMilestonePropertyMapping)


def has_processing_snapshot(mapping: MilestonePropertyMapping) -> bool:
    return isinstance(mapping, SingleProcessingDatetimeMilestonePropertyMapping)


def owner_code(table: Table) -> str:
    """TypeScript source for the relation a column or an attribute belongs to: a table of that name, whose columns this
    finder does not need to know."""
    return f"new Table('{table_qualified_name(table)}', [])"


def column_code(column: Column, keyed: bool = True) -> str:
    """TypeScript source that builds ``column`` in a generated finder. ``keyed`` False leaves out its primary key flag."""
    key = ", true" if column.primary_key and keyed else ""
    return f"new Column('{column.name}', '{column.type}', {owner_code(column.table)}{key})"


def _scheme_columns_code(table: Table) -> str:
    """TypeScript source for the milestoning columns of a table a join passes through, from its milestoning scheme."""
    scheme = table.milestoning_scheme
    assert scheme is not None
    by_name = {c.name: c for c in table.columns}

    def col(name: str | None) -> str:
        column = by_name.get(name or "")
        if column is None:
            raise ValueError(f"Table '{table.name}': milestoning column '{name}' of scheme '{scheme.name}' is not a column")
        return f"new Column('{column.name}', '{column.type}')"

    infinite = f", '{scheme.infinite_datetime}'" if scheme.infinite_datetime else ""
    if scheme.processing_datetime:
        return f"new SingleProcessingDatetimeColumn({col(scheme.processing_datetime)})"
    if scheme.processing_start and (scheme.business_date_from or scheme.business_date_to):
        return (f"new BiTemporalColumns({col(scheme.business_date_from)}, {col(scheme.business_date_to)}, "
                f"{col(scheme.processing_start)}, {col(scheme.processing_end)}{infinite})")
    if scheme.processing_start and scheme.business_date:
        return (f"new BusinessDateAndProcessingTemporalColumns({col(scheme.business_date)}, {col(scheme.processing_start)}, "
                f"{col(scheme.processing_end)}{infinite})")
    if scheme.processing_start:
        return f"new ProcessingTemporalColumns({col(scheme.processing_start)}, {col(scheme.processing_end)}{infinite})"
    if scheme.business_date_from or scheme.business_date_to:
        return f"new BusinessDateRangeColumns({col(scheme.business_date_from)}, {col(scheme.business_date_to)}{infinite})"
    if scheme.business_date:
        return f"new SingleBusinessDateColumn({col(scheme.business_date)})"
    raise ValueError(f"Milestoning scheme '{scheme.name}' has no columns")


def table_code(table: Table) -> str:
    """TypeScript source that builds ``table`` in a generated finder."""
    qualified = table_qualified_name(table)
    if table.milestoning_scheme is not None:
        milestoned = {c.name for c in _scheme_milestoning_columns(table)}
        columns = ", ".join(column_code(c) for c in table.columns if c.name not in milestoned)
        return f"new MilestonedTable('{qualified}', [{columns}], {_scheme_columns_code(table)})"
    columns = ", ".join(column_code(c) for c in table.columns)
    return f"new Table('{qualified}', [{columns}])"


def _scheme_milestoning_columns(table: Table) -> list:
    scheme = table.milestoning_scheme
    names = {scheme.processing_start, scheme.processing_end, scheme.business_date, scheme.business_date_from,
             scheme.business_date_to, scheme.processing_datetime} - {None}
    return [c for c in table.columns if c.name in names]


def parent_expr(join: Join, parent: str, with_dates: bool = False) -> str:
    """The parent step of the join to a property's class: ``parent`` itself, or, when the property is mapped through
    other tables first, ``parent`` followed by a step through each of them. ``with_dates`` gives each of those steps the
    ``dates`` the property was asked for with."""
    if not join.via:
        return parent
    # The columns of a step through a class-less table are written without key flags, as the data-finder specs run them
    # (their expected SQL has the join's own order, not the key-first order the flags would give).
    hops = ", ".join(f"[{column_code(lhs, False)}, {table_code(rhs.table)}, {column_code(rhs, False)}]" for lhs, rhs in join.via)
    dates = (", dates?.businessDate == null ? null : convertDate(dates.businessDate)"
             ", dates?.processingTime == null ? null : convertProcessingDate(dates.processingTime)") if with_dates else ""
    return f"viaJoins({parent}, [{hops}]{dates})"


def display_name(prop: Property) -> str:
    return prop.name


def get_doc(obj) -> str:
    """Return the doc tagged value text, or empty string if absent."""
    tv = getattr(obj, 'tagged_values', {}).get('doc')
    return tv.value if tv else ''


def prop_jsdoc(prop: Property) -> str:
    """Return a JSDoc line for a property method: friendly name + optional description."""
    doc = get_doc(prop)
    if doc:
        return f'/** {prop.name} — {doc} */'
    return f'/** {prop.name} */'


def to_ts_name(prop: Property) -> str:
    """The TypeScript method name of a property: its camelCase id (``legalName``)."""
    result = prop.id
    if result in _TS_RESERVED:
        result += '_'
    return result


def to_camel_case(name: str) -> str:
    """Convert PascalCase to camelCase for property names in context class."""
    if not name:
        return name
    return name[0].lower() + name[1:]


def table_qualified_name(table) -> str:
    return table.qualified_name


def flatten_embedded(join: Join) -> list:
    """Flatten a Join's embedded EmbeddedSetMapping (if any) into (dotted_path, leaf_property, column)
    triples, relative to the related class (e.g. 'name', 'branch.city' — not 'account.name').

    Returns [] when the join has no embedded mapping, so templates can gate codegen on it.
    """
    if join is None or join.embedded is None:
        return []
    result: list[tuple[str, Property, Column]] = []

    def _walk(esm: EmbeddedSetMapping, prefix: str):
        for pm in esm.property_mappings:
            dotted = f'{prefix}.{pm.property.id}' if prefix else pm.property.id
            if isinstance(pm.target, Column):
                result.append((dotted, pm.property, pm.target))
            elif isinstance(pm.target, EmbeddedSetMapping):
                _walk(pm.target, dotted)

    _walk(join.embedded, '')
    return result


def embedded_optional(join: Join) -> dict[str, bool]:
    """For each dotted path ``flatten_embedded`` gives, whether the value can be missing because the leaf property or
    one of the embedded properties on the way to it is optional (its multiplicity starts at 0)."""
    result: dict[str, bool] = {}
    if join is None or join.embedded is None:
        return result

    def _walk(esm: EmbeddedSetMapping, prefix: str, optional: bool):
        for pm in esm.property_mappings:
            dotted = f'{prefix}.{pm.property.id}' if prefix else pm.property.id
            here = optional or pm.property.multiplicity.lower == 0
            if isinstance(pm.target, Column):
                result[dotted] = here
            elif isinstance(pm.target, EmbeddedSetMapping):
                _walk(pm.target, dotted, here)

    _walk(join.embedded, '', False)
    return result


class _ClassView:
    """A class mapping as the finder templates see it: the properties reached by a join or held in a column, with the
    embedded (join-less) ones apart in ``embedded_mappings``."""

    def __init__(self, rcm):
        self.clazz = rcm.clazz
        self.milestone_mapping = rcm.milestone_mapping
        self.property_mappings = [pm for pm in rcm.property_mappings if not isinstance(pm.target, EmbeddedSetMapping)]
        self.embedded_mappings = [pm for pm in rcm.property_mappings if isinstance(pm.target, EmbeddedSetMapping)]


class EmbeddedClass:
    """A class embedded in its owner's row: its properties are columns of the owner's table, so it needs no join."""

    def __init__(self, name: str, label: str, columns: list, children: list, optional: bool = False,
                 joins: list | None = None):
        self.name = name
        self.label = label
        self.columns = columns
        self.children = children
        # the properties of this class that reach another table, each with the join that does
        self.joins = joins or []
        # whether the embedded property that holds this class, or one above it, is optional
        self.optional = optional


def embedded_classes(rcm: _ClassView) -> list[EmbeddedClass]:
    """The embedded classes of a class mapping, nested ones before the classes that hold them."""
    found: list[EmbeddedClass] = []

    def _walk(esm: EmbeddedSetMapping, stem: str, label: str, optional: bool) -> str:
        columns, children, joins = [], [], []
        for pm in esm.property_mappings:
            if isinstance(pm.target, Column):
                columns.append((pm.property, pm.target))
            elif isinstance(pm.target, Join):
                joins.append((pm.property, pm.target))
            elif isinstance(pm.target, EmbeddedSetMapping):
                child = _walk(pm.target, stem + pm.property.id[:1].upper() + pm.property.id[1:], f"{label} {pm.property.name}",
                              optional or pm.property.multiplicity.lower == 0)
                children.append((pm.property, child))
        found.append(EmbeddedClass(stem + "Embedded", label, columns, children, optional, joins))
        return stem + "Embedded"

    for pm in rcm.embedded_mappings:
        _walk(pm.target, f"_{rcm.clazz.name}{pm.property.id[:1].upper()}{pm.property.id[1:]}", pm.property.name,
              pm.property.multiplicity.lower == 0)
    return found


_FILTER_TS_TYPES = {
    'String': 'string', 'Integer': 'number', 'Float': 'number', 'Double': 'number', 'Decimal': 'number',
    'Boolean': 'boolean', 'Date': 'Date', 'DateTime': 'Date',
}


def filter_ts_type(prop: Property) -> str:
    """TypeScript type of the value a related-finder filter accepts for a primitive property."""
    return _FILTER_TS_TYPES.get(prop.type.name, 'string')


def get_used_attr_types(rcm) -> list:
    """Return ordered list of TypeScript attribute type names used in this mapping."""
    seen = set()
    result = []

    def _add(prop):
        t = prop.type.name + 'Attribute'
        if t not in seen:
            seen.add(t)
            result.append(t)

    for rpm in rcm.property_mappings:
        if is_primitive(rpm.property):
            _add(rpm.property)
        elif rpm.property.type.name != rcm.clazz.name:
            for _, leaf_prop, _ in flatten_embedded(rpm.target):
                _add(leaf_prop)
    for ec in embedded_classes(rcm):
        for prop, _ in ec.columns:
            _add(prop)
    return result


def _mapping_to_class_name(name: str) -> str:
    parts = re.split(r'[\s_]+', name)
    return ''.join(p[0].upper() + p[1:] for p in parts if p) + 'Context'


def _mapping_to_filename(name: str) -> str:
    parts = re.split(r'[\s_]+', name)
    return ''.join(p[0].upper() + p[1:] for p in parts if p) + 'Context.ts'


def _build_association_lookup(mapping: Mapping) -> dict:
    result = {}
    seen_assocs = set()
    for rcm in mapping.mappings:
        if rcm.clazz.package:
            for child in rcm.clazz.package.children:
                if isinstance(child, Association) and id(child) not in seen_assocs:
                    seen_assocs.add(id(child))
                    result[(child.source, child.target, child.source_property.id)] = child
    return result


def _build_reverse_assoc_map(mapping: Mapping, assoc_lookup: dict) -> dict:
    reverse_map = {}
    for rcm in mapping.mappings:
        for rpm in rcm.property_mappings:
            if is_primitive(rpm.property) or not isinstance(rpm.target, Join) or rpm.target.via:
                continue
            target_cls = rpm.property.type
            assoc = assoc_lookup.get((rcm.clazz.name, target_cls.name, rpm.property.id))
            if assoc is None:
                continue
            if assoc.target_property is None:
                continue  # a one-way association gives the target class no accessor back
            reverse_name = assoc.target_property.id
            reverse_map.setdefault(target_cls.name, []).append((rcm, rpm, assoc, reverse_name))
    return reverse_map


def humanize(name: str) -> str:
    """A class name as words: ``LegalEntity`` is ``Legal Entity``."""
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', name)


def milestone_dates(mapping: MilestonePropertyMapping | None) -> dict | None:
    """Which dates a query of a milestoned class is given (``None`` when the class has no milestoning): the business
    date for a class with a business date, the processing time for one with a processing time, as findAll takes them."""
    if mapping is None:
        return None
    business = any(f(mapping) for f in (has_uni_business_temporal, has_business_date_and_processing, has_bitemporal,
                                       has_business_date_range))
    processing = any(f(mapping) for f in (has_processing_temporal, has_business_date_and_processing, has_bitemporal,
                                         has_processing_snapshot))
    return {'businessDate': business, 'processingTime': processing}


def mapping_metadata(mapping: Mapping, reverse_assoc_map: dict) -> dict:
    """What a query tool needs to know about a mapping without its finders' source: for each class its display name,
    the properties it holds and the relations it reaches, by the name of the accessor that gives each."""
    classes = []
    for rcm in mapping.mappings:
        view = _ClassView(rcm)
        properties, relations = [], []
        for pm in view.property_mappings:
            prop = pm.property
            doc = get_doc(prop)
            if is_primitive(prop):
                entry = {'id': prop.id, 'accessor': to_ts_name(prop), 'label': prop.name, 'type': prop.type.name,
                         'optional': prop.multiplicity.lower == 0}
                if isinstance(pm.target, Column) and pm.target.nullable:
                    entry['optional'] = True
                target_list = properties
            elif isinstance(pm.target, Join):
                entry = {'id': prop.id, 'accessor': to_ts_name(prop), 'label': prop.name, 'target': prop.type.name,
                         'many': prop.multiplicity.is_many(), 'optional': prop.multiplicity.lower == 0}
                target_list = relations
            else:
                continue
            if doc:
                entry['description'] = doc
            target_list.append(entry)
        for source_rcm, _, assoc, reverse_name in reverse_assoc_map.get(rcm.clazz.name, []):
            relations.append({'id': reverse_name, 'accessor': reverse_name, 'label': assoc.target_property.name,
                              'target': source_rcm.clazz.name, 'many': assoc.target_multiplicity.is_many(),
                              'optional': assoc.target_multiplicity.lower == 0})
        entry = {'name': rcm.clazz.name, 'label': humanize(rcm.clazz.name), 'properties': properties, 'relations': relations,
                 'dates': milestone_dates(view.milestone_mapping)}
        doc = get_doc(rcm.clazz)
        if doc:
            entry['description'] = doc
        classes.append(entry)
    return {'name': mapping.name, 'context': _mapping_to_class_name(mapping.name), 'classes': classes}


def generate(mapping: Mapping, output_directory: str):
    templates_dir = os.path.join(os.path.dirname(__file__), 'templates')
    environment = Environment(
        loader=FileSystemLoader(templates_dir),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    finder_template = environment.get_template('finder_template.txt')
    base_template = environment.get_template('finder_base_template.txt')
    context_template = environment.get_template('context_template.txt')

    os.makedirs(output_directory, exist_ok=True)

    class_module_map = {}
    class_module_map_base = {}
    for rcm in mapping.mappings:
        class_module_map[rcm.clazz.name] = f'./{rcm.clazz.name}Finder'
        class_module_map_base[rcm.clazz.name] = f'./{rcm.clazz.name}Finder'

    assoc_lookup = _build_association_lookup(mapping)
    reverse_assoc_map = _build_reverse_assoc_map(mapping, assoc_lookup)

    shared_context = dict(
        class_module_map=class_module_map,
        class_module_map_base=class_module_map_base,
        is_primitive=is_primitive,
        has_processing_temporal=has_processing_temporal,
        has_uni_business_temporal=has_uni_business_temporal,
        has_business_date_and_processing=has_business_date_and_processing,
        has_bitemporal=has_bitemporal,
        has_business_date_range=has_business_date_range,
        has_processing_snapshot=has_processing_snapshot,
        parent_expr=parent_expr,
        column_code=column_code,
        display_name=display_name,
        to_ts_name=to_ts_name,
        to_camel_case=to_camel_case,
        table_qualified_name=table_qualified_name,
        owner_code=owner_code,
        get_used_attr_types=get_used_attr_types,
        get_doc=get_doc,
        prop_jsdoc=prop_jsdoc,
        flatten_embedded=flatten_embedded,
        filter_ts_type=filter_ts_type,
        embedded_classes=embedded_classes,
        embedded_optional=embedded_optional,
    )

    for rcm in mapping.mappings:
        reverse_assocs = reverse_assoc_map.get(rcm.clazz.name, [])
        render_ctx = dict(shared_context, rcm=_ClassView(rcm), reverse_assocs=reverse_assocs)

        base_filename = f'{rcm.clazz.name}FinderBase.ts'
        base_filepath = os.path.join(output_directory, base_filename)
        with open(base_filepath, mode='w', encoding='utf-8') as f:
            f.write(base_template.render(**render_ctx))
            print(f'... wrote {base_filename}')

        impl_filename = f'{rcm.clazz.name}Finder.ts'
        impl_filepath = os.path.join(output_directory, impl_filename)
        with open(impl_filepath, mode='w', encoding='utf-8') as f:
            f.write(finder_template.render(**render_ctx))
            print(f'... wrote {impl_filename}')

    context_filename = _mapping_to_filename(mapping.name)
    context_class_name = _mapping_to_class_name(mapping.name)
    context_filepath = os.path.join(output_directory, context_filename)
    with open(context_filepath, mode='w', encoding='utf-8') as f:
        f.write(context_template.render(
            **shared_context,
            mapping=mapping,
            context_class_name=context_class_name,
        ))
        print(f'... wrote {context_filename}')

    metadata_filename = _mapping_to_filename(mapping.name).replace('Context.ts', 'Metadata.ts')
    metadata_class = _mapping_to_class_name(mapping.name).replace('Context', 'Metadata')
    with open(os.path.join(output_directory, metadata_filename), mode='w', encoding='utf-8') as f:
        f.write("import type { MappingMetadata } from '@datafinder/metadata';\n\n"
                f"export const {metadata_class}: MappingMetadata = "
                f"{json.dumps(mapping_metadata(mapping, reverse_assoc_map), indent=2, ensure_ascii=False)};\n")
        print(f'... wrote {metadata_filename}')
