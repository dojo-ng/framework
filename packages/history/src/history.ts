// The history layer. Navigation goes through a pub/sub bus: anything publishes `nav:go`, this
// module is the only writer to the browser's history, and every change comes out as `nav:location`.
//
// Invariant (the structural fix for app3's re-push bug): only a `nav:go` pushes or replaces an
// entry. A `popstate` publishes `nav:location` and writes nothing. Every write goes through
// `writeEntry` below, and no code path from `onPop` reaches it.
//
// Guards (`block`) keep the invariant: a refused Back is undone with `history.go`, a traversal, never
// a write. Hash mode stamps an address-bar edit by publishing `nav:go`, so it goes through the writer too.
//
// This module must not import ./match.js: navigation never matches paths (decision D10).
import type { PubSub } from "@dojo-ng/pubsub";
import {
	getHistory,
	registerHistory,
	unregisterHistory,
	type Blocker,
	type BlockTarget,
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
		go(delta: number): void;
		scrollRestoration?: "auto" | "manual";
		readonly state: unknown;
	};
	location: { readonly pathname: string; readonly search: string; readonly hash: string; readonly href: string };
	readonly scrollX?: number;
	readonly scrollY?: number;
	scrollTo?(x: number, y: number): void;
	requestAnimationFrame?(callback: () => void): unknown;
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener(type: string, listener: (event: never) => void): void;
	document: {
		readonly visibilityState?: string;
		readonly activeElement?: Element | null;
		getElementById?(id: string): Element | null;
		querySelector?(selector: string): Element | null;
		addEventListener(type: string, listener: (event: never) => void): void;
		removeEventListener(type: string, listener: (event: never) => void): void;
	};
	readonly sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/** What `scroll` takes beyond `true`. */
export interface ScrollOptions {
	/** Scrollable elements besides the window. Each needs an `id`; one without is skipped, with a warning. */
	targets?: () => Iterable<Element>;
	/**
	 * Resolve when the view for `location` has rendered. Without it, restoring waits two animation
	 * frames, which is right for a synchronous render and not enough for data that loads later.
	 */
	ready?: (location: NavLocation) => Promise<void> | void;
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
	/**
	 * `"hash"` keeps the route after `#` (`#/orders/7`), so a server with no SPA fallback can serve any
	 * deep link. Default `"path"`. Hash mode owns the whole hash, so in-page `#anchor` links don't work
	 * there, and `base` is ignored.
	 */
	mode?: "path" | "hash";
	/**
	 * Restore the scroll position on Back, Forward and reload, and scroll to the top (or to a
	 * `#fragment`) after a `go`. Off by default. Turning it on sets `history.scrollRestoration` to
	 * `"manual"` until `destroy()`.
	 */
	scroll?: boolean | ScrollOptions;
	/**
	 * A selector. After a `go` (not a Back or a reload), focus the first match so keyboard and screen
	 * reader users learn the view changed. An element that can't take focus gets `tabindex="-1"` until
	 * it blurs. Focus already inside the match is left alone. Default off.
	 */
	focus?: string | false;
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

/** Saved positions: the window, plus each target by element id or registered key. */
interface ScrollRecord {
	x: number;
	y: number;
	t?: Record<string, [number, number]>;
}

interface ScrollStore {
	order: string[];
	pos: Record<string, ScrollRecord>;
}

interface PendingUndo {
	delta: number;
	token: number;
	to: BlockTarget;
}

const DEFAULT_DWELL_MS = 3000;
const MAX_INDEX_KEY = "dojo-ng.history.max";
const SCROLL_KEY = "dojo-ng.history.scroll";
const SCROLL_CAP = 50;
const FOCUSABLE = "a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]";
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

	const hashMode = options.mode === "hash";
	const base = hashMode ? "" : normalizeBase(options.base);
	const dwellMs = options.dwellMs ?? DEFAULT_DWELL_MS;
	const scrollOn = Boolean(options.scroll);
	const scrollOpts: ScrollOptions = typeof options.scroll === "object" ? options.scroll : {};
	const focusSelector = options.focus || undefined;
	const blockers = new Set<{ fn: Blocker }>();
	// Scroll targets components registered with scrollTarget(), by key.
	const registered = new Map<string, Element>();
	const warned = new Set<string>();
	let guardToken = 0;
	let undoing: PendingUndo | undefined;
	let redoing = false;
	let pendingAdopt = false;
	let settleToken = 0;
	let savedRestoration: "auto" | "manual" | undefined;
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
		if (hashMode) {
			const route = win!.location.hash.replace(/^#/, "");
			return route === "" ? "/" : route.startsWith("/") ? route : `/${route}`;
		}
		const full = win!.location.pathname + win!.location.search + win!.location.hash;
		if (base && (full === base || full.startsWith(`${base}/`) || full.startsWith(`${base}?`) || full.startsWith(`${base}#`))) {
			const rest = full.slice(base.length);
			return rest.startsWith("/") ? rest : `/${rest}`;
		}
		return full;
	}

	function place(): string {
		return win!.location.pathname + win!.location.search + (hashMode ? win!.location.hash : "");
	}

	function hrefOf(path: string): string {
		return hashMode ? `#${path}` : base + path;
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

	function toLocation(entry: Entry): NavLocation {
		return {
			path: entry.path,
			state: entry.state,
			index: entry.index,
			committed: entry.committed,
			source: entry.source,
			...(entry.trail ? { trail: entry.trail } : {}),
		};
	}

	function publish(): void {
		const location = toLocation(cur);
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

	// --- scroll and focus ----------------------------------------------------------------------
	// Positions live in sessionStorage by entry id, never in history state: writing them into state
	// would need a replaceState from a scroll or pop handler, and only nav:go may write.

	function readScrollStore(): ScrollStore {
		try {
			const raw = win!.sessionStorage?.getItem(SCROLL_KEY);
			const parsed = raw ? (JSON.parse(raw) as ScrollStore) : undefined;
			if (parsed && Array.isArray(parsed.order) && isRecord(parsed.pos)) return parsed;
		} catch {
			// Blocked storage or a damaged value: start empty.
		}
		return { order: [], pos: {} };
	}

	function writeScrollStore(store: ScrollStore): void {
		try {
			win!.sessionStorage?.setItem(SCROLL_KEY, JSON.stringify(store));
		} catch {
			// Storage can be blocked. Restoring is then a no-op.
		}
	}

	function saveScroll(id: string): void {
		if (!scrollOn) return;
		const record: ScrollRecord = { x: win!.scrollX ?? 0, y: win!.scrollY ?? 0 };
		if (scrollOpts.targets) {
			for (const el of scrollOpts.targets()) {
				if (!el.id) {
					warnOnce("scroll-target-id", "A scroll target has no id, so its position can't be saved");
					continue;
				}
				(record.t ??= {})[el.id] = [el.scrollLeft, el.scrollTop];
			}
		}
		// Registered targets go after targets(), keyed as given. A disconnected one is skipped: its
		// component has gone, and its last position would overwrite nothing useful.
		for (const [key, el] of registered) {
			if (!el.isConnected) continue;
			(record.t ??= {})[key] = [el.scrollLeft, el.scrollTop];
		}
		const store = readScrollStore();
		if (!(id in store.pos)) store.order.push(id);
		store.pos[id] = record;
		while (store.order.length > SCROLL_CAP) delete store.pos[store.order.shift()!];
		writeScrollStore(store);
	}

	function dropScroll(id: string): void {
		if (!scrollOn) return;
		const store = readScrollStore();
		if (!(id in store.pos)) return;
		delete store.pos[id];
		store.order = store.order.filter((other) => other !== id);
		writeScrollStore(store);
	}

	function restoreScroll(id: string): void {
		const record = readScrollStore().pos[id];
		if (!record) return;
		win!.scrollTo?.(record.x, record.y);
		if (!record.t) return;
		const apply = (el: Element, at: [number, number] | undefined) => {
			if (!at) return;
			el.scrollLeft = at[0];
			el.scrollTop = at[1];
		};
		if (scrollOpts.targets) {
			for (const el of scrollOpts.targets()) apply(el, el.id ? record.t[el.id] : undefined);
		}
		// Looked up by key now, after the wait, so an element re-created by the re-render is the one restored.
		for (const [key, el] of registered) if (el.isConnected) apply(el, record.t[key]);
	}

	function scrollForGo(path: string): void {
		const hash = path.indexOf("#");
		let target: Element | null | undefined;
		if (!hashMode && hash >= 0) {
			try {
				target = win!.document.getElementById?.(decodeURIComponent(path.slice(hash + 1)));
			} catch {
				target = undefined;
			}
		}
		if (target) target.scrollIntoView();
		else win!.scrollTo?.(0, 0);
	}

	function moveFocus(): void {
		const target = win!.document.querySelector?.(focusSelector!) as HTMLElement | null | undefined;
		if (!target) return;
		const active = win!.document.activeElement;
		if (active && target.contains(active)) return;
		if (!target.matches(FOCUSABLE)) {
			target.setAttribute("tabindex", "-1");
			target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
		}
		target.focus({ preventScroll: scrollOn });
	}

	/** The view renders after the publish, and history can't see it (D4), so wait for the app's word or two frames. */
	function whenRendered(location: NavLocation): Promise<void> {
		if (scrollOpts.ready) {
			return new Promise<void>((resolve) => resolve(scrollOpts.ready!(location))).catch((err) => {
				console.error("[@dojo-ng/history] scroll.ready rejected; restoring anyway:", err);
			});
		}
		const frame = win!.requestAnimationFrame?.bind(win);
		if (!frame) return Promise.resolve();
		return new Promise((resolve) => frame(() => frame(() => resolve())));
	}

	/** Called after a published location. A newer navigation cancels the wait of an older one. */
	function afterNavigation(entry: Entry): void {
		if (!scrollOn && !focusSelector) return;
		const token = ++settleToken;
		const isGo = entry.source === "go";
		const path = entry.path;
		void whenRendered(toLocation(entry)).then(() => {
			if (destroyed || token !== settleToken) return;
			if (scrollOn) {
				if (isGo) scrollForGo(path);
				else restoreScroll(entry.id);
			}
			if (focusSelector && isGo) moveFocus();
		});
	}

	function onPageHide(): void {
		if (!destroyed) saveScroll(cur.id);
	}

	// --- guards --------------------------------------------------------------------------------

	async function allows(to: BlockTarget): Promise<boolean> {
		const from = last ?? toLocation(cur);
		try {
			const answers = await Promise.all([...blockers].map(({ fn }) => fn(to, from)));
			return answers.every((answer) => answer === true);
		} catch (err) {
			console.error("[@dojo-ng/history] a blocker threw; the move is refused:", err);
			return false;
		}
	}

	function onBeforeUnload(event: Event): void {
		event.preventDefault();
	}

	async function runUndone(pending: PendingUndo): Promise<void> {
		const ok = await allows(pending.to);
		if (!ok || destroyed || pending.token !== guardToken) return;
		redoing = true;
		win!.history.go(pending.delta);
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
		if (pendingAdopt) {
			// An address-bar hash edit the browser already made. A blocker can't undo it safely, so it isn't asked.
			pendingAdopt = false;
			performGo(request, true);
		} else if (blockers.size === 0) {
			performGo(request, false);
		} else {
			// Last one wins: a newer request, or any pop, makes this answer stale.
			const token = ++guardToken;
			void allows(request).then((ok) => {
				if (ok && !destroyed && token === guardToken) performGo(request, false);
			});
		}
	}

	/** `adopt`: the browser has already pushed this entry (unstamped), so stamp it in place as the next index. */
	function performGo(request: NavGo, adopt: boolean): void {
		guardToken++;
		if (!adopt) checkForeignLocation();
		const previous = cur;
		const replace = !adopt && (request.replace === true || !previous.committed);
		if (replace) dropScroll(previous.id);
		else saveScroll(previous.id);
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
		writeEntry(replace || adopt ? "replace" : "push", entry, hrefOf(request.path));
		if (!replace) writeMax(entry.index);
		expectedPlace = place();
		cur = entry;

		// A replace of an entry that had already committed keeps its place on the stack, so the
		// replacement commits too. Otherwise the entry is provisional until it has been read.
		const commitNow = dwellMs <= 0 || adopt || (replace && previous.committed);
		if (commitNow) {
			entry.committed = true;
			publish();
			fireCommit(entry);
		} else {
			provisionalIds.add(entry.id);
			publish();
			startDwell();
		}
		afterNavigation(entry);
	}

	function onPop(): void {
		if (destroyed) return;
		if (undoing) {
			// The traversal we made to put a guarded Back back. Nothing changed; ask the blockers.
			const pending = undoing;
			undoing = undefined;
			void runUndone(pending);
			return;
		}
		if (redoing) {
			redoing = false;
			settlePop();
			return;
		}
		if (blockers.size > 0) {
			const target = readStamp(win!.history.state);
			if (target && target.id !== cur.id && target.index !== cur.index) {
				const delta = target.index - cur.index;
				undoing = { delta, token: ++guardToken, to: { path: currentPath(), source: "pop" } };
				win!.history.go(-delta);
				return;
			}
		}
		settlePop();
	}

	function settlePop(): void {
		guardToken++;
		const raw = win!.history.state;
		const stamp = readStamp(raw);
		// Hash mode: an unstamped entry here is an address-bar edit. The hashchange that follows adopts it.
		if (hashMode && !stamp && place() !== expectedPlace) return;
		stopTimer();
		saveScroll(cur.id);
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
		afterNavigation(entry);
	}

	function onHashChange(): void {
		if (destroyed || readStamp(win!.history.state)) return;
		pendingAdopt = true;
		bus.publish<NavGo>("nav:go", { path: currentPath(), replace: true });
		pendingAdopt = false;
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
		block(blocker) {
			const entry = { fn: blocker };
			blockers.add(entry);
			if (blockers.size === 1) win.addEventListener("beforeunload", onBeforeUnload);
			return () => {
				if (!blockers.delete(entry) || blockers.size > 0) return;
				win.removeEventListener("beforeunload", onBeforeUnload);
			};
		},
		scrollTarget(key, el) {
			registered.set(key, el);
			return () => {
				if (registered.get(key) === el) registered.delete(key);
			};
		},
		href: hrefOf,
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
			win.removeEventListener("hashchange", onHashChange);
			win.removeEventListener("pagehide", onPageHide);
			if (blockers.size > 0) win.removeEventListener("beforeunload", onBeforeUnload);
			blockers.clear();
			registered.clear();
			if (savedRestoration !== undefined) win.history.scrollRestoration = savedRestoration;
			win.document.removeEventListener("visibilitychange", onVisibility);
			win.document.removeEventListener("dj-navigate", onNavigate);
			unregisterHistory(instance);
		},
	};

	// --- install -------------------------------------------------------------------------------

	if (!isNative(win.history.pushState) || !isNative(win.history.replaceState)) {
		warnOnce("patched-pushstate", "history.pushState or replaceState is not the browser's own, so another router may be patching them");
	}

	if (hashMode && options.base) warnOnce("hash-base", "`base` is ignored in hash mode, because the route lives after the #");
	if (scrollOn && win.history.scrollRestoration !== undefined) {
		savedRestoration = win.history.scrollRestoration;
		win.history.scrollRestoration = "manual";
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
	if (hashMode) win.addEventListener("hashchange", onHashChange);
	if (scrollOn) win.addEventListener("pagehide", onPageHide);
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
		if (!fresh) afterNavigation(cur);
	}

	return instance;
}
