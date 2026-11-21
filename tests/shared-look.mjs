// Checks that session-hub's copy of the shared look (session-hub/hooks/mod/look.mjs) holds the same values as
// model-router's (model-router/lib/route-line.mjs): docs/design/shared-contract.md, "A shared look".
// Usage: node tests/shared-look.mjs [repo-root]   Exits 1 and names each value that differs.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const copy = await load('session-hub/hooks/mod/look.mjs');
const source = await load('model-router/lib/route-line.mjs');

const VALUES = ['MODEL_COLORS', 'EFFORT_COLORS', 'EMPTY_COLOR', 'CELL_FULL', 'CELL_EMPTY', 'ROUTE_ICON', 'ARROW'];
const differ = VALUES.filter((name) => JSON.stringify(copy[name]) !== JSON.stringify(source[name]));
if (differ.length > 0) {
  for (const name of differ) {
    console.error(`${name}: session-hub ${JSON.stringify(copy[name])}, model-router ${JSON.stringify(source[name])}`);
  }
  process.exit(1);
}
