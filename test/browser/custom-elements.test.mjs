// Real-browser smoke: decision 9 (framework-browser-smoke-spec.md) — property-first
// against a REAL, upgraded custom element. A mock DOM can fake `"name" in domNode`
// with a `defineProps` allowlist (see mock-dom.mjs), but only a real
// `customElements.define` proves the renderer plays correctly with actual custom
// element upgrade semantics.
import { v } from "../../dist/core/vdom.js";
import { cleanup, mountApp, assert, assertEqual } from "./helpers.mjs";

const TAG = "x-dj-smoke-probe";

if (!customElements.get(TAG)) {
	customElements.define(
		TAG,
		class extends HTMLElement {
			#data;
			#label = "";
			get data() {
				return this.#data;
			}
			set data(value) {
				this.#data = value;
			}
			get label() {
				return this.#label;
			}
			set label(value) {
				this.#label = value;
			}
		}
	);
}

describe("property-first on a real custom element (decision 9)", () => {
	afterEach(cleanup);

	it("a non-string value is set as a property, array identity intact, no attribute", () => {
		const payload = [1, 2];
		const { container } = mountApp(() => v(TAG, { data: payload }));
		const probe = container.querySelector(TAG);
		assert(probe.data === payload, "the exact array instance should land on the property");
		assertEqual(probe.hasAttribute("data"), false, "no stringified 'data' attribute should appear");
	});

	it("a string value with a matching instance property is ALSO set as a property (property-first)", () => {
		const { container } = mountApp(() => v(TAG, { label: "hello" }));
		const probe = container.querySelector(TAG);
		assertEqual(probe.label, "hello", "string value lands on the matching instance property");
		assertEqual(probe.hasAttribute("label"), false, "property-first: no attribute when the CE already has the property");
	});

	it("a string value with NO matching instance property still becomes a real attribute", () => {
		const { container } = mountApp(() => v(TAG, { "aria-label": "probe" }));
		const probe = container.querySelector(TAG);
		assertEqual(probe.getAttribute("aria-label"), "probe", "no matching instance property falls back to setAttribute");
	});
});
