import { describe, expect, it } from "vitest";
import {
  createCardReader,
  createDuel,
  loadDecks,
  makeResponseSelector,
  moveDuelCard,
  normalizeCdbRows,
  parseBanlistConf,
  runScriptedDuelFixture,
  scriptFilenameForCard,
  startDuel,
  upstreamBanlistPath,
  upstreamDatabasePath,
  upstreamScriptPath,
} from "../src/engine/index.js";
import type { DuelCardData, ScriptedDuelFixture } from "../src/engine/index.js";
import { createLuaScriptHost } from "../src/engine/lua-host.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("normalizes card database rows and banlist entries", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 2500, def: 2100, level: 4, setcode: 0 },
        { id: 200, type: 2 },
        { id: 300, type: 4 },
      ],
      [
        { id: 100, name: "Fixture Monster" },
        { id: 200, name: "Fixture Spell" },
      ],
    );

    expect(cards.map((card) => card.kind)).toEqual(["monster", "spell", "trap"]);
    expect(cards[0]?.name).toBe("Fixture Monster");
    expect(scriptFilenameForCard(100)).toBe("c100.lua");
    const upstream = { root: ".upstream/ignis", coreUrl: "core", scriptsUrl: "scripts", databaseUrl: "db", lflistUrl: "lists" };
    expect(upstreamScriptPath(upstream, 100)).toBe(".upstream/ignis/script/c100.lua");
    expect(upstreamDatabasePath(upstream, "cards.cdb")).toBe(".upstream/ignis/cdb/cards.cdb");
    expect(upstreamBanlistPath(upstream, "lflist.conf")).toBe(".upstream/ignis/lflist.conf");
    expect(parseBanlistConf("100 1\n# comment\n200 0\n!header\n300 4")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);
  });

  it("runs a scripted duel fixture against the TypeScript engine", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "normal summon fixture",
        options: { seed: 4, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "400"] },
        },
        responses: [makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })],
        expected: {
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("selects extra deck scripted fixture responses by material uids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Fixture Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Fixture Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Fixture Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Fixture Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Fixture Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const fixtureBase = {
      options: { seed: 3, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["100", "300"] },
      },
    } satisfies Pick<ScriptedDuelFixture, "options" | "decks">;
    const materialUids = ["p0-deck-100-0", "p0-deck-300-1"];
    const fixtures: ScriptedDuelFixture[] = [
      {
        ...fixtureBase,
        name: "fusion fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["900"] } },
        responses: [makeResponseSelector("fusionSummon", 0, { code: "900", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["900"], graveyard: ["100", "300"] }, logIncludes: ["Fusion Summoned"] },
      },
      {
        ...fixtureBase,
        name: "synchro fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["910"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("synchroSummon", 0, { code: "910", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["910"], graveyard: ["100", "300"] }, logIncludes: ["Synchro Summoned"] },
      },
      {
        ...fixtureBase,
        name: "xyz fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["920"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("xyzSummon", 0, { code: "920", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["920"], overlay: ["100", "300"] }, logIncludes: ["Xyz Summoned"] },
      },
      {
        ...fixtureBase,
        name: "link fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["930"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("linkSummon", 0, { code: "930", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["930"], graveyard: ["100", "300"] }, logIncludes: ["Link Summoned"] },
      },
      {
        ...fixtureBase,
        name: "ritual fixture",
        options: { seed: 3, startingHandSize: 3 },
        decks: { ...fixtureBase.decks, 0: { main: ["100", "300", "940"] } },
        responses: [makeResponseSelector("ritualSummon", 0, { code: "940", location: "hand", materialUids })],
        expected: { locations: { monsterZone: ["940"], graveyard: ["100", "300"] }, logIncludes: ["Ritual Summoned"] },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
    }
  });

  it("lets Lua scripts invoke scaffolded summon helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Lua Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Lua Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Lua Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Lua Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const cases = [
      { label: "fusion", fn: "FusionSummon", target: "900", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_HAND", extra: ["900"], main: ["100", "300"] },
      { label: "synchro", fn: "SynchroSummon", target: "910", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["910"], main: ["100", "300"], field: true },
      { label: "xyz", fn: "XyzSummon", target: "920", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["920"], main: ["100", "300"], field: true },
      { label: "link", fn: "LinkSummon", target: "930", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["930"], main: ["100", "300"], field: true },
      { label: "ritual", fn: "RitualSummon", target: "940", targetLocation: "LOCATION_HAND", materials: "LOCATION_HAND", main: ["940", "100", "300"] },
    ];

    for (const current of cases) {
      const session = createDuel({ seed: 5, startingHandSize: current.main.length, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: current.main, extra: current.extra ?? [] },
        1: { main: ["100", "300", "100"] },
      });
      startDuel(session);
      if (current.field) {
        for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
          moveDuelCard(session.state, card.uid, "monsterZone", 0);
        }
      }

      const host = createLuaScriptHost(session);
      const result = host.loadScript(
        `
        local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${current.target}), 0, ${current.targetLocation}, 0, 1, 1, nil):GetFirst()
        local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, ${current.materials}, 0, 2, 2, target)
        Debug.Message("${current.label} " .. Duel.${current.fn}(target, materials))
        `,
        `${current.label}-summon.lua`,
      );

      expect(result.ok).toBe(true);
      expect(host.messages).toContain(`${current.label} 1`);
      expect(session.state.cards.find((card) => card.code === current.target)?.location).toBe("monsterZone");
    }
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_phase = Duel.GetCurrentPhase()
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalString("observed_phase")).toBe("main1");
    expect(host.messages).toContain("lua host online");
  });
});
