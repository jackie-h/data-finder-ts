"""Check the SQL the finders write, in each dialect, against sqlglot.

Usage: validate_dialects.py corpus.json   (see `npm run check:dialects`, which writes the corpus)

1. Every query must parse in its dialect (this fails the script).
2. A report of where our DuckDB and Databricks SQL differs from what sqlglot writes for that dialect from our
   Postgres SQL. This is for review, and does not fail: sqlglot is itself lenient and sometimes passes a construct
   through unchanged, so a difference is something to look at, not a bug.

A parser accepting a query only means its syntax is valid for that dialect: it does not say the functions exist or
give the same answer, which only running the query against the database can.
"""
import json
import sys

import sqlglot
from sqlglot.errors import ParseError

# our dialect names, and sqlglot's
SQLGLOT = {'postgres': 'postgres', 'duckdb': 'duckdb', 'databricks': 'databricks'}


def main(path: str) -> int:
    with open(path) as f:
        corpus: dict[str, dict[str, str]] = json.load(f)
    failures = 0
    checked = 0
    for dialect, queries in corpus.items():
        for label, sql in queries.items():
            checked += 1
            try:
                sqlglot.parse_one(sql, read=SQLGLOT[dialect], error_level=sqlglot.ErrorLevel.RAISE)
            except ParseError as e:
                failures += 1
                print(f"{dialect}: {label}\n  {sql}\n  {str(e).splitlines()[0]}")
    print(f"{checked} queries checked in {len(corpus)} dialects, {failures} failed")
    report_differences(corpus)
    return 1 if failures else 0


def report_differences(corpus: dict[str, dict[str, str]]) -> None:
    """Where our SQL for a dialect is not what sqlglot writes for it from our Postgres SQL."""
    for target in ('duckdb', 'databricks'):
        differing = []
        for label, postgres in corpus['postgres'].items():
            try:
                ours = sqlglot.parse_one(corpus[target][label], read=SQLGLOT[target]).sql(dialect=SQLGLOT[target])
                theirs = sqlglot.transpile(postgres, read='postgres', write=SQLGLOT[target])[0]
            except Exception as e:  # a construct one side cannot read is itself a difference worth showing
                differing.append((label, 'could not compare', str(e).splitlines()[0]))
                continue
            if ours != theirs:
                differing.append((label, ours, theirs))
        print(f"\n{target}: {len(differing)} of {len(corpus['postgres'])} queries differ from sqlglot's")
        for label, ours, theirs in differing:
            print(f"  - {label}\n      ours   : {ours}\n      sqlglot: {theirs}")


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
