/**
 * Render benchmark for the renderer (core/vdom.js), over the O(1) mock DOM.
 * Measures the three hot paths at several sizes: mount, update-all (a changed
 * property on every row), and keyed-reverse (pure moves). The keyed diff is O(n)
 * — keyed-reverse runs 10k in tens of ms (the retired interim renderer was O(n^2)
 * there: ~1.3s at 5k).
 *
 * Run: node test/bench.mjs            (optionally: SIZES=1000,10000 ITERS=15)
 */
import { performance } from "node:perf_hooks";
import { mountApp, v } from "./harness.mjs";

const SIZES = (process.env.SIZES || "1000,2000,5000,10000").split(",").map(Number);
const ITERS = Number(process.env.ITERS || 7);
const WARMUP = 3;

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function timeIt(setup, fn) {
	const times = [];
	for (let i = 0; i < ITERS + WARMUP; i++) {
		const ctx = setup();
		const t0 = performance.now();
		fn(ctx);
		const t1 = performance.now();
		if (i >= WARMUP) times.push(t1 - t0);
	}
	return median(times);
}

function rows(items, flip) {
	return v(
		"ul",
		{},
		items.map((i) =>
			v("li", { key: i, class: flip ? "b" : "a", "data-i": String(i) }, [v("span", {}, ["Row " + i])])
		)
	);
}

console.log(`\nClean-room renderer benchmark (mock DOM) — median of ${ITERS} runs, Node ${process.version}\n`);
console.log("  rows     nodes     mount      update-all   keyed-reverse");
console.log("  " + "-".repeat(58));

const results = [];
for (const N of SIZES) {
	const base = Array.from({ length: N }, (_, i) => i);

	const mountMs = timeIt(
		() => ({ items: base }),
		(ctx) => { mountApp(() => rows(ctx.items, false)); }
	);

	const updateMs = timeIt(
		() => {
			let flip = false;
			const app = mountApp(() => rows(base, flip));
			return { app, toggle() { flip = !flip; } };
		},
		(ctx) => { ctx.toggle(); ctx.app.update(); }
	);

	const reverseMs = timeIt(
		() => {
			let items = base.slice();
			const app = mountApp(() => rows(items, false));
			return { app, rev() { items.reverse(); } };
		},
		(ctx) => { ctx.rev(); ctx.app.update(); }
	);

	const nodes = N * 3;
	results.push({ N, nodes, mountMs, updateMs, reverseMs });
	console.log(
		`  ${String(N).padEnd(8)} ${String(nodes).padEnd(9)} ${mountMs.toFixed(2).padStart(7)}ms  ` +
		`${updateMs.toFixed(2).padStart(8)}ms   ${reverseMs.toFixed(2).padStart(9)}ms`
	);
}
console.log("");
console.log("NEXT " + JSON.stringify(results));
