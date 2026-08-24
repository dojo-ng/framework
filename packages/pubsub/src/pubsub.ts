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

/**
 * A familiar publish/subscribe facade backed by an external store. Most pub/sub usage is
 * really "last value wins" shared state, so this retains the last payload per topic and
 * replays it to late subscribers by default — which is what callers usually expect. Every
 * `publish` notifies current subscribers, even if the payload is unchanged.
 *
 * The underlying state lives in `store`, so the same data can also be read through the
 * store/context machinery (StoreController, the context registry) when wanted.
 */
export interface PubSub {
	publish<T = unknown>(topic: string, payload: T): void;
	subscribe<T = unknown>(topic: string, handler: (payload: T) => void, options?: SubscribeOptions): () => void;
	/** The last payload published to a topic, or undefined. */
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

export function createPubSub(): PubSub {
	const store = createInternalStore<Topics>({});
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	let previous = store.getState();

	store.subscribe((state) => {
		for (const topic of Object.keys(state)) {
			if (state[topic] !== previous[topic]) {
				const set = listeners.get(topic);
				if (set) for (const handler of [...set]) handler(state[topic].value);
			}
		}
		previous = state;
	});

	return {
		store,
		publish(topic, payload) {
			store.setState((state) => ({
				...state,
				[topic]: { value: payload, seq: (state[topic]?.seq ?? 0) + 1 },
			}));
		},
		subscribe(topic, handler, options) {
			const replay = options?.replay ?? true;
			let set = listeners.get(topic);
			if (!set) listeners.set(topic, (set = new Set()));
			const h = handler as (value: unknown) => void;
			set.add(h);
			if (replay && topic in store.getState()) {
				h(store.getState()[topic].value);
			}
			return () => { set!.delete(h); };
		},
		getLast(topic) {
			return store.getState()[topic]?.value as never;
		},
	};
}
