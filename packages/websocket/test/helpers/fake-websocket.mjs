// Shared by wsocket.test.mjs and wsdispatcher.test.mjs. Mimics the real WebSocket
// callback-property API (onopen/onclose/onerror/onmessage, readyState, bufferedAmount)
// synchronously — nothing under test here depends on real close-handshake timing, only on the
// callbacks firing at all and readyState reflecting the transition, so a synchronous fake is
// enough and keeps every test timer-free except where a test explicitly enables fake timers.
export class FakeWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	constructor(url) {
		this.url = url;
		this.readyState = FakeWebSocket.CONNECTING;
		this.bufferedAmount = 0;
		this.onopen = null;
		this.onclose = null;
		this.onerror = null;
		this.onmessage = null;
		this.sent = [];
		this.sendThrows = false;
	}

	send(message) {
		if (this.sendThrows) throw new Error("send failed");
		this.sent.push(message);
	}

	close(code, reason) {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.({ type: "close", code, reason });
	}

	// Test helper, not part of the real WebSocket API.
	simulateOpen() {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.({ type: "open" });
	}
}

export function withFakeWebSocket(fn) {
	const realWebSocket = globalThis.WebSocket;
	globalThis.WebSocket = FakeWebSocket;
	try {
		return fn();
	} finally {
		globalThis.WebSocket = realWebSocket;
	}
}

export async function withFakeWebSocketAsync(fn) {
	const realWebSocket = globalThis.WebSocket;
	globalThis.WebSocket = FakeWebSocket;
	try {
		return await fn();
	} finally {
		globalThis.WebSocket = realWebSocket;
	}
}
