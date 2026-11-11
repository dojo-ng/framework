import { subscribeAsync as toAsyncIterable, type AsyncSubscribeOptions } from "./subscribe-async.js";

export type { AsyncSubscribeOptions } from "./subscribe-async.js";

// Duplicated from components/packages/store/src/types.ts, deliberately, not a shortcut. framework
// must not depend on components (that would point the lower layer at the higher one, and it
// wouldn't resolve at all until components publishes to npm). Because TypeScript structural typing
// doesn't care which declaration a shape came from, a PubSub built here still satisfies
// StoreController's parameter in components with no adapter and no cast.
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
	 * then `a<sep>b`, then `a`, most-specific first. One fixed separator per instance, rather than guessing `:` or `/`
	 * per topic, which behaves surprisingly on a topic containing both.
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
 * A publish made from inside a handler is queued and delivered once the current publish has
 * reached every subscriber, so every subscriber sees publishes in the order they were made.
 * Each `subscribe` call is its own subscription: the same handler subscribed twice is called
 * twice, and each returned function removes only its own subscription.
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
	/**
	 * An async-iterable view of `subscribe`: `for await` receives every value published to `topic`
	 * (including namespace descendants, same as `subscribe`), in order, starting from the moment
	 * this is called — not replayed, and not deferred to the first loop iteration. See
	 * `AsyncSubscribeOptions` and the README for the slow-consumer buffer bound.
	 */
	subscribeAsync<T = unknown>(topic: string, options?: AsyncSubscribeOptions): AsyncIterable<T>;
	/** The most recent payload published at or under a topic, or undefined. */
	getLast<T = unknown>(topic: string): T | undefined;
	/** The backing store, for integration with StoreController/context. */
	readonly store: ReadableStore<Topics>;
}

// Hand-rolled in place of zustand/vanilla's createStore — the
// framework repo has zero runtime deps by design, and none of zustand's actual semantics (the
// set/get/api passed to the initializer, shallow-merge setState, the Object.is change guard) were
// ever relied on here. `subscribe` still calls
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

/** One `subscribe` call. A record, not the bare handler, so subscribing a handler twice gives two subscriptions. */
interface Subscription {
	handler: (value: unknown, topic: string) => void;
	/** Deliver only publishes with a higher `seq`: ones made after subscribing, or after the replayed value. */
	after: number;
	active: boolean;
}

export function createPubSub(options?: PubSubOptions): PubSub {
	const separator = options?.separator ?? ":";
	const store = createInternalStore<Topics>({});
	const subscriptions = new Map<string, Set<Subscription>>();
	let previous = store.getState();
	let seq = 0;
	// Publishes waiting to be delivered. A publish made by a handler joins the end of this queue
	// and is delivered after the current one has reached every subscriber, so all subscribers see
	// publishes in the order they were made.
	const queue: { topic: string; entry: Entry }[] = [];
	let delivering = false;

	const notify = (sub: Subscription, value: unknown, topic: string) => {
		try {
			sub.handler(value, topic);
		} catch (err) {
			setTimeout(() => { throw err; }, 0);
		}
	};

	const deliver = (topic: string, entry: Entry) => {
		for (const ancestor of ancestorChain(topic, separator)) {
			const set = subscriptions.get(ancestor);
			if (!set) continue;
			for (const sub of [...set]) {
				if (!sub.active || entry.seq <= sub.after) continue;
				sub.after = entry.seq;
				notify(sub, entry.value, topic);
			}
		}
	};

	store.subscribe((state) => {
		// Advance `previous` BEFORE delivering. A handler may publish (to any topic), which re-enters
		// this listener with a newer state; if `previous` still held the pre-publish snapshot, that
		// nested pass would see the outer topic as changed again and re-deliver it.
		const before = previous;
		previous = state;
		for (const topic of Object.keys(state)) {
			if (state[topic] !== before[topic]) queue.push({ topic, entry: state[topic] });
		}
		if (delivering) return;
		delivering = true;
		try {
			for (let next = queue.shift(); next; next = queue.shift()) deliver(next.topic, next.entry);
		} finally {
			delivering = false;
		}
	});

	const subscribe: PubSub["subscribe"] = (topic, handler, subscribeOptions) => {
		const replay = subscribeOptions?.replay ?? true;
		let set = subscriptions.get(topic);
		if (!set) subscriptions.set(topic, (set = new Set()));
		// `after = seq` also skips publishes made before this call that are still queued: a replay
		// already covers them, and without replay the subscriber asked for new messages only.
		const sub: Subscription = { handler: handler as Subscription["handler"], after: seq, active: true };
		set.add(sub);
		if (replay) {
			const found = mostRecentAtOrUnder(store.getState(), topic, separator);
			if (found) notify(sub, found.entry.value, found.topic);
		}
		return () => {
			sub.active = false;
			set!.delete(sub);
		};
	};

	return {
		store,
		publish(topic, payload) {
			store.setState((state) => ({
				...state,
				[topic]: { value: payload, seq: ++seq },
			}));
		},
		subscribe,
		subscribeAsync(topic, asyncOptions) {
			return toAsyncIterable(subscribe, topic, asyncOptions);
		},
		getLast(topic) {
			return mostRecentAtOrUnder(store.getState(), topic, separator)?.entry.value as never;
		},
	};
}
