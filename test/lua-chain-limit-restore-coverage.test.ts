import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const testRoot = path.join(root, "test");
const scannerPath = path.join(root, "tools/scan-lua-chain-limit-patterns.mjs");
const upstreamOfficialScriptRoot = path.join(root, ".upstream/ignis/script/official");
const noActiveRestoreWindowGroups = new Set(["SetChainLimit:aux.FALSE"]);
const realScriptChainLimitFixtureCount = 17;
const realScriptOwnedScannerGroupCount = 15;
const realScriptChainLimitKindCounts = {
  activationDenyAll: 2,
  activeTypeBlock: 5,
  effectTypeBlock: 3,
  handlerExclusion: 4,
  responseMatchesChainPlayer: 3,
} satisfies Record<RealScriptChainLimitKind, number>;
const realScriptChainLimitSemanticVariantCounts = {
  antiMagicArrowsAuxFalseActivationBlock: 1,
  borrelendResponseMatchesChainPlayer: 1,
  bucephalusUntilChainEndResponsePlayer: 1,
  darkMagicExpandedTemporaryChainingWatcher: 1,
  fancyBallLinkMonsterResponseBlock: 1,
  forbiddenCrownMonsterEffectResponseBlock: 1,
  forbiddenDropletOriginalTypeMaskResponseBlock: 1,
  galaxyDestroyerNamedActivationTypeBlock: 1,
  giantStarfallNoLevelMonsterResponseBlock: 1,
  goblinPotholeChainEndTrapHoleSetcodeBlock: 1,
  goblinPotholeClonedFieldTrapHoleSetcodeBlock: 1,
  goblinPotholeSummonSuccessTrapActivationBlock: 1,
  morganiteNormalSummonMonsterResponseBlock: 1,
  nightBeamSelectedHandlerBlock: 1,
  obeliskAuxFalseSummonSuccessBlock: 1,
  raHandlerOnlySummonSuccessBlock: 1,
  titanicGalaxyMultiTargetHandlerBlock: 1,
  tyrantOgreTargetedCardHandlerExclusion: 1,
  ultimateSlayerMonsterResponseBlock: 1,
} satisfies Record<RealScriptChainLimitSemanticVariant, number>;

const officialPatternRestoreCoverage: Record<string, string[]> = {
  "SetChainLimit:aux.FALSE": ["test/lua-real-script-anti-magic-arrows-chain-limit.test.ts"],
  "SetChainLimit:factory:handler-exclusion": ["test/lua-real-script-night-beam-chain-limit.test.ts"],
  "SetChainLimit:factory:response-chain-player": ["test/lua-real-script-forbidden-droplet-chain-limit.test.ts"],
  "SetChainLimit:inline:active-type": ["test/lua-real-script-forbidden-crown-chain-limit.test.ts"],
  "SetChainLimit:inline:handler-exclusion": ["test/lua-real-script-titanic-galaxy-chain-limit.test.ts"],
  "SetChainLimit:inline:response-chain-player": ["test/lua-real-script-borrelend-chain-limit.test.ts"],
  "SetChainLimit:inline:target-card-handler-exclusion": ["test/lua-real-script-tyrant-ogre-chain-limit.test.ts"],
  "SetChainLimit:named:active-type": ["test/lua-real-script-giant-starfall-chain-limit.test.ts"],
  "SetChainLimit:named:effect-type": ["test/lua-real-script-galaxy-destroyer-chain-limit.test.ts"],
  "SetChainLimit:named:response-chain-player": ["test/lua-real-script-dark-magic-expanded-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:aux.FALSE": ["test/lua-real-script-obelisk-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:factory:handler-only": ["test/lua-real-script-ra-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:inline:response-chain-player": ["test/lua-real-script-bucephalus-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:named:effect-type": ["test/lua-real-script-goblin-pothole-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:named:response-chain-player": ["test/lua-real-script-morganite-chain-limit.test.ts"],
};

const officialPatternCounts: Record<string, number> = {
  "SetChainLimit:aux.FALSE": 20,
  "SetChainLimit:factory:handler-exclusion": 4,
  "SetChainLimit:factory:response-chain-player": 1,
  "SetChainLimit:inline:active-type": 4,
  "SetChainLimit:inline:handler-exclusion": 4,
  "SetChainLimit:inline:response-chain-player": 11,
  "SetChainLimit:inline:target-card-handler-exclusion": 1,
  "SetChainLimit:named:active-type": 1,
  "SetChainLimit:named:effect-type": 3,
  "SetChainLimit:named:response-chain-player": 36,
  "SetChainLimitTillChainEnd:aux.FALSE": 7,
  "SetChainLimitTillChainEnd:factory:handler-only": 1,
  "SetChainLimitTillChainEnd:inline:response-chain-player": 11,
  "SetChainLimitTillChainEnd:named:effect-type": 7,
  "SetChainLimitTillChainEnd:named:response-chain-player": 30,
};

const officialScannerSummary = {
  filesWithCalls: 124,
  calls: 141,
  unclassifiedCalls: 0,
};

describe("Lua chain-limit restore coverage", () => {
  it.skipIf(!fs.existsSync(upstreamOfficialScriptRoot))("maps every official chain-limit scanner group to restore coverage", () => {
    const output = execFileSync(process.execPath, [scannerPath, "--scripts", upstreamOfficialScriptRoot, "--limit", "1000", "--fail-on-unclassified"], { encoding: "utf8" });
    const groups = scannerGroups(output);

    expect(scannerSummary(output)).toEqual(officialScannerSummary);
    expect(groups).toEqual(Object.keys(officialPatternRestoreCoverage).sort());
    expect(scannerGroupCounts(output)).toEqual(officialPatternCounts);
    for (const [group, files] of Object.entries(officialPatternRestoreCoverage)) {
      expect(files, group).not.toEqual([]);
      for (const file of files) {
        expect(fs.existsSync(path.join(root, file)), `${group} -> ${file}`).toBe(true);
        assertRestoreCoverageFile(group, file);
      }
    }
  }, 30_000);

  it("requires real-script chain-limit fixtures to assert complete restored registry coverage", () => {
    const files = realScriptChainLimitFixtureFiles();
    expect(files).toHaveLength(realScriptChainLimitFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps real-script chain-limit fixture kinds explicit", () => {
    expect(countRealScriptChainLimitKinds(realScriptChainLimitFixtureFiles())).toEqual(realScriptChainLimitKindCounts);
  });

  it("keeps named real-script chain-limit semantic variants explicit", () => {
    expect(countRealScriptChainLimitSemanticVariants(realScriptChainLimitSemanticVariants())).toEqual(realScriptChainLimitSemanticVariantCounts);

    const weak = realScriptChainLimitSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps most official chain-limit scanner groups owned by real-script fixtures", () => {
    const realScriptOwnedGroups = Object.values(officialPatternRestoreCoverage)
      .filter((files) => files.some((file) => file.includes("/lua-real-script-")))
      .length;

    expect(realScriptOwnedGroups).toBe(realScriptOwnedScannerGroupCount);
  });
});

type RealScriptChainLimitKind =
  | "activationDenyAll"
  | "activeTypeBlock"
  | "effectTypeBlock"
  | "handlerExclusion"
  | "responseMatchesChainPlayer";
type RealScriptChainLimitSemanticVariant =
  | "antiMagicArrowsAuxFalseActivationBlock"
  | "borrelendResponseMatchesChainPlayer"
  | "bucephalusUntilChainEndResponsePlayer"
  | "darkMagicExpandedTemporaryChainingWatcher"
  | "fancyBallLinkMonsterResponseBlock"
  | "forbiddenCrownMonsterEffectResponseBlock"
  | "forbiddenDropletOriginalTypeMaskResponseBlock"
  | "galaxyDestroyerNamedActivationTypeBlock"
  | "giantStarfallNoLevelMonsterResponseBlock"
  | "goblinPotholeChainEndTrapHoleSetcodeBlock"
  | "goblinPotholeClonedFieldTrapHoleSetcodeBlock"
  | "goblinPotholeSummonSuccessTrapActivationBlock"
  | "morganiteNormalSummonMonsterResponseBlock"
  | "nightBeamSelectedHandlerBlock"
  | "obeliskAuxFalseSummonSuccessBlock"
  | "raHandlerOnlySummonSuccessBlock"
  | "titanicGalaxyMultiTargetHandlerBlock"
  | "tyrantOgreTargetedCardHandlerExclusion"
  | "ultimateSlayerMonsterResponseBlock";

function assertRestoreCoverageFile(group: string, file: string): void {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const missing = [
    ["restoreDuelWithLuaScripts", text.includes("restoreDuelWithLuaScripts")],
    ["restoreComplete", text.includes("restoreComplete")],
    ["incomplete restore diagnostics", text.includes('incompleteReasons.join("; ")')],
    ["missingRegistryKeys", text.includes("missingRegistryKeys")],
    ["no missing Lua registry keys assertion", text.includes("missingRegistryKeys).toEqual([])")],
    ["missingChainLimitRegistryKeys", text.includes("missingChainLimitRegistryKeys")],
    ["no missing registry keys assertion", text.includes("missingChainLimitRegistryKeys).toEqual([])")],
    ["serialized chain-limit assertion", noActiveRestoreWindowGroups.has(group) || /state\.chainLimits\[0\][\s\S]{0,160}(registryKey|toMatchObject)/.test(text)],
    ["registered effect label assertion", group !== "SetChainLimit:inline:target-card-handler-exclusion" || text.includes("label: 1")],
    ["registered card-target property assertion", group !== "SetChainLimit:inline:target-card-handler-exclusion" || text.includes("property: 0x10")],
    ["restored legal-action assertion", text.includes("getLuaRestoreLegalActions") || text.includes("getLuaRestoreLegalActionGroups")],
    ["restored grouped legal-action assertion", text.includes("getLuaRestoreLegalActionGroups") && text.includes("getGroupedDuelLegalActions")],
    ["flattened grouped action assertion", text.includes("flatMap((group) => group.actions)") && text.includes("getLuaRestoreLegalActions")],
  ]
    .filter(([, present]) => !present)
    .map(([label]) => label);
  expect(missing, group).toEqual([]);
}

function scannerGroups(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\s+(SetChainLimit(?:TillChainEnd)?:\S+)/)?.[1])
    .filter((group): group is string => group !== undefined)
    .sort();
}

function scannerGroupCounts(output: string): Record<string, number> {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(SetChainLimit(?:TillChainEnd)?:\S+)/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[2]!, Number(match[1]!)]),
  );
}

function scannerSummary(output: string): typeof officialScannerSummary {
  const filesWithCalls = output.match(/^files with calls:\s*(\d+)$/m);
  const calls = output.match(/^calls:\s*(\d+)$/m);
  const unclassifiedCalls = output.match(/^unclassified calls:\s*(\d+)$/m);
  expect(filesWithCalls).not.toBeNull();
  expect(calls).not.toBeNull();
  expect(unclassifiedCalls).not.toBeNull();
  return {
    filesWithCalls: Number(filesWithCalls![1]),
    calls: Number(calls![1]),
    unclassifiedCalls: Number(unclassifiedCalls![1]),
  };
}

function realScriptChainLimitFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-.*chain-limit.*\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}

function countRealScriptChainLimitKinds(files: string[]): Record<RealScriptChainLimitKind, number> {
  return files.reduce<Record<RealScriptChainLimitKind, number>>(
    (counts, file) => {
      counts[classifyRealScriptChainLimitKind(file)] += 1;
      return counts;
    },
    {
      activationDenyAll: 0,
      activeTypeBlock: 0,
      effectTypeBlock: 0,
      handlerExclusion: 0,
      responseMatchesChainPlayer: 0,
    },
  );
}

function realScriptChainLimitSemanticVariants(): Array<{
  file: string;
  kind: RealScriptChainLimitSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-anti-magic-arrows-chain-limit.test.ts",
      kind: "antiMagicArrowsAuxFalseActivationBlock",
      required: [
        'const arrowsCode = "97120394"',
        "applies Anti-Magic Arrows' Project Ignis aux.FALSE activation response block",
        "state.chainLimits).toEqual([])",
        "blocked arrows responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-borrelend-chain-limit.test.ts",
      kind: "borrelendResponseMatchesChainPlayer",
      required: [
        'const sourceCode = "98630720"',
        "restores Project Ignis response-matches-chain-player limits from a real quick effect",
        "closure:response-matches-chain-player",
        "getLuaRestoreLegalActions(restored, 1)).toEqual([])",
        "chainPlayerQuick!.uid",
      ],
    },
    {
      file: "test/lua-real-script-bucephalus-chain-limit.test.ts",
      kind: "bucephalusUntilChainEndResponsePlayer",
      required: [
        'const sourceCode = "10019086"',
        "restores its summon-success until-chain-end response-player limit",
        "closure:response-matches-chain-player",
        "untilChainEnd: true",
        "bucephalus opponent quick resolved",
      ],
    },
    {
      file: "test/lua-real-script-dark-magic-expanded-chain-limit.test.ts",
      kind: "darkMagicExpandedTemporaryChainingWatcher",
      required: [
        'const darkMagicianCode = "46986414"',
        "restores its temporary EVENT_CHAINING watcher before the controller chains a Spell",
        "closure:response-matches-chain-player",
        "controller spell resolved",
        "ownQuick.uid",
      ],
    },
    {
      file: "test/lua-real-script-fancy-ball-chain-limit.test.ts",
      kind: "fancyBallLinkMonsterResponseBlock",
      required: [
        'const sourceCode = "4993187"',
        "restores the Project Ignis Link Monster response block from a real quick effect",
        "closure:not-active-monster-link",
        "blockedLink!.uid)).toBe(false)",
        "allowedSpell!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-forbidden-crown-chain-limit.test.ts",
      kind: "forbiddenCrownMonsterEffectResponseBlock",
      required: [
        'const sourceCode = "98829635"',
        "restores the monster-effect response block from the Project Ignis script",
        "closure:not-active-type:1",
        "blockedMonster!.uid)).toBe(false)",
        "allowedTrap!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-forbidden-droplet-chain-limit.test.ts",
      kind: "forbiddenDropletOriginalTypeMaskResponseBlock",
      required: [
        'const dropletCode = "24299458"',
        "restores Forbidden Droplet's cost type-mask response block and resolved stat effects",
        "closure:original-type-mask-response-player:2",
        "blocked spell response resolved",
        "allowed monster response resolved",
      ],
    },
    {
      file: "test/lua-real-script-galaxy-destroyer-chain-limit.test.ts",
      kind: "galaxyDestroyerNamedActivationTypeBlock",
      required: [
        'const sourceCode = "66523544"',
        "restores the named activation-type response block from the Project Ignis script",
        "closure:not-effect-type-response-player:16",
        "getLegalActions(session, 0)).toEqual([])",
        "opponentTrapResponder!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-giant-starfall-chain-limit.test.ts",
      kind: "giantStarfallNoLevelMonsterResponseBlock",
      required: [
        'const sourceCode = "43986064"',
        "restores the Project Ignis no-Level monster response block from a real Trap activation",
        "closure:not-monster-without-level",
        "blockedNoLevel!.uid)).toBe(false)",
        "allowedSpell!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-goblin-pothole-chain-limit.test.ts",
      kind: "goblinPotholeSummonSuccessTrapActivationBlock",
      required: [
        'const blockedTrapCode = "300"',
        "restores the summon-success Trap activation limit from the Project Ignis script",
        "closure:not-source-type-effect-type:4:16",
        "blockedTrap!.uid)).toBe(false)",
        "allowedTrap!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-goblin-pothole-chain-limit.test.ts",
      kind: "goblinPotholeClonedFieldTrapHoleSetcodeBlock",
      required: [
        'const summonedCode = "201"',
        "restores the cloned field Trap Hole activation limit from the Project Ignis script",
        "closure:not-source-type-effect-type-setcode:4:16:76",
        "blockedTrapHole!.uid)).toBe(false)",
        "allowedOffSetTrap!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-goblin-pothole-chain-limit.test.ts",
      kind: "goblinPotholeChainEndTrapHoleSetcodeBlock",
      required: [
        'const specialStarterCode = "211"',
        "restores the chain-end Trap Hole activation limit after a Project Ignis special-summon event",
        "specialTarget!.location).toBe(\"monsterZone\")",
        "blockedTrapHole!.uid)).toBe(false)",
        "allowedOffSetTrap!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-morganite-chain-limit.test.ts",
      kind: "morganiteNormalSummonMonsterResponseBlock",
      required: [
        'const sourceCode = "19403423"',
        "restores its Normal Summon until-chain-end monster response limit",
        "closure:not-active-type-response-player:1",
        "opponentMonster!.uid)).toBe(false)",
        "opponentSpell!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-night-beam-chain-limit.test.ts",
      kind: "nightBeamSelectedHandlerBlock",
      required: [
        'const sourceCode = "89882100"',
        "restores the selected handler response block from the Project Ignis script",
        "closure:card-not-handler",
        "blockedTarget!.uid)).toBe(false)",
        "allowedResponder!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-obelisk-chain-limit.test.ts",
      kind: "obeliskAuxFalseSummonSuccessBlock",
      required: [
        'const obeliskCode = "10000000"',
        "restores Obelisk's Project Ignis aux.FALSE summon-success chain limit",
        "known:aux.FALSE",
        "post-obelisk starter resolved",
        "blocked obelisk responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-ra-chain-limit.test.ts",
      kind: "raHandlerOnlySummonSuccessBlock",
      required: [
        'const raCode = "10000010"',
        "restores Ra's summon-success handler-only chain limit from the Project Ignis script",
        "closure:card-handler",
        "ra!.uid)).toBe(true)",
        "responder!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-titanic-galaxy-chain-limit.test.ts",
      kind: "titanicGalaxyMultiTargetHandlerBlock",
      required: [
        'const sourceCode = "16110708"',
        "restores the multi-target handler response block from the Project Ignis script",
        "closure:cards-not-handler",
        "blockedFirst!.uid)).toBe(false)",
        "blockedSecond!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-tyrant-ogre-chain-limit.test.ts",
      kind: "tyrantOgreTargetedCardHandlerExclusion",
      required: [
        'const sourceCode = "7782069"',
        "restores the Project Ignis targeted-card handler exclusion callback",
        "closure:target-cards-not-handler",
        "label: 1",
        "property: 0x10",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-slayer-chain-limit.test.ts",
      kind: "ultimateSlayerMonsterResponseBlock",
      required: [
        'const sourceCode = "2263869"',
        "restores the Project Ignis monster-response block while allowing chain-player monster responses",
        "closure:not-active-type-response-player:1",
        "blockedMonster!.uid)).toBe(false)",
        "chainPlayerMonster!.uid)).toBe(true)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: RealScriptChainLimitSemanticVariant;
    required: string[];
  }>);
}

function countRealScriptChainLimitSemanticVariants(
  variants: Array<{ kind: RealScriptChainLimitSemanticVariant }>,
): Record<RealScriptChainLimitSemanticVariant, number> {
  return variants.reduce<Record<RealScriptChainLimitSemanticVariant, number>>(
    (counts, variant) => {
      counts[variant.kind] += 1;
      return counts;
    },
    {
      antiMagicArrowsAuxFalseActivationBlock: 0,
      borrelendResponseMatchesChainPlayer: 0,
      bucephalusUntilChainEndResponsePlayer: 0,
      darkMagicExpandedTemporaryChainingWatcher: 0,
      fancyBallLinkMonsterResponseBlock: 0,
      forbiddenCrownMonsterEffectResponseBlock: 0,
      forbiddenDropletOriginalTypeMaskResponseBlock: 0,
      galaxyDestroyerNamedActivationTypeBlock: 0,
      giantStarfallNoLevelMonsterResponseBlock: 0,
      goblinPotholeChainEndTrapHoleSetcodeBlock: 0,
      goblinPotholeClonedFieldTrapHoleSetcodeBlock: 0,
      goblinPotholeSummonSuccessTrapActivationBlock: 0,
      morganiteNormalSummonMonsterResponseBlock: 0,
      nightBeamSelectedHandlerBlock: 0,
      obeliskAuxFalseSummonSuccessBlock: 0,
      raHandlerOnlySummonSuccessBlock: 0,
      titanicGalaxyMultiTargetHandlerBlock: 0,
      tyrantOgreTargetedCardHandlerExclusion: 0,
      ultimateSlayerMonsterResponseBlock: 0,
    },
  );
}

function classifyRealScriptChainLimitKind(file: string): RealScriptChainLimitKind {
  const basename = path.basename(file);
  if (
    basename === "lua-real-script-anti-magic-arrows-chain-limit.test.ts" ||
    basename === "lua-real-script-obelisk-chain-limit.test.ts"
  ) {
    return "activationDenyAll";
  }
  if (
    basename === "lua-real-script-forbidden-crown-chain-limit.test.ts" ||
    basename === "lua-real-script-fancy-ball-chain-limit.test.ts" ||
    basename === "lua-real-script-giant-starfall-chain-limit.test.ts" ||
    basename === "lua-real-script-morganite-chain-limit.test.ts" ||
    basename === "lua-real-script-ultimate-slayer-chain-limit.test.ts"
  ) {
    return "activeTypeBlock";
  }
  if (
    basename === "lua-real-script-forbidden-droplet-chain-limit.test.ts" ||
    basename === "lua-real-script-galaxy-destroyer-chain-limit.test.ts" ||
    basename === "lua-real-script-goblin-pothole-chain-limit.test.ts"
  ) {
    return "effectTypeBlock";
  }
  if (
    basename === "lua-real-script-night-beam-chain-limit.test.ts" ||
    basename === "lua-real-script-ra-chain-limit.test.ts" ||
    basename === "lua-real-script-titanic-galaxy-chain-limit.test.ts" ||
    basename === "lua-real-script-tyrant-ogre-chain-limit.test.ts"
  ) {
    return "handlerExclusion";
  }
  if (
    basename === "lua-real-script-borrelend-chain-limit.test.ts" ||
    basename === "lua-real-script-bucephalus-chain-limit.test.ts" ||
    basename === "lua-real-script-dark-magic-expanded-chain-limit.test.ts"
  ) {
    return "responseMatchesChainPlayer";
  }
  throw new Error(`Unclassified real-script chain-limit fixture: ${file}`);
}
