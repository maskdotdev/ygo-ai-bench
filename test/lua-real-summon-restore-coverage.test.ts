import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const testRoot = path.join(root, "test");
const summonKeywords = ["summon", "fusion", "synchro", "xyz", "link", "ritual", "pendulum"];
const realScriptSummonFixtureCount = 160;
const summonProcedureFixtureCount = 20;
const typedSummonProcedureFixtureCount = 6;
const pendulumGrantFixtureCount = 4;
const pendulumHelperFixtureCount = 13;
const unionProcedureFixtureCount = 4;
const materialLockFixtureCount = 4;
const flipSummonSuccessTrapFixtureCount = 4;
const linkedZoneSpecialSummonFixtureCount = 1;
const realScriptSummonKeywordFamilyCounts = {
  fusion: 22,
  link: 12,
  pendulum: 17,
  ritual: 20,
  summon: 59,
  synchro: 16,
  xyz: 14,
} satisfies Record<RealScriptSummonKeywordFamily, number>;
const summonProcedureFamilyCounts = {
  fusionProcedure: 1,
  genericSpecialSummonProcedure: 10,
  pendulumProcedure: 1,
  ritualProcedure: 3,
  tributeProcedure: 2,
  typedProcedureFilter: 3,
} satisfies Record<SummonProcedureFamily, number>;
const typedSummonProcedureKindCounts = {
  fusionProcedure: 1,
  linkProcedure: 1,
  ritualProcedure: 2,
  synchroProcedure: 1,
  xyzProcedure: 1,
} satisfies Record<TypedSummonProcedureKind, number>;
const pendulumHelperKindCounts = {
  extraDeckGrant: 3,
  extraSummonCountGrant: 2,
  filteredSetcodeGrant: 3,
  handGrant: 1,
  pendulumSummonLock: 3,
  procedureAction: 1,
} satisfies Record<PendulumHelperKind, number>;
const pendulumGrantKindCounts = {
  extraDeckLocationGrant: 1,
  extraSummonCountGrant: 1,
  opponentScaleGrant: 1,
  opponentScaleSelectionGrant: 1,
} satisfies Record<PendulumGrantKind, number>;
const unionProcedureKindCounts = {
  battleTriggerSummonBack: 1,
  deckEquipBanish: 1,
  equipAndSummonBack: 1,
  equippedRitualSummon: 1,
} satisfies Record<SummonUnionProcedureKind, number>;
const materialLockKindCounts = {
  fusionMaterialLock: 1,
  genericMaterialLock: 1,
  linkMaterialLock: 1,
  xyzMaterialLock: 1,
} satisfies Record<SummonMaterialLockKind, number>;
const flipSummonSuccessTrapKindCounts = {
  flipBanishTrap: 1,
  flipDestroyTrap: 2,
  flipStatTrap: 1,
} satisfies Record<FlipSummonSuccessTrapKind, number>;
const linkedZoneSpecialSummonKindCounts = {
  releaseCostDeckSummon: 1,
} satisfies Record<LinkedZoneSpecialSummonKind, number>;

type SummonUnionProcedureKind =
  | "battleTriggerSummonBack"
  | "deckEquipBanish"
  | "equipAndSummonBack"
  | "equippedRitualSummon";

type SummonMaterialLockKind =
  | "fusionMaterialLock"
  | "genericMaterialLock"
  | "linkMaterialLock"
  | "xyzMaterialLock";

type FlipSummonSuccessTrapKind = "flipBanishTrap" | "flipDestroyTrap" | "flipStatTrap";
type LinkedZoneSpecialSummonKind = "releaseCostDeckSummon";
type RealScriptSummonKeywordFamily =
  | "fusion"
  | "link"
  | "pendulum"
  | "ritual"
  | "summon"
  | "synchro"
  | "xyz";
type SummonProcedureFamily =
  | "fusionProcedure"
  | "genericSpecialSummonProcedure"
  | "pendulumProcedure"
  | "ritualProcedure"
  | "tributeProcedure"
  | "typedProcedureFilter";
type TypedSummonProcedureKind =
  | "fusionProcedure"
  | "linkProcedure"
  | "ritualProcedure"
  | "synchroProcedure"
  | "xyzProcedure";
type PendulumHelperKind =
  | "extraDeckGrant"
  | "extraSummonCountGrant"
  | "filteredSetcodeGrant"
  | "handGrant"
  | "pendulumSummonLock"
  | "procedureAction";
type PendulumGrantKind =
  | "extraDeckLocationGrant"
  | "extraSummonCountGrant"
  | "opponentScaleGrant"
  | "opponentScaleSelectionGrant";

describe("Lua real summon restore coverage", () => {
  it("requires real-script summon and procedure fixtures to assert Lua-aware complete restore with diagnostics", () => {
    const files = realScriptSummonFixtureFiles();
    expect(files).toHaveLength(realScriptSummonFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")');
      });

    expect(missing).toEqual([]);
  });

  it("keeps real-script summon keyword families explicit", () => {
    expect(countRealScriptSummonKeywordFamilies(realScriptSummonFixtureFiles())).toEqual(realScriptSummonKeywordFamilyCounts);
  });

  it("requires real-script summon procedure fixtures to assert restored grouped legal actions", () => {
    const files = realScriptSummonProcedureFixtureFiles();
    expect(files).toHaveLength(summonProcedureFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps summon procedure fixture families explicit", () => {
    expect(countSummonProcedureFamilies(realScriptSummonProcedureFixtureFiles())).toEqual(summonProcedureFamilyCounts);
  });

  it("requires real-script typed summon procedure fixtures to prove restored summon type and Monster Zone placement", () => {
    const files = realScriptTypedSummonProcedureFixtureFiles();
    expect(files).toHaveLength(typedSummonProcedureFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/summonType:\s*["'](?:fusion|synchro|xyz|link|ritual)["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps typed summon procedure fixture kinds explicit", () => {
    expect(countTypedSummonProcedureKinds(realScriptTypedSummonProcedureFixtureFiles())).toEqual(typedSummonProcedureKindCounts);
  });

  it("requires real-script Pendulum grant fixtures to prove restored summon selection and consumption", () => {
    const files = realScriptPendulumGrantFixtureFiles();
    expect(files).toHaveLength(pendulumGrantFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("findPendulumSummon")
          || !text.includes("applyLuaRestoreAndAssert")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("pendulumSummonAvailable")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/summonType:\s*["']pendulum["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps Pendulum grant fixture kinds explicit", () => {
    expect(countPendulumGrantKinds(realScriptPendulumGrantFixtureFiles())).toEqual(pendulumGrantKindCounts);
  });

  it("requires representative Pendulum helper fixtures to pin restored grant filters and count limits", () => {
    const files = realScriptPendulumHelperFixtureSnippets();
    expect(files).toHaveLength(pendulumHelperFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps Pendulum helper fixture kinds explicit", () => {
    expect(countPendulumHelperKinds(realScriptPendulumHelperFixtureSnippets())).toEqual(pendulumHelperKindCounts);
  });

  it("requires representative Union procedure fixtures to pin restored equip and summon-back actions", () => {
    const files = realScriptUnionProcedureFixtureSnippets();
    expect(files).toHaveLength(unionProcedureFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps Union procedure fixture kinds explicit", () => {
    expect(countSummonUnionProcedureKinds(realScriptUnionProcedureFixtureSnippets())).toEqual(unionProcedureKindCounts);
  });

  it("requires representative material-lock fixtures to pin restored legal-action suppression and clean Lua restore", () => {
    const files = realScriptMaterialLockFixtureSnippets();
    expect(files).toHaveLength(materialLockFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps material-lock fixture kinds explicit", () => {
    expect(countSummonMaterialLockKinds(realScriptMaterialLockFixtureSnippets())).toEqual(materialLockKindCounts);
  });

  it("requires representative Flip Summon success trap fixtures to pin restored chain-response activations", () => {
    const files = realScriptFlipSummonSuccessTrapFixtureSnippets();
    expect(files).toHaveLength(flipSummonSuccessTrapFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventPreviousState")
          || !text.includes("eventCurrentState")
          || !text.includes("restored.session.state.chain).toHaveLength(0)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps Flip Summon success Trap fixture kinds explicit", () => {
    expect(countFlipSummonSuccessTrapKinds(realScriptFlipSummonSuccessTrapFixtureSnippets())).toEqual(flipSummonSuccessTrapKindCounts);
  });

  it("requires representative linked-zone Special Summon fixtures to pin player-scoped zones", () => {
    const files = realScriptLinkedZoneSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(linkedZoneSpecialSummonFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps linked-zone Special Summon fixture kinds explicit", () => {
    expect(countLinkedZoneSpecialSummonKinds(realScriptLinkedZoneSpecialSummonFixtureSnippets())).toEqual(linkedZoneSpecialSummonKindCounts);
  });
});

function realScriptSummonFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => summonKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}

function countRealScriptSummonKeywordFamilies(files: string[]): Record<RealScriptSummonKeywordFamily, number> {
  return files.reduce<Record<RealScriptSummonKeywordFamily, number>>(
    (counts, file) => {
      counts[classifyRealScriptSummonKeywordFamily(file)] += 1;
      return counts;
    },
    {
      fusion: 0,
      link: 0,
      pendulum: 0,
      ritual: 0,
      summon: 0,
      synchro: 0,
      xyz: 0,
    },
  );
}

function classifyRealScriptSummonKeywordFamily(file: string): RealScriptSummonKeywordFamily {
  const basename = path.basename(file);
  if (basename.includes("fusion")) return "fusion";
  if (basename.includes("link")) return "link";
  if (basename.includes("pendulum")) return "pendulum";
  if (basename.includes("ritual")) return "ritual";
  if (basename.includes("synchro")) return "synchro";
  if (basename.includes("xyz")) return "xyz";
  if (basename.includes("summon")) return "summon";
  throw new Error(`Unclassified real-script summon fixture: ${file}`);
}

function realScriptFlipSummonSuccessTrapFixtureSnippets(): Array<{
  file: string;
  kind: FlipSummonSuccessTrapKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      kind: "flipBanishTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        'location: "banished"',
        "category: 0x4",
        "bottomless flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      kind: "flipDestroyTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "house tape flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-adhesion-trap-hole-flip-summon.test.ts",
      kind: "flipStatTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "code === 103",
        "value: 500",
        "adhesion flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-flip-summon.test.ts",
      kind: "flipDestroyTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "duelReason.effect | duelReason.destroy",
        "trap hole flip chain starter resolved",
      ],
    },
  ];
}

function realScriptLinkedZoneSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: LinkedZoneSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-altergeist-primebanshee-linked-zone-special-summon.test.ts",
      kind: "releaseCostDeckSummon",
      required: [
        "GetLinkedZone(tp)",
        "release cost",
        'location: "monsterZone"',
        "sequence: 1",
        '"specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
      ],
    },
  ];
}

function countLinkedZoneSpecialSummonKinds(files: Array<{ kind: LinkedZoneSpecialSummonKind }>): Record<LinkedZoneSpecialSummonKind, number> {
  return files.reduce<Record<LinkedZoneSpecialSummonKind, number>>(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    {
      releaseCostDeckSummon: 0,
    },
  );
}

function realScriptSummonProcedureFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-(?:link|xyz|synchro)-procedure-filters\.test\.ts$/.test(file) || [
      "lua-real-script-chronomaly-moai-special-summon-procedure.test.ts",
      "lua-real-script-depth-shark-no-tribute-summon-procedure.test.ts",
      "lua-real-script-desert-twister-special-summon-procedure.test.ts",
      "lua-real-script-emissary-select-tribute-summon-procedure.test.ts",
      "lua-real-script-geira-guile-special-summon-procedure.test.ts",
      "lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
      "lua-real-script-guardian-eatos-special-summon-procedure.test.ts",
      "lua-real-script-leo-wizard-opponent-summon-procedure.test.ts",
      "lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
      "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
      "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
      "lua-real-script-morganite-field-summon-procedure.test.ts",
      "lua-real-script-palm-ryzeal-special-summon-procedure.test.ts",
      "lua-real-script-pankratops-special-summon-procedure.test.ts",
      "lua-real-script-pendulum-procedure-actions.test.ts",
      "lua-real-script-polymerization-fusion-summon.test.ts",
      "lua-real-script-prayers-ritual-matfilter.test.ts",
    ].includes(file))
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptTypedSummonProcedureFixtureFiles(): string[] {
  return [
    "lua-real-script-link-procedure-filters.test.ts",
    "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
    "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
    "lua-real-script-polymerization-fusion-summon.test.ts",
    "lua-real-script-synchro-procedure-filters.test.ts",
    "lua-real-script-xyz-procedure-filters.test.ts",
  ].map((file) => path.join("test", file));
}

function countSummonProcedureFamilies(files: string[]): Record<SummonProcedureFamily, number> {
  return files.reduce<Record<SummonProcedureFamily, number>>(
    (counts, file) => {
      counts[classifySummonProcedureFamily(file)] += 1;
      return counts;
    },
    {
      fusionProcedure: 0,
      genericSpecialSummonProcedure: 0,
      pendulumProcedure: 0,
      ritualProcedure: 0,
      tributeProcedure: 0,
      typedProcedureFilter: 0,
    },
  );
}

function classifySummonProcedureFamily(file: string): SummonProcedureFamily {
  const basename = path.basename(file);
  if (/^(lua-real-script-link-procedure-filters|lua-real-script-synchro-procedure-filters|lua-real-script-xyz-procedure-filters)\.test\.ts$/.test(basename)) return "typedProcedureFilter";
  if (basename === "lua-real-script-polymerization-fusion-summon.test.ts") return "fusionProcedure";
  if (/ritual/.test(basename)) return "ritualProcedure";
  if (basename === "lua-real-script-pendulum-procedure-actions.test.ts") return "pendulumProcedure";
  if (basename === "lua-real-script-emissary-select-tribute-summon-procedure.test.ts" || basename === "lua-real-script-morganite-field-summon-procedure.test.ts") return "tributeProcedure";
  if (basename.endsWith("-special-summon-procedure.test.ts") || basename === "lua-real-script-depth-shark-no-tribute-summon-procedure.test.ts" || basename === "lua-real-script-leo-wizard-opponent-summon-procedure.test.ts") return "genericSpecialSummonProcedure";
  throw new Error(`Unclassified summon procedure fixture: ${file}`);
}

function countTypedSummonProcedureKinds(files: string[]): Record<TypedSummonProcedureKind, number> {
  return files.reduce<Record<TypedSummonProcedureKind, number>>(
    (counts, file) => {
      counts[classifyTypedSummonProcedureKind(file)] += 1;
      return counts;
    },
    {
      fusionProcedure: 0,
      linkProcedure: 0,
      ritualProcedure: 0,
      synchroProcedure: 0,
      xyzProcedure: 0,
    },
  );
}

function classifyTypedSummonProcedureKind(file: string): TypedSummonProcedureKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-polymerization-fusion-summon.test.ts") return "fusionProcedure";
  if (basename === "lua-real-script-link-procedure-filters.test.ts") return "linkProcedure";
  if (basename === "lua-real-script-megalith-bethor-ritual-procedure.test.ts" || basename === "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts") return "ritualProcedure";
  if (basename === "lua-real-script-synchro-procedure-filters.test.ts") return "synchroProcedure";
  if (basename === "lua-real-script-xyz-procedure-filters.test.ts") return "xyzProcedure";
  throw new Error(`Unclassified typed summon procedure fixture: ${file}`);
}

function realScriptPendulumGrantFixtureFiles(): string[] {
  return [
    "lua-real-script-extra-pendulum-location-grant.test.ts",
    "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
    "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
    "lua-real-script-soul-pendulum-extra-summon.test.ts",
  ].map((file) => path.join("test", file));
}

function countPendulumGrantKinds(files: string[]): Record<PendulumGrantKind, number> {
  return files.reduce<Record<PendulumGrantKind, number>>(
    (counts, file) => {
      counts[classifyPendulumGrantKind(file)] += 1;
      return counts;
    },
    {
      extraDeckLocationGrant: 0,
      extraSummonCountGrant: 0,
      opponentScaleGrant: 0,
      opponentScaleSelectionGrant: 0,
    },
  );
}

function classifyPendulumGrantKind(file: string): PendulumGrantKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-extra-pendulum-location-grant.test.ts") return "extraDeckLocationGrant";
  if (basename === "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts") return "opponentScaleSelectionGrant";
  if (basename === "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts") return "opponentScaleGrant";
  if (basename === "lua-real-script-soul-pendulum-extra-summon.test.ts") return "extraSummonCountGrant";
  throw new Error(`Unclassified Pendulum grant fixture: ${file}`);
}

function realScriptPendulumHelperFixtureSnippets(): Array<{ file: string; kind: PendulumHelperKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-abyss-actor-twinkle-pendulum-setcode-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-setcode:\${setAbyssActor}\``,
        "twinkle abyss actor pendulum special 1",
        "twinkle generic pendulum special 0",
        "twinkle regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-couplet-pendulum-light-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-attribute:\${attributeLight}\``,
        "couplet light pendulum special 1",
        "couplet dark pendulum special 0",
        "couplet dark regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-odd-eyes-phantasma-pendulum-summon-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:special-summon-type-is:\${luaSummonTypePendulum}\``,
        "phantasma pendulum special 0",
        "phantasma regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-pendulum-procedure-actions.test.ts",
      kind: "procedureAction",
      required: [
        "findPendulumActivation",
        "const restoredPendulumWindow = restoreDuelWithLuaScripts",
        "const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find",
        'summonType: "pendulum"',
        "expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-soul-pendulum-extra-summon.test.ts",
      kind: "extraSummonCountGrant",
      required: [
        "session.state.players[0].pendulumSummonAvailable = false",
        "expect(findPendulumSummon(restored.session, getLuaRestoreLegalActions(restored, 0), candidate!.uid)).toBeUndefined()",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [candidate!.uid] })",
        'summonType: "pendulum"',
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-location-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), extraCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(extraPendulumCode) })]))",
        "expect(findExtraPendulumActivation(restoredAfterGrant.session, getLuaRestoreLegalActions(restoredAfterGrant, 0), secondExtraPendulum!.uid)).toBeUndefined()",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([",
        "expect.objectContaining({ locationMask: 0x40, scaleAlternatives: [expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })] })",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })])",
        "expect(pendulumSummon!.summonUids).toContain(extraCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-zefraath-special-summon-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setZefra })])",
        "expect(restored.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zefraathCode) })]))",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restored.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-moissa-knight-hand-pendulum-grant.test.ts",
      kind: "handGrant",
      required: [
        "expect(pendulumSummon!.summonUids).toContain(handCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(extraCandidate!.uid)",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [handCandidate!.uid] })",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-ddd-zeus-ragnarok-filtered-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zeusCode) })]))",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setDD })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-solfachord-happiness-filtered-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setSolfachord })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-blue-eyes-spirit-pendulum-count-limit.test.ts",
      kind: "extraSummonCountGrant",
      required: [
        "expect.objectContaining({ maxSummons: 4, summonUids: [first.uid, second.uid] })",
        "expect.objectContaining({ maxSummons: 1, summonUids: [first.uid, second.uid] })",
        "expect(applyResponse(session, { ...restrictedAction, summonUids: [first.uid, second.uid] }).ok).toBe(false)",
        'Debug.Message("spirit pendulum can " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))',
        'Debug.Message("spirit pendulum summoned " .. Duel.PendulumSummon(0))',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PendulumHelperKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countPendulumHelperKinds(
  fixtures: Array<{ kind: PendulumHelperKind }>,
): Record<PendulumHelperKind, number> {
  return fixtures.reduce<Record<PendulumHelperKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      extraDeckGrant: 0,
      extraSummonCountGrant: 0,
      filteredSetcodeGrant: 0,
      handGrant: 0,
      pendulumSummonLock: 0,
      procedureAction: 0,
    },
  );
}

function realScriptUnionProcedureFixtureSnippets(): Array<{
  file: string;
  kind: SummonUnionProcedureKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "equipAndSummonBack",
      required: [
        "getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068)",
        'location: "spellTrapZone", equippedToUid: target!.uid',
        "findEffectAction(restoredSummonWindow.session, getLuaRestoreLegalActions(restoredSummonWindow, 0), unionDriver!.uid, 2)",
        'location: "monsterZone"',
        "previousEquippedToUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "deckEquipBanish",
      required: [
        "const platformCode = \"23265594\"",
        "findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000)",
        'location: "banished", previousEquippedToUid: target!.uid',
        'location: "spellTrapZone", equippedToUid: target!.uid',
        "effect.sourceUid === platform!.uid && (effect.code === 76 || effect.code === 347)",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "equippedRitualSummon",
      required: [
        "const unionPilotCode = \"89357740\"",
        "findEffectActionByCategory(restoredEquippedState.session, getLuaRestoreLegalActions(restoredEquippedState, 0), unionPilot!.uid, 0x40200)",
        "previousEquippedToUid: target!.uid",
        '{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }',
        'eventName: "specialSummoned", eventCode: 1102',
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "battleTriggerSummonBack",
      required: [
        "const trigonCode = \"48568432\"",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), trigon!.uid, 1068)",
        'location: "spellTrapZone"',
        "equippedToUid: target!.uid",
        "passRestoredBattleResponsesUntilTrigger(restoredBattleWindow)",
        'eventName: "battleDestroyed"',
        "const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === \"activateTrigger\" && action.uid === trigon!.uid)",
        "expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveMachine!.uid)).toMatchObject",
        'summonType: "special"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonUnionProcedureKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function realScriptMaterialLockFixtureSnippets(): Array<{
  file: string;
  kind: SummonMaterialLockKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-mysterion-fusion-material-lock.test.ts",
      kind: "fusionMaterialLock",
      required: [
        "code: 235",
        'action.type === "fusionSummon"',
        "cannot be used as fusion material",
      ],
    },
    {
      file: "lua-real-script-doggy-diver-xyz-material-lock.test.ts",
      kind: "xyzMaterialLock",
      required: [
        "code: 238",
        'action.type === "xyzSummon"',
        "cannot be used as Xyz material",
      ],
    },
    {
      file: "lua-real-script-anger-knuckle-link-material-lock.test.ts",
      kind: "linkMaterialLock",
      required: [
        "code: 239",
        'action.type === "linkSummon"',
        "cannot be used as Link material",
      ],
    },
    {
      file: "lua-real-script-fallin-cheatah-generic-material-lock.test.ts",
      kind: "genericMaterialLock",
      required: [
        "code: 248",
        'action.type === "fusionSummon"',
        'action.type === "synchroSummon"',
        'action.type === "xyzSummon"',
        'action.type === "linkSummon"',
        "ritualSummonDuelCard",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonMaterialLockKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countSummonUnionProcedureKinds(
  fixtures: Array<{ kind: SummonUnionProcedureKind }>,
): Record<SummonUnionProcedureKind, number> {
  return fixtures.reduce<Record<SummonUnionProcedureKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleTriggerSummonBack: 0,
      deckEquipBanish: 0,
      equipAndSummonBack: 0,
      equippedRitualSummon: 0,
    },
  );
}

function countSummonMaterialLockKinds(
  fixtures: Array<{ kind: SummonMaterialLockKind }>,
): Record<SummonMaterialLockKind, number> {
  return fixtures.reduce<Record<SummonMaterialLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      fusionMaterialLock: 0,
      genericMaterialLock: 0,
      linkMaterialLock: 0,
      xyzMaterialLock: 0,
    },
  );
}

function countFlipSummonSuccessTrapKinds(
  fixtures: Array<{ kind: FlipSummonSuccessTrapKind }>,
): Record<FlipSummonSuccessTrapKind, number> {
  return fixtures.reduce<Record<FlipSummonSuccessTrapKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      flipBanishTrap: 0,
      flipDestroyTrap: 0,
      flipStatTrap: 0,
    },
  );
}
