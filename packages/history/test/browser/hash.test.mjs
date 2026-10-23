// Hash mode against the real History API (H9): a real address-bar hash edit, which the fake can only
// imitate. Setting location.hash pushes a null-state entry and fires popstate, then hashchange.
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../../dist/index.js";
import { assert, assertEqual, nextLocation } from "./helpers.mjs";

describe("@dojo-ng/history hash mode in a real browser", () => {
	let h;
	let warnings;
	let realWarn;

	beforeEach(() => {
		warnings = [];
		realWarn = console.warn;
		console.warn = (...args) => warnings.push(args.join(" "));
	});

	afterEach(() => {
		console.warn = realWarn;
		h?.destroy();
		h = undefined;
	});

	it("go writes #/path, and an address-bar hash edit is stamped and published once with no warning", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0, mode: "hash" });
		const page = location.pathname;
		h.go("/hash-test/a");
		assertEqual(location.hash, "#/hash-test/a", "go writes the hash");
		assertEqual(location.pathname, page, "the page's own path is untouched");

		const start = history.length;
		const seen = [];
		const stop = h.subscribe((l) => seen.push(l));
		const arrived = nextLocation(h, (l) => l.path === "/hash-test/typed");
		location.hash = "#/hash-test/typed";
		const loc = await arrived;
		stop();

		assertEqual(loc.source, "go", "published as a go");
		assertEqual(seen.filter((l) => l.path === "/hash-test/typed").length, 1, "published exactly once");
		assert(history.state && history.state.__djnav, "the browser's entry was stamped");
		assertEqual(history.state.__djnav.index, loc.index, "stamp index matches the published index");
		assertEqual(history.length, start + 1, "one entry for the edit");
		assertEqual(warnings.length, 0, "no coexistence warning");
	});

	it("Back after a hash edit returns to the earlier entry as a pop", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0, mode: "hash" });
		h.go("/hash-test/b1");
		const edited = nextLocation(h, (l) => l.path === "/hash-test/b2");
		location.hash = "#/hash-test/b2";
		await edited;
		const popped = nextLocation(h);
		h.back();
		const loc = await popped;
		assertEqual(loc.path, "/hash-test/b1", "path");
		assertEqual(loc.source, "pop", "source");
		assertEqual(warnings.length, 0, "no warnings");
	});
});
