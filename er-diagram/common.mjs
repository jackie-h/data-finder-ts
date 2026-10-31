import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Shared by generate.mjs (logical diagrams, green) and generate-db.mjs (database diagrams, blue): palettes, Mermaid config,
// name helpers and the HTML page template (stub links + hover descriptions).
// Forest-green palette in the style of Mermaid's default (lavender) theme: pale, low-saturation tinted fills with a darker
// border. Mermaid 'base' theme variables: header/box fill, alternating attribute rows, borders, lines, text.
const GREEN_VARS = {
  fontFamily: "-apple-system, Segoe UI, sans-serif",
  mainBkg: "#cfe3d6", nodeBorder: "#2f6b4f", border1: "#2f6b4f", border2: "#2f6b4f",
  attributeBackgroundColorOdd: "#f6faf7", attributeBackgroundColorEven: "#e3eee7",
  lineColor: "#2f6b4f", relationColor: "#2f6b4f", edgeLabelBackground: "#f6faf7",
  primaryColor: "#cfe3d6", primaryBorderColor: "#2f6b4f", primaryTextColor: "#1f3d2e",
  textColor: "#1f3d2e", nodeTextColor: "#1f3d2e", tertiaryColor: "#f6faf7",
};
export const ER_CONFIG = { useMaxWidth: false, layoutDirection: "LR", fontSize: 11, entityPadding: 3, minEntityHeight: 20, minEntityWidth: 80, nodeSpacing: 30, rankSpacing: 70, diagramPadding: 10 };

export const GREEN = { vars: GREEN_VARS, accent: "#2f6b4f", ink: "#1f3d2e" };
// Blue palette for the database (physical) diagrams: same structure as the green one.
export const BLUE = {
  vars: {
    fontFamily: "-apple-system, Segoe UI, sans-serif",
    mainBkg: "#d3e0f2", nodeBorder: "#2c5282", border1: "#2c5282", border2: "#2c5282",
    attributeBackgroundColorOdd: "#f5f8fc", attributeBackgroundColorEven: "#e3ecf8",
    lineColor: "#2c5282", relationColor: "#2c5282", edgeLabelBackground: "#f5f8fc",
    primaryColor: "#d3e0f2", primaryBorderColor: "#2c5282", primaryTextColor: "#1a365d",
    textColor: "#1a365d", nodeTextColor: "#1a365d", tertiaryColor: "#f5f8fc",
  },
  accent: "#2c5282", ink: "#1a365d",
};

// "FnoDerivativeFacility" -> "FNO Derivative Facility" (label only) once "Fno" is listed in the config's acronyms
let ACRONYMS = new Set();
export const setAcronyms = list => { ACRONYMS = new Set(list); };
export const spaced = n => n.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ").split(" ")
  .map(w => (ACRONYMS.has(w) ? w.toUpperCase() : w)).join(" ");
// Mermaid attribute names cannot contain spaces or quotes, so the readable name is written with "_" between words and the
// page script turns them back into spaces after rendering. Characters Mermaid rejects in an attribute name become "-".
export const attrName = n => n.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_\-\[\]()]/g, "-");

// ---------- config ----------
// A config file (JSON) says what to show, so the tool itself knows nothing about any particular model. It is also read by
// `python -m mapping_markdown.export_json`, which parses the markdown into the JSON this tool draws from:
//   { "title": "...", "dir": "<folder holding the files, relative to the config file>", "out": "<output folder>",
//     "models": ["a_model.md", ...],                                    // the full model
//     "mappings": ["a_mapping.md", { "path": "b_mapping.md", "name": "b", "title": "B" }],   // each gets a mapped-model and a database diagram
//     "attrs": "all" | N, "acronyms": ["Otc", ...] }                    // acronyms are upper-cased in readable names
export function loadConfig(args) {
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const file = opt("config");
  if (!file) { console.error("usage: node generate.mjs --config <config.json> [--data data.json] [--out dir] [--attrs all|N] [--open]"); process.exit(1); }
  const path = resolve(file), base = dirname(path), raw = JSON.parse(readFileSync(path, "utf8"));
  const attrs = opt("attrs", String(raw.attrs ?? "all"));
  const out = resolve(opt("out") ? process.cwd() : base, opt("out", raw.out ?? "out"));
  return {
    title: raw.title ?? "Models", out,
    data: resolve(opt("data") ? process.cwd() : out, opt("data", "data.json")),
    models: raw.models ?? [],
    mappings: (raw.mappings ?? []).map(m => typeof m === "string" ? { path: m } : m),
    maxAttrs: attrs === "all" ? Infinity : Number(attrs),
    acronyms: raw.acronyms ?? [], open: args.includes("--open"),
  };
}

// Mermaid crow's-foot tokens for a multiplicity ("1", "0..1", "*", "1..*"): `left` is the end drawn before the line, `right` after it.
const MULT = { "1": ["||", "||"], "0..1": ["|o", "o|"], "*": ["}o", "o{"], "0..*": ["}o", "o{"], "1..*": ["}|", "|{"] };
export const multLeft = m => (MULT[m] ?? MULT["*"])[0];
export const multRight = m => (MULT[m] ?? MULT["*"])[1];
export const cells = line => line.split("|").slice(1, -1).map(s => s.trim());

// ---------- HTML ----------
const css = p => `body{font-family:-apple-system,Segoe UI,sans-serif;margin:24px;background:#fff;color:${p.ink}}h1{font-size:20px;margin:0 0 4px}p,li{color:#555;font-size:13px}p{margin:0 0 12px}
a{color:${p.accent}}.mermaid{overflow:auto}nav{margin-bottom:12px;font-size:13px}
#tip{position:fixed;display:none;max-width:440px;background:${p.ink};color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;line-height:1.4;pointer-events:none;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.3)}`;
// Mermaid sizes text by measuring it with the top-level fontFamily but draws it with themeVariables.fontFamily; if they differ, a wider
// drawing font makes every line wrap. So both are always set to the same font. `mono` draws the diagram in a monospace font, which
// lets padded text line up in columns (the class diagrams' attribute rows).
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export function page({ title, intro, mmd, mermaidJs, stubs = {}, descs = {}, nav = "", footer = "", palette = GREEN, fixUnderscores = true, mono = false, body }) {
  const vars = mono ? { ...palette.vars, fontFamily: MONO } : palette.vars;
  if (body !== undefined) return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>${css(palette)}</style></head>
<body>
${nav}<h1>${title}</h1>
<p>${intro}</p>
${body}
</body></html>
`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>${css(palette)}</style></head>
<body>
${nav}<h1>${title}</h1>
<p>${intro}</p>
<pre class="mermaid">
${mmd}</pre>
${footer}
<script src="${mermaidJs}"></script>
<script>
const STUBS = ${JSON.stringify(stubs)};
const FIX_UNDERSCORES = ${fixUnderscores};
const DESCS = ${JSON.stringify(descs).replace(/</g, '\\u003c')};
mermaid.initialize({ startOnLoad: false, maxTextSize: 5000000, maxEdges: 5000, theme: 'base', fontFamily: ${JSON.stringify(vars.fontFamily)}, themeVariables: ${JSON.stringify(vars)}, securityLevel: 'loose', er: ${JSON.stringify(ER_CONFIG)}, class: { useMaxWidth: false } });
mermaid.run({ querySelector: '.mermaid' }).then(() => {
  // attribute names were written with "_" between words (Mermaid disallows spaces): show them as spaces
  if (FIX_UNDERSCORES) {
    const w = document.createTreeWalker(document.querySelector('.mermaid'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes('_')) n.nodeValue = n.nodeValue.replace(/_/g, ' ');
  }
  // stub entities (classes of other domains) become links to the owning domain's page
  for (const [cls, href] of Object.entries(STUBS)) {
    document.querySelectorAll('[id*="-entity-' + cls + '-"], [id*="classId-' + cls + '-"]').forEach(g => {
      g.style.cursor = 'pointer';
      g.querySelectorAll('path').forEach(p => { p.style.strokeDasharray = '6 3'; });
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = 'Open ' + href; g.prepend(t);
      g.addEventListener('click', () => { window.location.href = href; });
    });
  }
  // hover: description of the attribute row (or the class, over its header) under the mouse
  const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
  const lookup = e => {
    const g = e.target.closest && e.target.closest('[id*="-entity-"], [id*="classId-"]');
    if (!g) return '';
    const d = DESCS[g.id.replace(/^.*-(?:entity|classId)-(.*)-\\d+$/, '$1')];
    if (!d) return '';
    for (const el of g.querySelectorAll('span, p, text, div')) {
      if (el.children.length || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top - 2 || e.clientY > r.bottom + 2) continue;           // same row as the mouse
      const label = el.textContent.trim();
      if (label === d._label) return d._;
      if (d[label]) return d[label];
    }
    return '';
  };
  document.addEventListener('mousemove', e => {
    const text = lookup(e);
    tip.style.display = text ? 'block' : 'none';
    if (text) { tip.textContent = text; tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 460) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  });
  window.__tipLookup = lookup;   // for tests
});
</script>
</body></html>
`;
}
