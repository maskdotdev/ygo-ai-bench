import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const directDamageFixtureCount = 12;
const directDamageKindCounts = {
  allPlayerDelayedDamage: 1,
  battleDestroyedChainInfoDamage: 1,
  continuousCostTargetParamDamage: 1,
  eventToGraveChainInfoDamage: 2,
  fieldCountTargetPlayerDamage: 2,
  targetParamDamage: 4,
  lpConditionTargetParamDamage: 1,
} satisfies Record<DirectDamageKind, number>;
const directDamageSemanticVariantCounts = {
  ancientGearTankDestroyedEquipDamage: 1,
  backfireEventToGraveChainInfoDamage: 1,
  finalFlameTargetParamDamage: 1,
  hinotamaTargetParamDamage: 1,
  justDessertsMonsterCountResolutionDamage: 1,
  meteorOfDestructionOpponentLpCondition: 1,
  ookaziTargetParamDamage: 1,
  pursuitChaserBattleDestroyedDefenseDamage: 1,
  seismicCrasherContinuousCostTargetParamDamage: 1,
  sparksTargetParamDamage: 1,
  thunderShortFieldCountDamage: 1,
  tremendousFireAllPlayerDelayedDamage: 1,
} satisfies Record<DirectDamageSemanticVariant, number>;

type DirectDamageKind =
  | "allPlayerDelayedDamage"
  | "battleDestroyedChainInfoDamage"
  | "continuousCostTargetParamDamage"
  | "eventToGraveChainInfoDamage"
  | "fieldCountTargetPlayerDamage"
  | "lpConditionTargetParamDamage"
  | "targetParamDamage";
type DirectDamageSemanticVariant =
  | "ancientGearTankDestroyedEquipDamage"
  | "backfireEventToGraveChainInfoDamage"
  | "finalFlameTargetParamDamage"
  | "hinotamaTargetParamDamage"
  | "justDessertsMonsterCountResolutionDamage"
  | "meteorOfDestructionOpponentLpCondition"
  | "ookaziTargetParamDamage"
  | "pursuitChaserBattleDestroyedDefenseDamage"
  | "seismicCrasherContinuousCostTargetParamDamage"
  | "sparksTargetParamDamage"
  | "thunderShortFieldCountDamage"
  | "tremendousFireAllPlayerDelayedDamage";

describe("Lua real direct damage restore coverage", () => {
  it("requires direct damage fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = directDamageFixtureFiles();
    expect(fixtures).toHaveLength(directDamageFixtureCount);

    const missing = fixtures
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires direct damage fixtures to prove operation info, LP changes, and damage events", () => {
    const fixtures = directDamageFixtureFiles();
    expect(fixtures).toHaveLength(directDamageFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return (!text.includes("operationInfos") && !text.includes("Duel.SetOperationInfo(0,CATEGORY_DAMAGE"))
          || !text.includes("category: 0x80000")
          || !text.includes('eventName: "damageDealt"')
          || !text.includes("lifePoints")
          || !text.includes('location: "graveyard"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps direct damage fixture kinds explicit", () => {
    expect(countDirectDamageKinds(directDamageFixtureFiles())).toEqual(directDamageKindCounts);
  });

  it("keeps named direct damage semantic variants explicit", () => {
    expect(countDirectDamageSemanticVariants(directDamageSemanticVariants())).toEqual(directDamageSemanticVariantCounts);

    const weak = directDamageSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function directDamageFixtureFiles(): Array<{ file: string; kind: DirectDamageKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
      kind: "eventToGraveChainInfoDamage",
      required: [
        'const tankCode = "37457534"',
        "restores Ancient Gear Tank's setcode equip filter, stat boost, and destroyed Equip damage trigger",
        "return e:GetHandler():IsReason(REASON_DESTROY)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "targetParam: 600",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7400)",
      ],
    },
    {
      file: "test/lua-real-script-backfire-to-grave-chaininfo-damage.test.ts",
      kind: "eventToGraveChainInfoDamage",
      required: [
        'const backfireCode = "82705573"',
        "restores its EVENT_TO_GRAVE trigger and resolves target-player target-param damage from CHAININFO",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "operationInfos: [{ category: 0x80000",
        "targetParam: 500",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-pursuit-chaser-battle-destroyed-defense-damage.test.ts",
      kind: "battleDestroyedChainInfoDamage",
      required: [
        'const pursuitCode = "27870033"',
        "restores its field EVENT_BATTLE_DESTROYED defense-position filter into CHAININFO damage",
        "return c:IsPreviousPosition(POS_DEFENSE) and c:IsLocation(LOCATION_GRAVE)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"battleDestroyed\"",
        "previousPosition: \"faceUpDefense\"",
        "Duel.SetTargetParam(500)",
        "Duel.SetTargetPlayer(1-tp)",
        "eventPlayer: 0",
        "players[0].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-final-flame-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const finalFlameCode = "73134081"',
        "restores Final Flame's target-param damage operation",
        "targetParam: 600",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7400)",
      ],
    },
    {
      file: "test/lua-real-script-hinotama-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const hinotamaCode = "46130346"',
        "restores Hinotama's target-param damage operation",
        "targetParam: 500",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-meteor-destruction-lp-condition-damage.test.ts",
      kind: "lpConditionTargetParamDamage",
      required: [
        'const meteorCode = "33767325"',
        "restores Meteor of Destruction's opponent-LP condition and target-param damage",
        "players[1].lifePoints = 3000",
        "players[1].lifePoints = 8000",
        "targetParam: 1000",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
    {
      file: "test/lua-real-script-sparks-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const sparksCode = "76103675"',
        "restores Sparks' target-param damage operation",
        "targetParam: 200",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7800)",
      ],
    },
    {
      file: "test/lua-real-script-ookazi-direct-damage.test.ts",
      kind: "targetParamDamage",
      required: [
        'const ookaziCode = "19523799"',
        "restores Ookazi's player-targeted damage operation",
        "targetParam: 800",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "test/lua-real-script-thunder-short-field-count-damage.test.ts",
      kind: "fieldCountTargetPlayerDamage",
      required: [
        'const thunderShortCode = "20264508"',
        "restores Thunder Short's target-player field-count damage from CHAININFO",
        "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)~=0",
        "Duel.GetFieldGroupCount(p,LOCATION_MZONE,0)*400",
        "targetParam: 800",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "test/lua-real-script-just-desserts-monster-count-damage.test.ts",
      kind: "fieldCountTargetPlayerDamage",
      required: [
        'const justDessertsCode = "24068492"',
        "restores Just Desserts' target-player monster-count damage and recalculates at resolution",
        "Duel.IsExistingMatchingCard(aux.TRUE,tp,0,LOCATION_MZONE,1,nil)",
        "Duel.GetFieldGroupCount(1-tp,LOCATION_MZONE,0)*500",
        "targetParam: 1000",
        "targetPlayer: 0",
        "players[0].lifePoints).toBe(6500)",
      ],
    },
    {
      file: "test/lua-real-script-seismic-crasher-continuous-cost-damage.test.ts",
      kind: "continuousCostTargetParamDamage",
      required: [
        'const seismicCrasherCode = "114932"',
        "restores Seismic Crasher's continuous Spell/Trap cost and target-param damage",
        "typeFlags: typeSpell | typeContinuous",
        "reason: duelReason.cost",
        "targetParam: 500",
        "targetPlayer: 1",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-tremendous-fire-delayed-damage.test.ts",
      kind: "allPlayerDelayedDamage",
      required: [
        'const tremendousFireCode = "46918794"',
        "restores Tremendous Fire's all-player delayed damage operation",
        "parameter: 500",
        "player: 0",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
  ];
}

function directDamageSemanticVariants(): Array<{ file: string; kind: DirectDamageSemanticVariant; required: string[] }> {
  const variants: Array<{ file: string; kind: DirectDamageSemanticVariant; required: string[] }> = [
    {
      file: "test/lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
      kind: "ancientGearTankDestroyedEquipDamage",
      required: [
        "Ancient Gear Tank Chain Responder",
        "eventValue: 600",
        "eventReasonCardUid: tank.uid",
        "ancient gear tank responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-backfire-to-grave-chaininfo-damage.test.ts",
      kind: "backfireEventToGraveChainInfoDamage",
      required: [
        "Backfire Chain Responder",
        "eventValue: 500",
        "eventReasonCardUid: backfire.uid",
        "backfire responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-final-flame-direct-damage.test.ts",
      kind: "finalFlameTargetParamDamage",
      required: [
        "Final Flame Chain Responder",
        "eventValue: 600",
        "eventReasonCardUid: finalFlame!.uid",
        "final flame responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-hinotama-direct-damage.test.ts",
      kind: "hinotamaTargetParamDamage",
      required: [
        "Hinotama Chain Responder",
        "eventValue: 500",
        "eventReasonCardUid: hinotama!.uid",
        "hinotama responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-meteor-destruction-lp-condition-damage.test.ts",
      kind: "meteorOfDestructionOpponentLpCondition",
      required: [
        "Meteor of Destruction Chain Responder",
        "eventValue: 1000",
        "eventReasonCardUid: meteor!.uid",
        "meteor responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-just-desserts-monster-count-damage.test.ts",
      kind: "justDessertsMonsterCountResolutionDamage",
      required: [
        "Just Desserts Chain Summoner",
        "eventValue: 1500",
        "eventReasonCardUid: justDesserts.uid",
        "just desserts responder summoned",
      ],
    },
    {
      file: "test/lua-real-script-sparks-direct-damage.test.ts",
      kind: "sparksTargetParamDamage",
      required: [
        "Sparks Chain Responder",
        "eventValue: 200",
        "eventReasonCardUid: sparks!.uid",
        "sparks responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-ookazi-direct-damage.test.ts",
      kind: "ookaziTargetParamDamage",
      required: [
        "Ookazi Chain Responder",
        "eventValue: 800",
        "eventReasonCardUid: ookazi!.uid",
        "ookazi responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-pursuit-chaser-battle-destroyed-defense-damage.test.ts",
      kind: "pursuitChaserBattleDestroyedDefenseDamage",
      required: [
        "Pursuit Chaser Chain Responder",
        "eventValue: 500",
        "eventReasonCardUid: pursuit.uid",
        "pursuit chaser responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-seismic-crasher-continuous-cost-damage.test.ts",
      kind: "seismicCrasherContinuousCostTargetParamDamage",
      required: [
        "Seismic Crasher Chain Responder",
        "eventValue: 500",
        "eventReasonCardUid: seismicCrasher.uid",
        "seismic crasher responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-thunder-short-field-count-damage.test.ts",
      kind: "thunderShortFieldCountDamage",
      required: [
        "Thunder Short Chain Responder",
        "eventValue: 800",
        "eventReasonCardUid: thunderShort.uid",
        "thunder short responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-tremendous-fire-delayed-damage.test.ts",
      kind: "tremendousFireAllPlayerDelayedDamage",
      required: [
        "Tremendous Fire Chain Responder",
        "eventValue: 1000",
        "eventValue: 500",
        "eventReasonCardUid: tremendousFire!.uid",
        "tremendous fire responder resolved",
      ],
    },
  ];

  return variants.map(({ file, kind, required }) => ({
    file,
    kind,
    required: [
      ...directDamageFixtureFiles().find((fixture) => fixture.file === file)!.required,
      ...required,
    ],
  }));
}

function countDirectDamageKinds(fixtures: Array<{ kind: DirectDamageKind }>): Record<DirectDamageKind, number> {
  return fixtures.reduce<Record<DirectDamageKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      allPlayerDelayedDamage: 0,
      battleDestroyedChainInfoDamage: 0,
      continuousCostTargetParamDamage: 0,
      eventToGraveChainInfoDamage: 0,
      fieldCountTargetPlayerDamage: 0,
      targetParamDamage: 0,
      lpConditionTargetParamDamage: 0,
    },
  );
}

function countDirectDamageSemanticVariants(fixtures: Array<{ kind: DirectDamageSemanticVariant }>): Record<DirectDamageSemanticVariant, number> {
  return fixtures.reduce<Record<DirectDamageSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      ancientGearTankDestroyedEquipDamage: 0,
      backfireEventToGraveChainInfoDamage: 0,
      finalFlameTargetParamDamage: 0,
      hinotamaTargetParamDamage: 0,
      justDessertsMonsterCountResolutionDamage: 0,
      meteorOfDestructionOpponentLpCondition: 0,
      ookaziTargetParamDamage: 0,
      pursuitChaserBattleDestroyedDefenseDamage: 0,
      seismicCrasherContinuousCostTargetParamDamage: 0,
      sparksTargetParamDamage: 0,
      thunderShortFieldCountDamage: 0,
      tremendousFireAllPlayerDelayedDamage: 0,
    },
  );
}
