import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows, parseBanlistConf, scriptFilenameForCard, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath } from "#engine/data-loaders.js";
import { makeResponseSelector, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("normalizes card database rows and banlist entries", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 2500, def: 2100, level: 4, setcode: 0, race: 0x2, attribute: 0x20 },
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
    expect(cards[0]?.race).toBe(0x2);
    expect(cards[0]?.attribute).toBe(0x20);
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

  it("runs scripted battle-window fixtures against the TypeScript engine", () => {
    const battleCards: DuelCardData[] = [
      { code: "100", name: "Fixture Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Fixture Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Fixture Defender", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixtures: ScriptedDuelFixture[] = [
      {
        name: "direct attack pass fixture",
        options: { seed: 41, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        },
        responses: [
          makeResponseSelector("changePhase", 0, { phase: "battle" }),
          makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }),
          makeResponseSelector("passAttack", 1),
          makeResponseSelector("passAttack", 0),
          makeResponseSelector("passDamage", 1),
          makeResponseSelector("passDamage", 0),
        ],
        expected: {
          phase: "battle",
          lifePoints: { 1: 6200 },
          pendingBattle: false,
          currentAttack: false,
          locations: { monsterZone: ["100"] },
          logIncludes: ["Direct attack"],
        },
      },
      {
        name: "attack window quick fixture",
        options: { seed: 42, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "300"] },
          1: { main: ["400", "400"] },
        },
        setup: {
          moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
          effects: [
            {
              id: "fixture-attack-window-quick",
              player: 0,
              code: "300",
              location: "hand",
              event: "quick",
              range: ["hand"],
              oncePerTurn: true,
              logMessage: "Fixture attack-window quick resolved",
            },
          ],
        },
        responses: [
          makeResponseSelector("changePhase", 0, { phase: "battle" }),
          makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }),
          makeResponseSelector("passAttack", 1),
          makeResponseSelector("activateEffect", 0, { effectId: "fixture-attack-window-quick" }),
          makeResponseSelector("passAttack", 1),
          makeResponseSelector("passAttack", 0),
          makeResponseSelector("passDamage", 1),
          makeResponseSelector("passDamage", 0),
        ],
        expected: {
          phase: "battle",
          lifePoints: { 1: 6200 },
          pendingBattle: false,
          currentAttack: false,
          locations: { monsterZone: ["100"] },
          logIncludes: ["Fixture attack-window quick resolved", "Direct attack"],
        },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(battleCards) })).toEqual({ ok: true, failures: [] });
    }
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
});
