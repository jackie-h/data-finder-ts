#!/usr/bin/env bash
# What a user of the published packages does: install data-finder-ts and data-finder-query-ui from their tarballs into an empty
# project, build the page for generated mappings with the CLI, serve it, and check that it answers. Run from the repository root
# after `npm run build:lib` and `npm run build:lib --prefix query-ui`, and `npm run generate --prefix query-ui`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap '{ kill "${server:-}" && wait "${server:-}"; } 2>/dev/null || true; rm -rf "$work"' EXIT

mkdir "$work/tgz" "$work/project"
(cd "$root" && npm pack --silent --pack-destination "$work/tgz" >/dev/null)
(cd "$root/query-ui" && npm pack --silent --pack-destination "$work/tgz" >/dev/null)
cp -R "$root/query-ui/src/mappings" "$work/project/mappings"

cd "$work/project"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "$work"/tgz/data-finder-ts-*.tgz "$work"/tgz/data-finder-query-ui-*.tgz

npx data-finder-query-ui build --mappings mappings --out page
test -f page/index.html
test -f page/query-ui.config.json
test ! -e .data-finder-query-ui   # the build's working folder is removed

port=$((20000 + RANDOM % 10000))
DATABRICKS_HOST=http://127.0.0.1:9 DATABRICKS_TOKEN=unused node node_modules/data-finder-query-ui/bin/cli.mjs serve --dir page --port "$port" >"$work/serve.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$port/" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fs "http://127.0.0.1:$port/" | grep -q '<div id="root">'
curl -fs "http://127.0.0.1:$port/query-ui.config.json" | grep -q targets
refusal="$(curl -s -X POST "http://127.0.0.1:$port/api/2.0/sql/statements" -H 'Content-Type: application/json' -d '{"statement":"DROP TABLE x"}')"
echo "$refusal" | grep -q "Only SELECT"
echo "query-ui package smoke test passed"
