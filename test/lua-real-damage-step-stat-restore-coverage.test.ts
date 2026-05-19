import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damageStepStatFixtureCount = 7;
const damageStepStatKindCounts = {
  activatedDamageStepBoost: 4,
  labelObjectCostBoost: 1,
  mandatoryPreDamageBoost: 1,
  persistentDamageStepDebuff: 1,
} satisfies Record<DamageStepStatKind, number>;
const damageStepStatSemanticVariantCounts = {
  cipherSoldierMandatoryPreDamageBoost: 1,
  fabledAshenveilDamageStepHandCostBoost: 1,
  gamilDefenderBranchSelfToGraveBoost: 1,
  injectionFairyLilyPreDamageLpBoost: 1,
  miniaturizePersistentDamageStepDebuff: 1,
  rushRecklesslyTargetedDamageStepBoost: 1,
  shinobirdCrowLabelObjectCostBoost: 1,
} satisfies Record<DamageStepStatSemanticVariant, number>;

type DamageStepStatKind =
  | "activatedDamageStepBoost"
  | "labelObjectCostBoost"
  | "mandatoryPreDamageBoost"
  | "persistentDamageStepDebuff";
type DamageStepStatSemanticVariant =
  | "cipherSoldierMandatoryPreDamageBoost"
  | "fabledAshenveilDamageStepHandCostBoost"
  | "gamilDefenderBranchSelfToGraveBoost"
  | "injectionFairyLilyPreDamageLpBoost"
  | "miniaturizePersistentDamageStepDebuff"
  | "rushRecklesslyTargetedDamageStepBoost"
  | "shinobirdCrowLabelObjectCostBoost";

describe("Lua real damage-step stat restore coverage", () => {
  it("requires damage-step stat fixtures to assert clean restore and restored battle outcome", () => {
    const files = damageStepStatFixtureFiles();
    expect(files).toHaveLength(damageStepStatFixtureCount);

    const missing = files
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
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps damage-step stat fixture kinds explicit", () => {
    expect(countDamageStepStatKinds(damageStepStatFixtureFiles())).toEqual(damageStepStatKindCounts);
  });

  it("keeps named damage-step stat semantic variants explicit", () => {
    expect(countDamageStepStatSemanticVariants(damageStepStatSemanticVariants())).toEqual(damageStepStatSemanticVariantCounts);

    const weak = damageStepStatSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps damage-step stat fixtures script-gated and database-independent", () => {
    const weak = damageStepStatSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function damageStepStatFixtureFiles(): Array<{
  file: string;
  kind: DamageStepStatKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "currentAttack(boostedAshenveil",
        "battleDamage[1]).toBe",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gamil-damage-step-self-cost-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBoost)",
        "Cost.SelfToGrave",
        "Duel.GetAttackTarget()",
        "Duel.IsTurnPlayer(1-tp)",
        "currentAttack(restoredChain.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredBoost)",
        "Duel.PayLPCost(tp,2000)",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)",
        "currentAttack(boostedLily",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
        "flagEffects).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredActivation)",
        "expectCleanRestore(restoredBoost)",
        "aux.StatChangeDamageStepCondition",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "currentAttack(restoredAttacker",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "labelObjectCostBoost",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredSetup.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDamageStep.missingRegistryKeys).toEqual([])",
        "restoredDamageStep.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingChainLimitRegistryKeys).toEqual([])",
        "property: 0x4000",
        "effectLabelObjectUid: costSpirit!.uid",
        "currentAttack(restoredCrow",
        "battleDamage[1]).toBe(200)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "persistentDamageStepDebuff",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "property: 0x4000",
        "miniaturize persistent true/true/1/800/3",
        "battleDamage[0]).toBe(100)",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "mandatoryPreDamageBoost",
      required: [
        "triggerEvent: \"beforeDamageCalculation\"",
        "eventName: \"beforeDamageCalculation\"",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid)",
        "battleDamage[1]).toBe(1350)",
        "value: 2000",
        "finishBattle(restored.session)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageStepStatKind;
    required: string[];
  }>);
}

function countDamageStepStatKinds(
  fixtures: Array<{ kind: DamageStepStatKind }>,
): Record<DamageStepStatKind, number> {
  return fixtures.reduce<Record<DamageStepStatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      activatedDamageStepBoost: 0,
      labelObjectCostBoost: 0,
      mandatoryPreDamageBoost: 0,
      persistentDamageStepDebuff: 0,
    },
  );
}

function damageStepStatSemanticVariants(): Array<{
  file: string;
  kind: DamageStepStatSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilDamageStepHandCostBoost",
      required: [
        'const ashenveilCode = "12235475"',
        "restores its hand cost and pre-damage calculation ATK boost",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        "eventName: \"sentToGraveyard\"",
        "currentAttack(boostedAshenveil",
        "ashenveil responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "injectionFairyLilyPreDamageLpBoost",
      required: [
        'const lilyCode = "79575620"',
        "restores its LP cost, damage-calculation flag, temporary ATK boost, and battle damage",
        "Duel.PayLPCost(tp,2000)",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        'eventName: "lifePointCostPaid"',
        "currentAttack(boostedLily",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
      ],
    },
    {
      file: "test/lua-real-script-gamil-damage-step-self-cost-boost.test.ts",
      kind: "gamilDefenderBranchSelfToGraveBoost",
      required: [
        'const gamilCode = "25727454"',
        "restores the defender-branch Damage Step hand cost and temporary ATK boost",
        "e1:SetCost(Cost.SelfToGrave)",
        "if Duel.IsTurnPlayer(1-tp) then a=Duel.GetAttackTarget() end",
        "eventName: \"sentToGraveyard\"",
        "currentAttack(restoredChain.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "shinobirdCrowLabelObjectCostBoost",
      required: [
        'const crowCode = "39817919"',
        "restores its Damage Step discard label object and applies the ATK/DEF boost",
        "property: 0x4000",
        "effectLabelObjectUid: costSpirit!.uid",
        "eventName: \"discarded\"",
        "battleDamage[1]).toBe(200)",
      ],
    },
    {
      file: "test/lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "miniaturizePersistentDamageStepDebuff",
      required: [
        'const miniaturizeCode = "34815282"',
        "restores official persistent target into Damage Step ATK and Level updates",
        "property: 0x4000",
        "miniaturize persistent true/true/1/800/3",
        "battleDamage[0]).toBe(100)",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "rushRecklesslyTargetedDamageStepBoost",
      required: [
        'const rushCode = "70046172"',
        "restores targeted Damage Step ATK update activation and battle damage",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "property: 0x4010",
        "e1:SetValue(700)",
        "currentAttack(restoredAttacker",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "cipherSoldierMandatoryPreDamageBoost",
      required: [
        'const cipherSoldierCode = "79853073"',
        "restores its EVENT_PRE_DAMAGE_CALCULATE trigger and applies the Warrior battle stat boost",
        "registryKey: \"lua:79853073:lua-1-1134\"",
        "triggerEvent: \"beforeDamageCalculation\"",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid)",
        "battleDamage[1]).toBe(1350)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageStepStatSemanticVariant;
    required: string[];
  }>);
}

function countDamageStepStatSemanticVariants(
  fixtures: Array<{ kind: DamageStepStatSemanticVariant }>,
): Record<DamageStepStatSemanticVariant, number> {
  return fixtures.reduce<Record<DamageStepStatSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      cipherSoldierMandatoryPreDamageBoost: 0,
      fabledAshenveilDamageStepHandCostBoost: 0,
      gamilDefenderBranchSelfToGraveBoost: 0,
      injectionFairyLilyPreDamageLpBoost: 0,
      miniaturizePersistentDamageStepDebuff: 0,
      rushRecklesslyTargetedDamageStepBoost: 0,
      shinobirdCrowLabelObjectCostBoost: 0,
    },
  );
}
