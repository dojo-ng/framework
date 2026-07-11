/**
 * Smoke test for @dojo-ng/framework core/has.
 *
 * Verifies the faithful has runtime that app code (and the renderer) rely on:
 * the full API (has / add / exists), lazy single-evaluation + caching,
 * feature-name lowercasing, `undefined` for unregistered features, strict mode,
 * duplicate-add guard, and the features the renderer itself queries.
 *
 * Run: node smoke/has.mjs
 */

import has, { add, exists } from '../dist/core/has.js';

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { pass++; console.log('  ✓  ' + name); }
    else { fail++; console.log('  ✗  ' + name); }
}

console.log('\n@dojo-ng/framework — core/has smoke test\n');

// Features the renderer queries (vdom.js).
ok("has('dojo-debug') === false", has('dojo-debug') === false);
ok("has('dom-passive-event') runs without throwing (node → false)", has('dom-passive-event') === false);

// Baseline language features report true.
ok("has('es6-map') === true", has('es6-map') === true);
ok("has('es6-promise') === true", has('es6-promise') === true);

// Environment features compute live.
ok("has('host-node') is truthy under node", Boolean(has('host-node')));
ok("has('host-browser') === false under node", has('host-browser') === false);
ok("has('raf') === false under node (no requestAnimationFrame)", has('raf') === false);
ok("has('microtasks') === true (via es6-promise)", has('microtasks') === true);

// Unregistered → undefined (NOT false); strict throws.
ok("unregistered feature → undefined", has('totally-unknown') === undefined);
let strictThrew = false;
try { has('still-unknown', true); } catch { strictThrew = true; }
ok("strict mode throws on unregistered", strictThrew);

// Feature names are lowercased.
ok("feature name lowercased", has('Dojo-Debug') === false && has('ES6-Map') === true);

// Lazy registration: evaluated once, cached.
let calls = 0;
add('lazy-feature', () => { calls++; return 42; });
ok("exists() sees a registered feature", exists('lazy-feature') === true);
ok("lazy feature returns its value", has('lazy-feature') === 42);
has('lazy-feature');
ok("lazy test evaluated exactly once (cached)", calls === 1);
ok("exists() false for unknown", exists('no-such-feature') === false);

// add() guards duplicates unless overwrite.
let dupThrew = false;
try { add('dojo-debug', true); } catch { dupThrew = true; }
ok("add() throws on duplicate without overwrite", dupThrew);
add('dojo-debug', true, true);
ok("add() overwrite replaces the value", has('dojo-debug') === true);

// has.add convenience style also works.
has.add('convenience-feature', 'yes');
ok("has.add(...) convenience style works", has('convenience-feature') === 'yes');

console.log('\n' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
