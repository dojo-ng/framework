// Scroll restoration against a real scrolling page (H10), and focus after a go (H11). Scroll timing
// is where engines differ, so this file is part of Bill's three-engine run.
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../../dist/index.js";
import { assert, assertEqual, nextLocation, until } from "./helpers.mjs";

describe("@dojo-ng/history scroll and focus in a real browser", () => {
	let h;
	let tall;
	let panel;

	beforeEach(() => {
		tall = document.createElement("div");
		tall.style.cssText = "height:6000px;width:10px";
		document.body.append(tall);
		window.scrollTo(0, 0);
	});

	afterEach(() => {
		h?.destroy();
		h = undefined;
		tall.remove();
		panel?.remove();
		panel = undefined;
		window.scrollTo(0, 0);
	});

	it("Back returns the window to the offset it was left at, and a go lands at the top", async () => {
		h = installHistory(createPubSub(), { dwellMs: 0, scroll: true });
		assertEqual(history.scrollRestoration, "manual", "manual while installed");
		window.scrollTo(0, 800);
		await until(() => window.scrollY === 800, "page scrolled to 800");

		const arrived = nextLocation(h);
		h.go("/scroll-test/a");
		await arrived;
		await until(() => window.scrollY === 0, "a go scrolls to the top");

		window.scrollTo(0, 300);
		await until(() => window.scrollY === 300, "page scrolled to 300");
		const back = nextLocation(h);
		h.back();
		await back;
		await until(() => window.scrollY === 800, "Back restores 800");

		const forward = nextLocation(h);
		h.forward();
		await forward;
		await until(() => window.scrollY === 300, "Forward restores 300");

		h.destroy();
		h = undefined;
		assertEqual(history.scrollRestoration, "auto", "put back on destroy");
	});

	it("a scrolling element named in targets is restored too", async () => {
		panel = document.createElement("div");
		panel.id = "scroll-panel";
		panel.style.cssText = "height:100px;overflow:auto;position:fixed;top:0;left:0;width:100px";
		const inner = document.createElement("div");
		inner.style.height = "3000px";
		panel.append(inner);
		document.body.append(panel);

		h = installHistory(createPubSub(), { dwellMs: 0, scroll: { targets: () => [panel] } });
		panel.scrollTop = 450;
		await until(() => panel.scrollTop === 450, "panel scrolled");

		const arrived = nextLocation(h);
		h.go("/scroll-test/p");
		await arrived;
		panel.scrollTop = 0;
		const back = nextLocation(h);
		h.back();
		await back;
		await until(() => panel.scrollTop === 450, "panel offset restored");
	});

	it("a shadow-root scroller registered with scrollTarget is restored, even when re-created after Back", async () => {
		// Like dj-split-panel: the scroller is in a shadow root, has no id, and is named by key.
		const makeHost = (key) => {
			const host = document.createElement("div");
			host.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px";
			const pane = document.createElement("div");
			pane.style.cssText = "height:100px;overflow:auto";
			pane.innerHTML = '<div style="height:3000px"></div>';
			host.attachShadow({ mode: "open" }).append(pane);
			document.body.append(host);
			return { host, pane, unregister: h.scrollTarget(key, pane) };
		};
		h = installHistory(createPubSub(), { dwellMs: 0, scroll: true });
		let view = makeHost("shadow:start");
		panel = view.host;
		view.pane.scrollTop = 350;
		await until(() => view.pane.scrollTop === 350, "pane scrolled");

		let arrived = nextLocation(h);
		h.go("/scroll-test/s");
		await arrived;
		view.pane.scrollTop = 0;
		let back = nextLocation(h);
		h.back();
		await back;
		await until(() => view.pane.scrollTop === 350, "pane offset restored by key");

		// Leave again, drop the view, and re-create it as the Back arrives.
		arrived = nextLocation(h);
		h.go("/scroll-test/s2");
		await arrived;
		view.unregister();
		view.host.remove();
		back = nextLocation(h);
		h.back();
		await back;
		view = makeHost("shadow:start");
		panel = view.host;
		await until(() => view.pane.scrollTop === 350, "re-created pane gets the saved offset");
		view.unregister();
	});

	it("after a go, focus moves to the matched heading and the page can be read from it", async () => {
		const heading = document.createElement("h1");
		heading.id = "focus-heading";
		heading.textContent = "Orders";
		document.body.append(heading);
		try {
			h = installHistory(createPubSub(), { dwellMs: 0, focus: "#focus-heading" });
			h.go("/scroll-test/f");
			await until(() => document.activeElement === heading, "heading focused");
			assertEqual(heading.getAttribute("tabindex"), "-1", "made focusable");
			heading.blur();
			assert(!heading.hasAttribute("tabindex"), "tabindex removed on blur");
		} finally {
			heading.remove();
		}
	});
});
