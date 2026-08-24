// Duplicated from components/packages/store/src/types.ts, deliberately, not a shortcut. framework
// must not depend on components (that would point the lower layer at the higher one, and it
// wouldn't resolve at all until components publishes to npm). Because TypeScript structural typing
// doesn't care which declaration a shape came from, a PubSub built here still satisfies
// StoreController's parameter in components with no adapter and no cast — see
// framework-monorepo-spec.md C2 for the verification that proves that claim.
export interface ReadableStore<T> {
	getState(): T;
	subscribe(listener: (state: T, previous: T) => void): () => void;
}

interface Entry { value: unknown; seq: number; }
type Topics = Record<string, Entry>;

export interface SubscribeOptions {
	/** Deliver the topic's current (last published) value immediately on subscribe. Default true. */
	replay?: boolean;
}

export interface PubSubOptions {
	/**
	 * The namespace separator. Publishing `a<sep>b<sep>c` notifies subscribers of `a<sep>b<sep>c`,
	 * then `a<sep>b`, then `a`, most-specific first — one fixed separator per instance, rather than
	 * app3's per-topic `:`-or-`/` guess, which behaves surprisingly on a topic containing both.
	 * Default `":"`.
	 */
	separator?: string;
}

/**
 * A familiar publish/subscribe facade backed by an external store. Most pub/sub usage is
 * really "last value wins" shared state, so this retains the last payload per topic and
 * replays it to late subscribers by default — which is what callers usually expect. Every
 * `publish` notifies current subscribers, even if the payload is unchanged.
 *
 * Topics nest on the configured separator: publishing `a:b:c` also notifies subscribers of
 * `a:b` and `a`, most-specific first. A handler receives `(payload, topic)`, where `topic` is
 * the topic actually published — the one a namespace subscriber needs to tell descendants
 * apart. `seq` is a single counter shared across all topics, so it orders events across
 * topics as well as within one; replay and `getLast` for a namespace both resolve to the
 * single most recent entry at or under the subscribed topic, chosen by that `seq`.
 *
 * The underlying state lives in `store`, so the same data can also be read through the
 * store/context machinery (StoreController, the context registry) when wanted.
 */
export interface PubSub {
	publish<T = unknown>(topic: string, payload: T): void;
	subscribe<T = unknown>(
		topic: string,
		handler: (payload: T, topic: string) => void,
		options?: SubscribeOptions,
	): () => void;
	/** The most recent payload published at or under a topic, or undefined. */
	getLast<T = unknown>(topic: string): T | undefined;
	/** The backing store, for integration with StoreController/context. */
	readonly store: ReadableStore<Topics>;
}

// Hand-rolled in place of zustand/vanilla's createStore (framework-monorepo-spec.md C4) — the
// framework repo has zero runtime deps by design, and none of zustand's actual semantics (the
// set/get/api passed to the initializer, shallow-merge setState, the Object.is change guard) were
// ever relied on here; see the spec's C4 note for the case-by-case audit. `subscribe` still calls
// listeners with `(state, previous)`: nothing INTERNAL below reads the second argument (the notify
// loop tracks its own `previous` in a closure, unchanged from before this rewrite), but
// `ReadableStore` declares that signature and `StoreController` in components is an external
// consumer of the exposed `.store` — do not simplify this signature away.
function createInternalStore<T>(initial: T): ReadableStore<T> & { setState(updater: (state: T) => T): void } {
	let state = initial;
	const subscribers = new Set<(state: T, previous: T) => void>();
	return {
		getState() {
			return state;
		},
		setState(updater) {
			const previous = state;
			state = updater(state);
			for (const listener of [...subscribers]) listener(state, previous);
		},
		subscribe(listener) {
			subscribers.add(listener);
			return () => { subscribers.delete(listener); };
		},
	};
}

/**
 * `topic` itself, then each ancestor obtained by dropping the trailing `<separator>segment`,
 * most-specific first. A topic beginning with the separator (no non-empty prefix before it) has
 * no ancestors — `nextCut > 0`, not `>= 0`, is what enforces that.
 */
function ancestorChain(topic: string, separator: string): string[] {
	const chain = [topic];
	let current = topic;
	let cut = current.lastIndexOf(separator);
	while (cut > 0) {
		current = current.slice(0, cut);
		chain.push(current);
		cut = current.lastIndexOf(separator);
	}
	return chain;
}

/** The entry with the highest `seq` among `topic` and its descendants (`topic<separator>...`). */
function mostRecentAtOrUnder(state: Topics, topic: string, separator: string): { topic: string; entry: Entry } | undefined {
	const prefix = topic + separator;
	let best: { topic: string; entry: Entry } | undefined;
	for (const key of Object.keys(state)) {
		if (key !== topic && !key.startsWith(prefix)) continue;
		const entry = state[key];
		if (!best || entry.seq > best.entry.seq) best = { topic: key, entry };
	}
	return best;
}

export function createPubSub(options?: PubSubOptions): PubSub {
	const separator = options?.separator ?? ":";
	const store = createInternalStore<Topics>({});
	const listeners = new Map<string, Set<(value: unknown, topic: string) => void>>();
	let previous = store.getState();
	let seq = 0;

	const notify = (handler: (value: unknown, topic: string) => void, value: unknown, topic: string) => {
		try {
			handler(value, topic);
		} catch (err) {
			setTimeout(() => { throw err; }, 0);
		}
	};

	store.subscribe((state) => {
		for (const topic of Object.keys(state)) {
			if (state[topic] === previous[topic]) continue;
			const value = state[topic].value;
			for (const ancestor of ancestorChain(topic, separator)) {
				const set = listeners.get(ancestor);
				if (set) for (const handler of [...set]) notify(handler, value, topic);
			}
		}
		previous = state;
	});

	return {
		store,
		publish(topic, payload) {
			store.setState((state) => ({
				...state,
				[topic]: { value: payload, seq: ++seq },
			}));
		},
		subscribe(topic, handler, options) {
			const replay = options?.replay ?? true;
			let set = listeners.get(topic);
			if (!set) listeners.set(topic, (set = new Set()));
			const h = handler as (value: unknown, topic: string) => void;
			set.add(h);
			if (replay) {
				const found = mostRecentAtOrUnder(store.getState(), topic, separator);
				if (found) notify(h, found.entry.value, found.topic);
			}
			return () => { set!.delete(h); };
		},
		getLast(topic) {
			return mostRecentAtOrUnder(store.getState(), topic, separator)?.entry.value as never;
		},
	};
}
