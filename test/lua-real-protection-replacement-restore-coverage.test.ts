import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const protectionReplacementFixtureCount = 15;
const protectionReplacementKindCounts = {
  activatedImmunity: 1,
  battleTargetRelationProtection: 1,
  continuousBattleIndestructible: 1,
  countLimitedBattleIndestructible: 3,
  effectTargetProtection: 2,
  equipBattleProtectionSelfDestroy: 1,
  equipDestroySubstitute: 1,
  handGrantedIndestructible: 1,
  linkedTargetProtection: 1,
  persistentDestroyReplace: 1,
  positionConditionProtection: 1,
  temporaryBattleProtection: 1,
} satisfies Record<ProtectionReplacementKind, number>;
const protectionReplacementSemanticVariantCounts = {
  checksumDragonAttackPositionProtection: 1,
  darkFusionOpponentTargetProtection: 1,
  dForcePlasmaFieldTargetProtection: 1,
  forbiddenLanceActivatedImmunityStatLoss: 1,
  geminiSoldierBattleCountDeckSummon: 1,
  gyroidBattleCountProtection: 1,
  heartClearWaterEquipBattleProtectionSelfDestroy: 1,
  nightmareMagicianBattleTargetControlProtection: 1,
  phantomKnightsSwordPersistentDestroyReplace: 1,
  pilgrimContinuousBattleIndestructible: 1,
  redGardnaHandGrantedIndestructible: 1,
  riderStormWindsEquipDestroySubstitute: 1,
  runickSlumberCountLimitedProtection: 1,
  safeZoneLinkedTargetProtection: 1,
  wabokuTemporaryBattleProtection: 1,
} satisfies Record<ProtectionReplacementSemanticVariant, number>;

describe("Lua real protection and replacement restore coverage", () => {
  it("keeps protection/replacement fixture kinds explicit", () => {
    expect(countProtectionReplacementKinds(realScriptProtectionReplacementFixtureFiles())).toEqual(protectionReplacementKindCounts);
  });

  it("requires representative protection/replacement fixtures to assert Lua-aware restore", () => {
    const files = realScriptProtectionReplacementFixtureFiles();
    expect(files).toHaveLength(protectionReplacementFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative protection/replacement fixtures to prove restored semantics", () => {
    const files = realScriptProtectionReplacementFixtureFiles();
    expect(files).toHaveLength(protectionReplacementFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps named protection/replacement semantic variants explicit", () => {
    expect(countProtectionReplacementSemanticVariants(protectionReplacementSemanticVariants())).toEqual(
      protectionReplacementSemanticVariantCounts,
    );

    const missing = protectionReplacementSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(missing).toEqual([]);
  });
});

type ProtectionReplacementKind =
  | "activatedImmunity"
  | "battleTargetRelationProtection"
  | "continuousBattleIndestructible"
  | "countLimitedBattleIndestructible"
  | "effectTargetProtection"
  | "equipBattleProtectionSelfDestroy"
  | "equipDestroySubstitute"
  | "handGrantedIndestructible"
  | "linkedTargetProtection"
  | "persistentDestroyReplace"
  | "positionConditionProtection"
  | "temporaryBattleProtection";
type ProtectionReplacementSemanticVariant =
  | "checksumDragonAttackPositionProtection"
  | "darkFusionOpponentTargetProtection"
  | "dForcePlasmaFieldTargetProtection"
  | "forbiddenLanceActivatedImmunityStatLoss"
  | "geminiSoldierBattleCountDeckSummon"
  | "gyroidBattleCountProtection"
  | "heartClearWaterEquipBattleProtectionSelfDestroy"
  | "nightmareMagicianBattleTargetControlProtection"
  | "phantomKnightsSwordPersistentDestroyReplace"
  | "pilgrimContinuousBattleIndestructible"
  | "redGardnaHandGrantedIndestructible"
  | "riderStormWindsEquipDestroySubstitute"
  | "runickSlumberCountLimitedProtection"
  | "safeZoneLinkedTargetProtection"
  | "wabokuTemporaryBattleProtection";

function realScriptProtectionReplacementFixtureFiles(): Array<{ file: string; kind: ProtectionReplacementKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-phantom-knights-sword-persistent-replace.test.ts",
      kind: "persistentDestroyReplace",
      required: [
        "phantom sword persistent true/true/1/2600",
        "destroyDuelCard(restoredPersistent.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0)",
        "reason: duelReason.effect | duelReason.destroy | duelReason.replace",
        'action: "destroyReplace"',
      ],
    },
    {
      file: "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      kind: "equipDestroySubstitute",
      required: [
        "rider equip probe true/14239",
        "destroyDuelCard(restoredEquippedState.session.state, normalDragon!.uid, 0, duelReason.effect | duelReason.destroy, 1)",
        "reason: duelReason.effect | duelReason.destroy | duelReason.replace",
        'action: "destroySubstitute"',
      ],
    },
    {
      file: "lua-real-script-safe-zone-persistent-protection.test.ts",
      kind: "linkedTargetProtection",
      required: [
        "safe zone protection true/true/1/1/0/false/true/false/true",
        "sendDuelCardToGraveyard(restoredTargetLeaves.session.state, target!.uid, 0, duelReason.effect, 0)",
        "destroyDuelCard(restoredHandlerLeaves.session.state, safeZone!.uid, 0, duelReason.effect | duelReason.destroy, 1)",
        "expectCleanRestore(restoredDestroyed)",
      ],
    },
    {
      file: "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
      kind: "equipBattleProtectionSelfDestroy",
      required: [
        "restores battle indestructible equip protection and self-destroys when the equipped monster reaches 1300 ATK",
        "expect(battleIndestructible?.event).toBe(\"continuous\")",
        "expect(battleIndestructible?.range).toEqual([\"spellTrapZone\"])",
        "expect(battleIndestructible?.value).toBe(1)",
        "expect(restoredBattle.session.state.players[0].lifePoints).toBe(7400)",
        "expect(restoredBattle.session.state.cards.find((card) => card.uid === low.target.uid)).toMatchObject({ location: \"monsterZone\", controller: 0 })",
        "eventReason: duelReason.effect | duelReason.destroy",
      ],
    },
    {
      file: "lua-real-script-red-gardna-indestructible-restore.test.ts",
      kind: "handGrantedIndestructible",
      required: [
        'luaValueDescriptor: "indestructible:opponent"',
        "category: 0x1",
        'range: ["hand"]',
        "red gardna destroy resolved 0",
        "expect(restoredProtected.session.state.cards.find((card) => card.uid === protectedMonster!.uid)).toMatchObject({ location: \"monsterZone\", controller: 0 })",
        "expect(ownDestroy).toMatchObject({ uid: protectedMonster!.uid, location: \"graveyard\" })",
      ],
    },
    {
      file: "lua-real-script-dark-fusion-stage2-protection.test.ts",
      kind: "effectTargetProtection",
      required: [
        "restores opponent targeting protection granted to the summoned Fusion monster",
        'summonType: "fusion"',
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        "property: 0x10",
        'range: ["hand"]',
        "expect(getLuaRestoreLegalActions(restoredProtected, 1).find((action) => action.type === \"activateEffect\" && action.uid === opponentTarget!.uid)).toBeUndefined()",
        'expect(restoredProtected.host.messages).not.toContain("dark fusion target responder resolved")',
      ],
    },
    {
      file: "lua-real-script-d-force-target-protection.test.ts",
      kind: "effectTargetProtection",
      required: [
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        "d-force-target-protection-probe.lua",
        "dforce target protection false/true",
      ],
    },
    {
      file: "lua-real-script-runick-slumber-indestructible-count-restore.test.ts",
      kind: "countLimitedBattleIndestructible",
      required: [
        'luaValueDescriptor: "value-predicate:reason-mask:96"',
        "const battleDestroy = destroyDuelCard(restoredProtection.session.state, target!.uid, 0, duelReason.battle | duelReason.destroy, 1)",
        "expect(battleDestroy).toMatchObject({ uid: target!.uid, location: \"monsterZone\" })",
        "expect(effectDestroy).toMatchObject({ uid: target!.uid, location: \"graveyard\" })",
      ],
    },
    {
      file: "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "countLimitedBattleIndestructible",
      required: [
        "restores battled trigger, Deck Special Summon, and battle indestructible count",
        '"luaValueDescriptor": "value-predicate:reason-mask:32"',
        "expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: \"monsterZone\" })",
        "expect(restoredChain.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: \"monsterZone\", controller: 0 })",
        "expect(restoredChain.session.state.players[0].lifePoints).toBe(7500)",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "lua-real-script-gyroid-indestructible-count.test.ts",
      kind: "countLimitedBattleIndestructible",
      required: [
        "restores Gyroid's once-per-turn battle destruction count",
        'const gyroidCode = "18325492"',
        'luaValueDescriptor: "value-predicate:reason-mask:32"',
        "const battleDestroy = destroyDuelCard(restored.session.state, gyroid!.uid, 0, duelReason.battle | duelReason.destroy, 1)",
        "expect(battleDestroy).toMatchObject({ uid: gyroid!.uid, location: \"monsterZone\" })",
        "expect(secondBattleDestroy).toMatchObject({ uid: gyroid!.uid, location: \"graveyard\", reason: duelReason.battle | duelReason.destroy })",
      ],
    },
    {
      file: "lua-real-script-forbidden-lance-stat-immunity.test.ts",
      kind: "activatedImmunity",
      required: [
        "expect.objectContaining({ event: \"continuous\", code: 100, sourceUid: attacker!.uid, value: -800 })",
        "expect.objectContaining({ event: \"continuous\", code: 1, sourceUid: attacker!.uid })",
        "expect(restored.session.state.battleDamage[0]).toBe(300)",
        "expect(restored.host.messages).not.toContain(\"forbidden lance responder resolved\")",
      ],
    },
    {
      file: "lua-real-script-battle-protection.test.ts",
      kind: "continuousBattleIndestructible",
      required: [
        "expect.objectContaining({ event: \"continuous\", code: 42, sourceUid: pilgrim!.uid })",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 500 })",
        'eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 500',
        "expect(restored.session.state.cards.find((card) => card.uid === pilgrim!.uid)).toMatchObject({ location: \"monsterZone\", controller: 1 })",
      ],
    },
    {
      file: "lua-real-script-waboku-temporary-battle-protection.test.ts",
      kind: "temporaryBattleProtection",
      required: [
        "code: effectAvoidBattleDamage",
        "code: effectIndestructibleBattle",
        "expect(restoredProtection.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "battleDamageDealt", eventPlayer: 0',
        "effect.code === effectAvoidBattleDamage || effect.code === effectIndestructibleBattle",
      ],
    },
    {
      file: "lua-real-script-checksum-dragon-position-indestructible.test.ts",
      kind: "positionConditionProtection",
      required: [
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        'luaConditionDescriptor: "condition:source-attack-position"',
        "const attackPositionDestroy = destroyDuelCard(restored.session.state, restoredDragon!.uid, 0, duelReason.battle | duelReason.destroy, 1)",
        "expect(attackPositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: \"monsterZone\" })",
        "expect(defensePositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: \"graveyard\", reason: duelReason.battle | duelReason.destroy })",
      ],
    },
    {
      file: "lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "battleTargetRelationProtection",
      required: [
        'luaTargetDescriptor: "target:source-or-battle-target"',
        "expect(session.state.battleDamage).toEqual({ 0: 0, 1: 500 })",
        "expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: \"monsterZone\", controller: 1 })",
        "previousController: 1",
      ],
    },
  ] satisfies Array<{ file: string; kind: ProtectionReplacementKind; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

function protectionReplacementSemanticVariants(): Array<{
  file: string;
  kind: ProtectionReplacementSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-battle-protection.test.ts",
      kind: "pilgrimContinuousBattleIndestructible",
      requiredSnippets: [
        'const pilgrimCode = "20700531"',
        "restores Pilgrim of the Ice Barrier and keeps it from battle destruction by a high-ATK monster",
        'eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "test/lua-real-script-checksum-dragon-position-indestructible.test.ts",
      kind: "checksumDragonAttackPositionProtection",
      requiredSnippets: [
        'const checksumDragonCode = "94136469"',
        "restores its Attack Position-only battle indestructible effect",
        'luaConditionDescriptor: "condition:source-attack-position"',
      ],
    },
    {
      file: "test/lua-real-script-d-force-target-protection.test.ts",
      kind: "dForcePlasmaFieldTargetProtection",
      requiredSnippets: [
        'const dForceCode = "6186304"',
        "restores official field-wide cannot-be-effect-target protection while Plasma is face-up",
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
      ],
    },
    {
      file: "test/lua-real-script-dark-fusion-stage2-protection.test.ts",
      kind: "darkFusionOpponentTargetProtection",
      requiredSnippets: [
        'const darkFusionCode = "94820406"',
        "restores opponent targeting protection granted to the summoned Fusion monster",
        'summonType: "fusion"',
      ],
    },
    {
      file: "test/lua-real-script-forbidden-lance-stat-immunity.test.ts",
      kind: "forbiddenLanceActivatedImmunityStatLoss",
      requiredSnippets: [
        'const lanceCode = "27243130"',
        "restores Forbidden Lance's target and applies the ATK loss to battle calculation",
        "expect(restored.session.state.battleDamage[0]).toBe(300)",
      ],
    },
    {
      file: "test/lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "geminiSoldierBattleCountDeckSummon",
      requiredSnippets: [
        'const soldierCode = "68366996"',
        "restores battled trigger, Deck Special Summon, and battle indestructible count",
        '"luaValueDescriptor": "value-predicate:reason-mask:32"',
      ],
    },
    {
      file: "test/lua-real-script-gyroid-indestructible-count.test.ts",
      kind: "gyroidBattleCountProtection",
      requiredSnippets: [
        'const gyroidCode = "18325492"',
        "restores Gyroid's once-per-turn battle destruction count",
        'luaValueDescriptor: "value-predicate:reason-mask:32"',
      ],
    },
    {
      file: "test/lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
      kind: "heartClearWaterEquipBattleProtectionSelfDestroy",
      requiredSnippets: [
        'const heartCode = "64801562"',
        "restores battle indestructible equip protection and self-destroys when the equipped monster reaches 1300 ATK",
        "eventReason: duelReason.effect | duelReason.destroy",
      ],
    },
    {
      file: "test/lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "nightmareMagicianBattleTargetControlProtection",
      requiredSnippets: [
        'const nightmareCode = "40221691"',
        "restores battle-target indestructibility and controls the battled monster at Damage Step end",
        'luaTargetDescriptor: "target:source-or-battle-target"',
      ],
    },
    {
      file: "test/lua-real-script-phantom-knights-sword-persistent-replace.test.ts",
      kind: "phantomKnightsSwordPersistentDestroyReplace",
      requiredSnippets: [
        'const swordCode = "61936647"',
        "restores official persistent ATK boost and destruction replacement",
        'action: "destroyReplace"',
      ],
    },
    {
      file: "test/lua-real-script-red-gardna-indestructible-restore.test.ts",
      kind: "redGardnaHandGrantedIndestructible",
      requiredSnippets: [
        'const redGardnaCode = "72318602"',
        "restores Red Gardna's dynamic opponent-destruction protection",
        'luaValueDescriptor: "indestructible:opponent"',
      ],
    },
    {
      file: "test/lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      kind: "riderStormWindsEquipDestroySubstitute",
      requiredSnippets: [
        'const riderCode = "14235211"',
        "restores its self-equip destroy substitute for the equipped monster",
        'action: "destroySubstitute"',
      ],
    },
    {
      file: "test/lua-real-script-runick-slumber-indestructible-count-restore.test.ts",
      kind: "runickSlumberCountLimitedProtection",
      requiredSnippets: [
        'const slumberCode = "67835547"',
        "restores Runick Slumber's temporary battle/effect destruction count",
        'luaValueDescriptor: "value-predicate:reason-mask:96"',
      ],
    },
    {
      file: "test/lua-real-script-safe-zone-persistent-protection.test.ts",
      kind: "safeZoneLinkedTargetProtection",
      requiredSnippets: [
        'const safeZoneCode = "38296564"',
        "restores official persistent protection, targetability, direct-attack lock, and handler-leaves cleanup",
        "safe zone protection true/true/1/1/0/false/true/false/true",
      ],
    },
    {
      file: "test/lua-real-script-waboku-temporary-battle-protection.test.ts",
      kind: "wabokuTemporaryBattleProtection",
      requiredSnippets: [
        'const wabokuCode = "12607053"',
        "restores Trap-registered battle damage prevention and battle indestructibility until the End Phase",
        "code: effectAvoidBattleDamage",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ProtectionReplacementSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countProtectionReplacementKinds(
  fixtures: Array<{ kind: ProtectionReplacementKind }>,
): Record<ProtectionReplacementKind, number> {
  return fixtures.reduce<Record<ProtectionReplacementKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      activatedImmunity: 0,
      battleTargetRelationProtection: 0,
      continuousBattleIndestructible: 0,
      countLimitedBattleIndestructible: 0,
      effectTargetProtection: 0,
      equipBattleProtectionSelfDestroy: 0,
      equipDestroySubstitute: 0,
      handGrantedIndestructible: 0,
      linkedTargetProtection: 0,
      persistentDestroyReplace: 0,
      positionConditionProtection: 0,
      temporaryBattleProtection: 0,
    },
  );
}

function countProtectionReplacementSemanticVariants(
  fixtures: Array<{ kind: ProtectionReplacementSemanticVariant }>,
): Record<ProtectionReplacementSemanticVariant, number> {
  return fixtures.reduce<Record<ProtectionReplacementSemanticVariant, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      checksumDragonAttackPositionProtection: 0,
      darkFusionOpponentTargetProtection: 0,
      dForcePlasmaFieldTargetProtection: 0,
      forbiddenLanceActivatedImmunityStatLoss: 0,
      geminiSoldierBattleCountDeckSummon: 0,
      gyroidBattleCountProtection: 0,
      heartClearWaterEquipBattleProtectionSelfDestroy: 0,
      nightmareMagicianBattleTargetControlProtection: 0,
      phantomKnightsSwordPersistentDestroyReplace: 0,
      pilgrimContinuousBattleIndestructible: 0,
      redGardnaHandGrantedIndestructible: 0,
      riderStormWindsEquipDestroySubstitute: 0,
      runickSlumberCountLimitedProtection: 0,
      safeZoneLinkedTargetProtection: 0,
      wabokuTemporaryBattleProtection: 0,
    },
  );
}
