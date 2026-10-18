"""
Generate TypeScript tests from the Python project's backend-agnostic test specs.

The `datafinder_examples_tests` package (shipped with data-finder) holds one `FinderSpec` per finder,
each a list of `TestExpectation`s: a query written against the Python finder API, the expected column
names and values, and optional SQL fragments. This script translates every expectation to the
equivalent call on the generated TypeScript finders and writes one vitest file per spec module to
tests/specs/. The expected columns, values and SQL fragments are read from the spec objects; only the
query lambda is translated from its source.

Usage:
    uv run python example/generate_examples.py     # generated finders must exist first
    uv run python scripts/generate_spec_tests.py
"""
import ast
import datetime
import glob
import importlib
import json
import os
import re

import numpy as np
import pandas as pd

import datafinder_examples
import datafinder_examples_tests as specs_pkg
from mapping_markdown.markdown_mapping import load

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'tests', 'specs')
SPEC_DIR = os.path.dirname(specs_pkg.__file__)
EXAMPLES_DIR = os.path.dirname(datafinder_examples.__file__)

# Which database seed (tests/spec-seeds.ts) each spec module runs against.
SEEDS = {
    'finance_specs': 'finance',
    'finance_group_by_specs': 'finance_group_by',
    'finance_numeric_specs': 'finance_numeric',
    'embedded_specs': 'embedded',
    'null_end_milestoning_specs': 'null_end_milestoning',
    'orgchart_specs': 'orgchart',
    'orgchart_inheritance_specs': 'orgchart_inheritance',
    'companies_specs': 'companies',
    'companies_string_scalar_specs': 'companies_scalar',
    'diamond_specs': 'diamond',
    'positions_specs': 'positions',
}

# Python finder/attribute methods whose TypeScript names aren't a plain snake -> camel conversion.
METHOD_NAMES = {
    'find_all': 'findAll',
    'find_for_date_range': 'findForDateRange',
    'order_by': 'orderByOp',
    'group_by': 'groupByOp',
    'upper': 'toUpperCase',
    'lower': 'toLowerCase',
    'strip': 'trim',
    'lstrip': 'trimStart',
    'rstrip': 'trimEnd',
}

# Result column labels that follow the TypeScript method name where it deliberately differs from Python's
# (strip/lstrip/rstrip are trim/trimStart/trimEnd in TypeScript, see the idiomatic-naming refactor).
COLUMN_LABELS = {
    'strip': {'Strip Name': 'Trim Name'},
    'lstrip': {'Lstrip Name': 'Trim Start Name'},
    'rstrip': {'Rstrip Name': 'Trim End Name'},
}

COMPARE_METHODS = {ast.Eq: 'eq', ast.NotEq: 'ne', ast.Gt: 'gt', ast.Lt: 'lt', ast.GtE: 'gte', ast.LtE: 'lte'}
TIMEDELTA_UNITS = {'days': 'Days', 'hours': 'Hours', 'minutes': 'Minutes', 'seconds': 'Seconds'}
# Keyword arguments of window functions, which become a single options object in TypeScript.
OPTION_KEYS = {'partition_by': 'partitionBy', 'order_by': 'orderBy', 'method': 'method', 'pct': 'pct'}


def js_str(value: str) -> str:
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"


def camel(name: str) -> str:
    name = name.rstrip('_')
    head, *rest = name.split('_')
    return head + ''.join(w.capitalize() for w in rest)


def method_name(name: str) -> str:
    return METHOD_NAMES.get(name) or camel(name)


class Translator:
    """Translate the expression body of a spec's query lambda to TypeScript."""

    def expr(self, node: ast.AST) -> str:
        method = getattr(self, 'visit_' + type(node).__name__, None)
        if method is None:
            raise NotImplementedError(ast.dump(node))
        return method(node)

    def visit_Constant(self, node: ast.Constant) -> str:
        value = node.value
        if value is None:
            return 'null'
        if isinstance(value, bool):
            return 'true' if value else 'false'
        if isinstance(value, str):
            return js_str(value)
        return repr(value)

    def visit_Name(self, node: ast.Name) -> str:
        return node.id

    def visit_List(self, node: ast.List) -> str:
        return '[' + ', '.join(self.expr(e) for e in node.elts) + ']'

    def visit_UnaryOp(self, node: ast.UnaryOp) -> str:
        if isinstance(node.op, ast.USub):
            return '-' + self.expr(node.operand)
        raise NotImplementedError(ast.dump(node))

    def visit_Compare(self, node: ast.Compare) -> str:
        assert len(node.ops) == 1
        return f'{self.expr(node.left)}.{COMPARE_METHODS[type(node.ops[0])]}({self.expr(node.comparators[0])})'

    def visit_BinOp(self, node: ast.BinOp) -> str:
        left, right = self.expr(node.left), node.right
        if isinstance(node.op, (ast.Add, ast.Sub)) and isinstance(right, ast.Call) \
                and getattr(right.func, 'attr', None) == 'timedelta':
            (kw,) = right.keywords
            verb = 'add' if isinstance(node.op, ast.Add) else 'subtract'
            return f'{left}.{verb}{TIMEDELTA_UNITS[kw.arg]}({self.expr(kw.value)})'
        if isinstance(node.op, ast.Mult):
            return f'{left}.repeat({self.expr(right)})'
        if isinstance(node.op, ast.Mod):
            return f'{left}.mod({self.expr(right)})'
        if isinstance(node.op, ast.Pow):
            return f'{left}.power({self.expr(right)})'
        raise NotImplementedError(ast.dump(node))

    def visit_Subscript(self, node: ast.Subscript) -> str:
        """Mirror StringAttribute.__getitem__."""
        base = self.expr(node.value)
        sl = node.slice
        assert isinstance(sl, ast.Slice)
        const = lambda n: None if n is None else ast.literal_eval(n)  # noqa: E731
        start, stop, step = const(sl.lower), const(sl.upper), const(sl.step)
        if step == -1 and start is None and stop is None:
            return f'{base}.reverse()'
        if start is not None and start < 0 and stop is None:
            return f'{base}.right({-start})'
        if start is None and stop is not None and stop >= 0:
            return f'{base}.left({stop})'
        if start is not None and start >= 0:
            return f'{base}.substring({start})' if stop is None else f'{base}.substring({start}, {stop - start})'
        raise NotImplementedError(ast.dump(node))

    def visit_Call(self, node: ast.Call) -> str:
        func = node.func
        assert isinstance(func, ast.Attribute), ast.dump(node)
        owner = func.value
        # datetime.datetime(...) / datetime.date(...)
        if isinstance(owner, ast.Name) and owner.id == 'datetime':
            parts = [ast.literal_eval(a) for a in node.args]
            parts += [0] * (6 - len(parts)) if func.attr == 'datetime' else []
            y, m, d, *rest = parts
            return 'new Date(Date.UTC(' + ', '.join(str(x) for x in [y, m - 1, d, *rest]) + '))'
        args = [self.expr(a) for a in node.args]
        name = method_name(func.attr)
        # Window functions take their keyword arguments as one options object.
        if func.attr in ('rank', 'shift', 'qcut', 'first', 'last') and node.keywords:
            opts = ', '.join(f'{OPTION_KEYS[k.arg]}: {self.expr(k.value)}' for k in node.keywords)
            args.append('{ ' + opts + ' }')
        elif node.keywords:
            # A related-finder accessor given property filters: f.projects(code='ALPHA')
            opts = ', '.join(f'{k.arg}: {self.expr(k.value)}' for k in node.keywords)
            args.append('{ ' + opts + ' }')
        return f'{self.expr(owner)}.{name}({", ".join(args)})'


def ts_value(value) -> str:
    """Render one expected cell."""
    if value is None or value is pd.NA or (isinstance(value, float) and np.isnan(value)):
        return 'null'
    if isinstance(value, np.datetime64):
        return f"ts({js_str(str(value))})"
    if isinstance(value, (bool, np.bool_)):
        return 'true' if value else 'false'
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        return repr(float(value))
    if isinstance(value, str):
        return js_str(value)
    if isinstance(value, (datetime.datetime, datetime.date)):
        return f"ts({js_str(value.isoformat())})"
    raise NotImplementedError(repr(value))


def ts_rows(array) -> str:
    arr = np.asarray(array, dtype=object)
    if arr.size == 0:
        return '[]'
    rows = [', '.join(ts_value(v) for v in row) for row in arr.reshape(arr.shape[0], -1)]
    return '[\n' + ''.join(f'        [{r}],\n' for r in rows) + '      ]'


def finder_spec_nodes(tree: ast.Module) -> list[tuple[str, ast.Call]]:
    """Top-level `NAME = FinderSpec(...)` assignments, in source order."""
    result = []
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call) \
                and getattr(stmt.value.func, 'id', None) == 'FinderSpec':
            result.append((stmt.targets[0].id, stmt.value))
    return result


def kwarg(call: ast.Call, name: str) -> ast.AST:
    return next(k.value for k in call.keywords if k.arg == name)


def mapping_dir(mapping_file: str) -> str:
    """Directory under tests/generated_examples/ that example/generate_examples.py writes to."""
    return mapping_file.replace('.md', '').replace('_mapping', '')


def generate_module(module_name: str) -> str:
    module = importlib.import_module(f'datafinder_examples_tests.{module_name}')
    source = open(os.path.join(SPEC_DIR, module_name + '.py')).read()
    tree = ast.parse(source)
    translator = Translator()

    # Module-level constants used by the queries (_AT = "2023-12-01 12:00:00", ...)
    consts = []
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.targets[0], ast.Name) \
                and stmt.targets[0].id.startswith('_'):
            consts.append(f'const {stmt.targets[0].id} = {translator.expr(stmt.value)};')

    specs = finder_spec_nodes(tree)
    imports: dict[str, str] = {}   # finder class -> import path
    side_effects: set[str] = set()
    blocks = []
    for var_name, spec_call in specs:
        spec = getattr(module, var_name)
        directory = mapping_dir(spec.mapping_file)
        mapping = load(os.path.join(EXAMPLES_DIR, spec.mapping_file))
        for rcm in mapping.mappings:
            path = f'../generated_examples/{directory}/{rcm.clazz.name}Finder'
            if rcm.clazz.name + 'Finder' == spec.finder_name:
                imports[spec.finder_name] = path
            else:
                side_effects.add(path)   # registers the finder so reverse associations resolve
        expectation_calls = {
            ast.literal_eval(kwarg(c, 'name')): c
            for c in ast.walk(kwarg(spec_call, 'expectations'))
            if isinstance(c, ast.Call) and getattr(c.func, 'id', None) == 'TestExpectation'
        }
        cases = []
        for exp in spec.expectations:
            lam = kwarg(expectation_calls[exp.name], 'query')
            assert isinstance(lam, ast.Lambda)
            query = translator.expr(lam.body)
            labels = COLUMN_LABELS.get(exp.name, {})
            columns = [labels.get(c, c) for c in exp.expected_columns]
            fields = [f"columns: [{', '.join(js_str(c) for c in columns)}]",
                      f'rows: {ts_rows(exp.expected_result)}']
            if 'duckdb' in exp.expected_sql:
                fields.append(f"sql: {js_str(exp.expected_sql['duckdb'])}")
            if 'duckdb' in exp.unexpected_sql:
                fields.append(f"unexpectedSql: {js_str(exp.unexpected_sql['duckdb'])}")
            cases.append(
                f"  it({js_str(exp.name)}, () =>\n"
                f"    runExpectation(\n      {query},\n      runner,\n      {{ {', '.join(fields)} }},\n    ));\n"
            )
        blocks.append(
            f"describe({js_str(var_name)}, () => {{\n  const f = new {spec.finder_name}();\n\n" + '\n'.join(cases) + '});\n'
        )

    side_effects -= set(imports.values())
    header = [
        f'// Generated by scripts/generate_spec_tests.py from datafinder_examples_tests.{module_name}. Do not edit.',
        "import { describe, it, beforeAll, afterAll } from 'vitest';",
        "import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';",
        "import { registerDuckDb, DuckDbRunner } from '../duckdb-runner';",
        "import { runExpectation, ts } from '../spec-harness';",
        "import { seeds } from '../spec-seeds';",
    ]
    header += [f"import {{ {name} }} from '{path}';" for name, path in sorted(imports.items())]
    header += [f"import '{path}';" for path in sorted(side_effects)]
    setup = f"""
let instance: DuckDBInstance;
let conn: DuckDBConnection;
let runner: DuckDbRunner;

beforeAll(async () => {{
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  runner = registerDuckDb(conn);
  await seeds.{SEEDS[module_name]}(conn);
}});

afterAll(() => {{
  conn.disconnectSync();
  instance.closeSync();
}});
"""
    return '\n'.join(header) + '\n\n' + ('\n'.join(consts) + '\n' if consts else '') + setup + '\n' + '\n'.join(blocks)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(SPEC_DIR, '*_specs.py'))):
        module_name = os.path.basename(path)[:-3]
        out = os.path.join(OUT_DIR, module_name.replace('_specs', '').replace('_', '-') + '.test.ts')
        with open(out, 'w') as f:
            f.write(generate_module(module_name))
        print(f'... wrote {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    main()
