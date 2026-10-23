// A window test double for installHistory, in the spirit of websocket's FakeWebSocket: an in-memory
// history stack that implements pushState, replaceState, back, forward, state and length; a
// location; popstate dispatch; an event target; a document that routes events up through shadow
// roots (honoring `bubbles` and `composed`); and an in-memory sessionStorage.
//
// Traversal (back/forward) is synchronous here. The real browser fires popstate a task later, and
// the real-browser test in test/browser/ is where that difference is checked.

class Listeners {
	#map = new Map();
	add(type, fn) {
		if (!this.#map.has(type)) this.#map.set(type, new Set());
		this.#map.get(type).add(fn);
	}
	remove(type, fn) {
		this.#map.get(type)?.delete(fn);
	}
	fire(type, event) {
		for (const fn of [...(this.#map.get(type) ?? [])]) fn(event);
	}
	count(type) {
		return this.#map.get(type)?.size ?? 0;
	}
}

/** A node in a tiny DOM: enough to dispatch a bubbling, composed event out of a shadow root. */
export class FakeNode {
	constructor({ parent = null, host = null } = {}) {
		this.parent = parent; // light-DOM parent
		this.host = host; // set on a shadow root: the element it belongs to
		this.shadowRoot = null;
		this._listeners = new Listeners();
	}
	addEventListener(type, fn) {
		this._listeners.add(type, fn);
	}
	removeEventListener(type, fn) {
		this._listeners.remove(type, fn);
	}
	listenerCount(type) {
		return this._listeners.count(type);
	}
	appendChild(child = new FakeNode()) {
		child.parent = this;
		return child;
	}
	attachShadow() {
		this.shadowRoot = new FakeNode({ host: this });
		return this.shadowRoot;
	}
	dispatchEvent(event) {
		let node = this;
		while (node) {
			node._listeners.fire(event.type, event);
			if (!event.bubbles) break;
			if (node.parent) node = node.parent;
			else if (node.host && event.composed) node = node.host;
			else node = null;
		}
		return true;
	}
}

/**
 * An element with just enough to test scroll and focus: an id, scroll offsets, attributes, focus,
 * a blur event, `contains`, and `matches` (focusable when it says so or has a tabindex).
 */
export class FakeElement extends FakeNode {
	constructor(document, { id = "", tagName = "div", focusable = false, scrollLeft = 0, scrollTop = 0 } = {}) {
		super();
		this.document = document;
		this.id = id;
		this.tagName = tagName.toUpperCase();
		this.focusable = focusable;
		this.scrollLeft = scrollLeft;
		this.scrollTop = scrollTop;
		this.attrs = new Map();
		this.focusCalls = [];
		this.scrolledIntoView = 0;
	}
	setAttribute(name, value) {
		this.attrs.set(name, String(value));
	}
	removeAttribute(name) {
		this.attrs.delete(name);
	}
	hasAttribute(name) {
		return this.attrs.has(name);
	}
	getAttribute(name) {
		return this.attrs.get(name) ?? null;
	}
	matches() {
		return this.focusable || this.attrs.has("tabindex");
	}
	contains(node) {
		for (let n = node; n; n = n.parent) if (n === this) return true;
		return false;
	}
	focus(options) {
		this.focusCalls.push(options);
		const previous = this.document.activeElement;
		this.document.activeElement = this;
		if (previous && previous !== this) previous.dispatchEvent(Object.assign(new Event("blur")));
	}
	blur() {
		if (this.document.activeElement === this) this.document.activeElement = null;
		this.dispatchEvent(new Event("blur"));
	}
	scrollIntoView() {
		this.scrolledIntoView++;
	}
	addEventListener(type, fn, options) {
		if (options?.once) {
			const once = (event) => {
				this.removeEventListener(type, once);
				fn(event);
			};
			super.addEventListener(type, once);
		} else super.addEventListener(type, fn);
	}
}

class FakeDocument extends FakeNode {
	visibilityState = "visible";
	activeElement = null;
	elements = [];
	/** Add an element to the page. */
	element(init) {
		const el = new FakeElement(this, init);
		this.elements.push(el);
		return el;
	}
	getElementById(id) {
		return this.elements.find((el) => el.id === id) ?? null;
	}
	/** Selectors here are `#id` or a tag name, comma separated: all the tests need. */
	querySelector(selector) {
		const wanted = selector.split(",").map((part) => part.trim());
		for (const el of this.elements) {
			if (wanted.some((part) => (part.startsWith("#") ? el.id === part.slice(1) : el.tagName.toLowerCase() === part))) return el;
		}
		return null;
	}
	setVisibility(state) {
		this.visibilityState = state;
		this.dispatchEvent(new Event("visibilitychange"));
	}
}

class FakeStorage {
	#data = new Map();
	getItem(key) {
		return this.#data.has(key) ? this.#data.get(key) : null;
	}
	setItem(key, value) {
		this.#data.set(key, String(value));
	}
}

export class FakeWindow {
	/**
	 * @param {object} [init]
	 * @param {string} [init.url] where the tab lands
	 * @param {unknown} [init.state] history.state of the landing entry (a reload keeps it)
	 * @param {boolean} [init.storage] false makes sessionStorage throw, as when site data is blocked
	 */
	constructor({ url = "http://example.test/", state = null, storage = true } = {}) {
		this._stack = [{ state: structuredClone(state), url: new URL(url) }];
		this._cursor = 0;
		this._listeners = new Listeners();
		/** Every pushState/replaceState call, in order, whoever made it. */
		this.calls = [];
		this.document = new FakeDocument();
		this.sessionStorage = storage ? new FakeStorage() : undefined;
		this.scrollX = 0;
		this.scrollY = 0;
		/** Every scrollTo call, in order. Calling it also moves scrollX/scrollY. */
		this.scrolls = [];
		this._frames = [];
		if (!storage) {
			Object.defineProperty(this, "sessionStorage", {
				get() {
					throw new Error("SecurityError: storage is blocked");
				},
			});
		}

		const self = this;
		// Bound functions report "[native code]" from Function.prototype.toString, which is what
		// installHistory looks for. A test patches one by assigning a plain function over it.
		this.history = {
			pushState: function pushState(state, _title, url) {
				self.calls.push({ type: "push", state, url });
				self._stack.splice(self._cursor + 1);
				self._stack.push({ state: structuredClone(state), url: self._resolve(url) });
				self._cursor++;
			}.bind(null),
			replaceState: function replaceState(state, _title, url) {
				self.calls.push({ type: "replace", state, url });
				self._stack[self._cursor] = {
					state: structuredClone(state),
					url: url === undefined || url === null ? self._stack[self._cursor].url : self._resolve(url),
				};
			}.bind(null),
			back: function back() {
				self._traverse(-1);
			}.bind(null),
			forward: function forward() {
				self._traverse(1);
			}.bind(null),
			go: function go(delta) {
				self.traversals.push(delta);
				self._traverse(delta);
			}.bind(null),
			scrollRestoration: "auto",
		};
		/** Every history.go(delta) call, in order. */
		this.traversals = [];
		Object.defineProperty(this.history, "state", { get: () => this._stack[this._cursor].state, enumerable: true });
		Object.defineProperty(this.history, "length", { get: () => this._stack.length, enumerable: true });
	}

	_resolve(url) {
		return url === undefined || url === null ? this._stack[this._cursor].url : new URL(url, this._stack[this._cursor].url);
	}

	_traverse(delta) {
		const next = this._cursor + delta;
		if (next < 0 || next >= this._stack.length || delta === 0) return;
		const before = this._stack[this._cursor].url.hash;
		this._cursor = next;
		this.dispatchEvent(Object.assign(new Event("popstate"), { state: this.history.state }));
		if (this._stack[this._cursor].url.hash !== before) this.dispatchEvent(new Event("hashchange"));
	}

	/** The user edits the address bar's hash, or clicks `<a href="#/x">`: a new entry with null state, popstate, then hashchange. */
	editHash(hash) {
		const url = new URL(this._stack[this._cursor].url);
		url.hash = hash;
		this._stack.splice(this._cursor + 1);
		this._stack.push({ state: null, url });
		this._cursor++;
		this.dispatchEvent(Object.assign(new Event("popstate"), { state: null }));
		this.dispatchEvent(new Event("hashchange"));
	}

	scrollTo(x, y) {
		this.scrolls.push([x, y]);
		this.scrollX = x;
		this.scrollY = y;
	}

	requestAnimationFrame(fn) {
		this._frames.push(fn);
		return this._frames.length;
	}

	/** Run the queued animation frames `count` times, then let promise callbacks run. */
	async settle(count = 2) {
		for (let i = 0; i < count; i++) {
			const batch = this._frames.splice(0);
			for (const fn of batch) fn();
		}
		await new Promise((resolve) => setImmediate(resolve));
	}

	get location() {
		const url = this._stack[this._cursor].url;
		return { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href };
	}

	/** The path (pathname + search + hash) of each entry, oldest first. */
	get paths() {
		return this._stack.map((entry) => entry.url.pathname + entry.url.search + entry.url.hash);
	}

	/** Calls of one type since `from` (an index into `calls`). */
	callsOf(type, from = 0) {
		return this.calls.slice(from).filter((call) => call.type === type);
	}

	addEventListener(type, fn) {
		this._listeners.add(type, fn);
	}
	removeEventListener(type, fn) {
		this._listeners.remove(type, fn);
	}
	listenerCount(type) {
		return this._listeners.count(type);
	}
	dispatchEvent(event) {
		this._listeners.fire(event.type, event);
	}
}
