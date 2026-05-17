import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const representativeRitualFusionHelperFamilyCounts: Record<RitualFusionHelperFamily, number> = {
  fusion: 15,
  ritual: 16,
};
const representativeRitualFusionHelperKindCounts: Record<RitualFusionHelperKind, number> = {
  contactFusionBanish: 1,
  contactFusionCustomSummonType: 1,
  contactFusionOpponentMaterial: 1,
  contactFusionSendCost: 1,
  customRitualOperation: 1,
  fusionDeckMaterialOath: 1,
  fusionForcedHandler: 1,
  fusionFcheck: 1,
  fusionGraveBanishMaterial: 1,
  fusionHandMaterial: 1,
  fusionMaterialCheck: 1,
  fusionOpponentExtrafil: 1,
  fusionPartialExtraop: 1,
  fusionShuffleMaterial: 1,
  fusionStage2Oath: 1,
  fusionStage2Protection: 1,
  ritualDeckExtraop: 1,
  ritualEqualLevel: 1,
  ritualExtraDeckMaterial: 1,
  ritualExtraMaterialNormalDeck: 1,
  ritualGraveBanishMaterial: 1,
  ritualGreaterCode: 1,
  ritualGraveExtraMaterial: 1,
  ritualMaterialFilter: 1,
  ritualOpponentFieldMaterial: 1,
  ritualOperationReassigned: 1,
  ritualSelectOptionSumpos: 1,
  ritualSelfProcedure: 1,
  ritualSpecificMaterial: 1,
  ritualStage2: 2,
};

describe("Lua real Ritual and Fusion helper restore coverage", () => {
  it("keeps the representative Ritual/Fusion helper fixture inventory broad", () => {
    expect(representativeRitualFusionHelperFixtures()).toHaveLength(31);
  });

  it("keeps representative Ritual/Fusion helper fixture families balanced", () => {
    expect(countFixtureFamilies(representativeRitualFusionHelperFixtures())).toEqual(representativeRitualFusionHelperFamilyCounts);
  });

  it("keeps representative Ritual/Fusion helper fixture kinds explicit", () => {
    expect(countFixtureKinds(representativeRitualFusionHelperFixtures())).toEqual(representativeRitualFusionHelperKindCounts);
  });

  it("requires representative Ritual/Fusion helper fixtures to assert clean Lua restore", () => {
    const missing = representativeRitualFusionHelperFixtures()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative Ritual/Fusion helper fixtures to prove restored helper semantics", () => {
    const weak = representativeRitualFusionHelperFixtures()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

type RitualFusionHelperFamily = "fusion" | "ritual";
type RitualFusionHelperKind =
  | "contactFusionBanish"
  | "contactFusionCustomSummonType"
  | "contactFusionOpponentMaterial"
  | "contactFusionSendCost"
  | "customRitualOperation"
  | "fusionDeckMaterialOath"
  | "fusionForcedHandler"
  | "fusionFcheck"
  | "fusionGraveBanishMaterial"
  | "fusionHandMaterial"
  | "fusionMaterialCheck"
  | "fusionOpponentExtrafil"
  | "fusionPartialExtraop"
  | "fusionShuffleMaterial"
  | "fusionStage2Oath"
  | "fusionStage2Protection"
  | "ritualDeckExtraop"
  | "ritualEqualLevel"
  | "ritualExtraDeckMaterial"
  | "ritualExtraMaterialNormalDeck"
  | "ritualGraveBanishMaterial"
  | "ritualGreaterCode"
  | "ritualGraveExtraMaterial"
  | "ritualMaterialFilter"
  | "ritualOpponentFieldMaterial"
  | "ritualOperationReassigned"
  | "ritualSelectOptionSumpos"
  | "ritualSelfProcedure"
  | "ritualSpecificMaterial"
  | "ritualStage2";

function countFixtureFamilies(fixtures: Array<{ families: RitualFusionHelperFamily[] }>): Record<RitualFusionHelperFamily, number> {
  return fixtures
    .flatMap(({ families }) => families)
    .reduce<Record<RitualFusionHelperFamily, number>>(
      (counts, family) => ({ ...counts, [family]: counts[family] + 1 }),
      { fusion: 0, ritual: 0 },
    );
}

function countFixtureKinds(fixtures: Array<{ kind: RitualFusionHelperKind }>): Record<RitualFusionHelperKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(representativeRitualFusionHelperKindCounts).map((kind) => [kind, 0])) as Record<RitualFusionHelperKind, number>,
  );
}

function representativeRitualFusionHelperFixtures(): Array<{ file: string; kind: RitualFusionHelperKind; families: RitualFusionHelperFamily[]; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-machine-angel-absolute-grave-ritual.test.ts",
      kind: "ritualGraveExtraMaterial",
      families: ["ritual"],
      required: [
        'operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [handMaterial!.uid, graveMaterial!.uid]",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'eventName === "sentToDeck"',
        'expect(restored.host.messages).not.toContain("machine angel absolute responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-chaos-form-grave-ritual.test.ts",
      kind: "ritualGraveBanishMaterial",
      families: ["ritual"],
      required: [
        "restores a Ritual procedure that banishes a Graveyard Blue-Eyes material",
        "operationInfos).toEqual([",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        "{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x10 }",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([blueEyes!.uid])",
        'eventName === "specialSummoned"',
        'eventName === "banished"',
        "location: \"banished\", reason: duelReason.material | duelReason.ritual",
      ],
    },
    {
      file: "test/lua-real-script-nekroz-divinemirror-extra-deck-ritual.test.ts",
      kind: "ritualExtraDeckMaterial",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }])",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([nekrozExtraMaterialA!.uid, nekrozExtraMaterialB!.uid])",
        "reason: duelReason.material | duelReason.ritual",
        'location: "extraDeck"',
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("nekroz divinemirror responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-contract-dark-master-ritual-spell.test.ts",
      kind: "ritualGreaterCode",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-branded-fusion-deck-material.test.ts",
      kind: "fusionDeckMaterialOath",
      families: ["fusion"],
      required: [
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }",
        "{ category: 0x20, targetUids: [], count: 0, player: 0, parameter: 0x7 }",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "special-summon-limit:non-fusion-extra",
      ],
    },
    {
      file: "test/lua-real-script-dyna-base-forced-handler-fusion.test.ts",
      kind: "fusionForcedHandler",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [dynaBase!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === dynaBase!.uid",
        "getLegalActions(session, 0).find((action) => action.type === \"activateEffect\" && action.uid === dynaBase!.uid)).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "ritualEqualLevel",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialC!.uid]",
        "summonMaterialUids: [exactMaterial!.uid]",
        "summonMaterialUids: [darkMagician!.uid]",
        "summonMaterialUids: [validMaterial!.uid]",
        'eventName === "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-miracle-raven-self-ritual.test.ts",
      kind: "ritualSelfProcedure",
      families: ["ritual"],
      required: [
        "operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x200 }])",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x200 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-mutiny-sky-shuffle-fusion-material.test.ts",
      kind: "fusionShuffleMaterial",
      families: ["fusion"],
      required: [
        "restoredChainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "location: \"deck\"",
        'eventName: "moved"',
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      kind: "ritualSelectOptionSumpos",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }])",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToHand"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-maftea-deck-ritual.test.ts",
      kind: "ritualDeckExtraop",
      families: ["ritual"],
      required: [
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === deckNormalMaterial!.uid",
        "restores non-sentinel SelectOption into Ritual extra material extraop",
        'expect(restored.host.messages).not.toContain("magikey maftea responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-megalith-unformed-deck-ritual.test.ts",
      kind: "ritualOperationReassigned",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("megalith unformed responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-advanced-ritual-art-extra-material.test.ts",
      kind: "ritualExtraMaterialNormalDeck",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([normalMaterialB!.uid, normalMaterialA!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-arcana-force-chaos-ruler-contact-fusion.test.ts",
      kind: "contactFusionOpponentMaterial",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === opponentMaterial!.uid",
        "restores a Contact Fusion procedure that sends an opponent field material to its Graveyard",
      ],
    },
    {
      file: "test/lua-real-script-dark-fusion-stage2-protection.test.ts",
      kind: "fusionStage2Protection",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        "property: 0x10",
        'range: ["hand"]',
        "expect(getLuaRestoreLegalActions(restoredProtected, 1).find((action) => action.type === \"activateEffect\" && action.uid === opponentTarget!.uid)).toBeUndefined()",
        'expect(restoredProtected.host.messages).not.toContain("dark fusion target responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-forbidden-arts-gishki-opponent-ritual.test.ts",
      kind: "ritualOpponentFieldMaterial",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual([ownFieldMaterial!.uid, opponentFieldMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "controller: 1, reason: duelReason.release | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "effect.code === 101",
      ],
    },
    {
      file: "test/lua-real-script-gladiator-beast-andabata-contact-fusion.test.ts",
      kind: "contactFusionCustomSummonType",
      families: ["fusion"],
      required: [
        'summonType: "special"',
        "summonTypeCode: luaSummonTypeSpecial + 1",
        "summonMaterialUids: [specificMaterial!.uid, gladiatorMaterialA!.uid, gladiatorMaterialB!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "sentToDeck"',
        "event.eventCardUid === gladiatorMaterialB!.uid",
      ],
    },
    {
      file: "test/lua-real-script-high-ritual-art-deck-stage2.test.ts",
      kind: "ritualStage2",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [normalMaterial!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === normalMaterial!.uid",
        "ownerType: \"card\", ownerId: ritualTarget!.uid",
        "reason: duelReason.effect",
      ],
    },
    {
      file: "test/lua-real-script-ladys-dragonmaid-contact-fusion.test.ts",
      kind: "contactFusionBanish",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [fieldMaterial!.uid, graveMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "banished"',
        "event.eventCardUid === graveMaterial!.uid",
        "restores a Contact Fusion procedure that banishes selected field and Graveyard materials",
      ],
    },
    {
      file: "test/lua-real-script-vendread-reunion-custom-ritual.test.ts",
      kind: "customRitualOperation",
      families: ["ritual"],
      required: [
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual([materialA!.uid, materialB!.uid])",
        "reason: duelReason.release | duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === materialA!.uid",
        "event.eventCardUid === materialB!.uid",
        "expect(restored.host.messages).toEqual([",
        "restores a custom Ritual operation that sets, releases, and Ritual Summons with banished materials",
      ],
    },
    {
      file: "test/lua-real-script-heavy-polymerization-partial-extraop.test.ts",
      kind: "fusionPartialExtraop",
      families: ["fusion"],
      required: [
        "expect(chainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(chainLink.possibleOperationInfos).toEqual([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [handMaterialA!.uid, handMaterialB!.uid, extraMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "reason: duelReason.material | duelReason.fusion",
      ],
    },
    {
      file: "test/lua-real-script-fallen-of-albaz-opponent-fusion.test.ts",
      kind: "fusionOpponentExtrafil",
      families: ["fusion"],
      required: [
        "reason: duelReason.cost | duelReason.discard",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, opponentMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === opponentMaterial!.uid",
        "does not expose the summon-success trigger when the Fusion target cannot use Albaz",
      ],
    },
    {
      file: "test/lua-real-script-miracle-fusion-extra-material.test.ts",
      kind: "fusionGraveBanishMaterial",
      families: ["fusion"],
      required: [
        "expect(restoredChainLink.operationInfos).toEqual(",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "restores graveyard Fusion materials and banishes them through Fusion.BanishMaterial",
      ],
    },
    {
      file: "test/lua-real-script-necroquip-princess-contact-fusion.test.ts",
      kind: "contactFusionSendCost",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [equippedMaterial!.uid, fiendMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === fiendMaterial!.uid",
        "restores a Contact Fusion procedure that sends selected materials as cost",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "fusionHandMaterial",
      families: ["fusion"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]',
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "summonMaterialUids: [goddess!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "usedAsMaterial"',
        "event.eventCardUid === goddess!.uid",
        'expect(restored.host.messages).not.toContain("polymerization responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-prank-kids-pandemonium-stage2-oath.test.ts",
      kind: "fusionStage2Oath",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        'luaTargetDescriptor: "target:not-setcode:288"',
        "actions.some((action) => action.type === \"normalSummon\" && action.uid === nonPrankNormal!.uid)).toBe(false)",
        "actions.some((action) => action.type === \"specialSummonProcedure\" && action.uid === nonPrankSpecial!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-prayers-ritual-matfilter.test.ts",
      kind: "ritualMaterialFilter",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [lightMaterialA!.uid, lightMaterialB!.uid]",
        "expect(restored.session.state.cards.find((card) => card.uid === darkMaterial!.uid)).toMatchObject({ location: \"hand\" })",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === lightMaterialB!.uid",
        'expect(restored.host.messages).not.toContain("voiceless responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      kind: "fusionFcheck",
      families: ["fusion"],
      required: [
        "expect(restoredChainLink.operationInfos).toEqual([",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }",
        "{ category: 0x10, targetUids: [], count: 1, player: 0, parameter: 0x3c }",
        'summonType: "fusion"',
        "summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "does not expose Primite Fusion when the selected material set has no Normal Monster",
      ],
    },
    {
      file: "test/lua-real-script-rebirth-nephthys-stage2.test.ts",
      kind: "ritualStage2",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "sentToGraveyard"',
        "reason: duelReason.destroy | duelReason.effect",
      ],
    },
    {
      file: "test/lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
      kind: "fusionMaterialCheck",
      families: ["fusion"],
      required: [
        "expect(session.state.chain[0]!.operationInfos).toEqual([",
        "expect(restored.session.state.chain[0]!.operationInfos).toEqual([",
        'summonType: "fusion"',
        "summonMaterialUids: [darkMagician!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "does not expose the Fusion activation when no selected material is Dark Magician or Dark Magician Girl",
      ],
    },
    {
      file: "test/lua-real-script-super-soldier-synthesis-specific-material.test.ts",
      kind: "ritualSpecificMaterial",
      families: ["ritual"],
      required: [
        "{ category: 0x20, targetUids: [], count: 1, player: 0, parameter: 0x3 }",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handLightMaterial!.uid, deckDarkMaterial!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === handLightMaterial!.uid",
        'expect(restored.host.messages).not.toContain("super soldier synthesis responder resolved")',
      ],
    },
  ] satisfies Array<{ file: string; kind: RitualFusionHelperKind; families: RitualFusionHelperFamily[]; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}
