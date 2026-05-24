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
from model.relational_mapping import Join

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


def to_ts_name(prop: Property) -> str:
    """Convert a Property display name to a TypeScript camelCase method name."""
    words = prop.name.lower().split()
    if not words:
        return ''
    result = words[0] + ''.join(w.capitalize() for w in words[1:])
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


def get_used_attr_types(rcm) -> list:
    """Return ordered list of TypeScript attribute type names used in this mapping."""
    seen = set()
    result = []
    for rpm in rcm.property_mappings:
        if is_primitive(rpm.property):
            t = rpm.property.type.name + 'Attribute'
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result


def _mapping_to_class_name(name: str) -> str:
    parts = re.split(r'[\s_]+', name)
    return ''.join(p[0].upper() + p[1:] for p in parts if p) + 'Context'


def _mapping_to_filename(name: str) -> str:
    parts = re.split(r'[\s_]+', name)
    return ''.join(p[0].upper() + p[1:] for p in parts if p) + 'Context.ts'


def _build_association_lookup(mapping: Mapping) -> dict:
    result = {}
    for rcm in mapping.mappings:
        if rcm.clazz.package:
            for child in rcm.clazz.package.children:
                if isinstance(child, Association):
                    result[(child.source, child.target, child.target_property)] = child
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
            reverse_name = to_camel_case(assoc.source_property)
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
        class_module_map_base[rcm.clazz.name] = f'./{rcm.clazz.name}FinderBase'

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
    )

    for rcm in mapping.mappings:
        reverse_assocs = reverse_assoc_map.get(rcm.clazz.name, [])
        render_ctx = dict(shared_context, rcm=rcm, reverse_assocs=reverse_assocs)

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
