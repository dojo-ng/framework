// The real History API, not the fake. Push three entries, go back, and check history.length and
// location.pathname (H7). Mocha bdd under web-test-runner; throwing is all it needs, so there is no
// assertion library.
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../../dist/index.js";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
	if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Resolves with the next location (after the current replay) that satisfies `test`. */
function nextLocation(h, test = () => true) {
	return new Promise((resolve) => {
		let replayed = false;
		let stop;
		stop = h.subscribe((location) => {
			if (!replayed) return;
			if (test(location)) {
				stop?.();
				resolve(location);
			}
		});
		replayed = true;
	});
}

describe("@dojo-ng/history in a real browser", () => {
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

	it("push three entries, Back: history.length is unchanged and location.pathname is the middle entry", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0 });
		assertEqual(warnings.length, 0, "no coexistence warning in a clean page (history.pushState is native)");
		const start = history.length;
		h.go("/history-test/a");
		h.go("/history-test/b");
		h.go("/history-test/c");
		assertEqual(history.length, start + 3, "three pushes");
		assertEqual(location.pathname, "/history-test/c", "pathname after the pushes");

		const popped = nextLocation(h);
		h.back();
		const location1 = await popped;
		assertEqual(location1.path, "/history-test/b", "published path");
		assertEqual(location1.source, "pop", "source");
		assertEqual(location.pathname, "/history-test/b", "location.pathname after Back");
		assertEqual(history.length, start + 3, "Back must not change history.length (app3's re-push bug)");
		assert(h.canGoBack && h.canGoForward, "can go both ways from the middle");

		const forwarded = nextLocation(h);
		h.forward();
		const location2 = await forwarded;
		assertEqual(location2.path, "/history-test/c", "Forward still reaches the entry after Back");
		assertEqual(history.length, start + 3, "Forward must not change history.length");
		assertEqual(warnings.length, 0, "no warnings across the whole run");
	});

	it("the landing entry is stamped, so no entry has null state", () => {
		history.replaceState(null, ""); // as if this were a fresh tab, pasted link, or bookmark
		h = installHistory(createPubSub(), { dwellMs: 0 });
		assert(history.state && history.state.__djnav, "history.state carries __djnav");
	});

	it("skimmed pages share one entry with real timers", async () => {
		h = installHistory(createPubSub(), { dwellMs: 150 });
		const start = history.length;
		h.go("/history-test/s1");
		h.go("/history-test/s2");
		h.go("/history-test/s3");
		assertEqual(history.length, start + 1, "three quick gos made one entry");
		assertEqual(location.pathname, "/history-test/s3", "the last one wins");
		const committed = await nextLocation(h, (l) => l.committed);
		assertEqual(committed.path, "/history-test/s3", "the dwell commits the entry");
		h.go("/history-test/s4");
		assertEqual(history.length, start + 2, "after a commit the next go pushes");
	});

	it("a bubbling, composed dj-navigate from inside a real shadow root is picked up", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0 });
		const host = document.createElement("div");
		document.body.append(host);
		const inner = host.attachShadow({ mode: "open" }).appendChild(document.createElement("button"));
		const trail = [{ path: "/history-test", label: "Test" }, { path: "/history-test/n", label: "N" }];
		const start = history.length;
		const arrived = nextLocation(h);
		inner.dispatchEvent(new CustomEvent("dj-navigate", { detail: { path: "/history-test/n", trail }, bubbles: true, composed: true }));
		const location1 = await arrived;
		host.remove();
		assertEqual(location1.path, "/history-test/n", "path");
		assertEqual(JSON.stringify(location1.trail), JSON.stringify(trail), "trail");
		assertEqual(history.length, start + 1, "pushed");
		assertEqual(JSON.stringify(history.state.trail), JSON.stringify(trail), "trail is in history.state");
	});

	it("the trail comes back from history.state on Back", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0 });
		const trailA = [{ path: "/history-test/ta", label: "TA" }];
		h.go("/history-test/ta", undefined, { trail: trailA });
		h.go("/history-test/tb");
		const popped = nextLocation(h);
		h.back();
		const location1 = await popped;
		assertEqual(JSON.stringify(location1.trail), JSON.stringify(trailA), "trail after Back");
	});
});
