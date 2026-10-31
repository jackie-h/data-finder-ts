"""Export models and relational mappings to JSON, for tools outside Python (such as the ER diagram viewer).

The markdown is parsed by the same loaders the rest of the project uses, so there is one definition of the format.

    uv run python er-diagram/export_json.py --config er-diagram/data-finder.config.json --out er-diagram/out/data.json

The config is a JSON file naming what to export: ``dir`` (a folder relative to the config file, or ``python:<package>`` for the folder
of an installed Python package), ``models`` (file names) and ``mappings`` (file names, or objects with a ``path``). Other keys are
ignored. The viewer (generate.mjs) reads the same config and the JSON this writes.
"""
import argparse
import importlib
import json
import os
from typing import Any

from model.m3 import Association, Class, PrimitiveType, TaggedValue
from model.relational import Column, Table
from model.relational_mapping import Join
from model_markdown import markdown_model

from mapping_markdown import markdown_mapping


def _doc(element) -> str:
    tv = element.tagged_values.get(TaggedValue.DOC)
    return tv.value if tv is not None else ""


def _type_name(t) -> str:
    return t if isinstance(t, str) else t.name


def export_model_packages(packages: list) -> list[dict[str, Any]]:
    """Packages as plain data: each class with its own properties (not inherited or association-derived) and each association."""
    result = []
    for pkg in packages:
        classes, associations = [], []
        for child in pkg.children:
            if isinstance(child, Class):
                classes.append({
                    "name": child.name,
                    "description": _doc(child),
                    "superclasses": [s.name for s in child.superclasses],
                    "properties": [{
                        "name": p.name,
                        "id": p.id,
                        "type": _type_name(p.type),
                        "multiplicity": str(p.multiplicity),
                        "key": TaggedValue.KEY in p.tagged_values,
                        "description": _doc(p),
                    } for p in child.properties.values()],
                })
            elif isinstance(child, Association):
                associations.append({
                    "name": child.name,
                    "description": _doc(child),
                    "source": child.source,
                    "sourceMultiplicity": str(child.source_multiplicity),
                    "sourcePropertyName": child.source_property.name,
                    "sourcePropertyId": child.source_property.id,
                    "target": child.target,
                    "targetMultiplicity": str(child.target_multiplicity),
                    "targetPropertyName": child.target_property.name,
                    "targetPropertyId": child.target_property.id,
                })
        result.append({"name": pkg.name, "classes": classes, "associations": associations})
    return result


def export_model(path: str, name: str) -> dict[str, Any]:
    return {"file": name, "packages": export_model_packages(markdown_model.load(path))}


def _located(column: Column) -> tuple[str, str, str]:
    """(schema, table, column) names of a column that belongs to a table in a schema."""
    table = column.table
    assert table is not None and table.schema is not None, f"column {column.name} is not in a schema"
    return table.schema.name, table.name, column.name


def _mapped_table(class_mapping) -> Table | None:
    """The table a class is mapped to, found through any property mapped to one of its columns (or joined from one)."""
    for pm in class_mapping.property_mappings:
        target = pm.target
        if isinstance(target, Column):
            return target.table
        if isinstance(target, Join):
            return target.lhs.table
    return None


def export_mapping(path: str, name: str, dir: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        content = f.read()
    base_dir = os.path.dirname(os.path.abspath(path))
    # The same steps as markdown_mapping.load, keeping hold of the data store it builds (the Mapping does not expose it).
    packages = markdown_mapping._load_model_reference(content, base_dir)
    root = markdown_mapping.SyntaxTreeNode(markdown_mapping._md_parser.parse(content))
    nodes = markdown_mapping._expand_schema_includes(root.children, base_dir)
    datastore = markdown_mapping._build_repository_from_content(nodes)
    if datastore is None:
        raise ValueError(f"No '## DataStore:' section found in {path}")
    mapping = markdown_mapping._loads_from_nodes(nodes, packages, datastore)

    model_names = []
    for line in content.splitlines():
        if line.startswith("## Model:"):
            model_names.append(os.path.relpath(os.path.join(base_dir, line[len("## Model:"):].strip()), dir))

    associations_by_nav = {
        (a.source, a.target_property.id): a
        for pkg in packages for a in pkg.children if isinstance(a, Association)
    }
    table_class: dict[int, str] = {}
    column_property: dict[int, str] = {}
    joins = []
    for cm in mapping.mappings:
        table = _mapped_table(cm)
        if table is not None:
            table_class[id(table)] = cm.clazz.name
        for pm in cm.property_mappings:
            if isinstance(pm.target, Column):
                column_property[id(pm.target)] = pm.property.id
            elif isinstance(pm.target, Join):
                assoc = associations_by_nav.get((cm.clazz.name, pm.property.id))
                (src_schema, src_table, src_column), (tgt_schema, tgt_table, tgt_column) = _located(pm.target.lhs), _located(pm.target.rhs)
                joins.append({
                    "name": assoc.name if assoc else None,
                    "sourceClass": cm.clazz.name,
                    "sourceMultiplicity": str(assoc.source_multiplicity) if assoc else None,
                    "targetMultiplicity": str(assoc.target_multiplicity) if assoc else None,
                    "rows": [{
                        "sourceSchema": src_schema,
                        "sourceTable": src_table,
                        "sourceColumn": src_column,
                        "targetSchema": tgt_schema,
                        "targetTable": tgt_table,
                        "targetColumn": tgt_column,
                    }],
                })

    return {
        "file": name,
        "title": mapping.name,
        "models": model_names,
        "dataStore": {"name": datastore.name, "type": type(datastore).__name__},
        "schemas": [{
            "name": schema.name,
            "tables": [{
                "name": table.name,
                "class": table_class.get(id(table)),
                "columns": [{
                    "name": c.name,
                    "type": c.type,
                    "primaryKey": c.primary_key,
                    "nullable": c.nullable,
                    "property": column_property.get(id(c)),
                } for c in table.columns],
            } for table in schema.tables],
        } for schema in datastore.schemas],
        "associations": joins,
    }


def resolve_dir(config_path: str, dir: str) -> str:
    """The folder holding the markdown: relative to the config file, or ``python:<package>`` for an installed package's folder."""
    if dir.startswith("python:"):
        module = importlib.import_module(dir[len("python:"):])
        assert module.__file__ is not None, f"{dir} has no folder"
        return os.path.dirname(os.path.abspath(module.__file__))
    return os.path.abspath(os.path.join(os.path.dirname(config_path), dir))


def export(config_path: str) -> dict[str, Any]:
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
    dir = resolve_dir(config_path, config.get("dir", "."))
    mappings = [m if isinstance(m, str) else m["path"] for m in config.get("mappings", [])]
    exported_mappings = [export_mapping(os.path.join(dir, m), m, dir) for m in mappings]
    # models the mappings reference are exported too, so every mapped class can be resolved
    model_names = list(dict.fromkeys([*config.get("models", []), *(n for m in exported_mappings for n in m["models"])]))
    return {
        "models": [export_model(os.path.join(dir, m), m) for m in model_names],
        "mappings": exported_mappings,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--config", required=True, help="JSON config naming dir, models and mappings")
    parser.add_argument("--out", required=True, help="JSON file to write")
    args = parser.parse_args(argv)
    data = export(args.config)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
