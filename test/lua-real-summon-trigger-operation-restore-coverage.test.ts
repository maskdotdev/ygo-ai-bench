import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonTriggerOperationFixtureCount = 9;
const summonTriggerOperationKindCounts = {
  summonDraw: 1,
  summonMassDestroy: 1,
  summonSearch: 3,
  summonSearchSelfSummon: 1,
  summonToDeck: 1,
  summonToHandBounce: 2,
} satisfies Record<SummonTriggerOperationKind, number>;
const summonTriggerOperationSemanticVariantCounts = {
  aratamaSpiritSearchOnSummon: 1,
  darkDustSpiritMassDestroyOnSummon: 1,
  gishkiNataliaGraveToDeckTopOnSummon: 1,
  hanShiKyudoColumnReturnOnSummon: 1,
  ichikiSayoriHimeEffectSummonSearch: 1,
  izanamiDiscardGraveSpiritReturnOnSummon: 1,
  shinobaronessShadePeacockSearchSelfSummon: 1,
  shinobirdCraneDrawOnSpiritSummon: 1,
  yakshaBackrowReturnOnSummon: 1,
} satisfies Record<SummonTriggerOperationSemanticVariant, number>;

type SummonTriggerOperationKind =
  | "summonDraw"
  | "summonMassDestroy"
  | "summonSearch"
  | "summonSearchSelfSummon"
  | "summonToDeck"
  | "summonToHandBounce";
type SummonTriggerOperationSemanticVariant =
  | "aratamaSpiritSearchOnSummon"
  | "darkDustSpiritMassDestroyOnSummon"
  | "gishkiNataliaGraveToDeckTopOnSummon"
  | "hanShiKyudoColumnReturnOnSummon"
  | "ichikiSayoriHimeEffectSummonSearch"
  | "izanamiDiscardGraveSpiritReturnOnSummon"
  | "shinobaronessShadePeacockSearchSelfSummon"
  | "shinobirdCraneDrawOnSpiritSummon"
  | "yakshaBackrowReturnOnSummon";

describe("Lua real summon-trigger operation restore coverage", () => {
  it("requires summon-trigger operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = summonTriggerOperationFixtureFiles();
    expect(files).toHaveLength(summonTriggerOperationFixtureCount);

    const missing = files
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
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon-trigger operation fixture kinds explicit", () => {
    expect(countSummonTriggerOperationKinds(summonTriggerOperationFixtureFiles())).toEqual(summonTriggerOperationKindCounts);
  });

  it("keeps named summon-trigger operation semantic variants explicit", () => {
    expect(countSummonTriggerOperationSemanticVariants(summonTriggerOperationSemanticVariants())).toEqual(
      summonTriggerOperationSemanticVariantCounts,
    );

    const weak = summonTriggerOperationSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function summonTriggerOperationFixtureFiles(): Array<{
  file: string;
  kind: SummonTriggerOperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "summonDraw",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "cardsDrawn"',
        "category: 65536",
        "targetParam: 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "summonMassDestroy",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "destroyed"',
        "category: 0x1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "discarded"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredOpenWindow.missingRegistryKeys).toEqual([])",
        "restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 256",
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "summonSearchSelfSummon",
      required: [
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDraw.missingRegistryKeys).toEqual([])",
        "restoredDraw.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "specialSummoned"',
        'eventName: "sentToHand"',
        'eventName: "phaseStandby"',
        "category: 8",
        "category: 512",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "possibleOperationInfos",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "summonToDeck",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToDeck"',
        "category: 16",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonTriggerOperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function summonTriggerOperationSemanticVariants(): Array<{
  file: string;
  kind: SummonTriggerOperationSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      kind: "aratamaSpiritSearchOnSummon",
      requiredSnippets: [
        'const aratamaCode = "16889337"',
        "restores its summon trigger and searches a Spirit monster from Deck",
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "darkDustSpiritMassDestroyOnSummon",
      requiredSnippets: [
        'const darkDustCode = "89111398"',
        "restores its Spirit summon trigger and destroys all other face-up monsters",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "gishkiNataliaGraveToDeckTopOnSummon",
      requiredSnippets: [
        'const nataliaCode = "17241370"',
        "restores its summon trigger and returns a targeted Gishki monster from the Graveyard to the Deck top",
        'eventName: "sentToDeck"',
      ],
    },
    {
      file: "test/lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "hanShiKyudoColumnReturnOnSummon",
      requiredSnippets: [
        'const hanShiCode = "53270092"',
        "restores its summon trigger and returns Pendulum Zone columns to hand without resolving the responder",
        "possibleOperationInfos",
      ],
    },
    {
      file: "test/lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "ichikiSayoriHimeEffectSummonSearch",
      requiredSnippets: [
        'const ichikiCode = "9627299"',
        "restores its hand ignition Normal Summon and summon-trigger 800-stat Deck search",
        "category: 256",
        "category: 8",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "izanamiDiscardGraveSpiritReturnOnSummon",
      requiredSnippets: [
        'const izanamiCode = "43543777"',
        "restores its summon trigger discard cost, Graveyard Spirit target, and confirm-to-hand resolution",
        'eventName: "discarded"',
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "shinobaronessShadePeacockSearchSelfSummon",
      requiredSnippets: [
        'const shadeCode = "33325951"',
        "restores its Ritual-summoned search trigger and banished next-Standby self Special Summon",
        'eventName: "phaseStandby"',
        "category: 512",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "shinobirdCraneDrawOnSpiritSummon",
      requiredSnippets: [
        'const craneCode = "66815913"',
        "restores its field trigger when another Spirit monster is Summoned and draws 1 card",
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      kind: "yakshaBackrowReturnOnSummon",
      requiredSnippets: [
        'const yakshaCode = "94215860"',
        "restores its summon trigger and returns one opponent Spell/Trap to hand",
        "targetUids",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonTriggerOperationSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonTriggerOperationKinds(
  fixtures: Array<{ kind: SummonTriggerOperationKind }>,
): Record<SummonTriggerOperationKind, number> {
  return fixtures.reduce<Record<SummonTriggerOperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      summonDraw: 0,
      summonMassDestroy: 0,
      summonSearch: 0,
      summonSearchSelfSummon: 0,
      summonToDeck: 0,
      summonToHandBounce: 0,
    },
  );
}

function countSummonTriggerOperationSemanticVariants(
  fixtures: Array<{ kind: SummonTriggerOperationSemanticVariant }>,
): Record<SummonTriggerOperationSemanticVariant, number> {
  return fixtures.reduce<Record<SummonTriggerOperationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      aratamaSpiritSearchOnSummon: 0,
      darkDustSpiritMassDestroyOnSummon: 0,
      gishkiNataliaGraveToDeckTopOnSummon: 0,
      hanShiKyudoColumnReturnOnSummon: 0,
      ichikiSayoriHimeEffectSummonSearch: 0,
      izanamiDiscardGraveSpiritReturnOnSummon: 0,
      shinobaronessShadePeacockSearchSelfSummon: 0,
      shinobirdCraneDrawOnSpiritSummon: 0,
      yakshaBackrowReturnOnSummon: 0,
    },
  );
}
