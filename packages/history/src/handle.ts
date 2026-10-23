// The subpath components import: `@dojo-ng/history/handle`. It holds the types, the lookup of the
// installed instance, and the promise that resolves at install. It imports nothing (no pub/sub, no
// install code), so a component that only reads the location pulls in a few lines, not the package.
//
// The instance lives on `globalThis[Symbol.for("dojo-ng.history")]` (that is `window` in a
// browser), so two copies of the package in one bundle agree on one instance (decision D3). The
// callbacks waiting for an install live under a second well-known symbol for the same reason.

/** One step of the path from the root to a node, carried in navigation state. */
export interface TrailEntry {
	path: string;
	label: string;
}

/** Where a `NavLocation` came from: a `nav:go`, a Back/Forward (`pop`), or the install itself. */
export type NavSource = "go" | "pop" | "load";

/** The payload of every `nav:location` publish. `path` never includes the `base` option. */
export interface NavLocation {
	path: string;
	/** The state passed to `go`, or the result of `resolve`. `undefined` when there is none. */
	state: unknown;
	/** Position of this entry in the stack, 0 for the entry the app landed on. */
	index: number;
	/** False while the entry is provisional (see `dwellMs`). */
	committed: boolean;
	source: NavSource;
	/** Root-to-node trail, when whoever navigated supplied one. */
	trail?: TrailEntry[];
}

/** What `annotate` can change on the current entry. */
export interface NavAnnotation {
	state?: unknown;
	trail?: TrailEntry[];
}

/** The payload of `nav:go`, and of the `dj-navigate` event detail (which may carry extra keys). */
export interface NavGo {
	path: string;
	state?: unknown;
	trail?: TrailEntry[];
	replace?: boolean;
}

/** The `detail` of the `dj-navigate` event a component dispatches. `label` is for whoever listens; history ignores it. */
export interface NavigateDetail extends NavGo {
	label?: string;
}

export interface GoOptions {
	/** Replace the current entry instead of pushing a new one. */
	replace?: boolean;
	trail?: TrailEntry[];
}

/** What is passed to `onCommit` when an entry commits. */
export interface CommitEntry {
	path: string;
	state: unknown;
	trail?: TrailEntry[];
}

export interface HistoryInstance {
	/** Publish `nav:go`. The only way anything here writes to the browser's history. */
	go(path: string, state?: unknown, options?: GoOptions): void;
	back(): void;
	forward(): void;
	/** Commit the current entry now, without waiting out the dwell time. */
	commit(): void;
	/** Follow the location. The current one is delivered at once. Returns an unsubscribe function. */
	subscribe(fn: (location: NavLocation) => void): () => void;
	/** The current location, or `undefined` until the first one is published. */
	readonly current: NavLocation | undefined;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
	/** The URL for an app path: `base` plus `path`. */
	href(path: string): string;
	/** Merge `state` and/or `trail` into the current entry, then publish the location again. */
	annotate(partial: NavAnnotation): void;
	/** Remove listeners and unregister. For tests. */
	destroy(): void;
}

const INSTANCE_KEY = Symbol.for("dojo-ng.history");
const WAITERS_KEY = Symbol.for("dojo-ng.history.waiters");

type Slot = Record<symbol, unknown>;

function slot(): Slot {
	return globalThis as unknown as Slot;
}

/** The installed instance, or `undefined` when `installHistory` has not run. */
export function getHistory(): HistoryInstance | undefined {
	return slot()[INSTANCE_KEY] as HistoryInstance | undefined;
}

/** Resolves with the instance: at once if installed, otherwise when `installHistory` runs. */
export function whenHistory(): Promise<HistoryInstance> {
	const installed = getHistory();
	if (installed) return Promise.resolve(installed);
	return new Promise((resolve) => {
		const s = slot();
		const waiters = (s[WAITERS_KEY] as Array<(h: HistoryInstance) => void> | undefined) ?? [];
		waiters.push(resolve);
		s[WAITERS_KEY] = waiters;
	});
}

/** @internal Called by `installHistory`. Not part of the public API. */
export function registerHistory(instance: HistoryInstance): void {
	const s = slot();
	s[INSTANCE_KEY] = instance;
	const waiters = s[WAITERS_KEY] as Array<(h: HistoryInstance) => void> | undefined;
	s[WAITERS_KEY] = undefined;
	if (waiters) for (const resolve of waiters) resolve(instance);
}

/** @internal Called by `destroy()`. Only removes the registration if it is still `instance`. */
export function unregisterHistory(instance: HistoryInstance): void {
	const s = slot();
	if (s[INSTANCE_KEY] === instance) s[INSTANCE_KEY] = undefined;
}
