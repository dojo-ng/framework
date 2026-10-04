// A thin wrapper over the browser `WebSocket`, exposed as an `EventTarget`. There is no
// `MozWebSocket` fallback (dead for over a decade). `WebSocket` is read as the
// global, at call time rather than a module-scope import — that's also what lets a test substitute
// a fake one via `globalThis.WebSocket` with no constructor injection seam to design around.
//
// Four behaviors carried forward on purpose. Each is a real bug someone would otherwise
// reintroduce by "simplifying" this file once it looks like it's just wrapping `new WebSocket()`:
//
// - Out-of-sync detection (`send`, below): if `isOpen()` re-checked `socket.readyState` on every
//   call, the out-of-sync check in `send()` would be unreachable dead code — `isOpen` would
//   already return false for the same reason before `send()` got there. So `isOpen()` reflects
//   only OUR tracked state (set on `onopen`, cleared by `#handleClose`),
//   so `send()`'s live re-check of `socket.readyState` is the one thing that actually catches a
//   socket whose `readyState` moved to CLOSING/CLOSED before its own `onclose`/`onerror` fired —
//   which is legal per the WebSocket spec and is exactly the state this check exists to catch.
// - Backpressure: `bufferedAmount > 0` returns BUFFERING rather than sending, so a caller can back
//   off instead of piling messages into the OS send buffer.
// - Listener teardown before close: `#handleClose`, when IT decides to actively close a still-open
//   socket (as opposed to a close already in progress), nulls `onclose`/`onerror`/`onmessage`
//   before calling the underlying `close()`. Skip that and `close()` re-fires the still-wired
//   native `onclose`, which re-enters `#handleClose`, which closes again — the reconnect-storm bug.
// - `open(force)` semantics and handler wiring inside `onopen`: with no existing socket, or with
//   `force: true`, any prior socket is torn down and a fresh one opened. `message`/`error`/`close`
//   handlers are wired only once `onopen` fires, which is also why a pre-open error goes straight
//   to `#handleClose` with no `error` event — an asymmetry kept on purpose, because a caller
//   distinguishing "never connected" from "connected, then errored" depends on it.

export enum ReadyState {
	CONNECTING,
	OPEN,
	CLOSING,
	CLOSED,
}

export enum SendState {
	OKAY,
	NOT_READY,
	BUFFERING,
	SEND_ERROR,
}

// Documents each event's `detail` shape for callers writing their own listener signatures — e.g.
// `ws.addEventListener("message", (e: WSocketEventMap["message"]) => ...)`. Not wired into
// `addEventListener`/`removeEventListener` themselves: overriding those to be generic over event
// name requires class/interface declaration merging, which `@typescript-eslint/no-unsafe-
// declaration-merging` (in this repo's lint config) correctly flags as fragile — the merge can
// silently accept a listener signature the real DOM method never checks. Not worth it for four
// event names.
export interface WSocketEventMap {
	open: CustomEvent<{ event: Event }>;
	close: CustomEvent<{ event: CloseEvent | Record<string, unknown> }>;
	message: CustomEvent<{ data: unknown }>;
	error: CustomEvent<{ event: Event }>;
}

/** Canonicalizes differences across `WebSocket` implementations. See the file header for why. */
export class WSocket extends EventTarget {
	#state: ReadyState = ReadyState.CLOSED;
	#socket: WebSocket | null = null;
	#url: string;

	constructor(url: string) {
		super();
		this.#url = url;
	}

	get state(): ReadyState {
		return this.#state;
	}

	get url(): string {
		return this.#url;
	}

	get socket(): WebSocket | null {
		return this.#socket;
	}

	/** Our own tracked state, not a live re-check of `socket.readyState` — see `send()` for why. */
	isOpen(): boolean {
		return this.#socket !== null && this.#state === ReadyState.OPEN;
	}

	/** With no existing socket, or `force: true`, tears down any prior socket and opens a fresh one. */
	open(force = false): void {
		if (this.#socket) {
			if (!force) return;
			const stale = this.#socket;
			stale.onclose = null;
			stale.onerror = null;
			stale.onmessage = null;
			if (stale.readyState < WebSocket.CLOSING) stale.close();
			this.#socket = null;
		}

		this.#state = ReadyState.CONNECTING;
		const socket = (this.#socket = new WebSocket(this.#url));
		// Pre-open error: straight to close, no `error` event — see the file header.
		socket.onerror = () => this.#handleClose({});

		socket.onopen = (event) => {
			this.#state = ReadyState.OPEN;
			this.dispatchEvent(new CustomEvent("open", { detail: { event } }));

			socket.onmessage = (event) => {
				this.dispatchEvent(new CustomEvent("message", { detail: { data: event.data } }));
			};

			socket.onerror = (event) => {
				this.dispatchEvent(new CustomEvent("error", { detail: { event } }));
				this.#handleClose({});
			};

			socket.onclose = (event) => this.#handleClose(event);
		};
	}

	close(code?: number, reason?: string): void {
		this.#state = ReadyState.CLOSING;
		this.#socket?.close(code, reason);
	}

	send(message: string | Blob | BufferSource): SendState {
		if (!this.isOpen() || this.#socket === null) {
			return SendState.NOT_READY;
		}
		const socket = this.#socket;

		// Out-of-sync detection — see the file header.
		if (socket.readyState !== WebSocket.OPEN) {
			this.#handleClose({ reason: "readyState out of sync with tracked state" });
			return SendState.NOT_READY;
		}

		if (socket.bufferedAmount > 0) {
			return SendState.BUFFERING;
		}

		try {
			socket.send(message);
			return SendState.OKAY;
		} catch {
			this.#handleClose({ reason: "send threw" });
			return SendState.SEND_ERROR;
		}
	}

	#handleClose(event: CloseEvent | Record<string, unknown>): void {
		this.#state = ReadyState.CLOSED;
		const socket = this.#socket;
		if (socket && socket.readyState < WebSocket.CLOSING) {
			// Teardown before close — see the file header; this is the reconnect-storm fix.
			socket.onclose = null;
			socket.onerror = null;
			socket.onmessage = null;
			socket.close();
		}
		this.dispatchEvent(new CustomEvent("close", { detail: { event } }));
		this.#socket = null;
	}
}
