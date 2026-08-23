/**
 * In-memory mock DOM + complete `nodeApi` for testing/benchmarking the renderer
 * without a real-DOM library (jsdom/happy-dom can't be installed here, and the
 * interim renderer is CommonJS so it can't run in a browser yet). Zero deps.
 *
 * The renderer abstracts all DOM operations behind a `nodeApi` passed to
 * `mount({ nodeApi })`. This module implements the full method surface the
 * renderer calls, building a real in-memory tree so tests can assert on the
 * resulting structure and on the sequence of DOM operations.
 *
 * Children are stored as a DOUBLY-LINKED LIST (parent/prev/next/firstChild/
 * lastChild on the meta) so insertBefore / removeChild / replaceChild are O(1),
 * exactly like a real DOM. (An earlier array model made insertBefore O(n) via
 * indexOf, which turned an O(n) keyed reorder into O(n^2) wall-clock and masked
 * the renderer's true complexity in the benchmark.)
 *
 * Internal node model lives in a WeakMap (not on the node object) so that the
 * renderer's property-first check `propName in domNode` only sees real DOM
 * properties — element nodes carry DOM properties as their own keys, exactly
 * like a real element.
 */

export function createMockDom() {
	const meta = new WeakMap(); // node -> { type, tag?, data?, parent, prev, next, firstChild, lastChild, attrs, style, events }
	const supported = new Map(); // tag(lower) -> Set(propName): props this element "has"
	const opLog = [];
	let rafQueue = [];

	function element(tag) {
		const node = {}; // DOM properties live directly on this object
		// Real elements expose tagName/nodeType; the renderer's isElementNode
		// (`!!value.tagName`) and dom() rely on them. Non-enumerable so the
		// serializer (which lists enumerable own props) ignores them.
		Object.defineProperty(node, "tagName", { value: tag.toUpperCase(), enumerable: false, configurable: true });
		Object.defineProperty(node, "nodeType", { value: 1, enumerable: false, configurable: true });
		meta.set(node, {
			type: 1, tag: tag.toUpperCase(),
			parent: null, prev: null, next: null, firstChild: null, lastChild: null,
			attrs: {}, style: {}, events: {}
		});
		const props = supported.get(tag.toLowerCase());
		if (props) for (const p of props) if (!(p in node)) node[p] = undefined;
		return node;
	}
	function textNode(data) {
		const node = {};
		Object.defineProperty(node, "nodeType", { value: 3, enumerable: false, configurable: true });
		Object.defineProperty(node, "data", { value: data, enumerable: false, configurable: true, writable: true });
		meta.set(node, { type: 3, data, parent: null, prev: null, next: null });
		return node;
	}

	/** Ordered children of a node (walks the sibling links). */
	function childArray(node) {
		const out = [];
		let c = meta.get(node).firstChild;
		while (c) { out.push(c); c = meta.get(c).next; }
		return out;
	}

	const tagOf = (n) => { const m = meta.get(n); return m ? (m.type === 3 ? "#text" : m.tag.toLowerCase()) : "?"; };
	// Identify a node in op-sequence traces: prefer a `data-key` attribute, else
	// the node's first text content, else the bare tag.
	const labelOf = (n) => {
		const m = meta.get(n);
		if (!m) return "?";
		if (m.type === 3) return `#text"${m.data}"`;
		const key = m.attrs["data-key"];
		if (key != null) return `${m.tag.toLowerCase()}#${key}`;
		let c = m.firstChild;
		while (c) { if (meta.get(c).type === 3) return `${m.tag.toLowerCase()}"${meta.get(c).data}"`; c = meta.get(c).next; }
		return m.tag.toLowerCase();
	};

	/** Unlink a node from its current parent/siblings (O(1)). */
	function detach(node) {
		const m = meta.get(node);
		const p = m.parent;
		if (!p) return;
		const pm = meta.get(p);
		if (m.prev) meta.get(m.prev).next = m.next; else pm.firstChild = m.next;
		if (m.next) meta.get(m.next).prev = m.prev; else pm.lastChild = m.prev;
		m.parent = null; m.prev = null; m.next = null;
	}

	const root = element("div"); // the mount target

	const nodeApi = {
		getDocument: () => ({ createElement: element }),
		getBody: () => element("body"),
		getHead: () => element("head"),
		getTag: (n) => (n ? (meta.get(n)?.tag || "") : ""),
		create: (tag) => { opLog.push(["create", tag.toLowerCase()]); return element(tag); },
		createText: (data) => { opLog.push(["createText", data]); return textNode(data); },
		createWithNamespace: (_ns, tag) => element(tag),
		getProperty: (n, k) => n[k],
		setProperty: (n, k, v) => { opLog.push(["setProperty", tagOf(n), k, v]); n[k] = v; },
		setText: (n, data) => { opLog.push(["setText", data]); meta.get(n).data = data; if ("data" in n) n.data = data; },
		getAttribute: (n, k) => meta.get(n).attrs[k],
		setAttribute: (n, k, v) => { opLog.push(["setAttribute", tagOf(n), k, v]); meta.get(n).attrs[k] = v; },
		setAttributeWithNamespace: (n, _ns, k, v) => { meta.get(n).attrs[k] = v; },
		removeAttribute: (n, k) => { opLog.push(["removeAttribute", tagOf(n), k]); delete meta.get(n).attrs[k]; },
		setStyle: (n, k, v) => { meta.get(n).style[k] = v; },
		insertBefore: (parent, node, ref) => {
			opLog.push(["insertBefore", tagOf(parent), labelOf(node), ref ? labelOf(ref) : null]);
			detach(node);
			const pm = meta.get(parent);
			const m = meta.get(node);
			m.parent = parent;
			if (ref) {
				const rm = meta.get(ref);
				m.prev = rm.prev;
				m.next = ref;
				if (rm.prev) meta.get(rm.prev).next = node; else pm.firstChild = node;
				rm.prev = node;
			} else {
				m.prev = pm.lastChild;
				m.next = null;
				if (pm.lastChild) meta.get(pm.lastChild).next = node; else pm.firstChild = node;
				pm.lastChild = node;
			}
		},
		removeChild: (parent, node) => {
			opLog.push(["removeChild", tagOf(parent), labelOf(node)]);
			detach(node);
		},
		replaceChild: (parent, newN, oldN) => {
			opLog.push(["replaceChild", tagOf(parent), labelOf(newN), labelOf(oldN)]);
			detach(newN);
			const pm = meta.get(parent);
			const om = meta.get(oldN);
			const nm = meta.get(newN);
			nm.parent = parent; nm.prev = om.prev; nm.next = om.next;
			if (om.prev) meta.get(om.prev).next = newN; else pm.firstChild = newN;
			if (om.next) meta.get(om.next).prev = newN; else pm.lastChild = newN;
			om.parent = null; om.prev = null; om.next = null;
		},
		getChildren: (n) => childArray(n),
		getParent: (n) => meta.get(n).parent,
		contains: (parent, n) => { let p = n; while (p) { if (p === parent) return true; p = meta.get(p)?.parent; } return false; },
		addEvent: (n, type, listener) => { opLog.push(["addEvent", tagOf(n), type]); meta.get(n).events[type] = listener; },
		removeEvent: (n, type) => { opLog.push(["removeEvent", tagOf(n), type]); delete meta.get(n).events[type]; },
		requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
		cancelAnimationFrame: (id) => { rafQueue[id - 1] = null; },
		callProperty: (n, p) => { if (typeof n[p] === "function") n[p](); },
		isTextNode: (n) => meta.get(n)?.type === 3,
		equals: (a, b) => a === b
	};

	/** Declare which properties an element tag "supports" (so `prop in node` is
	 *  true — drives the property-first attribute-vs-property decision). */
	function defineProps(tag, props) { supported.set(tag.toLowerCase(), new Set(props)); }

	/** Serialize a node to a stable string: attributes (sorted) + set DOM
	 *  properties (sorted, `.`-prefixed, Lit-style) + children. */
	function serialize(node = root) {
		const m = meta.get(node);
		if (!m) return "";
		if (m.type === 3) return String(m.data);
		const tag = m.tag.toLowerCase();
		const attrs = Object.keys(m.attrs).sort()
			.map((k) => ` ${k}="${m.attrs[k]}"`).join("");
		const props = Object.keys(node).filter((k) => node[k] !== undefined).sort()
			.map((k) => ` .${k}=${JSON.stringify(node[k])}`).join("");
		const kids = childArray(node).map((c) => serialize(c)).join("");
		return `<${tag}${attrs}${props}>${kids}</${tag}>`;
	}

	/** Fire a named event on a node (calls the registered listener). */
	function fireEvent(node, type, event = {}) {
		const l = meta.get(node)?.events[type];
		if (l) l(event);
		return Boolean(l);
	}

	function flushRaf() { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb && cb()); }
	function clearOps() { opLog.length = 0; }
	function childrenOf(node) { return childArray(node); }
	function eventsOf(node) { return Object.keys(meta.get(node)?.events || {}); }

	return { nodeApi, root, serialize, opLog, clearOps, defineProps, fireEvent, flushRaf, childrenOf, eventsOf, meta, createElement: element, createTextNode: textNode };
}
