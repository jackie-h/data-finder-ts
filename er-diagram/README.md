# er-diagram

A viewer for data-finder models and mappings: Mermaid diagrams generated from the model and mapping markdown, as static HTML.

- **Full model**: a flowchart with a clickable box per model file, an ER-style class diagram per file (UML inheritance, associations with
  multiplicities, attributes as `Name  Type  [mult]  PK` columns), and one diagram with every class.
- **Per mapping**: the same views restricted to the classes the mapping maps, plus the database: a flowchart with a box per schema, a
  table diagram (PK/FK) per schema, and one with every table.
- Hover an attribute or column for its description; click a dashed stub box to open the page that owns it.

## Use

```bash
uv sync
npm ci --prefix er-diagram
npm run generate --prefix er-diagram     # writes er-diagram/out/ (open out/index.html)
npm test --prefix er-diagram             # viewer tests (node:test)
npm run test:export --prefix er-diagram  # exporter tests (pytest)
```

## How it fits together

1. `export_json.py` parses the markdown with data-finder's own loaders (`model_markdown`, `mapping_markdown`) and writes `out/data.json`:
   classes, properties, associations, tables, columns and foreign keys. There is one definition of the format; nothing here re-parses markdown.
2. `generate.mjs` draws that JSON (`data.mjs` loads it, `common.mjs` has the palettes and the HTML page template).

`data-finder.config.json` says what to show: `models` (the full model) and `mappings` (each gets a mapped-model and a database diagram).
`dir` is a folder relative to the config, or `python:<package>` for an installed package's folder (here `datafinder_examples`, which is the
markdown the e2e tests run on). Other keys: `title`, `out`, `attrs` (limit attributes shown), `acronyms`.

## Note on the data-finder version

The viewer needs property multiplicities and column nullability, which are newer than the data-finder 0.1.17 on PyPI, so the export step
runs with `data-finder` pinned to a commit of its main branch (`requirements.txt`, used via `uv run --with-requirements`). This does not
touch the root `pyproject.toml` or `uv.lock`. After data-finder's next release, delete `requirements.txt` and require that release instead.

CI (`.github/workflows/ci.yml`, job `er-diagram`) runs both test suites, builds the diagrams and uploads `er-diagram/out` as the `er-diagrams` artifact.
