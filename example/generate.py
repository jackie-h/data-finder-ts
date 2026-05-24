"""
Generate TypeScript finders from the example mapping definitions.

Usage:
    python example/generate.py

Expects the sibling data-finder project at ../data-finder relative to
the data-finder-ts root.
"""
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_here)
_data_finder = os.path.join(_root, '..', 'data-finder')

for sub in ('datafinder/src', 'model/src', 'datafinder_generator/src'):
    sys.path.insert(0, os.path.join(_data_finder, sub))

sys.path.insert(0, os.path.join(_root, 'generator', 'src'))
sys.path.insert(0, _here)

from mappings import create_mappings_normalized
from ts_generator.generator import generate

if __name__ == '__main__':
    mapping = create_mappings_normalized()
    out_dir = os.path.join(_here, 'generated')
    os.makedirs(out_dir, exist_ok=True)
    generate(mapping, out_dir)
    print('Done.')
