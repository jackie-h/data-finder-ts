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
    'people_denormalised_specs': 'people_denormalised',
}

# Python finder/attribute methods whose TypeScript names aren't a plain snake -> camel conversion.
METHOD_NAMES = {
    'find_all': 'findAll',
    'find_for_date_range': 'findForDateRange',
    'and_op': 'and',
    'and_': 'and',
    'or_': 'or',
    'order_by': 'orderBy',
    'group_by': 'groupBy',
    'upper': 'toUpperCase',
    'lower': 'toLowerCase',
    'fill_null': 'orElse',
    'is_none': 'isNull',
    'is_not_none': 'isNotNull',
    'strip': 'trim',
    'lstrip': 'trimStart',
    'rstrip': 'trimEnd',
}

# Result column labels that follow the TypeScript method name where it deliberately differs from Python's
# (strip/lstrip/rstrip are trim/trimStart/trimEnd in TypeScript, see the idiomatic-naming refactor; fill_null is orElse).
COLUMN_LABELS = {
    'strip': {'Strip Name': 'Trim Name'},
    'lstrip': {'Lstrip Name': 'Trim Start Name'},
    'rstrip': {'Rstrip Name': 'Trim End Name'},
    'fill_null_replaces_a_missing_manager': {'Fill Null Manager Name': 'Or Else Manager Name'},
    'fill_null_leaves_a_value_that_is_there': {'Fill Null Name': 'Or Else Name'},
}

# Specs that exercise Python features the TypeScript port doesn't have (SQL views: View / to_view).
SKIPPED_SPECS = {
    'TRADE_VIEW_FINDER_SPECS': 'SQL views are not ported',
}

# Spec groups whose expectations must also pass when run in a different order, and when every query is built
# before any is run (the Python project's test_trade_specs_do_not_depend_on_order). They share one finder.
ORDER_INDEPENDENT = {
    'finance_specs': ['TRADE_FINDER_SPECS', 'TRADE_MULTI_HOP_FINDER_SPECS', 'TRADE_EXISTS_FINDER_SPECS',
                      'TRADE_IS_NONE_FINDER_SPECS'],
}

COMPARE_METHODS = {ast.Eq: 'eq', ast.NotEq: 'ne', ast.Gt: 'gt', ast.Lt: 'lt', ast.GtE: 'gte', ast.LtE: 'lte'}
TIMEDELTA_UNITS = {'days': 'Days', 'hours': 'Hours', 'minutes': 'Minutes', 'seconds': 'Seconds'}
# Keyword arguments of window functions, which become a single options object in TypeScript.
OPTION_KEYS = {'partition_by': 'partitionBy', 'order_by': 'orderBy', 'method': 'method', 'pct': 'pct'}


def js_str(value: str) -> str:
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"


def to_snake(name: str) -> str:
    return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()


def camel(name: str) -> str:
    name = name.rstrip('_')
    head, *rest = name.split('_')
    return head + ''.join(w.capitalize() for w in rest)


# Free functions of the Python package that the specs call, and their TypeScript names.
FREE_FUNCTIONS = {'count_all': 'countAll', 'constant': 'constant', 'when': 'when', 'concat': 'concat'}
# Methods whose result is a number or text, which decides how `+ - * /` between them translates.
NUMBER_METHODS = {'length', 'abs', 'ceil', 'ceiling', 'floor', 'round', 'sqrt', 'power', 'mod', 'sum', 'average',
                  'min', 'max', 'count', 'count_distinct', 'std', 'var', 'year', 'month', 'day', 'hour', 'minute',
                  'second', 'day_of_week', 'day_of_year'}
TEXT_METHODS = {'upper', 'lower', 'strip', 'lstrip', 'rstrip', 'left', 'right', 'substring', 'reverse', 'repeat',
                'concat', 'replace', 'join'}
ARITHMETIC_METHODS = {ast.Add: 'plus', ast.Sub: 'minus', ast.Mult: 'times', ast.Div: 'dividedBy'}


def method_name(name: str) -> str:
    return METHOD_NAMES.get(name) or camel(name)


class Translator:
    """Translate the expression body of a spec's query lambda to TypeScript."""

    def __init__(self) -> None:
        self.properties: dict[str, str] = {}   # finder method -> type name, of the spec's mapping
        self.used: set[str] = set()            # free functions the translated queries call
        self.model_used: set[str] = set()      # model classes the translated queries use

    def type_of(self, node: ast.AST) -> str | None:
        """'text', 'number' or None: what an expression holds, as far as `+ - * /` needs to know."""
        if isinstance(node, ast.Constant):
            if isinstance(node.value, str):
                return 'text'
            if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
                return 'number'
        if isinstance(node, ast.UnaryOp):
            return self.type_of(node.operand)
        if isinstance(node, ast.BinOp):
            left, right = self.type_of(node.left), self.type_of(node.right)
            if isinstance(node.op, ast.Add) and 'text' in (left, right):
                return 'text'
            if isinstance(node.op, ast.Mult) and left == 'text':
                return 'text'
            return 'number'
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                return self.type_of(node.args[0]) if func.id == 'constant' else None
            if func.attr in TEXT_METHODS:
                return 'text'
            if func.attr in NUMBER_METHODS:
                return 'number'
            kind = self.properties.get(func.attr)
            return {'String': 'text', 'Integer': 'number', 'Float': 'number', 'Decimal': 'number'}.get(kind)
        return None

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
        try:   # two literals fold, as Python does before the query is built
            return repr(ast.literal_eval(node))
        except (ValueError, TypeError):
            pass
        kinds = self.type_of(node.left), self.type_of(node.right)
        if isinstance(node.op, ast.Add) and 'text' in kinds:
            if isinstance(node.left, ast.Constant):   # "Company: " + f.name(): no column to call concat on
                self.used.add('concat')
                return f'concat({left}, {self.expr(right)})'
            return f'{left}.concat({self.expr(right)})'
        if isinstance(node.op, ast.Mult) and kinds[0] == 'text':
            return f'{left}.repeat({self.expr(right)})'
        if type(node.op) in ARITHMETIC_METHODS:
            if kinds[0] is None and not isinstance(node.left, ast.Call):
                raise NotImplementedError('arithmetic on an unknown type: ' + ast.dump(node))
            if isinstance(node.left, ast.Constant):   # 100 - f.price(): a number is not an expression until it is a constant
                left = f'constant({left})'
                self.used.add('constant')
            return f'{left}.{ARITHMETIC_METHODS[type(node.op)]}({self.expr(right)})'
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
        if isinstance(func, ast.Name):
            self.used.add(FREE_FUNCTIONS[func.id])
            return f'{FREE_FUNCTIONS[func.id]}({", ".join(self.expr(a) for a in node.args)})'
        assert isinstance(func, ast.Attribute), ast.dump(node)
        owner = func.value
        # datetime.datetime(...) / datetime.date(...)
        if isinstance(owner, ast.Name) and owner.id == 'datetime':
            parts = [ast.literal_eval(a) for a in node.args]
            parts += [0] * (6 - len(parts)) if func.attr == 'datetime' else []
            y, m, d, *rest = parts
            if func.attr == 'date':   # a date, not a timestamp: it is written as a date literal
                self.model_used.add('DateOnly')
                return f"new DateOnly('{y:04d}-{m:02d}-{d:02d}T00:00:00Z')"
            return 'new Date(Date.UTC(' + ', '.join(str(x) for x in [y, m - 1, d, *rest]) + '))'
        args = [self.expr(a) for a in node.args]
        name = method_name(func.attr)
        if func.attr in ('std', 'var') and node.keywords:
            # std(ddof=0): the degrees of freedom are the one argument
            (kw,) = node.keywords
            assert kw.arg == 'ddof', ast.dump(node)
            return f'{self.expr(owner)}.{name}({", ".join(args + [self.expr(kw.value)])})'
        if func.attr == 'join' and node.keywords:
            # join(",", order_by=[...]): the order the values are joined in is the second argument
            (kw,) = node.keywords
            assert kw.arg == 'order_by', ast.dump(node)
            order = self.expr(kw.value)
            if not isinstance(kw.value, ast.List):
                order = f'[{order}]'
            return f'{self.expr(owner)}.{name}({", ".join((args or ["\'\'"]) + [order])})'
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


def generate_module(module_name: str) -> tuple[str, str]:
    """The TypeScript source of a spec module: (the cases, the DuckDB test that runs them).

    The cases are kept apart from the test so that the GraphQL specs (tests/graphql-specs.test.ts) can run the
    same queries against another backend.
    """
    module = importlib.import_module(f'datafinder_examples_tests.{module_name}')
    source = open(os.path.join(SPEC_DIR, module_name + '.py')).read()
    tree = ast.parse(source)
    translator = Translator()

    # Module-level constants used by the queries (_AT = "2023-12-01 12:00:00", ...)
    consts = []
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.targets[0], ast.Name) \
                and stmt.targets[0].id.startswith('_'):
            consts.append(f'export const {stmt.targets[0].id} = {translator.expr(stmt.value)};')

    specs = finder_spec_nodes(tree)
    imports: dict[str, str] = {}   # finder class -> import path, relative to tests/specs/
    side_effects: set[str] = set()
    case_blocks = []
    test_blocks = []
    groups: list[tuple[str, str]] = []   # (spec variable, finder class)
    order_finders: set[str] = set()
    for var_name, spec_call in specs:
        if var_name in SKIPPED_SPECS:
            print(f'... skipped {var_name}: {SKIPPED_SPECS[var_name]}')
            continue
        spec = getattr(module, var_name)
        directory = mapping_dir(spec.mapping_file)
        mapping = load(os.path.join(EXAMPLES_DIR, spec.mapping_file))
        translator.properties = {}
        for rcm in mapping.mappings:
            for prop in rcm.clazz.all_properties().values():
                kind = getattr(prop.type, 'name', None)
                for method in (to_snake(prop.id), to_snake(prop.id) + '_'):
                    translator.properties[method] = kind
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
            if 'graphql' in exp.skip_backends:
                fields.append(f"skipGraphql: {js_str(exp.skip_backends['graphql'])}")
            cases.append(
                f"  {{\n    name: {js_str(exp.name)},\n    query: f => {query},\n"
                f"    expected: {{ {', '.join(fields)} }},\n  }},\n"
            )
        case_blocks.append(f"export const {var_name}: SpecCase<{spec.finder_name}>[] = [\n" + ''.join(cases) + '];\n')
        test_blocks.append(
            f"describe({js_str(var_name)}, () => {{\n  const f = new {spec.finder_name}();\n\n"
            f"  for (const c of {var_name}) {{\n"
            f"    it(c.name, () => runExpectation(c.query(f), runner, c.expected));\n  }}\n}});\n"
        )
        groups.append((var_name, spec.finder_name))
        if var_name in ORDER_INDEPENDENT.get(module_name, []):
            order_finders.add(spec.finder_name)

    if module_name in ORDER_INDEPENDENT:
        assert len(order_finders) == 1, order_finders
        finder = order_finders.pop()
        names = ORDER_INDEPENDENT[module_name]
        test_blocks.append(f"""// Related finders, and the join nodes under them, are shared between queries. A query that is missing a join
// condition can pass only because an earlier query left its condition on a shared node, so each spec must also
// pass when it runs in a different order.
const ORDER_INDEPENDENT_SPECS: SpecCase<{finder}>[] = [{', '.join('...' + n for n in names)}];

describe('trade specs do not depend on order', () => {{
  const orders: [string, SpecCase<{finder}>[]][] = [
    ['reversed', [...ORDER_INDEPENDENT_SPECS].reverse()],
    ['shuffled-1', shuffled(ORDER_INDEPENDENT_SPECS, 1)],
    ['shuffled-2', shuffled(ORDER_INDEPENDENT_SPECS, 2)],
    ['shuffled-3', shuffled(ORDER_INDEPENDENT_SPECS, 3)],
  ];

  it.each(orders)('%s', async (_label, order) => {{
    const f = new {finder}();
    for (const c of order) await runExpectation(c.query(f), runner, c.expected);
  }});

  it('passes when every query is built before any is run', async () => {{
    const f = new {finder}();
    const built = ORDER_INDEPENDENT_SPECS.map(c => ({{ c, result: c.query(f) }}));
    for (const {{ c, result }} of built.reverse()) await runExpectation(result, runner, c.expected);
  }});
}});
""")
        harness_extra = ', shuffled'
    else:
        harness_extra = ''

    banner = f'// Generated by scripts/generate_spec_tests.py from datafinder_examples_tests.{module_name}. Do not edit.'

    cases_header = [
        banner,
        "import { ts, type SpecCase } from '../../spec-harness';",
    ]
    if translator.model_used:
        cases_header.append(f"import {{ {', '.join(sorted(translator.model_used))} }} from '../../../src/model/relational';")
    if translator.used:
        cases_header.append(f"import {{ {', '.join(sorted(translator.used))} }} from '../../../src/datafinder';")
    cases_header += [f"import type {{ {name} }} from '../{path}';" for name, path in sorted(imports.items())]
    group_entries = ''.join(f"  {js_str(var)}: {{ finder: {js_str(finder)}, cases: {var} }},\n" for var, finder in groups)
    cases_src = ('\n'.join(cases_header) + '\n\n' + ('\n'.join(consts) + '\n\n' if consts else '')
                 + '\n'.join(case_blocks)
                 + f"\n/** Every spec group of this module, with the name of the finder class it runs on. */\n"
                 f"export const SPEC_GROUPS = {{\n{group_entries}}};\n")

    side_effects -= set(imports.values())
    header = [
        banner,
        "import { describe, it, beforeAll, afterAll } from 'vitest';",
        "import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';",
        "import { registerDuckDb, DuckDbRunner } from '../duckdb-runner';",
        f"import {{ runExpectation, type SpecCase{harness_extra} }} from '../spec-harness';",
        "import { seeds } from '../spec-seeds';",
    ]
    header += [f"import {{ {name} }} from '{path}';" for name, path in sorted(imports.items())]
    header += [f"import '{path}';" for path in sorted(side_effects)]
    header += [f"import {{ {', '.join(sorted(var for var, _ in groups))} }} from './cases/{case_module_name(module_name)}';"]
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
    test_src = '\n'.join(header) + '\n' + setup + '\n' + '\n'.join(test_blocks)
    return cases_src, test_src


def case_module_name(module_name: str) -> str:
    return module_name.replace('_specs', '').replace('_', '-')


def main() -> None:
    os.makedirs(os.path.join(OUT_DIR, 'cases'), exist_ok=True)
    for path in sorted(glob.glob(os.path.join(SPEC_DIR, '*_specs.py'))):
        module_name = os.path.basename(path)[:-3]
        cases_src, test_src = generate_module(module_name)
        name = case_module_name(module_name)
        for out, src in ((os.path.join(OUT_DIR, 'cases', name + '.ts'), cases_src),
                         (os.path.join(OUT_DIR, name + '.test.ts'), test_src)):
            with open(out, 'w') as f:
                f.write(src)
            print(f'... wrote {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    main()
