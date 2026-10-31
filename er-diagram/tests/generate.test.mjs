// Tests for the ER diagram generator. Run with `npm test` (node:test, no extra dependencies).
//  - fixtures/shop: a tiny model + mapping, showing the tool is independent of any particular model
//  - data-finder.config.json: the real e2e model/mapping files in datafinder_examples
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// the markdown is parsed in Python (data-finder's mapping_markdown.export_json); the generator draws the JSON it writes
const repo = resolve(root, "..");
function generate(config) {
  const out = mkdtempSync(join(tmpdir(), "er-diagram-"));
  execFileSync("uv", ["run", "python", "-m", "mapping_markdown.export_json", "--config", config, "--out", join(out, "data.json")], { cwd: repo, stdio: "pipe" });
  const stdout = execFileSync("node", [join(root, "generate.mjs"), "--config", config, "--out", out], { stdio: "pipe" }).toString();
  return { out, stdout, read: f => readFileSync(join(out, f), "utf8"), has: f => existsSync(join(out, f)) };
}
const stubsOf = html => JSON.parse(html.match(/const STUBS = (.*);/)[1]);
const descsOf = html => JSON.parse(html.match(/const DESCS = (.*);/)[1]);
const descOfRow = (html, cls, rowPattern) => { const d = descsOf(html)[cls]; return d[Object.keys(d).find(k => rowPattern.test(k))]; };
const links = html => [...html.matchAll(/<a class="box (\w+)" href="([^"]+)"><b>([^<]+)<\/b>/g)].map(m => ({ kind: m[1], href: m[2], title: m[3] }));

// ---------- fixture: independent of our models ----------
test("fixture: landing page, full model, mapped model and database", () => {
  const { read, has } = generate(join(here, "fixtures/shop/config.json"));
  assert.deepEqual(links(read("index.html")), [
    { kind: "model", href: "model.html", title: "Full model" },
    { kind: "model", href: "shop_mapping__model.html", title: "Mapped model" },
    { kind: "db", href: "shop_mapping__database.html", title: "Database" },
  ]);
  assert.match(read("shop_mapping__model__shop.mmd"), /class Customer\["Customer"\] \{\n\s+Id\u00a0+Integer\u00a0+\[1\]\u00a0+PK\n\s+Full Name\u00a0+String\u00a0+\[1\]\n\s+\}/);
  const db = read("shop_mapping__database__sales.mmd");
  assert.match(db, /INT customer_id FK/);
  assert.match(db, /sales__customers \|\|--o\{ sales__orders : "customer_id to id"/);
  assert.equal(descsOf(read("shop_mapping__database__sales.html")).sales__orders.total, "Order total");
  assert.equal(descOfRow(read("model__shop.html"), "Customer", /^Full Name\u00a0+String\u00a0+\[1\]$/), "Name on the order");
  assert.ok(has("shop_mapping__model.html"));
});

test("fixture: a mapping that maps only some classes draws the rest as stubs linking to their model", () => {
  const { read } = generate(join(here, "fixtures/shop/partial.config.json"));
  assert.match(read("model__all.mmd"), /class Order\["Order"\] \{/);                   // the full model still has everything
  const mmd = read("partial_mapping__model__shop.mmd");
  assert.match(mmd, /\n\s+class Customer\["Customer"\]\n/);                            // unmapped: stub, no attributes
  assert.match(mmd, /class Order\["Order"\] \{/);
  assert.deepEqual(stubsOf(read("partial_mapping__model__shop.html")), { Customer: "model__shop.html" });
});

test("fixture: the full model links to each model's own diagram", () => {
  const { read } = generate(join(here, "fixtures/shop/config.json"));
  assert.match(read("model.mmd"), /click m0 href "model__shop.html"/);
  assert.match(read("model__shop.mmd"), /Order "\*" --> "1" Customer : Customer/);       // child Order (*) -> target Customer (1)
});

test("attribute rows are padded into aligned columns and drawn in a monospace font", () => {
  const { read } = generate(join(here, "fixtures/shop/config.json"));
  const rows = read("model__shop.mmd").match(/class Customer\["Customer"\] \{\n([^}]*)\}/)[1].trim().split("\n").map(l => l.trim());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].search(/Integer/), rows[1].search(/String/));                // the type column starts at the same offset
  assert.equal(rows[0].search(/\[1\]/), rows[1].search(/\[1\]/));                   // so does the multiplicity column
  // Mermaid measures text with the top-level fontFamily but draws with themeVariables.fontFamily; they must match or lines wrap
  assert.match(read("model__shop.html"), /fontFamily: "ui-monospace[^"]*", themeVariables: \{[^}]*"fontFamily":"ui-monospace/);
  assert.match(read("shop_mapping__database__sales.html"), /fontFamily: "-apple-system[^"]*", themeVariables: \{[^}]*"fontFamily":"-apple-system/);
});

test("a missing data file says how to write it", () => {
  const out = mkdtempSync(join(tmpdir(), "er-diagram-"));
  assert.throws(() => execFileSync("node", [join(root, "generate.mjs"), "--config", join(here, "fixtures/shop/config.json"), "--out", out], { stdio: "pipe" }),
    err => /export_json/.test(err.stderr.toString()));
});

test("a schema over 90 tables is split into pages, keeping joined tables together", () => {
  const dir = mkdtempSync(join(tmpdir(), "er-big-"));
  const n = 100, ids = Array.from({ length: n }, (_, i) => i);
  const cls = i => `Item${i}`;
  const header = "| Property | Id | Type | Multiplicity | Key | Description |\n|---|---|---|---|---|---|\n| Id | id | Integer | 1 | Y | |\n";
  writeFileSync(join(dir, "big_model.md"), "# Big\n\n## Sub-Domain: big\n\n" + ids.map(i =>
    `### Class: ${cls(i)}\n\n| Name | Description |\n|---|---|\n| ${cls(i)} | |\n\n${header}`).join("\n") +
    `\n### Association: Link\n\n| Name | Source | Source Property Name | Source Property ID | Source Multiplicity | Target | Target Property Name | Target Property ID | Target Multiplicity | Description |\n|---|---|---|---|---|---|---|---|---|---|\n| Link | ${cls(99)} | Zero | zero | 1 | ${cls(0)} | Items | items | * | |\n`);
  writeFileSync(join(dir, "big_mapping.md"), "# Big Mapping\n\n## Model: big_model.md\n\n## DataStore: big_db (Database)\n\n### Schema: main\n\n" + ids.map(i =>
    `#### Table: t${i} → ${cls(i)}\n\n| Column | Type | Key | Nullable | Property ID |\n|---|---|---|---|---|\n| id | INT | PK | N | id |\n` + (i === 99 ? "| zero_id | INT | FK | Y | zero |\n" : "")).join("\n") +
    "\n#### Association: Link\n\n| Source Column | Target Table | Target Column |\n|---|---|---|\n| zero_id | t0 | id |\n");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ dir: ".", models: ["big_model.md"], mappings: ["big_mapping.md"] }));
  const { read, has } = generate(join(dir, "config.json"));
  assert.match(read("big_mapping__database.mmd"), /s0\["<b>main<\/b><br\/>100 tables"\]/);
  assert.match(read("big_mapping__database.mmd"), /click s0 href "big_mapping__database__main_part1.html"/);
  assert.ok(has("big_mapping__database__main_part1.html") && has("big_mapping__database__main_part2.html"));
  assert.ok(!has("big_mapping__database__all.html"), "no all-tables page when it would not fit");
  const tables = f => (read(f).match(/^    main__t\d+\["t\d+"\] \{/gm) ?? []).length;
  assert.equal(tables("big_mapping__database__main_part1.mmd") + tables("big_mapping__database__main_part2.mmd"), 100);
  assert.ok(tables("big_mapping__database__main_part1.mmd") <= 90);
  // t99 and t0 are joined by a foreign key, so they share a page and the key is drawn without a stub
  const withFk = ["big_mapping__database__main_part1.mmd", "big_mapping__database__main_part2.mmd"].map(read).find(t => /main__t0 .*main__t99/.test(t));
  assert.ok(withFk && /main__t0\["t0"\] \{/.test(withFk) && /main__t99\["t99"\] \{/.test(withFk));
  assert.match(read("big_mapping__database__main_part1.html") + read("big_mapping__database__main_part2.html"), /Pages:/);
});

test("config is required", () => {
  assert.throws(() => execFileSync("node", [join(root, "generate.mjs")], { stdio: "pipe" }));
});

// ---------- our e2e model/mapping files ----------
const configPath = join(root, "data-finder.config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
// the e2e files are the installed datafinder_examples package's markdown ("python:<package>" in the config)
const dir = execFileSync("uv", ["run", "python", "-c", `import importlib, os; print(os.path.dirname(importlib.import_module("${config.dir.replace("python:", "")}").__file__))`],
  { cwd: repo, stdio: "pipe" }).toString().trim();
const key = m => m.replace(/\.md$/, "");

test("config covers every e2e model and database mapping file", () => {
  const listed = new Set([...config.models, ...config.mappings]);
  const files = readdirSync(dir).filter(f => f.endsWith(".md") && !f.endsWith("_graphql_mapping.md"));   // GraphQL mappings have no tables to draw
  assert.deepEqual(files.filter(f => !listed.has(f)), [], "markdown files in the e2e folder missing from the config");
  assert.deepEqual([...listed].filter(f => !existsSync(join(dir, f))), [], "config lists files that do not exist");
});

const gen = generate(configPath);
const { read, has } = gen;

test("e2e: landing page has the model box, then a mapped-model and a database box per mapping", () => {
  const l = links(read("index.html"));
  assert.deepEqual(l[0], { kind: "model", href: "model.html", title: "Full model" });
  assert.equal(l.length, 1 + 2 * config.mappings.length);
  config.mappings.forEach((m, i) => {
    assert.deepEqual(l[1 + 2 * i], { kind: "model", href: `${key(m)}__model.html`, title: "Mapped model" });
    assert.deepEqual(l[2 + 2 * i], { kind: "db", href: `${key(m)}__database.html`, title: "Database" });
    assert.ok(has(`${key(m)}__model.html`) && has(`${key(m)}__model__all.html`) && has(`${key(m)}__database.html`), m);
  });
  assert.ok(read("index.html").indexOf("<h2>Model</h2>") < read("index.html").indexOf("<h2>Mappings</h2>"));
});

test("e2e: full model is a flowchart with a clickable box per model file", () => {
  const mmd = read("model.mmd");
  config.models.forEach((m, i) => {
    assert.match(mmd, new RegExp(`click m${i} href "model__${key(m).replace(/_model$/, "")}.html"`), m);
    assert.ok(has(`model__${key(m).replace(/_model$/, "")}.html`), m);
  });
  assert.match(mmd, /m2 -->\|"2 associations"\| m3/);                                  // finance -> finance_trade (TradeAccount, TradeInstrument)
});

test("e2e: each model file has its own diagram; references to other models are stubs linking to them", () => {
  const fin = read("model__finance.mmd");
  assert.match(fin, /class Account\["Account"\] \{\n\s+Id\u00a0+Integer\u00a0+\[1\]\u00a0+PK\n\s+Name\u00a0+String\u00a0+\[1\]\n\s+\}/);
  assert.match(fin, /Account "\*" --> "0..1" Branch : Branch/);                          // Account * -> Branch 0..1
  assert.equal(descsOf(read("model__finance.html")).Account._, "Trading account used to buy and sell securities");
  assert.match(read("model__finance.html"), /Referenced by:.*Finance Trade/s);
  const trade = read("model__finance_trade.mmd");
  assert.match(trade, /\n\s+class Account\["Account"\]\n/);                            // stub: no attributes
  assert.match(trade, /Trade "\*" --> "1" Account : Account/);
  assert.deepEqual(stubsOf(read("model__finance_trade.html")), { Account: "model__finance.html", Instrument: "model__finance.html" });
});

test("e2e: all classes in one diagram, duplicates labelled by model", () => {
  const mmd = read("model__all.mmd");
  for (const c of ["Account", "Branch", "Trade", "Company", "Record", "Contactable", "Project", "Person", "Firm"])
    assert.match(mmd, new RegExp(`\\n    class ${c}(_\\d+)?\\["`), c);
  assert.match(mmd, /class Employee\["Employee \(Orgchart\)"\]/);
  assert.match(mmd, /class Employee_2\["Employee \(Orgchart Inheritance\)"\]/);
});

test("e2e: a mapped model has the same views as the full model, restricted to the mapped classes", () => {
  const flow = read("finance_mapping__model.mmd");                                      // a clickable box per model file
  assert.match(flow, /m0\["<b>Finance<\/b><br\/>3 classes"\]/);
  assert.match(flow, /m1\["<b>Finance Trade<\/b><br\/>2 classes"\]/);
  assert.match(flow, /m0 -->\|"2 associations"\| m1/);
  assert.match(flow, /click m0 href "finance_mapping__model__finance.html"/);
  assert.match(flow, /click m1 href "finance_mapping__model__finance_trade.html"/);
  assert.match(read("finance_mapping__model.html"), /finance_mapping__model__all.html/);
  const trade = read("finance_mapping__model__finance_trade.mmd");
  assert.match(trade, /Trade "\*" --> "1" Account : Account/);
  assert.deepEqual(stubsOf(read("finance_mapping__model__finance_trade.html")), { Account: "finance_mapping__model__finance.html", Instrument: "finance_mapping__model__finance.html" });   // mapped: their pages in this view
  const all = read("finance_mapping__model__all.mmd");
  assert.match(all, /class Account\["Account"\] \{\n\s+Id\u00a0+Integer\u00a0+\[1\]\u00a0+PK\n\s+Name\u00a0+String\u00a0+\[1\]\n\s+\}/);
  assert.match(all, /Account "\*" --> "0..1" Branch : Branch/);
});

test("e2e: a mapped model only has boxes for model files with mapped classes", () => {
  const flow = read("orgchart_inheritance_mapping__model.mmd");
  assert.match(flow, /m0\["<b>Orgchart Inheritance<\/b><br\/>2 classes"\]/);           // Employee and Project; not Person or Contactable
  assert.ok(!/m1/.test(flow));
});

test("e2e: associations follow the model's ends: the source property labels the arrow, each multiplicity sits at the far end", () => {
  const trade = read("model__finance_trade.mmd");
  assert.match(trade, /Trade "\*" --> "1" Account : Account/);                           // Trade.account (1): one account per trade; * trades per account
  assert.match(trade, /Trade "\*" --> "0..1" Instrument : Instrument/);                  // one-way: no Instrument.trades, still * trades per instrument
  assert.match(read("model__finance.mmd"), /Account "\*" --> "0..1" Branch : Branch/);     // Account.branch (0..1), Branch.accounts (*)
  const trading = read("finance_mapping__database__trading.mmd");
  assert.match(trading, /ref_data__account_master \|\|--o\{ trading__trades : "account_id to ID"/);   // a trade has exactly one account
  assert.match(trading, /ref_data__price \|o--o\{ trading__trades : "sym to SYM"/);                   // ... and at most one instrument
});

test("e2e: inheritance is drawn UML style, with superclasses as stubs where they are not mapped", () => {
  const model = read("model__orgchart_inheritance.mmd");
  assert.match(model, /Person <\|-- Employee\n\s+Contactable <\|-- Employee/);
  assert.match(read("model__diamond.mmd"), /Auditable <\|-- Trackable\n\s+Auditable <\|-- Versioned\n\s+Trackable <\|-- Record\n\s+Versioned <\|-- Record/);
  const mapped = read("orgchart_inheritance_mapping__model__all.mmd");     // only Employee and Project are mapped
  assert.match(mapped, /class Person\["Person"\]\n\s+class Contactable\["Contactable"\]\n/);
  assert.match(mapped, /Person <\|-- Employee/);
  assert.match(mapped, /cssClass "Person,Contactable" stub/);
  assert.match(read("model__all.mmd"), /Person <\|-- Employee_2/);          // the inheritance example's Employee
});

test("e2e: inheritance mapped model: self reference and many-to-many", () => {
  const mmd = read("orgchart_inheritance_mapping__model__all.mmd");
  assert.match(mmd, /Employee "\*" --> "0..1" Employee : Manager/);
  assert.match(mmd, /Project "\*" --> "\*" Employee : Assignee/);
});

test("e2e: a database has a flowchart with a clickable box per schema", () => {
  const flow = read("finance_mapping__database.mmd");
  assert.match(flow, /s0\["<b>ref_data<\/b><br\/>3 tables"\]/);
  assert.match(flow, /s1\["<b>trading<\/b><br\/>2 tables"\]/);
  assert.match(flow, /s0 -->\|"2 foreign keys"\| s1/);                                   // trades.account_id and trades.instrument_id into ref_data
  assert.match(flow, /click s0 href "finance_mapping__database__ref_data.html"/);
  assert.match(flow, /click s1 href "finance_mapping__database__trading.html"/);
  assert.match(read("finance_mapping__database.html"), /finance_mapping__database__all.html/);
  assert.match(read("orgchart_mapping__database.mmd"), /s0\["<b>hr<\/b><br\/>1 table"\]/);   // a single schema is still a box
});

test("e2e: finance database: each schema has its own page with PK/FK columns; a table in the other schema is a stub", () => {
  const ref = read("finance_mapping__database__ref_data.mmd");
  assert.match(ref, /INT ID PK/);
  assert.match(ref, /INT BRANCH_ID FK/);
  assert.match(ref, /ref_data__branch \|o--o\{ ref_data__account_master : "BRANCH_ID to ID"/);
  assert.deepEqual(stubsOf(read("finance_mapping__database__ref_data.html")), {});
  const trading = read("finance_mapping__database__trading.mmd");
  assert.match(trading, /INT account_id FK/);
  assert.match(trading, /ref_data__account_master \|\|--o\{ trading__trades : "account_id to ID"/);
  assert.deepEqual(stubsOf(read("finance_mapping__database__trading.html")), { ref_data__account_master: "finance_mapping__database__ref_data.html", ref_data__price: "finance_mapping__database__ref_data.html" });
  assert.ok(!/trading__trades/.test(ref));                                            // each page holds only its own schema's tables
});

test("e2e: all tables of a mapping in one diagram, across schemas", () => {
  const all = read("finance_mapping__database__all.mmd");
  assert.match(all, /ref_data__branch \|o--o\{ ref_data__account_master : "BRANCH_ID to ID"/);
  assert.match(all, /ref_data__account_master \|\|--o\{ trading__trades : "account_id to ID"/);
  assert.deepEqual(stubsOf(read("finance_mapping__database__all.html")), {});               // everything is on the one page
});

test("e2e: finance_mapping_embedded is its own mapping with its own diagrams", () => {
  const mmd = read("finance_mapping_embedded__database__ref_data.mmd");
  assert.match(mmd, /ref_data__branch_master \|o--o\{ ref_data__account_master/);
  assert.match(read("finance_mapping_embedded__database__trading.mmd"), /VARCHAR branch_city/);
});

test("e2e: column hover shows the logical property description", () => {
  const d = descsOf(read("finance_mapping__database__ref_data.html"));
  assert.equal(d.ref_data__account_master.BRANCH_ID, "Foreign key to branch.ID");
  assert.match(d.ref_data__account_master._, /^Account: Trading account/);
});

test("e2e: every foreign key is drawn and every association resolved", () => {
  assert.match(gen.stdout, /9 mappings, 8 foreign keys \(0 associations unresolved\)/);
});
