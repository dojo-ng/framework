// Local echo server for the @dojo-ng/websocket playground (websocket-spec.md T8). Not part of the
// package — dev tooling only, run with `npm run playground`. Serves the playground's static files
// (including both packages' dist/ output, so the browser's import map resolves against real files)
// and a WebSocket endpoint speaking the T5 envelope ({action, id, data}), plus two HTTP control
// routes that do things a client can never legitimately do to itself, which is the whole point:
//
// - POST /control/kill — terminates the raw connection with no close handshake, simulating an
//   unexpected drop. WSDispatcher never called close() itself, so this is what actually exercises
//   the Fibonacci-backoff reconnect path — simulate("disconnect") does NOT: that's an explicit
//   client close, which T4 proves schedules no reconnect at all.
// - POST /control/pause-heartbeat — stops this server sending PING, without closing the socket.
//   Exercises the client's 40s watchdog: close, wait 2s, reopen through the same backoff path.
//
// Run: cd packages/websocket && npm run playground, then open http://localhost:8901/playground/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import Ajv from "ajv";

const PORT = 8901;
const HEARTBEAT_INTERVAL_MS = 15_000;

const here = path.dirname(fileURLToPath(import.meta.url));
const frameworkRoot = path.resolve(here, "../../.."); // packages/websocket/playground -> framework/

const schema = JSON.parse(await readFile(path.join(here, "../schema/envelope.schema.json"), "utf8"));
const validate = new Ajv().compile(schema);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };

const server = createServer(async (req, res) => {
	if (req.method === "POST" && req.url?.startsWith("/control/")) {
		handleControl(req.url, res);
		return;
	}

	const urlPath = req.url === "/" ? "/packages/websocket/playground/index.html" : req.url ?? "/";
	const filePath = path.join(frameworkRoot, decodeURIComponent(urlPath.split("?")[0]));
	if (!filePath.startsWith(frameworkRoot)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	try {
		const body = await readFile(filePath);
		res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
		res.end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
});

/** The most recently connected client — enough for a single-tab manual demo. */
let currentClient = null;

function handleControl(url, res) {
	if (!currentClient) {
		res.writeHead(409).end("no client connected");
		return;
	}
	if (url === "/control/kill") {
		console.log("[control] killing the current connection (simulated drop)");
		currentClient.socket.terminate();
	} else if (url === "/control/pause-heartbeat") {
		console.log("[control] pausing heartbeat — the client's 40s watchdog should now fire");
		clearInterval(currentClient.heartbeatTimer);
	} else if (url === "/control/resume-heartbeat") {
		console.log("[control] resuming heartbeat");
		startHeartbeat(currentClient);
	} else {
		res.writeHead(404).end("unknown control route");
		return;
	}
	res.writeHead(204).end();
}

function send(socket, frame) {
	socket.send(JSON.stringify(frame));
}

function startHeartbeat(client) {
	clearInterval(client.heartbeatTimer);
	client.heartbeatTimer = setInterval(() => {
		send(client.socket, { action: "ping", id: 0, data: null });
	}, HEARTBEAT_INTERVAL_MS);
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
	const client = { socket, heartbeatTimer: null };
	currentClient = client;
	console.log("[connect] client connected");

	send(socket, { action: "event", id: 0, data: { event: "server:welcome", params: { connectedAt: Date.now() } } });
	startHeartbeat(client);

	socket.on("message", (raw) => {
		let frame;
		try {
			frame = JSON.parse(raw.toString());
		} catch {
			console.log("[message] not JSON, ignoring:", raw.toString());
			return;
		}
		if (!validate(frame)) {
			console.log("[message] failed schema validation, ignoring:", JSON.stringify(validate.errors));
			return;
		}

		if (frame.action === "call") {
			console.log("[call]", frame.id, frame.data);
			setTimeout(() => {
				send(socket, { action: "call", id: frame.id, data: { echo: frame.data, serverTime: Date.now() } });
			}, 150);
		} else if (frame.action === "event") {
			console.log("[event]", frame.data?.event, frame.data?.params);
			for (const other of wss.clients) {
				if (other !== socket && other.readyState === other.OPEN) send(other, frame);
			}
		}
	});

	socket.on("close", () => {
		console.log("[disconnect] client disconnected");
		clearInterval(client.heartbeatTimer);
		if (currentClient === client) currentClient = null;
	});
});

server.listen(PORT, () => {
	console.log(`playground: http://localhost:${PORT}/packages/websocket/playground/index.html`);
	console.log(`websocket:  ws://localhost:${PORT}/ws`);
});
