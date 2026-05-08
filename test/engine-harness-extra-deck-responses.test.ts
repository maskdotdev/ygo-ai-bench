import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro compatibility harness extra deck responses", () => {
  it("selects extra deck scripted fixture responses by material uids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster", typeFlags: 0x1001 },
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
        responses: [makeScriptedStep(makeResponseSelector("fusionSummon", 0, { code: "900", location: "extraDeck", materialUids }))],
        expected: { source: "edopro", locations: { monsterZone: ["900"], graveyard: ["100", "300"] }, logIncludes: ["Fusion Summoned"] },
      },
      {
        ...fixtureBase,
        name: "synchro fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["910"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("synchroSummon", 0, { code: "910", location: "extraDeck", materialUids }))],
        expected: { source: "edopro", locations: { monsterZone: ["910"], graveyard: ["100", "300"] }, logIncludes: ["Synchro Summoned"] },
      },
      {
        ...fixtureBase,
        name: "xyz fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["920"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("xyzSummon", 0, { code: "920", location: "extraDeck", materialUids }))],
        expected: { source: "edopro", locations: { monsterZone: ["920"], overlay: ["100", "300"] }, logIncludes: ["Xyz Summoned"] },
      },
      {
        ...fixtureBase,
        name: "link fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["930"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeScriptedStep(makeResponseSelector("linkSummon", 0, { code: "930", location: "extraDeck", materialUids }))],
        expected: { source: "edopro", locations: { monsterZone: ["930"], graveyard: ["100", "300"] }, logIncludes: ["Link Summoned"] },
      },
      {
        ...fixtureBase,
        name: "ritual fixture",
        options: { seed: 3, startingHandSize: 3 },
        decks: { ...fixtureBase.decks, 0: { main: ["100", "300", "940"] } },
        responses: [makeScriptedStep(makeResponseSelector("ritualSummon", 0, { code: "940", location: "hand", materialUids }))],
        expected: { source: "edopro", locations: { monsterZone: ["940"], graveyard: ["100", "300"] }, logIncludes: ["Ritual Summoned"] },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
    }
  });

  it("does not match duplicate material expectations against distinct material actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "920", name: "Fixture Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const materialUids = ["p0-deck-100-0", "p0-deck-300-1"];
    const fixture: ScriptedDuelFixture = {
      name: "duplicate material expectation fixture",
      options: { seed: 4, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"], extra: ["920"] },
        1: { main: ["100", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone" },
          { player: 0, code: "300", from: "hand", to: "monsterZone" },
        ],
      },
      responses: [],
      expected: {
        source: "edopro",
        legalActions: [{ type: "xyzSummon", player: 0, code: "920", location: "extraDeck", materialUids: [materialUids[0]!, materialUids[0]!], count: 1 }],
      },
    };

    const result = runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) });

    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.message.includes("Expected legal action"))).toBe(true);
  });
});
