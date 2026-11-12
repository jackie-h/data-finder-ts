"""
Generate the finders and metadata the query UI offers, from the datafinder_examples mappings.

Each mapping goes to its own folder under query-ui/src/mappings/. The UI finds them there, so adding a mapping is
adding its folder (or a line to _MAPPINGS here).

Usage (from the repo root):
    uv run python query-ui/generate_mappings.py
"""
import os

import datafinder_examples
from mapping_markdown.markdown_mapping import load
from ts_generator.generator import generate

_EXAMPLES_DIR = os.path.dirname(datafinder_examples.__file__)

_MAPPINGS = [
    'finance_mapping.md',
    'orgchart_mapping.md',
    'companies_mapping.md',
]

if __name__ == '__main__':
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'mappings')
    for mapping_file in _MAPPINGS:
        mapping = load(os.path.join(_EXAMPLES_DIR, mapping_file))
        name = mapping_file.replace('.md', '').replace('_mapping', '')
        out_dir = os.path.join(root, name)
        os.makedirs(out_dir, exist_ok=True)
        print(f'--- {mapping_file} -> query-ui/src/mappings/{name}/')
        generate(mapping, out_dir)
