import { renderer, v } from "./dist/core/vdom.js";

const ops = [];
function mkNode(tag) {
  return { tag, children: [], listeners: {}, parent: null };
}
function detach(n) {
  if (n.parent) {
    n.parent.children = n.parent.children.filter(c => c !== n);
    n.parent = null;
  }
}
const nodeApi = {
  create: (tag) => mkNode(tag),
  createText: (data) => ({ tag: "#text", data, parent: null }),
  setText: (n, data) => { n.data = data; },
  setAttribute: (n, k, v) => {},
  removeAttribute: (n, k) => {},
  setProperty: (n, k, v) => { n[k] = v; },
  setStyle: (n, k, v) => {},
  addEvent: (n, type, listener) => { ops.push(["addEvent", n.tag, type]); n.listeners[type] = listener; },
  removeEvent: (n, type) => { ops.push(["removeEvent", n.tag, type]); delete n.listeners[type]; },
  insertBefore: (parent, node, ref) => { detach(node); node.parent = parent; parent.children.push(node); },
  removeChild: (parent, node) => { ops.push(["removeChild", parent.tag, node.tag]); detach(node); },
};

const root = mkNode("root");
let show = true;
let clicked = 0;
const r = renderer(() => (show ? v("button", { onclick: () => clicked++ }, ["go"]) : null));
r.mount({ domNode: root, nodeApi, sync: true });

const btnNode = root.children[0];
console.log("mount ops:", JSON.stringify(ops));
btnNode.listeners.click && btnNode.listeners.click();
console.log("clicked after direct dispatch on mounted node:", clicked);

ops.length = 0;
show = false;
r.invalidate();
console.log("removal ops:", JSON.stringify(ops));
console.log("listener still present on detached node?", !!btnNode.listeners.click);
if (btnNode.listeners.click) btnNode.listeners.click();
console.log("clicked after direct dispatch on DETACHED node:", clicked);
