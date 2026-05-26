import "./browser-node-shims/process-global.js";
import { createPlaytestAgent } from "#playtest/agent-bridge.js";

declare global {
  interface Window {
    duelDeckPlaytest?: ReturnType<typeof createPlaytestAgent>;
  }
}

window.duelDeckPlaytest = createPlaytestAgent();
