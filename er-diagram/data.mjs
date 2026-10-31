// Reads the JSON written by data-finder's `python -m mapping_markdown.export_json` and shapes it for the generator.
// The markdown is parsed in Python, by the loaders the rest of the project uses; nothing here reads markdown.
import { readFileSync } from "node:fs";

// -> { classes: Map("file::Name" -> {file, name, desc, props:[{name,id,type,mult,key,desc}]}), byName: Map(Name -> [keys]),
//      assocs: [{name, file, source, sourcePropName, sourceMult, target, targetPropName, targetMult}],
//      mappings: Map(file -> {file, title, models, datastore, tables:[{name, cls, schema, columns:[...]}], associations}) }
export function loadData(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const classes = new Map(), byName = new Map(), assocs = [], mappings = new Map();
  for (const model of data.models) for (const pkg of model.packages) {
    for (const c of pkg.classes) {
      const key = `${model.file}::${c.name}`;
      classes.set(key, {
        file: model.file, name: c.name, desc: c.description, superclasses: c.superclasses,
        props: c.properties.map(p => ({ name: p.name, id: p.id, type: p.type, mult: p.multiplicity, key: p.key, desc: p.description })),
      });
      byName.set(c.name, [...(byName.get(c.name) ?? []), key]);
    }
    // each end is the property added to its own class: the source property (on the source class) returns the target and has
    // sourceMult; the target property (on the target class, null when one-way) returns the source; targetMult is declared either way
    for (const a of pkg.associations) assocs.push({
      name: a.name, file: model.file, source: a.source, sourcePropName: a.sourcePropertyName, sourceMult: a.sourceMultiplicity,
      target: a.target, targetPropName: a.targetPropertyName, targetMult: a.targetMultiplicity,
    });
  }
  for (const m of data.mappings) mappings.set(m.file, {
    file: m.file, title: m.title, models: m.models, datastore: m.dataStore.name, associations: m.associations,
    tables: m.schemas.flatMap(s => s.tables.map(t => ({
      name: t.name, cls: t.class, schema: s.name,
      columns: t.columns.map(c => ({ name: c.name, type: c.type, key: c.primaryKey ? "PK" : "", nullable: c.nullable, prop: c.property })),
    }))),
  });
  return { classes, byName, assocs, mappings };
}
