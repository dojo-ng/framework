/**
 * match(pattern, path): static segments, :name params, a trailing * for the rest. Table-driven.
 *
 * Run: node --test test/match.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { match } from "../dist/index.js";

const cases = [
	// exact match
	["/orders", "/orders", {}],
	["/orders/new", "/orders/new", {}],
	["/", "/", {}],
	["", "/", {}],
	// params
	["/orders/:id", "/orders/42", { id: "42" }],
	["/u/:user/posts/:post", "/u/ann/posts/7", { user: "ann", post: "7" }],
	// rest
	["/files/*", "/files/a/b/c", { "*": "a/b/c" }],
	["/files/*", "/files/a", { "*": "a" }],
	["/files/*", "/files", { "*": "" }],
	["/files/:kind/*", "/files/img/2026/a.png", { kind: "img", "*": "2026/a.png" }],
	["/*", "/anything/at/all", { "*": "anything/at/all" }],
	// mismatched segment count and segment text
	["/orders/:id", "/orders", null],
	["/orders/:id", "/orders/42/lines", null],
	["/orders", "/orders/42", null],
	["/orders/:id", "/invoices/42", null],
	["/files/:kind/*", "/files", null],
	// encoded params, decoded
	["/search/:q", "/search/a%20b%2Fc", { q: "a b/c" }],
	["/files/*", "/files/a%20b/c%C3%A9", { "*": "a b/cé" }],
	["/orders/:id", "/orders/%E0%A4%A", null], // malformed escape is a non-match, not a throw
	// trailing slashes are ignored on both sides
	["/orders/", "/orders", {}],
	["/orders", "/orders/", {}],
	["/orders/:id/", "/orders/42/", { id: "42" }],
];

for (const [pattern, path, expected] of cases) {
	test(`match(${JSON.stringify(pattern)}, ${JSON.stringify(path)})`, () => {
		assert.deepEqual(match(pattern, path), expected);
	});
}

test("a lone colon is a static segment, not a param", () => {
	assert.deepEqual(match("/a/:", "/a/:"), {});
	assert.equal(match("/a/:", "/a/x"), null);
});

test("src/history.ts does not import the match module (decision D10)", () => {
	const source = readFileSync(fileURLToPath(new URL("../src/history.ts", import.meta.url)), "utf8");
	assert.doesNotMatch(source, /^\s*(import|export)[^;]*from\s+["'][^"']*match/m);
});
