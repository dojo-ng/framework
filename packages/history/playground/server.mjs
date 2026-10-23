// Static server for the @dojo-ng/history playground. Not part of the package: dev tooling only,
// run with `npm run playground`. Real paths need the server to answer every route with the app,
// so this serves the files under /packages/ as they are and answers every other GET with
// index.html (the SPA fallback). That is what lets you reload on /orders/7 and land on that view.
//
// Run: cd packages/history && npm run playground, then open http://localhost:8902/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8902);
const here = path.dirname(fileURLToPath(import.meta.url));
const frameworkRoot = path.resolve(here, "../../.."); // packages/history/playground -> framework/
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".map": "application/json" };

const server = createServer(async (req, res) => {
	const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
	if (urlPath.startsWith("/packages/")) {
		const filePath = path.join(frameworkRoot, urlPath);
		if (!filePath.startsWith(frameworkRoot + path.sep)) {
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
		return;
	}
	// The SPA fallback: every other route is the app.
	const page = await readFile(path.join(here, "index.html"));
	res.writeHead(200, { "content-type": "text/html" });
	res.end(page);
});

server.listen(PORT, () => {
	console.log(`playground: http://localhost:${PORT}/  (every route serves the app; try /orders/7 and reload)`);
});
