import { createPlaytestAgent } from "./playtest/index.js";

declare global {
  interface Window {
    duelDeckPlaytest?: ReturnType<typeof createPlaytestAgent>;
  }
}

window.duelDeckPlaytest = createPlaytestAgent();
