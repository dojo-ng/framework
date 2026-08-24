// websocket-spec.md T6: the async-iterable subscription surface. `for await` works with no
// library, and this is also the decision that makes T7 (Observable interop) nearly free — RxJS
// ships `from(asyncIterable)`, so nothing else needs writing for that direction once this exists.
//
// Takes `subscribe` as a parameter rather than a `PubSub` instance so the core logic is testable
// against a plain counting fake, without needing to exercise the real store/notify machinery to
// prove a subscription was actually torn down — see the honest-verification note in
// websocket-spec.md T6's own dated entry.
import type { SubscribeOptions } from "./pubsub.js";

/** Default: how many published values a slow consumer can fall behind by. See the README. */
export const DEFAULT_BUFFER_SIZE = 256;

export interface AsyncSubscribeOptions {
	/** Ends the iteration and tears down the subscription when this fires. */
	signal?: AbortSignal;
	/**
	 * How many published values a slow consumer (one that hasn't called `.next()` yet) can be
	 * behind by before the oldest are dropped to make room for new ones. Default
	 * `DEFAULT_BUFFER_SIZE` (256). See the README for why this exists — an unbounded buffer here is
	 * exactly the "grew unbounded" bug the Perry caveat in T9 names.
	 */
	bufferSize?: number;
}

type Subscribe = <T>(topic: string, handler: (payload: T, topic: string) => void, options?: SubscribeOptions) => () => void;

/**
 * Wraps `subscribe` into an async iterable over `topic`. Subscribes immediately (not deferred to
 * the first `for await` iteration) so nothing published between calling this and starting the loop
 * is missed. Never replays — matches `for await`'s "start listening now" expectation, not a cache
 * read. A `for...of`/`for await` `break`, `return`, or thrown error inside the loop also tears the
 * subscription down, via the standard `AsyncIterator.return()` protocol — not only an explicit
 * `AbortSignal`.
 */
export function subscribeAsync<T>(subscribe: Subscribe, topic: string, options?: AsyncSubscribeOptions): AsyncIterable<T> {
	const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;
	const signal = options?.signal;

	const buffer: T[] = [];
	let waiting: (() => void) | null = null;
	let ended = false;

	const unsubscribe = subscribe<T>(
		topic,
		(value) => {
			if (ended) return;
			buffer.push(value);
			if (buffer.length > bufferSize) buffer.shift();
			waiting?.();
			waiting = null;
		},
		{ replay: false },
	);

	const end = () => {
		if (ended) return;
		ended = true;
		unsubscribe();
		waiting?.();
		waiting = null;
	};

	if (signal) {
		if (signal.aborted) end();
		else signal.addEventListener("abort", end, { once: true });
	}

	return {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			return {
				async next(): Promise<IteratorResult<T>> {
					while (buffer.length === 0 && !ended) {
						await new Promise<void>((resolve) => {
							waiting = resolve;
						});
					}
					if (buffer.length > 0) {
						return { value: buffer.shift() as T, done: false };
					}
					return { value: undefined, done: true };
				},
				async return(): Promise<IteratorResult<T>> {
					end();
					return { value: undefined, done: true };
				},
			};
		},
	};
}
