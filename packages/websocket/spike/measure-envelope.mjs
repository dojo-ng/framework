/**
 * The measurement behind the envelope shape. Not part of the package (not in package.json "files",
 * not run by `npm test`) — a one-time spike, kept here for reproducibility, not as ongoing tooling.
 *
 * Compares the object envelope the dispatcher uses ({action, id, data}) against a
 * positional-array shape ([actionCode, id, data]) over a representative session, compressed both ways with raw DEFLATE and a per-message
 * Z_SYNC_FLUSH boundary — which is what permessage-deflate (RFC 7692) actually does on the wire: a
 * flush point per message, but the LZ77 window/dictionary carries over between messages unless
 * "no context takeover" was negotiated, which is not the default in most stacks. That carried-over
 * context is exactly what makes short repeated keys ("action", "event", "ping") cost almost nothing
 * after their first occurrence — measuring per-frame with a reset window would flatter positional
 * and misrepresent every stack that doesn't disable context takeover.
 *
 * Run: node spike/measure-envelope.mjs
 */
import { createDeflateRaw } from "node:zlib";
import { constants } from "node:zlib";

const ACTION_CODE = { ping: 0, event: 1, call: 2 };

/**
 * A representative session: the dispatcher's own test frames, repeated and varied into a plausible temporal
 * mix rather than a single sample of each. 120 frames — order matters (it's what a compression
 * context sees), not just the frame set.
 */
function buildSession() {
	const frames = [];

	// Identity handshake, sent once at connect (the onConnect hook).
	frames.push({ action: "event", id: 0, data: { event: "identify", params: { who: "session-1" } } });

	let nextId = 1;
	const topics = ["chat:message", "presence:update", "cursor:move", "doc:patch", "notify:event"];
	const rpcPayloads = [
		{ method: "getUser", args: [42] },
		{ method: "listDocs", args: [] },
		{ method: "saveDoc", args: [{ id: 7, title: "Q3 plan" }] },
		"ping-check",
		{ method: "search", args: ["dojo ng"] },
	];

	for (let i = 0; i < 120; i++) {
		const kind = i % 12;
		if (kind === 0) {
			// Server heartbeat, roughly every 12 frames.
			frames.push({ action: "ping", id: 0, data: null });
		} else if (kind % 4 === 1) {
			// An outbound call and its response, back to back — as a real session would interleave them.
			const id = nextId++;
			frames.push({ action: "call", id, data: rpcPayloads[i % rpcPayloads.length] });
			frames.push({ action: "call", id, data: { ok: true, result: i * 7 } });
		} else {
			// A named event, alternating direction (the direction doesn't change the frame shape).
			const topic = topics[i % topics.length];
			frames.push({ action: "event", id: 0, data: { event: topic, params: { seq: i, at: i * 33 } } });
		}
	}

	return frames;
}

function toPositional(frame) {
	return [ACTION_CODE[frame.action], frame.id, frame.data];
}

/** Compresses `messages` (already-encoded strings) as a single session, one Z_SYNC_FLUSH per message. */
async function compressedBytesPerMessage(messages) {
	const deflate = createDeflateRaw({ flush: constants.Z_SYNC_FLUSH });
	const sizes = [];
	let carried = 0;

	deflate.on("data", (chunk) => {
		carried += chunk.length;
	});

	for (const message of messages) {
		const before = carried;
		await new Promise((resolve, reject) => {
			deflate.write(message, (err) => (err ? reject(err) : undefined));
			deflate.flush(constants.Z_SYNC_FLUSH, () => resolve());
		});
		sizes.push(carried - before);
	}

	deflate.end();
	return sizes;
}

function sum(ns) {
	return ns.reduce((a, b) => a + b, 0);
}

async function main() {
	const session = buildSession();

	const objectEncoded = session.map((f) => JSON.stringify(f));
	const positionalEncoded = session.map((f) => JSON.stringify(toPositional(f)));

	const objectUncompressed = sum(objectEncoded.map((s) => Buffer.byteLength(s)));
	const positionalUncompressed = sum(positionalEncoded.map((s) => Buffer.byteLength(s)));

	const objectCompressedSizes = await compressedBytesPerMessage(objectEncoded);
	const positionalCompressedSizes = await compressedBytesPerMessage(positionalEncoded);
	const objectCompressed = sum(objectCompressedSizes);
	const positionalCompressed = sum(positionalCompressedSizes);

	const deltaBytes = objectCompressed - positionalCompressed;
	const deltaPct = (deltaBytes / positionalCompressed) * 100;

	console.log(`frames in session: ${session.length}`);
	console.log();
	console.log("uncompressed (would flatter positional — not the deciding number):");
	console.log(`  object:     ${objectUncompressed} bytes`);
	console.log(`  positional: ${positionalUncompressed} bytes`);
	console.log(`  positional is ${(((objectUncompressed - positionalUncompressed) / objectUncompressed) * 100).toFixed(1)}% smaller uncompressed`);
	console.log();
	console.log("compressed (raw DEFLATE, per-message Z_SYNC_FLUSH, context carried across the session):");
	console.log(`  object:     ${objectCompressed} bytes`);
	console.log(`  positional: ${positionalCompressed} bytes`);
	console.log(`  object is ${deltaBytes >= 0 ? deltaPct.toFixed(1) + "% larger" : (-deltaPct).toFixed(1) + "% smaller"} than positional, compressed`);
}

main();
