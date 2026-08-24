/**
 * The envelope schema (websocket-spec.md T5) against frames actually produced by T4's own tests
 * — a captured frame of each action type, validated with ajv (a real JSON Schema validator, not a
 * hand-rolled check, since the whole point of the schema is that any language's real validator can
 * point at it). Also checks the JSON.stringify round-trip is lossless, per the "no
 * undefined-vs-missing distinctions" design constraint. Pure — no DOM, no network.
 *
 * Run: node --test test/envelope.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const schema = JSON.parse(
	readFileSync(fileURLToPath(new URL("../schema/envelope.schema.json", import.meta.url)), "utf8"),
);
const ajv = new Ajv();
const validate = ajv.compile(schema);

// One captured frame per action type, taken from what wsdispatcher.test.mjs actually sends and
// receives — not invented shapes.
const capturedFrames = {
	ping: { action: "ping", id: 0, data: null },
	callRequest: { action: "call", id: 1, data: { hello: "world" } },
	callResponse: { action: "call", id: 1, data: "reply" },
	eventInbound: { action: "event", id: 0, data: { event: "some:topic", params: { x: 1 } } },
	eventOutbound: { action: "event", id: 0, data: { event: "identify", params: { who: "me" } } },
};

for (const [name, frame] of Object.entries(capturedFrames)) {
	test(`schema validates the captured ${name} frame`, () => {
		const ok = validate(frame);
		assert.equal(ok, true, JSON.stringify(validate.errors));
	});

	test(`the captured ${name} frame round-trips through JSON.stringify losslessly`, () => {
		const roundTripped = JSON.parse(JSON.stringify(frame));
		assert.deepEqual(roundTripped, frame);
	});
}

test("schema rejects a frame with an unknown action", () => {
	const ok = validate({ action: "manhole", id: 0, data: null });
	assert.equal(ok, false);
});

test("schema rejects an event frame missing params", () => {
	const ok = validate({ action: "event", id: 0, data: { event: "x" } });
	assert.equal(ok, false);
});

test("schema rejects a frame missing a required field", () => {
	const ok = validate({ action: "ping", data: null });
	assert.equal(ok, false);
});

test("schema rejects unknown top-level properties", () => {
	const ok = validate({ action: "ping", id: 0, data: null, target: "extra" });
	assert.equal(ok, false);
});
