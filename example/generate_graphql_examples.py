"""
Generate TypeScript finders from the datafinder_examples GraphQL mappings.

Each mapping is generated into its own subdirectory under tests/generated_graphql/.

Usage:
    uv run python example/generate_graphql_examples.py
"""
import os

import datafinder_examples
from mapping_markdown.graphql_mapping_markdown import load
from ts_generator.graphql_generator import generate

_EXAMPLES_DIR = os.path.dirname(datafinder_examples.__file__)

_MAPPINGS = [
    'finance_graphql_mapping.md',
    'companies_graphql_mapping.md',
    'positions_graphql_mapping.md',
    'null_end_milestoning_graphql_mapping.md',
    'diamond_graphql_mapping.md',
    'orgchart_graphql_mapping.md',
    'orgchart_inheritance_graphql_mapping.md',
]

if __name__ == '__main__':
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for mapping_file in _MAPPINGS:
        mapping = load(os.path.join(_EXAMPLES_DIR, mapping_file))
        name = mapping_file.replace('.md', '').replace('_graphql_mapping', '')
        out_dir = os.path.join(_root, 'tests', 'generated_graphql', name)
        print(f'\n--- {mapping_file} → tests/generated_graphql/{name}/')
        generate(mapping, out_dir)
    print('\nDone.')
