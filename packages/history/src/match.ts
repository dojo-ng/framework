// Path matching. A separate export that navigation never calls (decision D10): mapping a path to a
// view stays the app's job, and this is only a helper for doing it.

function segments(path: string): string[] {
	const parts = path.split("/");
	if (parts[0] === "") parts.shift();
	if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
	return parts;
}

function decode(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

/**
 * Match a path against a pattern of static segments, `:name` params, and an optional trailing `*`.
 * Returns the params, or `null` when the path does not match. Params are decoded with
 * `decodeURIComponent`; a malformed escape is a non-match. A trailing slash on either side is
 * ignored. `*` takes the rest of the path, zero or more segments, under the key `"*"`.
 *
 * Pass a pathname. A `?query` or `#hash` is not stripped.
 */
export function match(pattern: string, path: string): Record<string, string> | null {
	const want = segments(pattern);
	const have = segments(path);
	const rest = want[want.length - 1] === "*";
	const fixed = rest ? want.slice(0, -1) : want;
	if (rest ? have.length < fixed.length : have.length !== fixed.length) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < fixed.length; i++) {
		const piece = fixed[i];
		if (piece.length > 1 && piece[0] === ":") {
			const value = decode(have[i]);
			if (value === null) return null;
			params[piece.slice(1)] = value;
		} else if (piece !== have[i]) {
			return null;
		}
	}
	if (rest) {
		const decoded: string[] = [];
		for (const part of have.slice(fixed.length)) {
			const value = decode(part);
			if (value === null) return null;
			decoded.push(value);
		}
		params["*"] = decoded.join("/");
	}
	return params;
}
