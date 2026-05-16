import { describe, expect, it } from "vitest";
import {
  bootstrapPvpDuel,
  pvpVisibleBattleFixtureScript,
  pvpVisibleBattleFixtureYdk,
  runPvpArenaVisibleScript,
} from "../src/playtest-app/pvp-arena.js";
import { createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";

const lazyLoadedYdk = `#created by test
#main
90000003
#extra
!side`;

describe("PvP arena visible scripts", () => {
  it("drives the browser arena fixture through visible actions", () => {
    const session = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-visible-script", 1);

    const result = runPvpArenaVisibleScript(session, pvpVisibleBattleFixtureScript);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.attacksDeclared).toHaveLength(1);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
  });

  it("can bootstrap from preloaded browser card data", async () => {
    const cache = createBrowserDuelCardDataCache(async () => [
      { code: "90000003", name: "Lazy Loaded Duelist", kind: "monster", attack: 2100 },
    ]);

    await cache.preload(["90000003"]);
    const session = bootstrapPvpDuel(lazyLoadedYdk, lazyLoadedYdk, "pvp-arena-lazy-card-data", 1, { cardReader: cache.reader });

    expect(session.state.cards).toContainEqual(expect.objectContaining({
      code: "90000003",
      name: "Lazy Loaded Duelist",
      data: expect.objectContaining({ attack: 2100 }),
    }));
  });
});
