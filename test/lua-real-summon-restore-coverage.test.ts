import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";
import {
  countFlipSummonSuccessTrapKinds,
  countLinkedZoneSpecialSummonKinds,
  countPendulumGrantKinds,
  countPendulumHelperKinds,
  countRealScriptSummonKeywordFamilies,
  countSelfTributeZoneSpecialSummonKinds,
  countSummonMaterialLockKinds,
  countSummonProcedureFamilies,
  countSummonSemanticVariants,
  countSummonUnionProcedureKinds,
  countTypedSummonProcedureKinds,
  flipSummonSuccessTrapFixtureCount,
  flipSummonSuccessTrapKindCounts,
  groupSummonSemanticVariantFiles,
  linkedZoneSpecialSummonFixtureCount,
  linkedZoneSpecialSummonKindCounts,
  materialLockFixtureCount,
  materialLockKindCounts,
  pendulumGrantFixtureCount,
  pendulumGrantKindCounts,
  pendulumHelperFixtureCount,
  pendulumHelperKindCounts,
  realScriptFlipSummonSuccessTrapFixtureSnippets,
  realScriptLinkedZoneSpecialSummonFixtureSnippets,
  realScriptMaterialLockFixtureSnippets,
  realScriptPendulumGrantFixtureFiles,
  realScriptPendulumHelperFixtureSnippets,
  realScriptSelfTributeZoneSpecialSummonFixtureSnippets,
  realScriptSummonFixtureCount,
  realScriptSummonFixtureFiles,
  realScriptSummonKeywordFamilyCounts,
  realScriptSummonProcedureFixtureFiles,
  realScriptTypedSummonProcedureFixtureFiles,
  realScriptUnionProcedureFixtureSnippets,
  selfTributeZoneSpecialSummonFixtureCount,
  selfTributeZoneSpecialSummonKindCounts,
  summonProcedureFamilyCounts,
  summonProcedureFixtureCount,
  summonSemanticVariantCounts,
  summonSemanticVariants,
  typedSummonProcedureFixtureCount,
  typedSummonProcedureKindCounts,
  unionProcedureFixtureCount,
  unionProcedureKindCounts,
} from "./lua-real-summon-restore-fixtures.js";
import {
  countDiscardTriggerSpecialSummonKinds,
  discardTriggerSpecialSummonFixtureCount,
  discardTriggerSpecialSummonKindCounts,
  realScriptDiscardTriggerSpecialSummonFixtureSnippets,
} from "./lua-real-discard-trigger-special-summon-restore-fixtures.js";
import {
  countForceMonsterZoneSummonLockKinds,
  forceMonsterZoneSummonLockKindCounts,
  realScriptForceMonsterZoneSummonLockFixtureSnippets,
} from "./lua-real-force-mzone-summon-restore-fixtures.js";
import {
  countFreeChainSpecialSummonKinds,
  freeChainSpecialSummonFixtureCount,
  freeChainSpecialSummonKindCounts,
  realScriptFreeChainSpecialSummonFixtureSnippets,
} from "./lua-real-free-chain-special-summon-restore-fixtures.js";
import {
  countIgnitionCostSpecialSummonKinds,
  ignitionCostSpecialSummonFixtureCount,
  ignitionCostSpecialSummonKindCounts,
  realScriptIgnitionCostSpecialSummonFixtureSnippets,
} from "./lua-real-ignition-cost-special-summon-restore-fixtures.js";
import {
  countReleaseCostSpecialSummonKinds,
  realScriptReleaseCostSpecialSummonFixtureSnippets,
  releaseCostSpecialSummonFixtureCount,
  releaseCostSpecialSummonKindCounts,
} from "./lua-real-release-cost-special-summon-restore-fixtures.js";

const root = process.cwd();

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

  it("requires representative self-tribute Special Summon fixtures to pin zone freeing", () => {
    const files = realScriptSelfTributeZoneSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(selfTributeZoneSpecialSummonFixtureCount);

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

  it("keeps self-tribute Special Summon fixture kinds explicit", () => {
    expect(countSelfTributeZoneSpecialSummonKinds(realScriptSelfTributeZoneSpecialSummonFixtureSnippets())).toEqual(selfTributeZoneSpecialSummonKindCounts);
  });

  it("requires representative release-cost Special Summon fixtures to pin release group costs", () => {
    const files = realScriptReleaseCostSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(releaseCostSpecialSummonFixtureCount);

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

  it("keeps release-cost Special Summon fixture kinds explicit", () => {
    expect(countReleaseCostSpecialSummonKinds(realScriptReleaseCostSpecialSummonFixtureSnippets())).toEqual(releaseCostSpecialSummonKindCounts);
  });

  it("requires representative free-chain Special Summon fixtures to pin hand selection and operation info", () => {
    const files = realScriptFreeChainSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(freeChainSpecialSummonFixtureCount);

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

  it("keeps free-chain Special Summon fixture kinds explicit", () => {
    expect(countFreeChainSpecialSummonKinds(realScriptFreeChainSpecialSummonFixtureSnippets())).toEqual(freeChainSpecialSummonKindCounts);
  });

  it("requires representative ignition-cost Special Summon fixtures to pin cost movement before self summon", () => {
    const files = realScriptIgnitionCostSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(ignitionCostSpecialSummonFixtureCount);

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

  it("keeps ignition-cost Special Summon fixture kinds explicit", () => {
    expect(countIgnitionCostSpecialSummonKinds(realScriptIgnitionCostSpecialSummonFixtureSnippets())).toEqual(ignitionCostSpecialSummonKindCounts);
  });

  it("requires representative discard-trigger Special Summon fixtures to pin mandatory to-Graveyard self summon restore", () => {
    const files = realScriptDiscardTriggerSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(discardTriggerSpecialSummonFixtureCount);

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

  it("keeps discard-trigger Special Summon fixture kinds explicit", () => {
    expect(countDiscardTriggerSpecialSummonKinds(realScriptDiscardTriggerSpecialSummonFixtureSnippets())).toEqual(discardTriggerSpecialSummonKindCounts);
  });

  it("requires representative force-Monster-Zone summon locks to pin restored zone counts", () => {
    const files = realScriptForceMonsterZoneSummonLockFixtureSnippets();

    const weak = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("keeps force-Monster-Zone summon lock fixture kinds explicit", () => {
    expect(countForceMonsterZoneSummonLockKinds(realScriptForceMonsterZoneSummonLockFixtureSnippets())).toEqual(forceMonsterZoneSummonLockKindCounts);
  });

  it("keeps named summon semantic variants explicit", () => {
    expect(countSummonSemanticVariants(summonSemanticVariants())).toEqual(summonSemanticVariantCounts);

    const empty = Object.entries(groupSummonSemanticVariantFiles(summonSemanticVariants()))
      .filter(([, files]) => files.length === 0)
      .map(([kind]) => kind);

    expect(empty).toEqual([]);
  });
});
