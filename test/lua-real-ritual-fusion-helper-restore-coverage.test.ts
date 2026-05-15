import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real Ritual and Fusion helper restore coverage", () => {
  it("keeps the representative Ritual/Fusion helper fixture inventory broad", () => {
    expect(representativeRitualFusionHelperFixtures()).toHaveLength(30);
  });

  it("requires representative Ritual/Fusion helper fixtures to assert clean Lua restore", () => {
    const missing = representativeRitualFusionHelperFixtures()
      .filter(({ file }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

function representativeRitualFusionHelperFixtures(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-machine-angel-absolute-grave-ritual.test.ts",
      required: [
        'operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]))',
        'summonType: "ritual"',
        "expect.arrayContaining([handMaterial!.uid, graveMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("machine angel absolute responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-nekroz-divinemirror-extra-deck-ritual.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }]',
        'summonType: "ritual"',
        "expect.arrayContaining([nekrozExtraMaterialA!.uid, nekrozExtraMaterialB!.uid])",
        "reason: duelReason.material | duelReason.ritual",
        'location: "extraDeck"',
        'expect(restored.host.messages).not.toContain("nekroz divinemirror responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-contract-dark-master-ritual-spell.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-branded-fusion-deck-material.test.ts",
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
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [dynaBase!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "getLegalActions(session, 0).find((action) => action.type === \"activateEffect\" && action.uid === dynaBase!.uid)).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }]',
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialC!.uid]",
        "summonMaterialUids: [exactMaterial!.uid]",
        "summonMaterialUids: [darkMagician!.uid]",
        "summonMaterialUids: [validMaterial!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-miracle-raven-self-ritual.test.ts",
      required: [
        "operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x200 }]))",
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
      ],
    },
    {
      file: "test/lua-real-script-mutiny-sky-shuffle-fusion-material.test.ts",
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
      required: [
        'operationInfos: [{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }]',
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-maftea-deck-ritual.test.ts",
      required: [
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        "restores non-sentinel SelectOption into Ritual extra material extraop",
        'expect(restored.host.messages).not.toContain("magikey maftea responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-megalith-unformed-deck-ritual.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("megalith unformed responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-advanced-ritual-art-extra-material.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toHaveLength(2)",
        "expect.arrayContaining([normalMaterialA!.uid, normalMaterialB!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-arcana-force-chaos-ruler-contact-fusion.test.ts",
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        "restores a Contact Fusion procedure that sends an opponent field material to its Graveyard",
      ],
    },
    {
      file: "test/lua-real-script-dark-fusion-stage2-protection.test.ts",
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
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual([ownFieldMaterial!.uid, opponentFieldMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "controller: 1, reason: duelReason.release | duelReason.material | duelReason.ritual",
      ],
    },
    {
      file: "test/lua-real-script-gladiator-beast-andabata-contact-fusion.test.ts",
      required: [
        'summonType: "special"',
        "summonTypeCode: luaSummonTypeSpecial + 1",
        "summonMaterialUids: [specificMaterial!.uid, gladiatorMaterialA!.uid, gladiatorMaterialB!.uid]",
        "reason: duelReason.cost | duelReason.material",
      ],
    },
    {
      file: "test/lua-real-script-high-ritual-art-deck-stage2.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        'summonType: "ritual"',
        "summonMaterialUids: [normalMaterial!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        "ownerType: \"card\", ownerId: ritualTarget!.uid",
        "reason: duelReason.effect",
      ],
    },
    {
      file: "test/lua-real-script-ladys-dragonmaid-contact-fusion.test.ts",
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [fieldMaterial!.uid, graveMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        "restores a Contact Fusion procedure that banishes selected field and Graveyard materials",
      ],
    },
    {
      file: "test/lua-real-script-vendread-reunion-custom-ritual.test.ts",
      required: [
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual(expect.arrayContaining([materialA!.uid, materialB!.uid]))",
        "reason: duelReason.release | duelReason.effect | duelReason.material | duelReason.ritual",
        "restores a custom Ritual operation that sets, releases, and Ritual Summons with banished materials",
      ],
    },
    {
      file: "test/lua-real-script-heavy-polymerization-partial-extraop.test.ts",
      required: [
        "expect(chainLink.operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]))",
        "expect(chainLink.possibleOperationInfos).toEqual(expect.arrayContaining([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }]))",
        'summonType: "fusion"',
        "summonMaterialUids: [handMaterialA!.uid, handMaterialB!.uid, extraMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "reason: duelReason.material | duelReason.fusion",
      ],
    },
    {
      file: "test/lua-real-script-fallen-of-albaz-opponent-fusion.test.ts",
      required: [
        "reason: duelReason.cost | duelReason.discard",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, opponentMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "does not expose the summon-success trigger when the Fusion target cannot use Albaz",
      ],
    },
    {
      file: "test/lua-real-script-miracle-fusion-extra-material.test.ts",
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
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [equippedMaterial!.uid, fiendMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        "restores a Contact Fusion procedure that sends selected materials as cost",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]',
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "summonMaterialUids: [goddess!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'expect(restored.host.messages).not.toContain("polymerization responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-prank-kids-pandemonium-stage2-oath.test.ts",
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
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "summonMaterialUids: [lightMaterialA!.uid, lightMaterialB!.uid]",
        "expect(restored.session.state.cards.find((card) => card.uid === darkMaterial!.uid)).toMatchObject({ location: \"hand\" })",
        "reason: duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("voiceless responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      required: [
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
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        "reason: duelReason.destroy | duelReason.effect",
      ],
    },
    {
      file: "test/lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
      required: [
        "expect(session.state.chain[0]!.operationInfos).toEqual(",
        'summonType: "fusion"',
        "summonMaterialUids: [darkMagician!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "does not expose the Fusion activation when no selected material is Dark Magician or Dark Magician Girl",
      ],
    },
    {
      file: "test/lua-real-script-super-soldier-synthesis-specific-material.test.ts",
      required: [
        'operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }]))',
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handLightMaterial!.uid, deckDarkMaterial!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("super soldier synthesis responder resolved")',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
