import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const spiritReturnFixtureCount = 5;
const spiritReturnKindCounts = {
  costReturnBounce: 1,
  fieldReturnLock: 1,
  grantedEndPhaseReturn: 1,
  graveyardDiscardReturn: 1,
  targetedSpiritBounce: 1,
} satisfies Record<SpiritReturnKind, number>;
const spiritReturnSemanticVariantCounts = {
  heboTargetGrantedEndPhaseReturn: 1,
  izanamiDiscardCostGraveyardSpiritReturn: 1,
  rasetsuRevealCostTemporaryLockBounce: 1,
  shinobirdPigeonFieldIgnitionSpiritBounce: 1,
  spiritualEnergySettleMachineReturnSuppressionCleanup: 1,
} satisfies Record<SpiritReturnSemanticVariant, number>;

type SpiritReturnKind =
  | "costReturnBounce"
  | "fieldReturnLock"
  | "grantedEndPhaseReturn"
  | "graveyardDiscardReturn"
  | "targetedSpiritBounce";
type SpiritReturnSemanticVariant =
  | "heboTargetGrantedEndPhaseReturn"
  | "izanamiDiscardCostGraveyardSpiritReturn"
  | "rasetsuRevealCostTemporaryLockBounce"
  | "shinobirdPigeonFieldIgnitionSpiritBounce"
  | "spiritualEnergySettleMachineReturnSuppressionCleanup";

describe("Lua real Spirit return restore coverage", () => {
  it("requires Spirit return and bounce fixtures to assert clean Lua registry restore and payload outcomes", () => {
    const files = spiritReturnFixtureFiles();
    expect(files).toHaveLength(spiritReturnFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity through restored Spirit trigger and chain windows", () => {
    const files = spiritReturnFixtureFiles();
    expect(files).toHaveLength(spiritReturnFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps Spirit return fixture kinds explicit", () => {
    expect(countSpiritReturnKinds(spiritReturnFixtureFiles())).toEqual(spiritReturnKindCounts);
  });

  it("keeps named Spirit return semantic variants explicit", () => {
    expect(countSpiritReturnSemanticVariants(spiritReturnSemanticVariants())).toEqual(spiritReturnSemanticVariantCounts);

    const weak = spiritReturnSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function spiritReturnFixtureFiles(): Array<{
  file: string;
  kind: SpiritReturnKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-hebo-spirit-grant-return.test.ts",
      kind: "grantedEndPhaseReturn",
      required: [
        "Hebo Spirit grant return",
        "target-granted Spirit type",
        "code: effectAddType",
        "code: phaseEndEvent",
        "eventName: \"sentToHand\"",
        "eventCardUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "graveyardDiscardReturn",
      required: [
        "Izanami Spirit Graveyard return",
        "eventName: \"discarded\"",
        "operationInfos: [{ category: 0x8",
        "eventName: \"sentToHand\"",
        "eventName: \"confirmed\"",
        "eventName: \"sentToHandConfirmed\"",
      ],
    },
    {
      file: "lua-real-script-rasetsu-spirit-cost-return.test.ts",
      kind: "costReturnBounce",
      required: [
        "Rasetsu Spirit cost return",
        "confirmed 1:",
        "operationInfos: [{ category: 0x8",
        "rasetsu can special false",
        "eventName: \"confirmed\"",
        "eventName: \"sentToHand\"",
      ],
    },
    {
      file: "lua-real-script-shinobird-pigeon-spirit-return.test.ts",
      kind: "targetedSpiritBounce",
      required: [
        "Shinobird Pigeon Spirit return",
        "operationInfos: [{ category: 0x8",
        "targetUids).not.toContain(pigeon!.uid)",
        "targetUids).not.toContain(invalidMonster!.uid)",
        "eventName: \"sentToHand\"",
      ],
    },
    {
      file: "lua-real-script-spiritual-energy-settle-machine-return-lock.test.ts",
      kind: "fieldReturnLock",
      required: [
        "Spiritual Energy Settle Machine return lock",
        'action.type === "activateTrigger"',
        "toBe(false)",
        "settle leaves 1",
        "eventName: \"sentToHand\"",
        "eventCardUid: yata.uid",
        "eventCardUid: opponentSpirit.uid",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SpiritReturnKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countSpiritReturnKinds(fixtures: Array<{ kind: SpiritReturnKind }>): Record<SpiritReturnKind, number> {
  return fixtures.reduce<Record<SpiritReturnKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costReturnBounce: 0,
      fieldReturnLock: 0,
      grantedEndPhaseReturn: 0,
      graveyardDiscardReturn: 0,
      targetedSpiritBounce: 0,
    },
  );
}

function spiritReturnSemanticVariants(): Array<{
  file: string;
  kind: SpiritReturnSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-hebo-spirit-grant-return.test.ts",
      kind: "heboTargetGrantedEndPhaseReturn",
      required: [
        'const heboCode = "90365482"',
        "restores target-granted Spirit type and the target-owned End Phase return",
        "target-granted Spirit type",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "izanamiDiscardCostGraveyardSpiritReturn",
      required: [
        'const izanamiCode = "43543777"',
        "restores its summon trigger discard cost, Graveyard Spirit target, and confirm-to-hand resolution",
        "eventName: \"sentToHandConfirmed\"",
      ],
    },
    {
      file: "test/lua-real-script-rasetsu-spirit-cost-return.test.ts",
      kind: "rasetsuRevealCostTemporaryLockBounce",
      required: [
        'const rasetsuCode = "43378076"',
        "restores its reveal cost, temporary Special Summon lock, and targeted monster return",
        "rasetsu can special false",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-pigeon-spirit-return.test.ts",
      kind: "shinobirdPigeonFieldIgnitionSpiritBounce",
      required: [
        'const pigeonCode = "92200612"',
        "restores its field ignition target and returns another Spirit monster to the hand",
        "targetUids).not.toContain(pigeon!.uid)",
      ],
    },
    {
      file: "test/lua-real-script-spiritual-energy-settle-machine-return-lock.test.ts",
      kind: "spiritualEnergySettleMachineReturnSuppressionCleanup",
      required: [
        'const settleMachineCode = "99173029"',
        "restores its Spirit return suppression and leave-field return-all cleanup",
        "settle leaves 1",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SpiritReturnSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSpiritReturnSemanticVariants(
  fixtures: Array<{ kind: SpiritReturnSemanticVariant }>,
): Record<SpiritReturnSemanticVariant, number> {
  return fixtures.reduce<Record<SpiritReturnSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      heboTargetGrantedEndPhaseReturn: 0,
      izanamiDiscardCostGraveyardSpiritReturn: 0,
      rasetsuRevealCostTemporaryLockBounce: 0,
      shinobirdPigeonFieldIgnitionSpiritBounce: 0,
      spiritualEnergySettleMachineReturnSuppressionCleanup: 0,
    },
  );
}
