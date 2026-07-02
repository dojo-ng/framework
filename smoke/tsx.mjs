/**
 * Smoke test for the v()-only `tsx` JSX factory prototype.
 *
 * Verifies that with the w()/widget dispatch removed, tsx still:
 *   - routes string tags (intrinsic + custom elements) to v() correctly,
 *   - flattens nested children and coerces null properties,
 * and that a non-string (widget) tag is rejected with a clear error ONLY under
 * dojo-debug (the production path has no per-element type check).
 *
 * Run: node smoke/tsx.mjs
 */

import * as vdom from '../dist/core/vdom.js';
import has from '../dist/core/has.js';

const { tsx, isVNode } = vdom;

let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) { pass++; console.log('  ✓  ' + name); }
    else { fail++; console.log('  ✗  ' + name); }
}

console.log('\n@dojo-ng/framework — v()-only tsx smoke test\n');

// Intrinsic element → VNode via v().
const div = tsx('div', { classes: ['box'] }, 'hello');
ok("intrinsic 'div' → VNode with tag 'div'", isVNode(div) && div.tag === 'div');
ok("properties passed through", Array.isArray(div.properties.classes) && div.properties.classes[0] === 'box');

// Custom element (hyphenated string tag) → VNode via v().
const btn = tsx('dj-button', { kind: 'outlined' }, 'Save');
ok("custom element 'dj-button' → VNode", isVNode(btn) && btn.tag === 'dj-button');
ok("custom element keeps its props", btn.properties.kind === 'outlined');

// Null properties coerced to {}.
const bare = tsx('span', null, 'x');
ok("null properties coerced to {}", bare.properties && typeof bare.properties === 'object');

// Nested children flattened (JSX passes arrays of arrays).
const list = tsx('ul', null, [tsx('li', null, 'a'), [tsx('li', null, 'b'), tsx('li', null, 'c')]]);
ok("nested children flattened (3 <li>)", list.children.length === 3 && list.children.every((c) => c.tag === 'li'));

// Dev guard: a non-string (widget) tag throws under dojo-debug.
has.add('dojo-debug', true, true);
let threw = false, msgOk = false;
try { tsx(function FakeWidget() {}, {}); }
catch (e) { threw = true; msgOk = /string tag/.test(e.message); }
ok("non-string tag throws under dojo-debug", threw);
ok("error message is clear about string tags", msgOk);

// Dev guard still lets valid string tags through.
has.add('dojo-debug', true, true);
const stillWorks = tsx('dj-list', { options: [] });
ok("string tag still works with dojo-debug on", isVNode(stillWorks) && stillWorks.tag === 'dj-list');

// Production path (dojo-debug off): no per-element type check (no throw on string).
has.add('dojo-debug', false, true);
const prod = tsx('section', null);
ok("production path renders string tags without the guard", isVNode(prod) && prod.tag === 'section');

// The v()-only public API drops the widget/registry constructs (w/isWNode/registry
// items AND the widget `create` factory); it keeps the hyperscript + renderer surface.
ok("w / isWNode / FromRegistry / fromRegistry / REGISTRY_ITEM / create are NOT exported",
   ["w", "isWNode", "FromRegistry", "fromRegistry", "REGISTRY_ITEM", "create"].every((k) => !(k in vdom)));
ok("renderer / default / v / tsx / dom / isVNode / isDomVNode ARE exported",
   ["renderer", "default", "v", "tsx", "dom", "isVNode", "isDomVNode"].every((k) => k in vdom));

console.log('\n' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
