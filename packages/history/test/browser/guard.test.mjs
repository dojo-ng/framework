// Guards against the real Back button's timing (H12): the undo traversal is a real, asynchronous
// popstate here, which the fake does synchronously. Engines differ, so this is in the three-engine run.
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../../dist/index.js";
import { assert, assertEqual, nextLocation, sleep, until } from "./helpers.mjs";

describe("@dojo-ng/history guards in a real browser", () => {
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

	it("a blocker that refuses keeps the page; one that allows lets Back through, with no entry added", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0 });
		h.go("/guard-test/a");
		h.go("/guard-test/b");
		const length = history.length;
		const published = [];
		h.subscribe((l) => published.push(l.path));

		let asked = [];
		let allow = false;
		h.block((to) => (asked.push(to.path), allow));

		h.back();
		await until(() => asked.length === 1, "blocker asked about the Back");
		await sleep(150); // let the undo traversal land
		assertEqual(location.pathname, "/guard-test/b", "refused: still on b");
		assertEqual(h.current.path, "/guard-test/b", "refused: nothing published");
		assertEqual(history.length, length, "refused: no entry added");
		assertEqual(asked[0], "/guard-test/a", "the blocker was told the target");

		allow = true;
		const popped = nextLocation(h, (l) => l.source === "pop");
		h.back();
		const loc = await popped;
		assertEqual(loc.path, "/guard-test/a", "allowed: reached a");
		assertEqual(location.pathname, "/guard-test/a", "allowed: location");
		assertEqual(history.length, length, "allowed: no entry added");
		assertEqual(published.filter((p) => p === "/guard-test/a").length >= 1, true, "published");
		assertEqual(warnings.length, 0, "no coexistence warnings");
	});

	it("a refused go changes nothing; unblock restores plain behaviour", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0 });
		const unblock = h.block(() => false);
		const before = location.pathname;
		h.go("/guard-test/refused");
		await sleep(100);
		assertEqual(location.pathname, before, "refused go");
		unblock();
		h.go("/guard-test/ok");
		assertEqual(location.pathname, "/guard-test/ok", "after unblock");
		assert(true);
	});
});
