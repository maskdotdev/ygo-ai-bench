import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const controlFixtureCount = 11;
const controlKindCounts = {
  cannotChangeControl: 1,
  discardCostTemporaryControl: 1,
  equipControl: 1,
  flipGetControl: 1,
  flipSetControl: 1,
  releaseCostControl: 1,
  restrictedTemporaryControl: 2,
  swapControlLock: 1,
  targetedSwapControl: 1,
  temporaryControl: 1,
} satisfies Record<ControlKind, number>;
const controlSemanticVariantCounts = {
  brainControlLpCostReturn: 1,
  changeHeartTemporaryReturn: 1,
  creatureSwapControlLock: 1,
  dharcFlipSetControl: 1,
  electricVirusDiscardControl: 1,
  enemyControllerReleaseControl: 1,
  matazaCannotChangeControl: 1,
  mindControlRestrictions: 1,
  rafflesiaFlipGetControl: 1,
  snatchStealEquipControl: 1,
  xyzReversalTargetedSwapControl: 1,
} satisfies Record<ControlSemanticVariant, number>;

type ControlKind =
  | "cannotChangeControl"
  | "discardCostTemporaryControl"
  | "equipControl"
  | "flipGetControl"
  | "flipSetControl"
  | "releaseCostControl"
  | "restrictedTemporaryControl"
  | "swapControlLock"
  | "targetedSwapControl"
  | "temporaryControl";

type ControlSemanticVariant =
  | "brainControlLpCostReturn"
  | "changeHeartTemporaryReturn"
  | "creatureSwapControlLock"
  | "dharcFlipSetControl"
  | "electricVirusDiscardControl"
  | "enemyControllerReleaseControl"
  | "matazaCannotChangeControl"
  | "mindControlRestrictions"
  | "rafflesiaFlipGetControl"
  | "snatchStealEquipControl"
  | "xyzReversalTargetedSwapControl";

describe("Lua real control restore coverage", () => {
  it("requires representative control-change fixtures to prove clean Lua restore and replayed legal actions", () => {
    const files = realScriptControlFixtureFiles();
    expect(files).toHaveLength(controlFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
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
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("previousController")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps control fixture kinds explicit", () => {
    expect(countControlKinds(realScriptControlFixtureFiles())).toEqual(controlKindCounts);
  });

  it("keeps named control semantic variants explicit", () => {
    expect(countControlSemanticVariants(realScriptControlSemanticVariants())).toEqual(controlSemanticVariantCounts);

    const weak = realScriptControlSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptControlFixtureFiles(): Array<{
  file: string;
  kind: ControlKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-change-of-heart-control-return.test.ts",
      kind: "temporaryControl",
      required: [
        'luaValueDescriptor: "temporary-control-return"',
        'registryKey: `lua:${targetCode}:temporary-control-return:${target!.uid}`',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`)",
      ],
    },
    {
      file: "lua-real-script-brain-control-cost-return.test.ts",
      kind: "restrictedTemporaryControl",
      required: [
        "lifePointCostPaid",
        "players[0].lifePoints).toBe(7200)",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-electric-virus-discard-control.test.ts",
      kind: "discardCostTemporaryControl",
      required: [
        'const electricVirusCode = "24725825"',
        "restores Electric Virus's discard cost, race-gated target, temporary GetControl, and End Phase return",
        "duelReason.cost | duelReason.discard",
        'luaValueDescriptor: "temporary-control-return"',
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-dharc-flip-set-control.test.ts",
      kind: "flipSetControl",
      required: [
        'const dharcCode = "19327348"',
        "restores Dharc's targeted flip control effect and persistent EFFECT_SET_CONTROL handoff",
        'action.type === "activateTrigger" && action.uid === dharc.uid',
        "eventName: \"controlChanged\"",
        "dharcCardTargets(restoredChain.session, dharc.uid)).toContain(darkTarget.uid)",
      ],
    },
    {
      file: "lua-real-script-rafflesia-flip-get-control.test.ts",
      kind: "flipGetControl",
      required: [
        'const rafflesiaCode = "31440542"',
        "restores Rafflesia Seduction's flip target, temporary GetControl, and End Phase return",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        'luaValueDescriptor: "temporary-control-return"',
        "eventName: \"controlChanged\"",
      ],
    },
    {
      file: "lua-real-script-enemy-controller-control-cost.test.ts",
      kind: "releaseCostControl",
      required: [
        "effectLabel: 2",
        "duelReason.release",
        "duelReason.cost",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-mind-control-restrictions.test.ts",
      kind: "restrictedTemporaryControl",
      required: [
        "restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85])",
        "mind release probe true/false/0",
        'action.type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-creature-swap-control-lock.test.ts",
      kind: "swapControlLock",
      required: [
        "targetUids ?? []).toEqual([])",
        "positionLockCodes(restoredResponseWindow.session, ownMonster!.uid)).toEqual([14])",
        "creature swap position probe false/false",
      ],
    },
    {
      file: "lua-real-script-xyz-reversal-swap-control.test.ts",
      kind: "targetedSwapControl",
      required: [
        "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "Duel.SwapControl(a,b)",
        "targetUids: [opponentXyz.uid, ownXyz.uid]",
        "eventUids: [opponentXyz.uid, ownXyz.uid]",
      ],
    },
    {
      file: "lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "cannotChangeControl",
      required: [
        "code: 5",
        "mataza control predicate false",
        "mataza control take 0",
        "mataza control swap false",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "equipControl",
      required: [
        "equippedToUid: target!.uid",
        "previousEquippedToUid: target!.uid",
        "snatch probe 0/45986603/612501",
        "snatch probe 1/nil/nil",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ControlKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countControlKinds(fixtures: Array<{ kind: ControlKind }>): Record<ControlKind, number> {
  return fixtures.reduce<Record<ControlKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      cannotChangeControl: 0,
      discardCostTemporaryControl: 0,
      equipControl: 0,
      flipGetControl: 0,
      flipSetControl: 0,
      releaseCostControl: 0,
      restrictedTemporaryControl: 0,
      swapControlLock: 0,
      targetedSwapControl: 0,
      temporaryControl: 0,
    },
  );
}

function realScriptControlSemanticVariants(): Array<{
  file: string;
  kind: ControlSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-brain-control-cost-return.test.ts",
      kind: "brainControlLpCostReturn",
      required: [
        'const brainControlCode = "87910978"',
        "restores Brain Control's LP cost, summonable target filter, and End Phase return",
        "lifePointCostPaid",
        "players[0].lifePoints).toBe(7200)",
        "extraTarget!.uid)).toMatchObject({ controller: 1, location: \"monsterZone\" })",
      ],
    },
    {
      file: "lua-real-script-change-of-heart-control-return.test.ts",
      kind: "changeHeartTemporaryReturn",
      required: [
        'const changeOfHeartCode = "4031928"',
        "restores Change of Heart's target, control operation, and End Phase return",
        "eventName: \"controlChanged\"",
        'luaValueDescriptor: "temporary-control-return"',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`)",
      ],
    },
    {
      file: "lua-real-script-creature-swap-control-lock.test.ts",
      kind: "creatureSwapControlLock",
      required: [
        'const creatureSwapCode = "31036355"',
        "restores Creature Swap's non-targeting control exchange and position locks",
        "targetUids ?? []).toEqual([])",
        "eventUids: [ownMonster!.uid, opponentMonster!.uid]",
        "creature swap position probe false/false",
      ],
    },
    {
      file: "lua-real-script-dharc-flip-set-control.test.ts",
      kind: "dharcFlipSetControl",
      required: [
        'const dharcCode = "19327348"',
        "restores Dharc's targeted flip control effect and persistent EFFECT_SET_CONTROL handoff",
        "EFFECT_SET_CONTROL",
        "eventName: \"controlChanged\"",
        "duelReason.effect",
      ],
    },
    {
      file: "lua-real-script-rafflesia-flip-get-control.test.ts",
      kind: "rafflesiaFlipGetControl",
      required: [
        'const rafflesiaCode = "31440542"',
        "restores Rafflesia Seduction's flip target, temporary GetControl, and End Phase return",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
        "previousController: 1",
      ],
    },
    {
      file: "lua-real-script-electric-virus-discard-control.test.ts",
      kind: "electricVirusDiscardControl",
      required: [
        'const electricVirusCode = "24725825"',
        "restores Electric Virus's discard cost, race-gated target, temporary GetControl, and End Phase return",
        "Duel.SendtoGrave(e:GetHandler(),REASON_COST|REASON_DISCARD)",
        "c:IsRace(RACE_MACHINE|RACE_DRAGON)",
        "Duel.GetControl(tc,tp,PHASE_END,1)",
      ],
    },
    {
      file: "lua-real-script-enemy-controller-control-cost.test.ts",
      kind: "enemyControllerReleaseControl",
      required: [
        'const enemyControllerCode = "98045062"',
        "restores Enemy Controller's release-cost control branch and End Phase return",
        "effectLabel: 2",
        "eventName: \"released\"",
        "duelReason.release | duelReason.cost",
      ],
    },
    {
      file: "lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "matazaCannotChangeControl",
      required: [
        'const matazaCode = "22609617"',
        "restores official control-change lock and static extra attack",
        "code === 5",
        "mataza control predicate false",
        "mataza control take 0",
        "hasDirectAttack(secondActions, mataza!.uid)).toBe(true)",
      ],
    },
    {
      file: "lua-real-script-mind-control-restrictions.test.ts",
      kind: "mindControlRestrictions",
      required: [
        'const mindControlCode = "37520316"',
        "restores Mind Control's temporary control, unreleasable, and cannot-attack effects",
        "restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85])",
        "mind release probe true/false/0",
        "action.type === \"declareAttack\" && action.attackerUid === target!.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "snatchStealEquipControl",
      required: [
        'const snatchCode = "45986603"',
        "restores Snatch Steal's equip control and returns control when the equip leaves",
        "equippedToUid: target!.uid",
        "previousEquippedToUid: target!.uid",
        "snatch probe 1/nil/nil",
      ],
    },
    {
      file: "lua-real-script-xyz-reversal-swap-control.test.ts",
      kind: "xyzReversalTargetedSwapControl",
      required: [
        'const reversalCode = "66604523"',
        "restores Xyz Reversal's two selected targets and swaps control from chain target cards",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,g1,2,0,0)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "previousController: 0",
        "previousController: 1",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ControlSemanticVariant;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function countControlSemanticVariants(fixtures: Array<{ kind: ControlSemanticVariant }>): Record<ControlSemanticVariant, number> {
  return fixtures.reduce<Record<ControlSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      brainControlLpCostReturn: 0,
      changeHeartTemporaryReturn: 0,
      creatureSwapControlLock: 0,
      dharcFlipSetControl: 0,
      electricVirusDiscardControl: 0,
      enemyControllerReleaseControl: 0,
      matazaCannotChangeControl: 0,
      mindControlRestrictions: 0,
      rafflesiaFlipGetControl: 0,
      snatchStealEquipControl: 0,
      xyzReversalTargetedSwapControl: 0,
    },
  );
}
