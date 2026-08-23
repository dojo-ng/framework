// Real-browser smoke: decisions 4-5 (framework-browser-smoke-spec.md) — the keyed
// reconciler's whole point is that a reorder REUSES DOM nodes rather than
// recreating them. A mock DOM can prove the op sequence is right; only a real
// document can prove the classic regression this buys: focus survives a reorder.
import { v } from "../../dist/core/vdom.js";
import { cleanup, mountApp, assert, assertEqual } from "./helpers.mjs";

describe("keyed reorder (decisions 4-5)", () => {
	afterEach(cleanup);

	it("preserves real element identity across a reverse", () => {
		let data = ["a", "b", "c"];
		const { container, update } = mountApp(() =>
			v(
				"ul",
				{},
				data.map((k) => v("li", { key: k }, [k]))
			)
		);

		const before = [...container.querySelectorAll("li")];
		assertEqual(before.map((li) => li.textContent).join(","), "a,b,c");

		data = [...data].reverse();
		update();

		const after = [...container.querySelectorAll("li")];
		assertEqual(after.map((li) => li.textContent).join(","), "c,b,a", "DOM order reflects the reversed data");
		// Same element OBJECTS, just moved — not new nodes carrying the same text.
		assert(after[0] === before[2], "'c' li is the SAME element that was previously last");
		assert(after[1] === before[1], "'b' li is the SAME element (middle stays middle)");
		assert(after[2] === before[0], "'a' li is the SAME element that was previously first");
	});

	// NOT tested here: focus survival across a FULL reversal. Traced and confirmed
	// 2026-07-19 (Bill's call, see framework-browser-smoke-spec.md F2) that a full
	// reversal is a genuine edge case for any LIS-based minimal-move keyed diff: no
	// two elements can preserve their relative order across a total reversal, so at
	// most ONE element avoids a physical DOM move — and the tie-break for WHICH one
	// stays doesn't (and, without adding focus-awareness to the DOM-agnostic
	// reconciler, can't cheaply) favor whichever happens to be focused. Moving an
	// element's ancestor via insertBefore blurs a focused descendant per the HTML
	// spec, even when the moved node is reused (not recreated) — confirmed
	// reproducing in all three engines. This is a known, accepted limitation, not a
	// guarantee this renderer makes. The realistic case below — moving ONE item,
	// the actual shape of a drag/keyboard reorder (dj-board/dj-list) — IS guaranteed
	// (every other element's relative order is untouched, so none of them move).
	it("focus survives a keyed reorder that moves a single item", () => {
		let data = ["a", "b", "c", "d"];
		const { container, update } = mountApp(() =>
			v(
				"ul",
				{},
				data.map((k) => v("li", { key: k }, [v("input", { value: k })]))
			)
		);

		const inputs = [...container.querySelectorAll("input")];
		const untouched = inputs[2]; // key "c" — keeps its relative order below, so it never moves
		untouched.focus();
		assert(document.activeElement === untouched, "sanity: 'c' is actually focused before the reorder");

		data = ["b", "c", "d", "a"]; // move "a" from the front to the end; b/c/d keep their relative order
		update();

		assert(
			document.activeElement === untouched,
			"moving one item must not disturb focus on the untouched ones — the realistic reorder case"
		);
		assertEqual(untouched.value, "c", "the untouched input still carries its own value");
	});
});
