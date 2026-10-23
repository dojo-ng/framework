// Shared by the real-browser tests. Mocha bdd under web-test-runner; throwing is all a test needs.
export function assert(condition, message) {
	if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
	if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Resolves with the next location (after the current replay) that satisfies `test`. */
export function nextLocation(h, test = () => true) {
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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check()` is truthy, or fails with `message` after `ms`. */
export async function until(check, message, ms = 2000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return;
		await sleep(20);
	}
	throw new Error(`timed out: ${message}`);
}
