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
npm test --prefix er-diagram             # viewer tests (node:test, they run the export too)
```

## How it fits together

1. data-finder's `mapping_markdown.export_json` (in the Python data-finder repo, so there is always a way to get the model and mappings as JSON)
   parses the markdown with the project's own loaders and writes `out/data.json`: classes, properties, associations, tables, columns and joins.
   The markdown format has one definition; nothing here re-parses markdown.
2. `generate.mjs` draws that JSON (`data.mjs` loads it, `common.mjs` has the palettes and the HTML page template).

`data-finder.config.json` says what to show: `models` (the full model) and `mappings` (each gets a mapped-model and a database diagram).
`dir` is a folder relative to the config, or `python:<package>` for an installed package's folder (here `datafinder_examples`, which is the
markdown the e2e tests run on). Other keys: `title`, `out`, `attrs` (limit attributes shown), `acronyms`.

## Data-finder version

The export needs `mapping_markdown.export_json`, which first shipped in data-finder 0.1.18, so the root `pyproject.toml` requires `data-finder[markdown]>=0.1.18`.
The JSON is defined by that package: if it changes there, update `data.mjs` and `generate.mjs` to match.

CI (`.github/workflows/ci.yml`, job `er-diagram`) runs the tests, builds the diagrams and uploads `er-diagram/out` as the `er-diagrams` artifact.
