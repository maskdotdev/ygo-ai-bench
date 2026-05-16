import { describe, expect, it } from "vitest";
import {
  bootstrapPvpDuel,
  pvpVisibleBattleFixtureScript,
  pvpVisibleBattleFixtureYdk,
  runPvpArenaVisibleScript,
} from "../src/playtest-app/pvp-arena.js";

describe("PvP arena visible scripts", () => {
  it("drives the browser arena fixture through visible actions", () => {
    const session = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-visible-script", 1);

    const result = runPvpArenaVisibleScript(session, pvpVisibleBattleFixtureScript);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.attacksDeclared).toHaveLength(1);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
  });
});
