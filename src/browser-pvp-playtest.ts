import { createDuelPvpAgent } from "#playtest/duel-pvp-agent-bridge.js";

declare global {
  interface Window {
    duelPvpPlaytest?: ReturnType<typeof createDuelPvpAgent>;
  }
}

window.duelPvpPlaytest = createDuelPvpAgent();
