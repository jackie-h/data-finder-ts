"""Generate TypeScript finders for GraphQL mappings: one `{ClassName}Finder.ts` per GraphQL class mapping."""
import os

from jinja2 import Environment, FileSystemLoader

from datafinder_graphql.generator import (
    association_display,
    association_many,
    association_name,
    association_path,
    is_association_mapping,
    is_primitive_mapping,
    related_classes,
    type_str,
)
from model.graphql_mapping import (
    GraphQLBiTemporalMilestone,
    GraphQLBusinessDateMilestone,
    GraphQLClassMapping,
    GraphQLProcessingMilestone,
)
from model.mapping import Mapping
from ts_generator.generator import display_name, filter_ts_type, to_ts_name


def milestone_class(ms) -> str:
    if isinstance(ms, GraphQLBiTemporalMilestone):
        return 'GraphQLBiTemporalMilestone'
    if isinstance(ms, GraphQLBusinessDateMilestone):
        return 'GraphQLBusinessDateMilestone'
    if isinstance(ms, GraphQLProcessingMilestone):
        return 'GraphQLProcessingMilestone'
    return ''


def milestone_expr(ms) -> str:
    if isinstance(ms, GraphQLBiTemporalMilestone):
        return f"new GraphQLBiTemporalMilestone('{ms.business_date_argument}', '{ms.processing_argument}')"
    if isinstance(ms, GraphQLBusinessDateMilestone):
        return f"new GraphQLBusinessDateMilestone('{ms.argument_name}')"
    if isinstance(ms, GraphQLProcessingMilestone):
        return f"new GraphQLProcessingMilestone('{ms.argument_name}')"
    return 'undefined'


def used_attr_types(cm, class_mappings_by_name: dict) -> list[str]:
    """TypeScript attribute type names used by a finder and its related finders, in first-use order."""
    names: list[str] = []
    for mapped in [cm, *related_classes(cm, class_mappings_by_name)]:
        for pm in mapped.property_mappings:
            if is_primitive_mapping(pm):
                name = pm.property.type.name + 'Attribute'
                if name not in names:
                    names.append(name)
    return names


def generate(mapping: Mapping, output_directory: str) -> None:
    templates_dir = os.path.join(os.path.dirname(__file__), 'templates')
    environment = Environment(loader=FileSystemLoader(templates_dir), trim_blocks=True, lstrip_blocks=True)
    template = environment.get_template('graphql_finder_template.txt')
    os.makedirs(output_directory, exist_ok=True)

    class_mappings_by_name = {
        cm.clazz.name: cm for cm in mapping.mappings if isinstance(cm, GraphQLClassMapping)
    }
    for cm in class_mappings_by_name.values():
        filename = f'{cm.clazz.name}Finder.ts'
        with open(os.path.join(output_directory, filename), mode='w', encoding='utf-8') as f:
            f.write(template.render(
                cm=cm,
                class_mappings_by_name=class_mappings_by_name,
                related_classes=lambda c: related_classes(c, class_mappings_by_name),
                attr_types=used_attr_types(cm, class_mappings_by_name),
                is_primitive_mapping=is_primitive_mapping,
                is_association_mapping=is_association_mapping,
                association_path=association_path,
                association_name=association_name,
                association_many=lambda pm: 'true' if association_many(pm) else 'false',
                filter_ts_type=filter_ts_type,
                association_display=association_display,
                type_str=type_str,
                display_name=display_name,
                to_ts_name=to_ts_name,
                milestone_class=milestone_class,
                milestone_expr=milestone_expr,
            ))
        print(f'... wrote {filename}')
