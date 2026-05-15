import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const protectionReplacementFixtureCount = 9;

describe("Lua real protection and replacement restore coverage", () => {
  it("requires representative protection/replacement fixtures to assert Lua-aware restore", () => {
    const files = realScriptProtectionReplacementFixtureFiles();
    expect(files).toHaveLength(protectionReplacementFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptProtectionReplacementFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-phantom-knights-sword-persistent-replace.test.ts",
      required: [
        "phantom sword persistent true/true/1/2600",
        "destroyDuelCard(restoredPersistent.session.state, target!.uid, 1, duelReason.effect | duelReason.destroy, 0)",
        "reason: duelReason.effect | duelReason.destroy | duelReason.replace",
        'action: "destroyReplace"',
      ],
    },
    {
      file: "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      required: [
        "rider equip probe true/14239",
        "destroyDuelCard(restoredEquippedState.session.state, normalDragon!.uid, 0, duelReason.effect | duelReason.destroy, 1)",
        "reason: duelReason.effect | duelReason.destroy | duelReason.replace",
        'action: "destroySubstitute"',
      ],
    },
    {
      file: "lua-real-script-safe-zone-persistent-protection.test.ts",
      required: [
        "safe zone protection true/true/1/1/0/false/true/false/true",
        "sendDuelCardToGraveyard(restoredTargetLeaves.session.state, target!.uid, 0, duelReason.effect, 0)",
        "destroyDuelCard(restoredHandlerLeaves.session.state, safeZone!.uid, 0, duelReason.effect | duelReason.destroy, 1)",
        "expectCleanRestore(restoredDestroyed)",
      ],
    },
    {
      file: "lua-real-script-red-gardna-indestructible-restore.test.ts",
      required: [
        'luaValueDescriptor: "indestructible:opponent"',
        "red gardna destroy resolved 0",
        "expect(restoredProtected.session.state.cards.find((card) => card.uid === protectedMonster!.uid)).toMatchObject({ location: \"monsterZone\", controller: 0 })",
        "expect(ownDestroy).toMatchObject({ uid: protectedMonster!.uid, location: \"graveyard\" })",
      ],
    },
    {
      file: "lua-real-script-d-force-target-protection.test.ts",
      required: [
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        "d-force-target-protection-probe.lua",
        "dforce target protection false/true",
      ],
    },
    {
      file: "lua-real-script-runick-slumber-indestructible-count-restore.test.ts",
      required: [
        'luaValueDescriptor: "value-predicate:reason-mask:96"',
        "const battleDestroy = destroyDuelCard(restoredProtection.session.state, target!.uid, 0, duelReason.battle | duelReason.destroy, 1)",
        "expect(battleDestroy).toMatchObject({ uid: target!.uid, location: \"monsterZone\" })",
        "expect(effectDestroy).toMatchObject({ uid: target!.uid, location: \"graveyard\" })",
      ],
    },
    {
      file: "lua-real-script-forbidden-lance-stat-immunity.test.ts",
      required: [
        "expect.objectContaining({ event: \"continuous\", code: 100, sourceUid: attacker!.uid, value: -800 })",
        "expect.objectContaining({ event: \"continuous\", code: 1, sourceUid: attacker!.uid })",
        "expect(restored.session.state.battleDamage[0]).toBe(300)",
        "expect(restored.host.messages).not.toContain(\"forbidden lance responder resolved\")",
      ],
    },
    {
      file: "lua-real-script-battle-protection.test.ts",
      required: [
        "expect.objectContaining({ event: \"continuous\", code: 42, sourceUid: pilgrim!.uid })",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 500 })",
        'eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 500',
        "expect(restored.session.state.cards.find((card) => card.uid === pilgrim!.uid)).toMatchObject({ location: \"monsterZone\", controller: 1 })",
      ],
    },
    {
      file: "lua-real-script-waboku-temporary-battle-protection.test.ts",
      required: [
        "code: effectAvoidBattleDamage",
        "code: effectIndestructibleBattle",
        "expect(restoredProtection.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "battleDamageDealt", eventPlayer: 0',
        "effect.code === effectAvoidBattleDamage || effect.code === effectIndestructibleBattle",
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
