"""
Generate TypeScript finders from the example mapping definitions.

Usage:
    uv run python example/generate.py
"""
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_here)
sys.path.insert(0, _here)

from mappings import create_mappings_normalized
from ts_generator.generator import generate

if __name__ == '__main__':
    mapping = create_mappings_normalized()
    out_dir = os.path.join(_here, 'generated')
    os.makedirs(out_dir, exist_ok=True)
    generate(mapping, out_dir)
    print('Done.')
