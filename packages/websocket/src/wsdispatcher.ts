// WebSocket message dispatch on top of `WSocket`. Behaviors, each with its own reason:
//
// - Request/response correlation (`call`): `#nextId++` into a callback map, resolved by id on the
//   matching inbound frame. There is no timeout/reject path, so a pending call can wait forever
//   on a connection that never responds. This is deliberate and documented; a caller that needs a
//   limit races the promise against a timer.
// - Offline send queue (`#drain`): peeks and sends, dequeuing only on a confirmed OKAY send, so a
//   failed send never drops the message. BUFFERING retries at 50ms; a confirmed send immediately
//   tries the next one.
// - Reconnect with Fibonacci backoff (`#scheduleReopen`): `TIMEOUT_BASE` 15s plus the step table,
//   counter reset only on a successful open, suppressed entirely while `#closing` is true.
// - Heartbeat watchdog (`#armHeartbeat`): each inbound "ping" frame arms a 40s timer. On expiry:
//   close, wait 2s, then go through the SAME backoff-aware reopen path as any other reconnect —
//   not a bypass. `TIMEOUT_STEP`'s reset-only-on-success rule means a heartbeat failure right after
//   a fresh open still reopens promptly, but a string of them backs off like any other flapping
//   connection.
// - Identity handshake (`onConnect`): a caller-supplied hook returning frames to send first on
//   every (re)connect, before the queue flush. The app owns what identity means; this package
//   does not know what "who this is" means for any given backend.
// - Events over pub/sub, not a bespoke API: an inbound "event" frame publishes under its own name;
//   publishing to `outboundTopic` sends an "event" frame. No new subscription concept invented —
//   pub/sub is the whole app-facing surface, in both directions.
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

const TIMEOUT_BASE = 15;
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
}

export interface WSDispatcherOptions {
	url: string;
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
	readonly #url: string;
	readonly #ws: WSocket;
	readonly #pubsub: PubSub;
	readonly #onConnect?: () => unknown[];
	readonly #msgQueue = new Queue<Envelope>();
	readonly #cbqueue = new Map<number, PendingCall>();

	#closing = false;
	#reopenCount = 0;
	#nextId = 1;
	#pingTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: WSDispatcherOptions) {
		this.#url = options.url;
		this.#onConnect = options.onConnect;
		this.#pubsub = options.pubsub ?? createPubSub();

		this.#ws = new WSocket(this.#url);
		this.#ws.addEventListener("message", (event) => {
			this.#dispatch((event as WSocketEventMap["message"]).detail.data as string);
		});
		this.#ws.addEventListener("open", () => {
			this.#reopenCount = 0;
			this.#flushQueue();
		});
		this.#ws.addEventListener("close", () => {
			this.#scheduleReopen();
		});

		const outboundTopic = options.outboundTopic ?? "notify:event";
		this.#pubsub.subscribe(
			outboundTopic,
			(payload: EventFrameData) => this.#enqueue({ action: "event", id: 0, data: payload }),
			{ replay: false },
		);
	}

	get url(): string {
		return this.#url;
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

	open(force = false): void {
		this.#closing = false;
		this.#ws.open(force);
	}

	close(): void {
		this.#closing = true;
		this.#ws.close();
	}

	/** A correlated request: resolves with the `data` of the response frame carrying the same id. */
	call(data: unknown): Promise<unknown> {
		const id = this.#nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		this.#cbqueue.set(id, { resolve, reject });
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

	#scheduleReopen(): void {
		if (this.#closing) return;
		const step = Math.min(this.#reopenCount, TIMEOUT_STEP.length - 1);
		const timeoutSeconds = TIMEOUT_STEP[step] + TIMEOUT_BASE;
		this.#reopenCount++;
		setTimeout(() => {
			this.open();
		}, timeoutSeconds * 1000);
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

		const frame = this.#msgQueue.peek();
		const sendState = this.#ws.send(JSON.stringify(frame));
		if (sendState === SendState.OKAY) {
			this.#msgQueue.dequeue();
		}

		if (!this.#msgQueue.isEmpty() && (sendState === SendState.OKAY || sendState === SendState.BUFFERING)) {
			const delayMs = sendState === SendState.OKAY ? 0 : 50;
			setTimeout(() => this.#drain(), delayMs);
		}
	}

	#dispatch(raw: string): void {
		const frame = JSON.parse(raw) as Envelope;
		switch (frame.action) {
			case "ping":
				this.#armHeartbeat();
				break;
			case "event": {
				const { event, params } = frame.data as EventFrameData;
				this.#pubsub.publish(event, params);
				break;
			}
			case "call": {
				const pending = this.#cbqueue.get(frame.id);
				if (pending) {
					this.#cbqueue.delete(frame.id);
					pending.resolve(frame.data);
				}
				break;
			}
		}
	}

	#armHeartbeat(): void {
		if (this.#pingTimer) clearTimeout(this.#pingTimer);
		this.#pingTimer = setTimeout(() => {
			this.#pingTimer = null;
			this.close();
			setTimeout(() => {
				this.#closing = false;
				this.#scheduleReopen();
			}, PING_RECOVERY_DELAY_MS);
		}, PING_TIMEOUT_MS);
	}
}
