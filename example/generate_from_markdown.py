"""
Generate TypeScript finders from the finance markdown mapping definition.

Usage:
    uv run python example/generate_from_markdown.py
"""
import os

import datafinder_examples
from mapping_markdown.markdown_mapping import load
from ts_generator.generator import generate

_MAPPING_FILE = os.path.join(os.path.dirname(datafinder_examples.__file__), 'finance_mapping.md')

if __name__ == '__main__':
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mapping = load(_MAPPING_FILE)
    out_dir = os.path.join(_root, 'tests', 'generated_markdown')
    os.makedirs(out_dir, exist_ok=True)
    generate(mapping, out_dir)
    print('Done.')
