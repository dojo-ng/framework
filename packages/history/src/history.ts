// The history layer. Navigation goes through a pub/sub bus: anything publishes `nav:go`, this
// module is the only writer to the browser's history, and every change comes out as `nav:location`.
//
// Invariant (the structural fix for app3's re-push bug): only a `nav:go` pushes or replaces an
// entry. A `popstate` publishes `nav:location` and writes nothing. Every write goes through
// `writeEntry` below, and no code path from `onPop` reaches it.
//
// This module must not import ./match.js: navigation never matches paths (decision D10).
import type { PubSub } from "@dojo-ng/pubsub";
import {
	getHistory,
	registerHistory,
	unregisterHistory,
	type CommitEntry,
	type HistoryInstance,
	type NavAnnotation,
	type NavGo,
	type NavLocation,
	type NavSource,
	type TrailEntry,
} from "./handle.js";

/** The parts of `window` that `installHistory` uses. Tests pass a fake with this shape. */
export interface HistoryWindow {
	history: {
		pushState(state: unknown, title: string, url?: string | null): void;
		replaceState(state: unknown, title: string, url?: string | null): void;
		back(): void;
		forward(): void;
		readonly state: unknown;
	};
	location: { readonly pathname: string; readonly search: string; readonly hash: string; readonly href: string };
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener(type: string, listener: (event: never) => void): void;
	document: {
		readonly visibilityState?: string;
		addEventListener(type: string, listener: (event: never) => void): void;
		removeEventListener(type: string, listener: (event: never) => void): void;
	};
	readonly sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

export interface InstallOptions {
	/** A path prefix such as `/acme`. Added to every URL written, stripped from every path read. */
	base?: string;
	/** Default `globalThis.window`. Exists so tests can inject a fake. */
	window?: HistoryWindow;
	/** How long (visible) milliseconds an entry must stay current before it is committed. Default 3000. 0 turns skimming off. */
	dwellMs?: number;
	/** Called once per entry when it commits. Never for a skimmed entry, never for the landing entry. */
	onCommit?: (entry: CommitEntry) => void;
	/**
	 * Called at install when the landing entry carries no state of ours (a new tab, a pasted link, a
	 * bookmark). Its result becomes the entry's state before `nav:location` is published as `load`.
	 */
	resolve?: (path: string) => Promise<unknown>;
}

interface Entry {
	id: string;
	index: number;
	path: string;
	state: unknown;
	trail?: TrailEntry[];
	committed: boolean;
	source: NavSource;
}

interface Stamp {
	id: string;
	index: number;
}

const DEFAULT_DWELL_MS = 3000;
const MAX_INDEX_KEY = "dojo-ng.history.max";
const DUPLICATE_INSTALL_WARNED = new WeakSet<HistoryInstance>();

let idCounter = 0;
function newId(): string {
	return `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readStamp(raw: unknown): Stamp | undefined {
	if (!isRecord(raw)) return undefined;
	const stamp = raw.__djnav;
	if (!isRecord(stamp) || typeof stamp.id !== "string" || typeof stamp.index !== "number") return undefined;
	return { id: stamp.id, index: stamp.index };
}

function isNative(fn: unknown): boolean {
	try {
		return Function.prototype.toString.call(fn).includes("[native code]");
	} catch {
		return false;
	}
}

function normalizeBase(base: string | undefined): string {
	if (!base) return "";
	const trimmed = base.replace(/\/+$/, "");
	return trimmed === "" || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function installHistory(bus: PubSub, options: InstallOptions = {}): HistoryInstance {
	const existing = getHistory();
	if (existing) {
		if (!DUPLICATE_INSTALL_WARNED.has(existing)) {
			DUPLICATE_INSTALL_WARNED.add(existing);
			console.warn("[@dojo-ng/history] installHistory was called more than once. There is one history stack; returning the first instance.");
		}
		return existing;
	}

	const win = options.window ?? (globalThis as unknown as { window?: HistoryWindow }).window;
	if (!win) throw new Error("[@dojo-ng/history] installHistory needs a window. Pass options.window outside a browser.");

	const base = normalizeBase(options.base);
	const dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
	const warned = new Set<string>();
	const provisionalIds = new Set<string>();
	let cur: Entry;
	let last: NavLocation | undefined;
	let expectedPlace = "";
	let destroyed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let remaining = dwellMs;
	let startedAt = 0;

	// --- helpers -------------------------------------------------------------------------------

	function warnOnce(signal: string, message: string): void {
		if (warned.has(signal)) return;
		warned.add(signal);
		console.warn(`[@dojo-ng/history] ${message} (${signal}). Dojo NG routing stays in charge; this is the only warning of this kind.`);
	}

	function currentPath(): string {
		const full = win!.location.pathname + win!.location.search + win!.location.hash;
		if (base && (full === base || full.startsWith(`${base}/`) || full.startsWith(`${base}?`) || full.startsWith(`${base}#`))) {
			const rest = full.slice(base.length);
			return rest.startsWith("/") ? rest : `/${rest}`;
		}
		return full;
	}

	function place(): string {
		return win!.location.pathname + win!.location.search;
	}

	function stateFor(entry: Entry): unknown {
		return { __djnav: { id: entry.id, index: entry.index }, state: entry.state, trail: entry.trail };
	}

	/** The one place that writes to the browser's history. Called from `onGo`, install, and annotate; never from `onPop`. */
	function writeEntry(mode: "push" | "replace", entry: Entry, url?: string): void {
		if (mode === "push") win!.history.pushState(stateFor(entry), "", url);
		else win!.history.replaceState(stateFor(entry), "", url);
	}

	function entryFromState(raw: unknown, stamp: Stamp): Entry {
		const record = raw as Record<string, unknown>;
		return {
			id: stamp.id,
			index: stamp.index,
			path: currentPath(),
			state: record.state,
			trail: Array.isArray(record.trail) ? (record.trail as TrailEntry[]) : undefined,
			committed: !provisionalIds.has(stamp.id),
			source: "pop",
		};
	}

	function readMax(): number | undefined {
		try {
			const value = win!.sessionStorage?.getItem(MAX_INDEX_KEY);
			if (value === null || value === undefined) return undefined;
			const n = Number(value);
			return Number.isFinite(n) ? n : undefined;
		} catch {
			return undefined;
		}
	}

	function writeMax(n: number): void {
		try {
			win!.sessionStorage?.setItem(MAX_INDEX_KEY, String(n));
		} catch {
			// Storage can be blocked. canGoForward is then false, which is harmless.
		}
	}

	function publish(): void {
		const location: NavLocation = {
			path: cur.path,
			state: cur.state,
			index: cur.index,
			committed: cur.committed,
			source: cur.source,
			...(cur.trail ? { trail: cur.trail } : {}),
		};
		last = location;
		bus.publish("nav:location", location);
	}

	function fireCommit(entry: Entry): void {
		if (!options.onCommit) return;
		try {
			options.onCommit({ path: entry.path, state: entry.state, ...(entry.trail ? { trail: entry.trail } : {}) });
		} catch (err) {
			console.error("[@dojo-ng/history] onCommit threw:", err);
		}
	}

	// --- dwell ---------------------------------------------------------------------------------

	function isVisible(): boolean {
		return win!.document.visibilityState !== "hidden";
	}

	function stopTimer(): void {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	function runTimer(): void {
		startedAt = Date.now();
		timer = setTimeout(() => {
			timer = undefined;
			commitCurrent();
		}, remaining);
	}

	/** Start counting dwell time for a provisional entry. Counts visible time only. */
	function startDwell(): void {
		stopTimer();
		remaining = dwellMs;
		if (isVisible()) runTimer();
	}

	function onVisibility(): void {
		if (destroyed) return;
		if (!isVisible()) {
			if (timer !== undefined) {
				stopTimer();
				remaining = Math.max(0, remaining - (Date.now() - startedAt));
			}
		} else if (!cur.committed && timer === undefined) {
			runTimer();
		}
	}

	function commitCurrent(): void {
		if (destroyed || cur.committed) return;
		stopTimer();
		cur.committed = true;
		provisionalIds.delete(cur.id);
		publish();
		fireCommit(cur);
	}

	// --- the coexistence checks (D6) -----------------------------------------------------------

	function checkForeignLocation(): void {
		if (place() !== expectedPlace) {
			warnOnce("foreign-location", "The location changed without a nav:go, so another router or script may be pushing history");
		}
	}

	// --- inputs --------------------------------------------------------------------------------

	function onGo(request: NavGo): void {
		if (destroyed || !request || typeof request.path !== "string") return;
		checkForeignLocation();
		const previous = cur;
		const replace = request.replace === true || !previous.committed;
		const entry: Entry = {
			id: newId(),
			index: replace ? previous.index : previous.index + 1,
			path: request.path,
			state: request.state,
			trail: request.trail,
			committed: false,
			source: "go",
		};
		provisionalIds.delete(previous.id);
		stopTimer();
		writeEntry(replace ? "replace" : "push", entry, base + request.path);
		if (!replace) writeMax(entry.index);
		expectedPlace = place();
		cur = entry;

		// A replace of an entry that had already committed keeps its place on the stack, so the
		// replacement commits too. Otherwise the entry is provisional until it has been read.
		const commitNow = dwellMs <= 0 || (replace && previous.committed);
		if (commitNow) {
			entry.committed = true;
			publish();
			fireCommit(entry);
		} else {
			provisionalIds.add(entry.id);
			publish();
			startDwell();
		}
	}

	function onPop(): void {
		if (destroyed) return;
		stopTimer();
		const raw = win!.history.state;
		const stamp = readStamp(raw);
		let entry: Entry;
		let newlyCommitted = false;
		if (!stamp) {
			warnOnce("foreign-entry", "Back or Forward landed on a history entry this layer did not create, so another router or script may be pushing history");
			// Keeps the id of the entry we were on, so a later Back onto a stamped entry that is
			// already "current" still reads as history changing without a nav:go.
			entry = {
				id: cur.id,
				index: cur.index,
				path: currentPath(),
				state: undefined,
				committed: true,
				source: "pop",
			};
		} else {
			if (stamp.id === cur.id) {
				warnOnce("foreign-location", "Back landed on the entry already current, so history changed without a nav:go");
			}
			entry = entryFromState(raw, stamp);
			if (!entry.committed) {
				entry.committed = true;
				provisionalIds.delete(entry.id);
				newlyCommitted = true;
			}
		}
		entry.source = "pop";
		cur = entry;
		expectedPlace = place();
		publish();
		if (newlyCommitted) fireCommit(entry);
	}

	function onNavigate(event: Event): void {
		const detail = (event as CustomEvent<Partial<NavGo> | undefined>).detail;
		if (!detail || typeof detail.path !== "string") return;
		bus.publish<NavGo>("nav:go", {
			path: detail.path,
			state: detail.state,
			trail: detail.trail,
			replace: detail.replace === true,
		});
	}

	// --- the instance --------------------------------------------------------------------------

	const instance: HistoryInstance = {
		go(path, state, goOptions) {
			bus.publish<NavGo>("nav:go", { path, state, trail: goOptions?.trail, replace: goOptions?.replace === true });
		},
		back() {
			win.history.back();
		},
		forward() {
			win.history.forward();
		},
		commit: commitCurrent,
		subscribe(fn) {
			return bus.subscribe<NavLocation>("nav:location", (location) => fn(location));
		},
		get current() {
			return last;
		},
		get canGoBack() {
			return cur.index > 0;
		},
		get canGoForward() {
			const max = readMax();
			return max !== undefined && cur.index < max;
		},
		href(path) {
			return base + path;
		},
		annotate(partial: NavAnnotation) {
			if (destroyed) return;
			if ("state" in partial) cur.state = partial.state;
			if ("trail" in partial) cur.trail = partial.trail;
			writeEntry("replace", cur);
			publish();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			stopTimer();
			unsubscribeGo();
			win.removeEventListener("popstate", onPop);
			win.document.removeEventListener("visibilitychange", onVisibility);
			win.document.removeEventListener("dj-navigate", onNavigate);
			unregisterHistory(instance);
		},
	};

	// --- install -------------------------------------------------------------------------------

	if (!isNative(win.history.pushState) || !isNative(win.history.replaceState)) {
		warnOnce("patched-pushstate", "history.pushState or replaceState is not the browser's own, so another router may be patching them");
	}

	const raw = win.history.state;
	const stamp = readStamp(raw);
	let fresh = false;
	if (stamp) {
		cur = { ...entryFromState(raw, stamp), committed: true, source: "load" };
	} else {
		// A fresh tab, pasted link, or bookmark. Stamp the entry so none ever has null state (app3 lesson 5).
		fresh = true;
		cur = { id: newId(), index: 0, path: currentPath(), state: undefined, committed: true, source: "load" };
		writeEntry("replace", cur);
		writeMax(0);
	}
	expectedPlace = place();

	const unsubscribeGo = bus.subscribe<NavGo>("nav:go", onGo, { replay: false });
	win.addEventListener("popstate", onPop);
	win.document.addEventListener("visibilitychange", onVisibility);
	win.document.addEventListener("dj-navigate", onNavigate);
	registerHistory(instance);

	if (fresh && options.resolve) {
		const landing = cur;
		new Promise<unknown>((resolve) => resolve(options.resolve!(landing.path))).then(
			(result) => {
				if (destroyed || cur !== landing) return;
				if (result !== undefined) {
					landing.state = result;
					writeEntry("replace", landing);
				}
				publish();
			},
			(err) => {
				console.error("[@dojo-ng/history] resolve rejected; publishing the bare path:", err);
				if (destroyed || cur !== landing) return;
				publish();
			},
		);
	} else {
		publish();
	}

	return instance;
}
