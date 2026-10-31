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
)
from model.relational import Column
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

    def __init__(self, name: str, label: str, columns: list, children: list, optional: bool = False):
        self.name = name
        self.label = label
        self.columns = columns
        self.children = children
        # whether the embedded property that holds this class, or one above it, is optional
        self.optional = optional


def embedded_classes(rcm: _ClassView) -> list[EmbeddedClass]:
    """The embedded classes of a class mapping, nested ones before the classes that hold them."""
    found: list[EmbeddedClass] = []

    def _walk(esm: EmbeddedSetMapping, stem: str, label: str, optional: bool) -> str:
        columns, children = [], []
        for pm in esm.property_mappings:
            if isinstance(pm.target, Column):
                columns.append((pm.property, pm.target))
            elif isinstance(pm.target, EmbeddedSetMapping):
                child = _walk(pm.target, stem + pm.property.id[:1].upper() + pm.property.id[1:], f"{label} {pm.property.name}",
                              optional or pm.property.multiplicity.lower == 0)
                children.append((pm.property, child))
        found.append(EmbeddedClass(stem + "Embedded", label, columns, children, optional))
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
            if is_primitive(rpm.property) or not isinstance(rpm.target, Join):
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
        display_name=display_name,
        to_ts_name=to_ts_name,
        to_camel_case=to_camel_case,
        table_qualified_name=table_qualified_name,
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
