// Ported from app3/core/socket/src/socket.ts (350 lines, websocket-spec.md T4). This is the task
// that carries the value — everything in the proposal's carry list lands here except the
// transport/envelope registries (Phase 2, deliberately unwritten until Phase 1 meets a real
// backend). Carried behaviors, each with its own reason:
//
// - Request/response correlation (`call`): `#nextId++` into a callback map, resolved by id on the
//   matching inbound frame. No timeout/reject path — app3 never had one either, and it's not on
//   the carry list, so a pending call can wait forever on a connection that never responds. Not a
//   bug to "fix" here; a deliberate fidelity choice, revisit only if Bill asks for it.
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
// - Identity handshake (`onConnect`): app3 hardcoded a SESSID frame built from
//   `window.hcstatic.sessionid`. Generalized into a caller-supplied hook returning frames to send
//   first, before the queue flush — the app owns what identity means (DYNLS separation lesson),
//   this package doesn't know what "who this is" means for any given backend.
// - Events over pub/sub, not a bespoke API: an inbound "event" frame publishes under its own name;
//   publishing to `outboundTopic` sends an "event" frame. No new subscription concept invented —
//   pub/sub is the whole app-facing surface, in both directions.
// - `simulate("disconnect" | "connect")`: a deliberate testing affordance. Reconnect logic is
//   otherwise nearly untestable against a real backend.
//
// Dropped, not carried: the `queue_available` Defer-based gate around the send queue. It only ever
// guarded synchronous code (`Queue`'s ops don't await anything), so in single-threaded JS it
// serialized nothing that wasn't already serial — every method here runs to completion before the
// next scheduled one starts, so there's no reentrancy hazard for it to guard against. Also dropped:
// `createDefer` (→ `Promise.withResolvers()`), the `WeakMap` private-props pattern (→ `#private`
// fields), `Evented`/`ws.on()` (→ `WSocket`'s `EventTarget`, from T3), lodash-es `defer`/`delay` (→
// native `setTimeout`), all `window.hcstatic.*` coupling, and the MANHOLE/CDPPUSH actions
// (Holmes-specific). JSON-RPC's header/response-object wrapping is also dropped — that's `core/rpc`
// territory, out of scope for this package per the proposal's layering.
//
// The envelope shape below (`{ action, id, data }`) is a T4-local working assumption, not T5's
// decision. websocket-spec.md T5 measures compressed bytes on the wire and picks the shape for
// real; until then this object form (matching the proposal's standing lean) is what dispatch and
// the tests here operate on.

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
