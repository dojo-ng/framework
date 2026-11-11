// Public entry point for @dojo-ng/websocket. `queue.ts`'s Queue is deliberately not re-exported
// from this file — everything else built here is meant to be used directly.
export { WSocket, ReadyState, SendState } from "./wsocket.js";
export type { WSocketEventMap } from "./wsocket.js";
export { WSDispatcher, WSCallError } from "./wsdispatcher.js";
export type { WSDispatcherOptions, WSCallOptions, WSCallErrorReason } from "./wsdispatcher.js";
