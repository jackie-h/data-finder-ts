"""
Generate TypeScript finders from all datafinder_examples markdown mappings.

Each mapping is generated into its own subdirectory under tests/generated_examples/.

Usage:
    uv run python example/generate_examples.py
"""
import os

import datafinder_examples
from mapping_markdown.markdown_mapping import load
from ts_generator.generator import generate

_EXAMPLES_DIR = os.path.dirname(datafinder_examples.__file__)

_MAPPINGS = [
    'finance_mapping.md',
    'orgchart_mapping.md',
    'orgchart_inheritance_mapping.md',
    'companies_mapping.md',
    'positions_mapping.md',
    'diamond_mapping.md',
    'null_end_milestoning_mapping.md',
]

if __name__ == '__main__':
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for mapping_file in _MAPPINGS:
        mapping_path = os.path.join(_EXAMPLES_DIR, mapping_file)
        mapping = load(mapping_path)
        name = mapping_file.replace('_mapping.md', '').replace('.md', '')
        out_dir = os.path.join(_root, 'tests', 'generated_examples', name)
        os.makedirs(out_dir, exist_ok=True)
        print(f'\n--- {mapping_file} → tests/generated_examples/{name}/')
        generate(mapping, out_dir)
    print('\nDone.')
