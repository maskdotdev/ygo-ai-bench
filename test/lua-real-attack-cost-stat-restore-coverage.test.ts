import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackCostAndStatFixtureCount = 10;
const legalActionFixtureCount = 6;
const attackCostAndStatKindCounts = {
  attackCostLp: 1,
  attackCostRelease: 1,
  baseAttackExtraDeckLock: 1,
  currentAttackExtraDeckLock: 1,
  dynamicFieldStat: 1,
  ignitionBanishCostAtkBoost: 1,
  dynamicLinkedGroupStat: 1,
  fieldSetAttack: 1,
  targetAttackPredicate: 1,
  toonReleaseProcedureLpAttackCost: 1,
} satisfies Record<AttackCostAndStatKind, number>;
const attackCostAndStatSemanticVariantCounts = {
  bazooBanishCountAtkBoost: 1,
  burdenMightyLevelBasedFieldAtkUpdate: 1,
  darkElfLpAttackCost: 1,
  elphaseLinkedGroupDynamicAtk: 1,
  fusionDevourerTargetedFieldAtkFinal: 1,
  pantherWarriorReleaseAttackCost: 1,
  rbLastStandCurrentAtkExtraMachineLock: 1,
  rbStageLandingBaseAtkExtraMachineLock: 1,
  valcanBoosterLizardOriginalMachineAtkPredicate: 1,
  toonSummonedSkullReleaseProcedureLpAttackCost: 1,
} satisfies Record<AttackCostAndStatSemanticVariant, number>;

type AttackCostAndStatKind =
  | "attackCostLp"
  | "attackCostRelease"
  | "baseAttackExtraDeckLock"
  | "currentAttackExtraDeckLock"
  | "dynamicFieldStat"
  | "ignitionBanishCostAtkBoost"
  | "dynamicLinkedGroupStat"
  | "fieldSetAttack"
  | "targetAttackPredicate"
  | "toonReleaseProcedureLpAttackCost";
type AttackCostAndStatSemanticVariant =
  | "bazooBanishCountAtkBoost"
  | "burdenMightyLevelBasedFieldAtkUpdate"
  | "darkElfLpAttackCost"
  | "elphaseLinkedGroupDynamicAtk"
  | "fusionDevourerTargetedFieldAtkFinal"
  | "pantherWarriorReleaseAttackCost"
  | "rbLastStandCurrentAtkExtraMachineLock"
  | "rbStageLandingBaseAtkExtraMachineLock"
  | "valcanBoosterLizardOriginalMachineAtkPredicate"
  | "toonSummonedSkullReleaseProcedureLpAttackCost";

describe("Lua real attack cost and attack-stat restore coverage", () => {
  it("requires attack-cost and ATK-threshold restore fixtures to assert clean Lua registry restore", () => {
    const files = attackCostAndStatFixtureFiles();
    expect(files).toHaveLength(attackCostAndStatFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored ATK-threshold locks expose actions", () => {
    const files = legalActionFixtureFiles();
    expect(files).toHaveLength(legalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      });

    expect(missing).toEqual([]);
  });

  it("keeps attack-cost and attack-stat fixture kinds explicit", () => {
    expect(countAttackCostAndStatKinds(attackCostAndStatFixtureFiles())).toEqual(attackCostAndStatKindCounts);
  });

  it("keeps named attack-cost and attack-stat semantic variants explicit", () => {
    expect(countAttackCostAndStatSemanticVariants(attackCostAndStatSemanticVariants())).toEqual(attackCostAndStatSemanticVariantCounts);

    const weak = attackCostAndStatSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function attackCostAndStatFixtureFiles(): Array<{
  file: string;
  kind: AttackCostAndStatKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-bazoo-banish-count-atk.test.ts",
      kind: "ignitionBanishCostAtkBoost",
      required: [
        "restores selected banish cost count into the temporary ATK boost",
        "Duel.Remove(cg,POS_FACEUP,REASON_COST)",
        "e:SetLabel(#cg)",
        "e1:SetValue(count*300)",
        "reason: duelReason.cost",
        "value: 900",
      ],
    },
    {
      file: "lua-real-script-burden-mighty-dynamic-stat.test.ts",
      kind: "dynamicFieldStat",
      required: [
        "burden of the mighty attack 1000/1300/1800",
        "getLuaRestoreLegalActionGroups(restoredChain, 1)",
        "expect(restoredStat.session.state.battleDamage[0]).toBe(800)",
        "players[0].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "lua-real-script-elphase-linked-group-stat.test.ts",
      kind: "dynamicLinkedGroupStat",
      required: [
        "restores GetLinkedGroupCount dynamic ATK from the monster it points to",
        "currentAttack(elphase, session.state)).toBe((elphase.data.attack ?? 0) + 300)",
        "currentAttack(restoredElphase, restored.session.state)).toBe((elphase.data.attack ?? 0) + 300)",
        "elphase linked group stat 1/",
      ],
    },
    {
      file: "lua-real-script-fusion-devourer-field-stat.test.ts",
      kind: "fieldSetAttack",
      required: [
        "code: 102",
        "targetRange: [0, 0x04]",
        'battleWindow?.kind).toBe("startDamageStep")',
        "expect(restored.session.state.battleDamage[1]).toBe(devourer!.data.attack)",
      ],
    },
    {
      file: "lua-real-script-panther-warrior-attack-cost.test.ts",
      kind: "attackCostRelease",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "released"',
        "passBattleResponses(restored.session)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-toon-summoned-skull-release-attack-cost.test.ts",
      kind: "toonReleaseProcedureLpAttackCost",
      required: [
        "restores its Toon World-gated release Special Summon procedure and same-turn attack lock",
        "Duel.CheckReleaseGroup(c:GetControler(),aux.TRUE,1,false,1,true,c,c:GetControler(),nil,false,nil)",
        "Duel.SelectReleaseGroup(tp,aux.TRUE,1,1,false,true,true,c,nil,nil,false,nil)",
        "Duel.Release(g,REASON_COST)",
        "Duel.CheckLPCost(tp,500)",
        "Duel.AttackCostPaid()",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(5500)",
      ],
    },
    {
      file: "lua-real-script-dark-elf-attack-cost.test.ts",
      kind: "attackCostLp",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "lifePointCostPaid"',
        "players[0].lifePoints).toBe(7000)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
      kind: "currentAttackExtraDeckLock",
      required: [
        "special-summon-limit:not-race-attack-lte-extra:32:1500",
        "rb last high machine special 0",
        "rb last low machine special 1",
        "rb last deck special 1",
      ],
    },
    {
      file: "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
      kind: "baseAttackExtraDeckLock",
      required: [
        "special-summon-limit:not-race-base-attack-lte-extra:32:1500",
        "rb stage high machine special 0",
        "rb stage low machine special 1",
        "rb stage deck special 1",
      ],
    },
    {
      file: "lua-real-script-valcan-booster-lizard-attack-lock.test.ts",
      kind: "targetAttackPredicate",
      required: [
        "target:not-original-race-text-attack-lte:32:1500",
        "targetCardPredicate",
        "effect!.targetCardPredicate!(ctx, machine1500!)).toBe(false)",
        "effect!.targetCardPredicate!(ctx, machine1000!)).toBe(true)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackCostAndStatKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function legalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-bazoo-banish-count-atk.test.ts",
    "lua-real-script-dark-elf-attack-cost.test.ts",
    "lua-real-script-panther-warrior-attack-cost.test.ts",
    "lua-real-script-toon-summoned-skull-release-attack-cost.test.ts",
    "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
    "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function attackCostAndStatSemanticVariants(): Array<{
  file: string;
  kind: AttackCostAndStatSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-bazoo-banish-count-atk.test.ts",
      kind: "bazooBanishCountAtkBoost",
      required: [
        'const bazooCode = "40133511"',
        "restores selected banish cost count into the temporary ATK boost",
        "Duel.Remove(cg,POS_FACEUP,REASON_COST)",
        "currentAttack(restoredBoosted.session.state.cards.find((card) => card.uid === bazoo!.uid), restoredBoosted.session.state)).toBe(",
      ],
    },
    {
      file: "lua-real-script-burden-mighty-dynamic-stat.test.ts",
      kind: "burdenMightyLevelBasedFieldAtkUpdate",
      required: [
        'const burdenCode = "44947065"',
        "restores official field ATK update callback by monster Level",
        "burden of the mighty attack 1000/1300/1800",
        "expect(restoredStat.session.state.battleDamage[0]).toBe(800)",
      ],
    },
    {
      file: "lua-real-script-dark-elf-attack-cost.test.ts",
      kind: "darkElfLpAttackCost",
      required: [
        'const darkElfCode = "21417692"',
        "restores Dark Elf after its attack cost is paid",
        "does not expose Dark Elf attacks when the LP attack cost cannot be paid",
        'eventName: "lifePointCostPaid"',
      ],
    },
    {
      file: "lua-real-script-elphase-linked-group-stat.test.ts",
      kind: "elphaseLinkedGroupDynamicAtk",
      required: [
        'const elphaseCode = "60292055"',
        "restores GetLinkedGroupCount dynamic ATK from the monster it points to",
        "currentAttack(elphase, session.state)).toBe((elphase.data.attack ?? 0) + 300)",
        "elphase linked group stat 1/",
      ],
    },
    {
      file: "lua-real-script-fusion-devourer-field-stat.test.ts",
      kind: "fusionDevourerTargetedFieldAtkFinal",
      required: [
        'const devourerCode = "98336111"',
        "restores and applies Fusion Devourer's targeted field ATK-final effect during battle",
        "targetRange: [0, 0x04]",
        'battleWindow?.kind).toBe("startDamageStep")',
      ],
    },
    {
      file: "lua-real-script-panther-warrior-attack-cost.test.ts",
      kind: "pantherWarriorReleaseAttackCost",
      required: [
        'const pantherCode = "42035044"',
        "restores Panther Warrior after releasing a monster for its attack cost",
        "does not expose Panther Warrior attacks without a releasable monster",
        'eventName: "released"',
      ],
    },
    {
      file: "lua-real-script-toon-summoned-skull-release-attack-cost.test.ts",
      kind: "toonSummonedSkullReleaseProcedureLpAttackCost",
      required: [
        'const toonCode = "91842653"',
        "restores its opposing-Toon battle target restriction and LP attack cost",
        "restores its direct attack path and pays the same LP attack cost when no opposing Toon exists",
        'eventName: "lifePointCostPaid"',
      ],
    },
    {
      file: "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
      kind: "rbLastStandCurrentAtkExtraMachineLock",
      required: [
        'const lastStandCode = "43450363"',
        "restores its Extra Deck-only Machine 1500-or-less current ATK special summon lock",
        "special-summon-limit:not-race-attack-lte-extra:32:1500",
        "rb last high machine special 0",
      ],
    },
    {
      file: "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
      kind: "rbStageLandingBaseAtkExtraMachineLock",
      required: [
        'const stageLandingCode = "5109321"',
        "restores its Extra Deck-only Machine 1500-or-less base ATK special summon lock",
        "special-summon-limit:not-race-base-attack-lte-extra:32:1500",
        "rb stage high machine special 0",
      ],
    },
    {
      file: "lua-real-script-valcan-booster-lizard-attack-lock.test.ts",
      kind: "valcanBoosterLizardOriginalMachineAtkPredicate",
      required: [
        'const boosterCode = "6821579"',
        "restores original Machine and text ATK Clock Lizard checks",
        "target:not-original-race-text-attack-lte:32:1500",
        "effect!.targetCardPredicate!(ctx, machine1000!)).toBe(true)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackCostAndStatSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackCostAndStatSemanticVariants(
  fixtures: Array<{ kind: AttackCostAndStatSemanticVariant }>,
): Record<AttackCostAndStatSemanticVariant, number> {
  return fixtures.reduce<Record<AttackCostAndStatSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      bazooBanishCountAtkBoost: 0,
      burdenMightyLevelBasedFieldAtkUpdate: 0,
      darkElfLpAttackCost: 0,
      elphaseLinkedGroupDynamicAtk: 0,
      fusionDevourerTargetedFieldAtkFinal: 0,
      pantherWarriorReleaseAttackCost: 0,
      rbLastStandCurrentAtkExtraMachineLock: 0,
      rbStageLandingBaseAtkExtraMachineLock: 0,
      toonSummonedSkullReleaseProcedureLpAttackCost: 0,
      valcanBoosterLizardOriginalMachineAtkPredicate: 0,
    },
  );
}

function countAttackCostAndStatKinds(
  fixtures: Array<{ kind: AttackCostAndStatKind }>,
): Record<AttackCostAndStatKind, number> {
  return fixtures.reduce<Record<AttackCostAndStatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackCostLp: 0,
      attackCostRelease: 0,
      baseAttackExtraDeckLock: 0,
      currentAttackExtraDeckLock: 0,
      dynamicFieldStat: 0,
      ignitionBanishCostAtkBoost: 0,
      dynamicLinkedGroupStat: 0,
      fieldSetAttack: 0,
      targetAttackPredicate: 0,
      toonReleaseProcedureLpAttackCost: 0,
    },
  );
}
