"""
Generate TypeScript finders from the finance markdown mapping definition.

Usage:
    python example/generate_from_markdown.py

Reads finance_mapping.md (and its referenced model files) from the sibling
data-finder project and emits TypeScript finders to tests/generated_markdown/.
"""
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_here)
_data_finder = os.path.join(_root, '..', 'data-finder')

for sub in ('datafinder/src', 'model/src', 'datafinder_generator/src',
            'model_markdown/src', 'mapping_markdown/src'):
    sys.path.insert(0, os.path.join(_data_finder, sub))

sys.path.insert(0, os.path.join(_root, 'generator', 'src'))

from mapping_markdown.markdown_mapping import load
from ts_generator.generator import generate

_MAPPING_FILE = os.path.normpath(
    os.path.join(_data_finder, 'mapping_markdown', 'tests', 'finance_mapping.md')
)

if __name__ == '__main__':
    mapping = load(_MAPPING_FILE)
    out_dir = os.path.join(_root, 'tests', 'generated_markdown')
    os.makedirs(out_dir, exist_ok=True)
    generate(mapping, out_dir)
    print('Done.')
