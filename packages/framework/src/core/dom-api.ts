/**
 * Real-DOM `nodeApi` for the renderer.
 *
 * The renderer (core/vdom) performs every DOM mutation through a `nodeApi`
 * object passed to `mount({ nodeApi })`, so it never touches `document`
 * directly and can be driven by a mock in tests. This module provides the
 * browser implementation: the 11 methods the renderer actually calls
 * (create, createText, setText, setAttribute, removeAttribute, setProperty,
 * setStyle, addEvent, removeEvent, insertBefore, removeChild).
 *
 * `removeEvent(node, type)` is called WITHOUT the original listener reference,
 * so the adapter keeps a per-node map of registered listeners (in a WeakMap,
 * so it doesn't retain detached nodes) and looks the handler up to call
 * `removeEventListener`. This mirrors the test mock's approach.
 */
import type { NodeApi } from "./vdom.js";

/**
 * Build a real-DOM nodeApi bound to `doc` (defaults to the global `document`).
 * Throws a clear error when called with no document available (e.g. in Node
 * with nothing passed) rather than a bare `ReferenceError`.
 */
export function createDomApi(doc?: Document): NodeApi {
	const d = doc ?? (typeof document !== "undefined" ? document : undefined);
	if (!d) {
		throw new Error(
			"createDomApi(): no document is available. Pass a Document explicitly when running outside a browser.",
		);
	}

	// node -> (event type -> listener), so removeEvent can find the handler to
	// detach even though it's given only the event type.
	const listeners = new WeakMap<EventTarget, Map<string, EventListenerOrEventListenerObject>>();

	return {
		create: (tag: string): Element => d.createElement(tag),
		createText: (data: string): Text => d.createTextNode(data),
		setText: (node: Text, data: string): void => {
			node.data = data;
		},
		setAttribute: (node: Element, name: string, value: string): void => {
			node.setAttribute(name, value);
		},
		removeAttribute: (node: Element, name: string): void => {
			node.removeAttribute(name);
		},
		setProperty: (node: any, name: string, value: unknown): void => {
			node[name] = value;
		},
		setStyle: (node: HTMLElement, name: string, value: string): void => {
			// Empty string clears the declaration, matching applyProp/removeProp.
			if (name.indexOf("-") !== -1) {
				node.style.setProperty(name, value);
			} else {
				(node.style as any)[name] = value ?? "";
			}
		},
		addEvent: (node: EventTarget, type: string, listener: EventListenerOrEventListenerObject): void => {
			let map = listeners.get(node);
			if (!map) listeners.set(node, (map = new Map()));
			// Detach any prior listener for this type first, so a re-register never
			// leaves two live listeners on the same node/type.
			const existing = map.get(type);
			if (existing) node.removeEventListener(type, existing);
			map.set(type, listener);
			node.addEventListener(type, listener);
		},
		removeEvent: (node: EventTarget, type: string): void => {
			const map = listeners.get(node);
			const listener = map?.get(type);
			if (listener) {
				node.removeEventListener(type, listener);
				map!.delete(type);
			}
		},
		insertBefore: (parent: Node, node: Node, ref: Node | null): void => {
			parent.insertBefore(node, ref ?? null);
		},
		removeChild: (parent: Node, node: Node): void => {
			parent.removeChild(node);
		},
	};
}
