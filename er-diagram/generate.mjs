// Mermaid ER diagram viewer for model and mapping markdown files.
// usage: node generate.mjs --config <config.json> [--out dir] [--attrs all|N] [--open]
//
// The config file says which models and mappings to show (see loadConfig in common.mjs). Output, one HTML + .mmd per diagram:
//   index.html                   landing page: a box for the full model, then a box per mapping holding a
//                                "mapped model" box and a "database" box
//   model.html                   the full (unmapped) model: a flowchart with a clickable box per model file
//   model__<model>.html          one model file's ER diagram, with stubs linking to the models it references
//   model__all.html              every class of the configured models in one ER diagram
//   <mapping>__model.html        the mapped model: the classes the mapping maps, with stubs for classes it relates to but does not map
//   <mapping>__database.html     the mapping's database: a flowchart with a clickable box per schema
//   <mapping>__database__<schema>.html   one schema's tables (PK/FK), paginated past 90 tables; <mapping>__database__all.html has every table
// Hover an attribute or column for its description; click a dashed stub box to open the page that owns it.
// Class names can repeat between models, so a name is resolved within the file, then within the mapping's models, then first found.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { BLUE, GREEN, page, loadConfig, setAcronyms, spaced, multLeft, multRight } from "./common.mjs";
import { loadData } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig(process.argv.slice(2));
setAcronyms(cfg.acronyms);
const { out: outDir, maxAttrs } = cfg;
if (!cfg.models.length) { console.error("config lists no models"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const mermaidJs = relative(outDir, join(here, "node_modules/mermaid/dist/mermaid.min.js"));

const slug = s => s.replace(/[^A-Za-z0-9]+/g, "_");
const words = s => s.split("_").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const nameOf = f => basename(f).replace(/(_model|_mapping)?\.md$/, "");
const plural = (n, w) => `${n} ${n === 1 ? w : w.endsWith("s") ? w + "es" : w + "s"}`;
const write = (name, text) => writeFileSync(join(outDir, name), text);
const attrNote = Number.isFinite(maxAttrs) ? `First ${maxAttrs} attributes shown.` : "All attributes shown.";

// ---------- load ----------
let data;
try { data = loadData(cfg.data); }
catch (e) { console.error(`cannot read ${cfg.data} (${e.message})\nwrite it first: python -m mapping_markdown.export_json --config <config.json> --out ${cfg.data}`); process.exit(1); }
const { classes, byName, assocs: rawAssocs } = data;
const modelFiles = cfg.models;
const mappings = cfg.mappings.map(m => {
  const mp = data.mappings.get(m.path);
  if (!mp) { console.error(`${m.path} is not in ${cfg.data}; regenerate it`); process.exit(1); }
  const key = slug(m.name ?? basename(m.path, ".md"));
  return { ...mp, key, title: m.title ?? mp.title ?? words(key) };
});

function resolveClass(name, file, scope) {
  const cands = byName.get(name) ?? [];
  if (cands.length <= 1) return cands[0];
  return cands.find(k => classes.get(k).file === file) ?? cands.find(k => scope.has(classes.get(k).file)) ?? cands[0];
}
const relsFor = scope => rawAssocs.filter(a => scope.has(a.file)).flatMap(a => {
  const s = resolveClass(a.source, a.file, scope), t = resolveClass(a.target, a.file, scope);
  return s && t ? [{ ...a, s, t }] : [];
});

// ---------- logical diagrams ----------
// Mermaid's ER diagram has no inheritance, so models are drawn as UML class diagrams: attributes (name, type, [multiplicity], key, in padded columns) in the class box, "Parent <|-- Child"
// for inheritance, and an association arrow from the child (source) to the target with a multiplicity at each end.
// Ids are the class names; a repeated name in one diagram gets a numbered id, and its label names the model it came from.
// A superclass of a class drawn in full is always included, as a stub if it is not drawn in full itself.
function classText(rels, fullKeys, alwaysInclude, scope) {
  const inherit = [];                              // [superclass key, subclass key]
  const supers = new Set();
  const first = new Set([...alwaysInclude, ...rels.flatMap(a => [a.t, a.s])]);
  for (const key of first) if (fullKeys.has(key)) for (const name of classes.get(key).superclasses ?? []) {
    const sk = resolveClass(name, classes.get(key).file, scope);
    if (sk) { inherit.push([sk, key]); supers.add(sk); }
  }
  const used = [...new Set([...first, ...supers])];
  const count = new Map();
  for (const k of used) count.set(classes.get(k).name, (count.get(classes.get(k).name) ?? 0) + 1);
  const label = k => { const c = classes.get(k); return count.get(c.name) > 1 ? `${spaced(c.name)} (${words(nameOf(c.file))})` : spaced(c.name); };
  // attribute rows: "Name  Type  [mult]  PK", padded with non-breaking spaces so each class's columns line up (the page draws them in monospace)
  const NB = "\u00a0", pad = (t, n) => t + NB.repeat(n - t.length);
  const memberRows = c => {
    const rows = c.props.map(p => [p.name.replace(/[(){}<>~"]/g, ""), p.type, `[${p.mult}]`, p.key ? "PK" : ""]);
    const w = [0, 1, 2].map(i => Math.max(...rows.map(r => r[i].length)));
    return new Map(c.props.map((p, i) => [p, rows[i].map((t, j) => (j < 3 ? pad(t, w[j]) : t)).join(NB + NB).trimEnd()]));
  };
  const ids = new Map(), taken = new Set(), descs = {};
  for (const key of used) {
    let id = classes.get(key).name, i = 2;
    while (taken.has(id)) id = `${classes.get(key).name}_${i++}`;
    taken.add(id); ids.set(key, id);
  }
  const lines = ["classDiagram", "    direction TB"], stubIds = [];
  for (const key of used) {
    const id = ids.get(key), c = classes.get(key), d = { _label: label(key), _: c.desc };
    if (fullKeys.has(key) && c.props.length) {
      const rows = memberRows(c);
      lines.push(`    class ${id}["${label(key)}"] {`);
      for (const p of c.props.slice(0, maxAttrs)) lines.push(`        ${rows.get(p)}`);
      lines.push("    }");
      for (const p of c.props) if (p.desc) d[rows.get(p)] = p.desc;       // hover key: the attribute row as drawn
    } else {
      lines.push(`    class ${id}["${label(key)}"]`);
      if (!fullKeys.has(key)) stubIds.push(id);       // a class this diagram does not draw in full
    }
    descs[id] = d;
  }
  for (const [sk, key] of inherit) lines.push(`    ${ids.get(sk)} <|-- ${ids.get(key)}`);
  // an arrow from the source class to the target, labelled with the source property (Account.branch); the multiplicity at the target
  // end is that property's (0..1 branches per account) and at the source end the target property's (* accounts per branch)
  for (const a of rels) lines.push(`    ${ids.get(a.s)} "${a.targetMult}" --> "${a.sourceMult}" ${ids.get(a.t)} : ${a.sourcePropName.replace(/[:"]/g, "")}`);
  if (stubIds.length) lines.push("    classDef stub stroke:#555,stroke-dasharray:6", `    cssClass "${stubIds.join(",")}" stub`);
  return { text: lines.join("\n") + "\n", used, ids, descs };
}

// one ER page per model file: its own classes in full, plus stubs for classes of other models that its associations reach
const modelScope = new Set(modelFiles);
const subTitle = f => words(nameOf(f));
const modelPage = f => modelScope.has(f) ? `model__${nameOf(f)}.html` : "model.html";   // the full model's page for a file ("model.html" if it is not in the config)

// A model view: a flowchart with a clickable box per model file (arrows from the model that owns a class to the model whose classes
// reference it), an ER page per model file, and one page with every class. Used for the full model and, restricted to the classes a
// mapping maps, for each mapping. `keys` are the classes in the view, `rels` its associations (drawn from the child side; an end
// outside `keys` is a stub linking to the full model).
//   prefix  page names: <prefix>.html, <prefix>__<file>.html, <prefix>__all.html
function modelViews({ prefix, title, back, extraNav = "", files, keys, rels, scope, flowIntro, allIntro }) {
  const inView = f => files.filter(x => [...keys].some(k => classes.get(k).file === x));
  const shown = inView(files);
  const viewPage = f => `${prefix}__${nameOf(f)}.html`;
  const pageFor = k => keys.has(k) ? viewPage(classes.get(k).file) : modelPage(classes.get(k).file);
  const home = `<a href="index.html">&larr; Home</a>`;
  const info = new Map();                          // file -> { classes, count }
  for (const file of shown) {
    const own = new Set([...keys].filter(k => classes.get(k).file === file));
    const fileRels = rels.filter(a => own.has(a.s));
    const { text, used, ids, descs } = classText(fileRels, own, [...own], scope);
    const stubs = {};
    for (const k of used) if (!own.has(k)) stubs[ids.get(k)] = pageFor(k);
    const incoming = new Map();                    // other models whose classes reference this one
    for (const a of rels) if (own.has(a.t) && !own.has(a.s)) { const f = classes.get(a.s).file; incoming.set(f, (incoming.get(f) ?? 0) + 1); }
    const footer = incoming.size ? `<p><b>Referenced by:</b></p><ul>${[...incoming].map(([f, n]) => `<li><a href="${viewPage(f)}">${subTitle(f)}</a> (${plural(n, "association")})</li>`).join("")}</ul>` : "";
    const name = viewPage(file).replace(/\.html$/, "");
    write(`${name}.mmd`, text);
    write(`${name}.html`, page({
      title: `${title}: ${subTitle(file)}`, mermaidJs, mmd: text, stubs, descs, footer, fixUnderscores: false, mono: true,
      nav: `<nav>${home} &middot; <a href="${prefix}.html">&larr; ${back}</a>${extraNav}</nav>`,
      intro: `${plural(own.size, "class")} from ${basename(file)}. Associations point from the child class to its target, labelled with the target property; inheritance has a hollow arrow to the superclass. ${attrNote}${Object.keys(stubs).length ? " Dashed boxes are classes drawn on another page; click one to open it." : ""}`,
    }));
    info.set(file, { classes: own.size, count: fileRels.length });
  }

  const fl = ["flowchart LR"], idx = new Map(shown.map((f, i) => [f, `m${i}`]));
  for (const f of shown) fl.push(`    ${idx.get(f)}["<b>${subTitle(f)}</b><br/>${plural(info.get(f).classes, "class")}"]`);
  const between = new Map();
  for (const a of rels) {
    if (!keys.has(a.t)) continue;
    const sf = classes.get(a.s).file, tf = classes.get(a.t).file;
    if (sf !== tf) between.set(`${tf}>${sf}`, (between.get(`${tf}>${sf}`) ?? 0) + 1);
  }
  for (const [k, n] of between) { const [t, c] = k.split(">"); fl.push(`    ${idx.get(t)} -->|"${plural(n, "association")}"| ${idx.get(c)}`); }
  for (const f of shown) fl.push(`    click ${idx.get(f)} href "${viewPage(f)}"`);
  const flow = fl.join("\n") + "\n";
  write(`${prefix}.mmd`, flow);
  write(`${prefix}.html`, page({
    title, mermaidJs, mmd: flow, nav: `<nav>${home}${extraNav}</nav>`, intro: flowIntro(shown.length),
    footer: `<p><a href="${prefix}__all.html">All classes in one ER diagram &rarr;</a></p><ul>${shown.map(f => `<li><a href="${viewPage(f)}">${subTitle(f)}</a> - ${plural(info.get(f).classes, "class")}, ${plural(info.get(f).count, "association")}</li>`).join("")}</ul>`,
  }));
  const all = classText(rels, keys, [...keys], scope);
  write(`${prefix}__all.mmd`, all.text);
  write(`${prefix}__all.html`, page({
    title: `${title}: all classes`, mermaidJs, mmd: all.text, descs: all.descs, fixUnderscores: false, mono: true,
    nav: `<nav>${home} &middot; <a href="${prefix}.html">&larr; ${back}</a>${extraNav}</nav>`,
    intro: `${allIntro} Associations point from the child class to its target, labelled with the target property; inheritance has a hollow arrow to the superclass. ${attrNote}`,
  }));
}

const fullRels = relsFor(modelScope);
const fullKeys = new Set([...classes].filter(([, c]) => modelScope.has(c.file)).map(([k]) => k));
modelViews({
  prefix: "model", title: `${cfg.title}: full model`, back: "Full model", files: modelFiles, keys: fullKeys, rels: fullRels, scope: modelScope,
  flowIntro: n => `Each box is a model file (${plural(n, "model")}, ${fullKeys.size} classes); arrows run from the model that owns a class to the model whose classes reference it. Click a box to open its ER diagram.`,
  allIntro: `Every class of the ${plural(modelFiles.length, "model file")} (${fullKeys.size} classes, ${fullRels.length} associations) in one diagram, independent of any mapping.`,
});

// ---------- database diagrams ----------
const MAX_TABLES = 90;                           // Mermaid copes with about 100 entities a page; leave room for stub boxes
const typeToken = t => (t || "unknown").replace(/[^A-Za-z0-9]/g, "") || "unknown";   // keep the database type as written in the mapping
const colToken = n => n.replace(/[^A-Za-z0-9_\-\[\]()]/g, "-");
const entityId = t => `${slug(t.schema)}__${slug(t.name)}`;
let unresolved = 0, totalFks = 0;

// Tables joined by a foreign key stay together where they can: connected groups are packed into pages of at most MAX_TABLES, in order.
function paginate(tables, edges) {
  if (tables.length <= MAX_TABLES) return [tables];
  const root = new Map(tables.map(t => [t, t]));
  const find = t => { while (root.get(t) !== t) { root.set(t, root.get(root.get(t))); t = root.get(t); } return t; };
  for (const e of edges) if (root.has(e.child) && root.has(e.parent)) root.set(find(e.child), find(e.parent));
  const groups = new Map();
  for (const t of tables) { const r = find(t); groups.set(r, [...(groups.get(r) ?? []), t]); }
  const parts = [];
  let cur = [];
  for (const g of [...groups.values()].sort((x, y) => y.length - x.length)) {
    for (let i = 0; i < g.length; i += MAX_TABLES) {
      const chunk = g.slice(i, i + MAX_TABLES);
      if (cur.length + chunk.length > MAX_TABLES) { parts.push(cur); cur = []; }
      cur.push(...chunk);
    }
  }
  if (cur.length) parts.push(cur);
  return parts;
}

// A mapping's database views: a flowchart with a clickable box per schema (arrows from the schema holding the referenced table to the
// schema holding the foreign key), an ER page per schema (a table in another schema is a stub linking to that schema's page), and
// one page with every table when it fits. Returns the number of foreign keys drawn.
function dbViews(mp, scope) {
  const prefix = `${mp.key}__database`;
  const table = (schema, name) => mp.tables.find(t => t.schema === schema && t.name === name);
  const edges = [];                              // every foreign key, resolved to (child table, parent table)
  for (const a of mp.associations) for (const r of a.rows) {
    const child = table(r.sourceSchema, r.sourceTable), parent = table(r.targetSchema, r.targetTable);
    if (!child || !parent) { unresolved++; continue; }
    // the source property sits on the child (the table with the foreign key) and returns the parent, so its multiplicity is how many
    // parents a child has; the target multiplicity is how many children a parent has
    edges.push({ def: { sourceMult: a.sourceMultiplicity, targetMult: a.targetMultiplicity }, r: { srcCol: r.sourceColumn, tgtCol: r.targetColumn }, child, parent });
  }
  const schemas = [...new Set(mp.tables.map(t => t.schema))];
  const pages = schemas.flatMap(schema => {
    const parts = paginate(mp.tables.filter(t => t.schema === schema), edges);
    return parts.map((tables, i) => ({ schema, name: `${prefix}__${slug(schema)}${parts.length > 1 ? `_part${i + 1}` : ""}`, part: i + 1, of: parts.length, tables, rels: [], stubs: new Map() }));
  });
  const pageOf = new Map(pages.flatMap(pg => pg.tables.map(t => [t, pg])));
  const relOf = ({ def, r, child, parent }) => ({ child, parent, srcCol: r.srcCol, tgtCol: r.tgtCol, childMult: def.targetMult, parentMult: def.sourceMult });
  for (const e of edges) {
    const pg = pageOf.get(e.child);
    pg.rels.push(relOf(e));
    if (pageOf.get(e.parent) !== pg) pg.stubs.set(entityId(e.parent), { table: e.parent, href: `${pageOf.get(e.parent).name}.html` });
  }
  totalFks += edges.length;

  const home = `<a href="index.html">&larr; Home</a>`, modelLink = ` &middot; <a href="${mp.key}__model.html">Mapped model &rarr;</a>`;
  const first = schema => pages.find(pg => pg.schema === schema).name;
  const sub = `Tables and columns from ${mp.file}${mp.datastore ? ` (data store ${mp.datastore})` : ""}`;
  const tableCount = schema => mp.tables.filter(t => t.schema === schema).length;
  const fkCount = schema => pages.filter(pg => pg.schema === schema).reduce((n, pg) => n + pg.rels.length, 0);
  const common = { mermaidJs, palette: BLUE, fixUnderscores: false };

  // the flowchart of schemas
  const fl = ["flowchart LR"], idx = new Map(schemas.map((sc, i) => [sc, `s${i}`]));
  for (const sc of schemas) fl.push(`    ${idx.get(sc)}["<b>${sc}</b><br/>${plural(tableCount(sc), "table")}"]`);
  const between = new Map();
  for (const e of edges) if (e.child.schema !== e.parent.schema) { const k = `${e.parent.schema}>${e.child.schema}`; between.set(k, (between.get(k) ?? 0) + 1); }
  for (const [k, n] of between) { const [t, c] = k.split(">"); fl.push(`    ${idx.get(t)} -->|"${plural(n, "foreign key")}"| ${idx.get(c)}`); }
  for (const sc of schemas) fl.push(`    click ${idx.get(sc)} href "${first(sc)}.html"`);
  const flow = fl.join("\n") + "\n";
  const hasAll = mp.tables.length <= MAX_TABLES;
  write(`${prefix}.mmd`, flow);
  write(`${prefix}.html`, page({
    ...common, title: `${mp.title}: database`, mmd: flow, nav: `<nav>${home}${modelLink}</nav>`,
    intro: `${sub}. Each box is a schema (${plural(schemas.length, "schema")}, ${plural(mp.tables.length, "table")}); arrows run from the schema holding the referenced table to the schema holding the foreign key. Click a box to open its tables.`,
    footer: `${hasAll ? `<p><a href="${prefix}__all.html">All tables in one ER diagram &rarr;</a></p>` : ""}<ul>${schemas.map(sc => `<li><a href="${first(sc)}.html">${sc}</a> - ${plural(tableCount(sc), "table")}, ${plural(fkCount(sc), "foreign key")}</li>`).join("")}</ul>`,
  }));

  // an ER page per schema (per part, when a schema is too big for one page)
  for (const pg of pages) {
    const { text, descs } = dbText(pg, scope);
    const parts = pages.filter(p => p.schema === pg.schema);
    const others = parts.length > 1 ? `<p><b>Pages:</b> ${parts.map(p => p === pg ? `${p.part}` : `<a href="${p.name}.html">${p.part}</a>`).join(" &middot; ")}</p>` : "";
    write(`${pg.name}.mmd`, text);
    write(`${pg.name}.html`, page({
      ...common, title: `${mp.title}: ${pg.schema}${pg.of > 1 ? ` (part ${pg.part} of ${pg.of})` : ""}`, mmd: text, descs, footer: others,
      stubs: Object.fromEntries([...pg.stubs].map(([id, st]) => [id, st.href])),
      nav: `<nav>${home} &middot; <a href="${prefix}.html">&larr; Database</a>${modelLink}</nav>`,
      intro: `${plural(pg.tables.length, "table")} of schema ${pg.schema}, with database types and PK/FK. Foreign keys are the mapping's associations, labelled source column to target column.${pg.stubs.size ? " Dashed boxes are tables in another schema; click one to open it." : ""}`,
    }));
  }

  // every table in one diagram
  if (hasAll) {
    const { text, descs } = dbText({ tables: mp.tables, rels: edges.map(relOf), stubs: new Map() }, scope);
    write(`${prefix}__all.mmd`, text);
    write(`${prefix}__all.html`, page({
      ...common, title: `${mp.title}: all tables`, mmd: text, descs,
      nav: `<nav>${home} &middot; <a href="${prefix}.html">&larr; Database</a>${modelLink}</nav>`,
      intro: `${sub}: all ${plural(mp.tables.length, "table")} in one diagram, with database types and PK/FK.`,
    }));
  }
  return { edges: edges.length, schemas: schemas.length };
}

function dbText(pg, scope) {
  const fkCols = new Map();                      // entity id -> Map(column -> "Parent.col")
  for (const r of pg.rels) { const id = entityId(r.child); if (!fkCols.has(id)) fkCols.set(id, new Map()); fkCols.get(id).set(r.srcCol, `${r.parent.name}.${r.tgtCol}`); }
  const lines = ["erDiagram"], descs = {};
  for (const t of pg.tables) {
    const id = entityId(t), fks = fkCols.get(id) ?? new Map();
    const cls = classes.get((byName.get(t.cls) ?? []).find(k => scope.has(classes.get(k).file)));
    lines.push(`    ${id}["${t.name}"] {`);
    descs[id] = { _label: t.name, _: cls ? `${t.cls}: ${cls.desc}` : "" };
    for (const c of t.columns) {
      const keys = [c.key === "PK" ? "PK" : null, fks.has(c.name) ? "FK" : null].filter(Boolean).join(", ");
      lines.push(`        ${typeToken(c.type)} ${colToken(c.name)}${keys ? " " + keys : ""}`);
      const d = [cls?.props.find(p => p.id === c.prop)?.desc, fks.has(c.name) ? `Foreign key to ${fks.get(c.name)}` : ""].filter(Boolean).join(" - ");
      if (d) descs[id][c.name] = d;
    }
    lines.push("    }");
  }
  for (const [id, s] of pg.stubs) { lines.push(`    ${id}["${s.table.name}"]`); descs[id] = { _label: s.table.name, _: s.table.schema }; }
  for (const r of pg.rels) lines.push(`    ${entityId(r.parent)} ${multLeft(r.parentMult)}--${multRight(r.childMult)} ${entityId(r.child)} : "${r.srcCol} to ${r.tgtCol}"`);
  return { text: lines.join("\n") + "\n", descs };
}

// ---------- per mapping ----------
const summary = [];
for (const mp of mappings) {
  const scope = new Set(mp.models);
  const db = dbViews(mp, scope);

  // mapped model: the same views as the full model, restricted to the classes the mapping maps; associations are drawn from the
  // mapped (child) side, and classes it relates to but does not map are stubs linking to the full model
  const mapped = new Set(mp.tables.map(t => (byName.get(t.cls) ?? []).find(k => scope.has(classes.get(k).file))).filter(Boolean));
  const rels = relsFor(scope).filter(a => mapped.has(a.s));
  modelViews({
    prefix: `${mp.key}__model`, title: `${mp.title}: mapped model`, back: "Mapped model", extraNav: ` &middot; <a href="${mp.key}__database.html">Database diagram &rarr;</a>`,
    files: mp.models, keys: mapped, rels, scope,
    flowIntro: n => `Each box is a model file with classes mapped by ${mp.file} (${plural(n, "model")}, ${mapped.size} classes); arrows run from the model that owns a class to the model whose classes reference it. Click a box to open the mapped classes of that model.`,
    allIntro: `The ${plural(mapped.size, "class")} mapped by ${mp.file} (${plural(rels.length, "association")}) in one diagram.`,
  });

  summary.push({ mp, classes: mapped.size, tables: mp.tables.length, fks: db.edges, schemas: db.schemas });
}

// ---------- landing page ----------
const box = (kind, href, title, detail) => `<a class="box ${kind}" href="${href}"><b>${title}</b><span>${detail}</span></a>`;
const body = `<style>
h2{font-size:15px;margin:28px 0 10px}
.row{display:flex;flex-wrap:wrap;gap:16px}
.group{border:1px solid #ccc;border-radius:8px;padding:10px 12px}
.group h3{font-size:14px;margin:0 0 2px}.group small{display:block;color:#666;font-size:12px;margin-bottom:8px}
.pair{display:flex;gap:10px}
.box{display:block;min-width:150px;padding:10px 14px;border-radius:6px;border:1.5px solid;text-decoration:none;color:inherit}
.box b{display:block;font-size:14px}.box span{font-size:12px;color:#555}
.box:hover{box-shadow:0 2px 8px rgba(0,0,0,.2)}
.model{background:${GREEN.vars.mainBkg};border-color:${GREEN.accent};color:${GREEN.ink}}
.db{background:${BLUE.vars.mainBkg};border-color:${BLUE.accent};color:${BLUE.ink}}
</style>
<h2>Model</h2>
<div class="row">${box("model", "model.html", "Full model", `${plural(modelFiles.length, "model")}, ${plural(fullKeys.size, "class")}<br>${plural(fullRels.length, "association")}, no mapping`)}</div>
<h2>Mappings</h2>
<div class="row">${summary.map(s => `<div class="group"><h3>${s.mp.title}</h3><small>${s.mp.datastore ? s.mp.datastore + " &middot; " : ""}${s.mp.file}</small><div class="pair">${
  box("model", `${s.mp.key}__model.html`, "Mapped model", plural(s.classes, "class"))}${
  box("db", `${s.mp.key}__database.html`, "Database", `${plural(s.tables, "table")} in ${plural(s.schemas, "schema")}<br>${plural(s.fks, "foreign key")}`)}</div></div>`).join("\n")}</div>`;
write("index.html", page({
  title: cfg.title, mermaidJs, body, intro: "Start with the full model, or pick a mapping to see the model entities it maps and its database tables.",
}));
console.log(`${fullKeys.size} classes, ${mappings.length} mappings, ${totalFks} foreign keys (${unresolved} associations unresolved) -> ${relative(process.cwd(), join(outDir, "index.html"))}`);
if (cfg.open) execFileSync("open", [join(outDir, "index.html")]);
