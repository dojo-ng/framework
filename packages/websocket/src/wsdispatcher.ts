// WebSocket message dispatch on top of `WSocket`. Behaviors, each with its own reason:
//
// - Request/response correlation (`call`): `#nextId++` into a callback map, resolved by id on the
//   matching inbound frame. A call is rejected with a `WSCallError` when its timeout passes
//   (`callTimeout`, or the per-call `timeout`), when its `signal` aborts, when the connection drops
//   after its frame went out (the response can no longer arrive), and on `dispose()`. A call still
//   waiting in the offline queue survives a drop and goes out on the next connect. With no
//   timeout set, a call on a connection that stays up but never answers still waits forever.
// - Offline send queue (`#drain`): peeks and sends, dequeuing only on a confirmed OKAY send, so a
//   failed send never drops the message. BUFFERING retries at 50ms; a confirmed send immediately
//   tries the next one.
// - Reconnect with Fibonacci backoff (`#scheduleReopen`): `reconnectBase` (default 15s) plus the
//   step table, stretched by a random `reconnectJitter` (default up to 25% longer, never shorter)
//   so tabs dropped by the same server restart do not all return in the same second. The counter
//   resets only on a successful open. Suppressed entirely while `#closing` is true.
// - Timers: the reconnect timer, the heartbeat watchdog, and the watchdog's recovery delay are all
//   tracked, and `close()` clears every one. Each of them ends by opening the socket again, and
//   `open()` clears `#closing`, so a timer left armed after `close()` would undo it.
// - URL provider: `url` may be a function, called before EVERY open (first connect and each
//   reconnect) so a single-use ticket in the query string is fresh each time. A provider that
//   throws or rejects is a failed attempt and goes through `#scheduleReopen`; one that wants to stop
//   for good calls `close()` before throwing. `#closing` is rechecked after the provider resolves,
//   so a `close()` that lands mid-await wins.
// - Heartbeat watchdog (`#armHeartbeat`): each inbound "ping" frame arms a 40s timer, and a closed
//   connection disarms it (it watches one connection). On expiry: close, wait 2s, then go through
//   the SAME backoff-aware reopen path as any other reconnect — not a bypass. `TIMEOUT_STEP`'s
//   reset-only-on-success rule means a heartbeat failure right after a fresh open still reopens
//   promptly, but a string of them backs off like any other flapping connection.
// - Identity handshake (`onConnect`): a caller-supplied hook returning frames to send first on
//   every (re)connect, before the queue flush. The app owns what identity means; this package
//   does not know what "who this is" means for any given backend.
// - Events over pub/sub, not a bespoke API: an inbound "event" frame publishes under its own name;
//   publishing to `outboundTopic` sends an "event" frame. No new subscription concept invented —
//   pub/sub is the whole app-facing surface, in both directions. An inbound event that lands on
//   the outbound topic (or under it) still reaches the app's subscribers but is not sent back.
// - Inbound frames that are not JSON, or not an envelope, are dropped. One bad frame from the
//   server must not throw out of the socket's message handler.
// - `dispose()`: the end of a dispatcher's life. Closes, clears every timer, rejects every
//   pending call, empties the queue, and lets go of the socket and pub/sub listeners.
// - `simulate("disconnect" | "connect")`: a deliberate testing affordance. Reconnect logic is
//   otherwise nearly untestable against a real backend.
//
// There is no lock around the send queue. `Queue`'s operations are synchronous, so in
// single-threaded JS every method here runs to completion before the next scheduled one starts,
// and there is no reentrancy hazard to guard against. Request/response wrapping such as JSON-RPC
// headers is out of scope; that belongs in a layer above this package.
//
// The envelope shape (`{ action, id, data }`) is specified in schema/envelope.schema.json. It was
// chosen over a positional array by measuring compressed bytes on the wire
// (spike/measure-envelope.mjs).

import { createPubSub, type PubSub } from "@dojo-ng/pubsub";
import { Queue } from "./queue.js";
import { WSocket, SendState, type WSocketEventMap } from "./wsocket.js";

const DEFAULT_RECONNECT_BASE = 15;
const DEFAULT_RECONNECT_JITTER = 0.25;
const TIMEOUT_STEP = [0, 0, 0, 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
const PING_TIMEOUT_MS = 40_000;
const PING_RECOVERY_DELAY_MS = 2_000;

type Action = "ping" | "event" | "call";

interface Envelope {
	action: Action;
	id: number;
	data: unknown;
}

interface EventFrameData {
	event: string;
	params: unknown;
}

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	/** True once the frame has left the queue; a drop after that means no response can come. */
	sent: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	/** Removes the abort listener, if a signal was given. */
	release: (() => void) | null;
}

/** Why a `call()` was rejected. */
export type WSCallErrorReason = "timeout" | "closed" | "aborted" | "disposed";

/** The rejection of a `call()` that will get no response. `reason` says why. */
export class WSCallError extends Error {
	readonly reason: WSCallErrorReason;

	constructor(reason: WSCallErrorReason, message: string) {
		super(message);
		this.name = "WSCallError";
		this.reason = reason;
	}
}

export interface WSCallOptions {
	/** Milliseconds to wait for the response before rejecting. Overrides `callTimeout`; 0 means none. */
	timeout?: number;
	/** Aborting rejects the call, and takes its frame out of the queue if it has not gone out. */
	signal?: AbortSignal;
}

export interface WSDispatcherOptions {
	/**
	 * The socket URL, or a function returning it (sync or async). A function is called before every
	 * open, first connect and every reconnect alike, and its result is the URL for that attempt only
	 * — use it when the URL carries a single-use credential such as a ticket. A function that throws
	 * or rejects counts as a failed attempt and is retried through the reconnect backoff. To stop
	 * for good (say the credential was refused), call `close()` and then throw.
	 *
	 * ```ts
	 * url: async () => {
	 *   const res = await fetch("/api/ws-ticket", { method: "POST" });
	 *   if (res.status === 401) { dispatcher.close(); throw new Error("not authorized"); }
	 *   return `wss://example.com/ws?ticket=${(await res.json()).ticket}`;
	 * }
	 * ```
	 */
	url: string | (() => string | Promise<string>);
	/**
	 * Seconds added to every reconnect delay, on top of the Fibonacci step. Default 15. Lower it for
	 * a client on the same machine as its server (a daemon restart); keep it high for a public site
	 * so a server restart is not met by every tab at once.
	 */
	reconnectBase?: number;
	/**
	 * How much longer, at most, each reconnect delay may randomly be, as a fraction of it. Default
	 * 0.25 (up to 25% longer, never shorter). 0 turns jitter off.
	 */
	reconnectJitter?: number;
	/** Default milliseconds a `call()` waits for its response before rejecting. Default 0: no limit. */
	callTimeout?: number;
	/** Frames to send first on every (re)connect, before the offline queue flushes. */
	onConnect?: () => unknown[];
	/** Shared with the rest of the app if given; otherwise a private instance is created. */
	pubsub?: PubSub;
	/** Publishing here sends an outbound "event" frame. Default `"notify:event"`. */
	outboundTopic?: string;
}

/**
 * WebSocket message dispatch: frames are routed by `action`. Messages sent while the socket isn't
 * open are queued and flushed on connect. See the file header for the full behavior list.
 */
export class WSDispatcher {
	readonly #urlSource: string | (() => string | Promise<string>);
	readonly #reconnectBase: number;
	readonly #reconnectJitter: number;
	readonly #callTimeout: number;
	readonly #ws: WSocket;
	readonly #pubsub: PubSub;
	readonly #onConnect?: () => unknown[];
	readonly #msgQueue = new Queue<Envelope>();
	readonly #cbqueue = new Map<number, PendingCall>();
	readonly #unsubscribeOutbound: () => void;
	readonly #onMessage = (event: Event) => {
		this.#dispatch((event as WSocketEventMap["message"]).detail.data);
	};
	readonly #onOpen = () => {
		this.#reopenCount = 0;
		this.#flushQueue();
	};
	readonly #onClose = () => {
		this.#clearTimer("ping");
		this.#rejectSentCalls();
		this.#scheduleReopen();
	};

	#closing = false;
	#disposed = false;
	#resolvingUrl = false;
	#reopenCount = 0;
	#nextId = 1;
	/** The topic of the inbound event being published right now, so it is not sent back out. */
	#inboundTopic: string | null = null;
	#pingTimer: ReturnType<typeof setTimeout> | null = null;
	#reopenTimer: ReturnType<typeof setTimeout> | null = null;
	#recoveryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: WSDispatcherOptions) {
		this.#urlSource = options.url;
		this.#reconnectBase = options.reconnectBase ?? DEFAULT_RECONNECT_BASE;
		this.#reconnectJitter = Math.max(0, options.reconnectJitter ?? DEFAULT_RECONNECT_JITTER);
		this.#callTimeout = options.callTimeout ?? 0;
		this.#onConnect = options.onConnect;
		this.#pubsub = options.pubsub ?? createPubSub();

		this.#ws = new WSocket(typeof this.#urlSource === "string" ? this.#urlSource : "");
		this.#ws.addEventListener("message", this.#onMessage);
		this.#ws.addEventListener("open", this.#onOpen);
		this.#ws.addEventListener("close", this.#onClose);

		const outboundTopic = options.outboundTopic ?? "notify:event";
		this.#unsubscribeOutbound = this.#pubsub.subscribe(
			outboundTopic,
			(payload: EventFrameData, topic: string) => {
				if (topic === this.#inboundTopic) return; // came from the server: don't echo it
				this.#enqueue({ action: "event", id: 0, data: payload });
			},
			{ replay: false },
		);
	}

	/** The most recent URL opened; empty until a URL provider has resolved once. */
	get url(): string {
		return this.#ws.url;
	}

	/** The underlying `WSocket`, for connection-state inspection. */
	get socket(): WSocket {
		return this.#ws;
	}

	/** The pub/sub instance in use — the caller's own if supplied, otherwise the private default. */
	get pubsub(): PubSub {
		return this.#pubsub;
	}

	isOpen(): boolean {
		return this.#ws.isOpen();
	}

	/** Opens the socket. Does nothing after `dispose()`. */
	open(force = false): void {
		if (this.#disposed) return;
		this.#closing = false;
		// An explicit open replaces any reopen already on its way.
		this.#clearTimer("reopen");
		this.#clearTimer("recovery");
		if (typeof this.#urlSource === "string") {
			this.#ws.open(force);
			return;
		}
		// A second open while the provider is pending would spend a second single-use URL.
		if (this.#resolvingUrl) return;
		void this.#openResolved(this.#urlSource, force);
	}

	/** Closes the socket and stops every reconnect until the next `open()`. Queued messages stay queued. */
	close(): void {
		this.#closing = true;
		this.#clearTimer("reopen");
		this.#clearTimer("recovery");
		this.#clearTimer("ping");
		this.#ws.close();
	}

	/**
	 * Closes for good: clears every timer, rejects every pending `call()` with reason `"disposed"`,
	 * drops the queue, and stops listening to the socket and the outbound topic. `open()` does
	 * nothing afterwards, and a later `call()` rejects at once.
	 */
	dispose(): void {
		if (this.#disposed) return;
		this.close();
		this.#disposed = true;
		this.#unsubscribeOutbound();
		this.#ws.removeEventListener("message", this.#onMessage);
		this.#ws.removeEventListener("open", this.#onOpen);
		this.#ws.removeEventListener("close", this.#onClose);
		for (const id of [...this.#cbqueue.keys()]) {
			this.#failCall(id, new WSCallError("disposed", "the dispatcher was disposed"));
		}
		this.#msgQueue.clear();
	}

	/**
	 * A correlated request: resolves with the `data` of the response frame carrying the same id.
	 * Rejects with a `WSCallError` on timeout, abort, a dropped connection after the frame went out,
	 * or `dispose()`.
	 */
	call(data: unknown, options: WSCallOptions = {}): Promise<unknown> {
		if (this.#disposed) {
			return Promise.reject(new WSCallError("disposed", "the dispatcher was disposed"));
		}
		const { signal } = options;
		if (signal?.aborted) {
			return Promise.reject(new WSCallError("aborted", "the call was aborted"));
		}
		const id = this.#nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const pending: PendingCall = { resolve, reject, sent: false, timer: null, release: null };
		this.#cbqueue.set(id, pending);

		const timeout = options.timeout ?? this.#callTimeout;
		if (timeout > 0) {
			pending.timer = setTimeout(() => {
				this.#failCall(id, new WSCallError("timeout", `no response within ${timeout}ms`));
			}, timeout);
		}
		if (signal) {
			const onAbort = () => this.#failCall(id, new WSCallError("aborted", "the call was aborted"));
			signal.addEventListener("abort", onAbort, { once: true });
			pending.release = () => signal.removeEventListener("abort", onAbort);
		}

		this.#enqueue({ action: "call", id, data });
		return promise;
	}

	/** A deliberate testing affordance — reconnect logic is otherwise nearly untestable. */
	simulate(action: "disconnect" | "connect"): void {
		if (action === "disconnect") {
			if (!this.#closing) this.close();
		} else if (!this.isOpen()) {
			this.open();
		}
	}

	async #openResolved(provider: () => string | Promise<string>, force: boolean): Promise<void> {
		this.#resolvingUrl = true;
		let url: string;
		try {
			url = await provider();
		} catch {
			this.#resolvingUrl = false;
			this.#scheduleReopen();
			return;
		}
		this.#resolvingUrl = false;
		// A close() that landed while the provider was pending must win.
		if (this.#closing) return;
		this.#ws.open(force, url);
	}

	#scheduleReopen(): void {
		if (this.#closing || this.#disposed) return;
		const step = Math.min(this.#reopenCount, TIMEOUT_STEP.length - 1);
		const delayMs = (TIMEOUT_STEP[step] + this.#reconnectBase) * 1000;
		const jitterMs = delayMs * this.#reconnectJitter * Math.random();
		this.#reopenCount++;
		this.#clearTimer("reopen");
		this.#reopenTimer = setTimeout(() => {
			this.#reopenTimer = null;
			this.open();
		}, delayMs + jitterMs);
	}

	#clearTimer(which: "reopen" | "recovery" | "ping"): void {
		if (which === "reopen" && this.#reopenTimer) {
			clearTimeout(this.#reopenTimer);
			this.#reopenTimer = null;
		} else if (which === "recovery" && this.#recoveryTimer) {
			clearTimeout(this.#recoveryTimer);
			this.#recoveryTimer = null;
		} else if (which === "ping" && this.#pingTimer) {
			clearTimeout(this.#pingTimer);
			this.#pingTimer = null;
		}
	}

	#failCall(id: number, error: WSCallError): void {
		const pending = this.#cbqueue.get(id);
		if (!pending) return;
		this.#cbqueue.delete(id);
		if (pending.timer) clearTimeout(pending.timer);
		pending.release?.();
		// Not sent yet: take it out of the queue so it doesn't go out with nobody waiting.
		if (!pending.sent) this.#msgQueue.removeFirst((frame) => frame.action === "call" && frame.id === id);
		pending.reject(error);
	}

	#rejectSentCalls(): void {
		for (const [id, pending] of [...this.#cbqueue]) {
			if (pending.sent) {
				this.#failCall(id, new WSCallError("closed", "the connection closed before the response arrived"));
			}
		}
	}

	#flushQueue(): void {
		for (const frame of this.#onConnect?.() ?? []) {
			this.#ws.send(JSON.stringify(frame));
		}
		this.#drain();
	}

	#enqueue(frame: Envelope): void {
		this.#msgQueue.enqueue(frame);
		this.#drain();
	}

	#drain(): void {
		if (!this.#ws.isOpen() || this.#msgQueue.isEmpty()) return;

		const frame = this.#msgQueue.peek()!;
		const sendState = this.#ws.send(JSON.stringify(frame));
		if (sendState === SendState.OKAY) {
			this.#msgQueue.dequeue();
			if (frame.action === "call") {
				const pending = this.#cbqueue.get(frame.id);
				if (pending) pending.sent = true;
			}
		}

		if (!this.#msgQueue.isEmpty() && (sendState === SendState.OKAY || sendState === SendState.BUFFERING)) {
			const delayMs = sendState === SendState.OKAY ? 0 : 50;
			setTimeout(() => this.#drain(), delayMs);
		}
	}

	#dispatch(raw: unknown): void {
		let frame: Envelope;
		try {
			frame = JSON.parse(raw as string) as Envelope;
		} catch {
			return; // not JSON: drop it rather than throw out of the socket's message handler
		}
		if (typeof frame !== "object" || frame === null) return;
		switch (frame.action) {
			case "ping":
				this.#armHeartbeat();
				break;
			case "event": {
				const data = frame.data as EventFrameData | null;
				if (typeof data !== "object" || data === null || typeof data.event !== "string") return;
				this.#inboundTopic = data.event;
				try {
					this.#pubsub.publish(data.event, data.params);
				} finally {
					this.#inboundTopic = null;
				}
				break;
			}
			case "call": {
				const pending = this.#cbqueue.get(frame.id);
				if (pending) {
					this.#cbqueue.delete(frame.id);
					if (pending.timer) clearTimeout(pending.timer);
					pending.release?.();
					pending.resolve(frame.data);
				}
				break;
			}
		}
	}

	#armHeartbeat(): void {
		this.#clearTimer("ping");
		this.#pingTimer = setTimeout(() => {
			this.#pingTimer = null;
			this.close();
			// close() cleared every timer; this one is cleared by the next close() or open().
			this.#recoveryTimer = setTimeout(() => {
				this.#recoveryTimer = null;
				this.#closing = false;
				this.#scheduleReopen();
			}, PING_RECOVERY_DELAY_MS);
		}, PING_TIMEOUT_MS);
	}
}
