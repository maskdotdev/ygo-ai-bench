import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battledRemovalFixtureCount = 7;
const battledRemovalKindCounts = {
  afterDamageBanish: 2,
  battleDestroyRedirect: 1,
  battleDestroyedBackrowDestroy: 1,
  battleDestroyedMonsterDestroy: 3,
} satisfies Record<BattledRemovalKind, number>;
const battledRemovalSemanticVariantCounts = {
  bladeBurnerFalconBattleDestroyingDetachCountDestroy: 1,
  ddAssailantAfterDamageBanishBoth: 1,
  divineKnightIshzarkAfterDamageBanishTarget: 1,
  lesserFiendBattleDestroyRedirect: 1,
  newdoriaBattleDestroyedTargetDestroy: 1,
  yamatoNoKamiBattleDestroyedBackrowDestroy: 1,
  yomiShipBattleDestroyedAttackerDestroy: 1,
} satisfies Record<BattledRemovalSemanticVariant, number>;

type BattledRemovalKind =
  | "afterDamageBanish"
  | "battleDestroyRedirect"
  | "battleDestroyedBackrowDestroy"
  | "battleDestroyedMonsterDestroy";
type BattledRemovalSemanticVariant =
  | "bladeBurnerFalconBattleDestroyingDetachCountDestroy"
  | "ddAssailantAfterDamageBanishBoth"
  | "divineKnightIshzarkAfterDamageBanishTarget"
  | "lesserFiendBattleDestroyRedirect"
  | "newdoriaBattleDestroyedTargetDestroy"
  | "yamatoNoKamiBattleDestroyedBackrowDestroy"
  | "yomiShipBattleDestroyedAttackerDestroy";

describe("Lua real battled-removal restore coverage", () => {
  it("requires battled removal fixtures to assert clean Lua registry restore and restored trigger outcomes", () => {
    const files = battledRemovalFixtureFiles();
    expect(files).toHaveLength(battledRemovalFixtureCount);

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
          || !text.includes("pendingTriggers")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battled-removal fixture kinds explicit", () => {
    expect(countBattledRemovalKinds(battledRemovalFixtureFiles())).toEqual(battledRemovalKindCounts);
  });

  it("keeps named battled-removal semantic variants explicit", () => {
    expect(countBattledRemovalSemanticVariants(battledRemovalSemanticVariants())).toEqual(battledRemovalSemanticVariantCounts);

    const weak = battledRemovalSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function battledRemovalFixtureFiles(): Array<{
  file: string;
  kind: BattledRemovalKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-blade-burner-falcon-battle-destroying-detach-count-destroy.test.ts",
      kind: "battleDestroyedMonsterDestroy",
      required: [
        "expect(restoredBattle.session.state.pendingTriggers).toEqual",
        'id: "trigger-6-1"',
        'effectId: "lua-3-1139"',
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        'eventTriggerTiming: "when"',
        'triggerBucket: "turnOptional"',
        'type === "activateTrigger"',
        'eventName: "detachedMaterial"',
        'eventName: "destroyed"',
        'eventName: "battleDamageDealt"',
        "eventPlayer: 1",
        "eventValue: 500",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: falcon.uid",
        "eventReasonPlayer: 0",
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
        'location: "graveyard"',
        "reasonCardUid: falcon.uid",
      ],
    },
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "afterDamageBanish",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 0',
        'location: "banished", controller: 1',
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "afterDamageBanish",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 1',
        "deferredBattleDestroyed",
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-newdoria-battle-destroyed-target.test.ts",
      kind: "battleDestroyedMonsterDestroy",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "reasonCardUid: attacker!.uid",
      ],
    },
    {
      file: "test/lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "battleDestroyedMonsterDestroy",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "reasonCardUid: attacker!.uid",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-lesser-fiend-battle-destroy-redirect.test.ts",
      kind: "battleDestroyRedirect",
      required: [
        'eventName: "battleDestroyed"',
        "pendingTriggers).toEqual([])",
        "battleDamage).toEqual({ 0: 0, 1: 1100 })",
        'eventName: "battleDamageDealt"',
        "eventValue: 1100",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: lesserFiend!.uid",
        "eventReasonPlayer: 0",
        'eventName: "banished"',
        'location: "banished"',
        "code: 204",
        "reason: 0x4000021",
      ],
    },
    {
      file: "test/lua-real-script-yamato-no-kami-battle-destroy-backrow.test.ts",
      kind: "battleDestroyedBackrowDestroy",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        "property: 0xc000",
        'location: "graveyard", controller: 1',
        "specialSummonProcedure",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattledRemovalKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattledRemovalKinds(fixtures: Array<{ kind: BattledRemovalKind }>): Record<BattledRemovalKind, number> {
  return fixtures.reduce<Record<BattledRemovalKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      afterDamageBanish: 0,
      battleDestroyRedirect: 0,
      battleDestroyedBackrowDestroy: 0,
      battleDestroyedMonsterDestroy: 0,
    },
  );
}

function battledRemovalSemanticVariants(): Array<{
  file: string;
  kind: BattledRemovalSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-blade-burner-falcon-battle-destroying-detach-count-destroy.test.ts",
      kind: "bladeBurnerFalconBattleDestroyingDetachCountDestroy",
      required: [
        'const falconCode = "96592102"',
        "restores battle-destroying detach cost label into exact opponent monster destruction",
        'eventName: "battleDamageDealt"',
        "eventValue: 500",
        "eventReasonCardUid: falcon.uid",
        "expect(restoredBattle.session.state.pendingTriggers).toEqual",
        'effectId: "lua-3-1139"',
        'eventTriggerTiming: "when"',
        'eventName: "detachedMaterial"',
        "eventReasonEffectId: 3",
        "reasonCardUid: falcon.uid",
      ],
    },
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "ddAssailantAfterDamageBanishBoth",
      required: [
        'const assailantCode = "70074904"',
        "restores D.D. Assailant after damage calculation and banishes both battle participants",
        'eventName: "banished"',
        'location: "banished", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "divineKnightIshzarkAfterDamageBanishTarget",
      required: [
        'const ishzarkCode = "57902462"',
        "restores Divine Knight Ishzark after damage calculation and banishes the battle-destroyed target",
        "deferredBattleDestroyed",
        'location: "banished", controller: 1',
      ],
    },
    {
      file: "test/lua-real-script-lesser-fiend-battle-destroy-redirect.test.ts",
      kind: "lesserFiendBattleDestroyRedirect",
      required: [
        'const lesserFiendCode = "16475472"',
        "restores Lesser Fiend and banishes monsters it destroys by battle",
        "restores mutual Lesser Fiend battle destruction and redirects both monsters",
        'eventName: "battleDamageDealt"',
        "eventReasonCardUid: lesserFiend!.uid",
        "reason: 0x4000021",
      ],
    },
    {
      file: "test/lua-real-script-newdoria-battle-destroyed-target.test.ts",
      kind: "newdoriaBattleDestroyedTargetDestroy",
      required: [
        'const newdoriaCode = "4335645"',
        "restores Newdoria's battle-destroyed trigger and destroys its selected monster target",
        'eventName: "battleDestroyed"',
        "reasonCardUid: attacker!.uid",
      ],
    },
    {
      file: "test/lua-real-script-yamato-no-kami-battle-destroy-backrow.test.ts",
      kind: "yamatoNoKamiBattleDestroyedBackrowDestroy",
      required: [
        'const yamatoCode = "82841979"',
        "restores its banish-cost Special Summon and battle-destroying Spell/Trap destruction",
        "operationInfos: [{ category: 0x1",
        "specialSummonProcedure",
      ],
    },
    {
      file: "test/lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "yomiShipBattleDestroyedAttackerDestroy",
      required: [
        'const yomiShipCode = "51534754"',
        "restores Yomi Ship's battle-destroyed trigger and destroys the monster that destroyed it",
        "eventReasonEffectId: 1",
        "reasonCardUid: attacker!.uid",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattledRemovalSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattledRemovalSemanticVariants(
  fixtures: Array<{ kind: BattledRemovalSemanticVariant }>,
): Record<BattledRemovalSemanticVariant, number> {
  return fixtures.reduce<Record<BattledRemovalSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      bladeBurnerFalconBattleDestroyingDetachCountDestroy: 0,
      ddAssailantAfterDamageBanishBoth: 0,
      divineKnightIshzarkAfterDamageBanishTarget: 0,
      lesserFiendBattleDestroyRedirect: 0,
      newdoriaBattleDestroyedTargetDestroy: 0,
      yamatoNoKamiBattleDestroyedBackrowDestroy: 0,
      yomiShipBattleDestroyedAttackerDestroy: 0,
    },
  );
}
