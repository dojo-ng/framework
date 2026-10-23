import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../../dist/index.js";
import { FakeWindow } from "./fake-window.mjs";

/**
 * A fresh bus, fake window, and installed history, destroyed when the test ends. `locations` is every
 * nav:location payload seen from install on.
 */
export function makeEnv(t, { window: windowInit, ...options } = {}) {
	const win = new FakeWindow(windowInit);
	const bus = createPubSub();
	const locations = [];
	bus.subscribe("nav:location", (loc) => locations.push(loc), { replay: false });
	const h = installHistory(bus, { window: win, ...options });
	t.after(() => h.destroy());
	return { win, bus, h, locations };
}
