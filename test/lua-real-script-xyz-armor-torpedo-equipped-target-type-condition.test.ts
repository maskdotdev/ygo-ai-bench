import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz Armor Torpedo equipped target type condition", () => {
  it("restores local handler equipped-target type checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const armorTorpedoCode = "94151981";
    const xyzTargetCode = "94151982";
    const nonXyzTargetCode = "94151983";
    const typeXyz = 0x800000;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === armorTorpedoCode),
      { code: xyzTargetCode, name: "Armor Torpedo Xyz Target", kind: "extra", typeFlags: 0x800001, level: 4, attack: 2000, defense: 2000 },
      { code: nonXyzTargetCode, name: "Armor Torpedo Non-Xyz Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9417, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [armorTorpedoCode, xyzTargetCode], main: [nonXyzTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const armorTorpedo = session.state.cards.find((card) => card.code === armorTorpedoCode);
    const xyzTarget = session.state.cards.find((card) => card.code === xyzTargetCode);
    const nonXyzTarget = session.state.cards.find((card) => card.code === nonXyzTargetCode);
    expect(armorTorpedo).toBeDefined();
    expect(xyzTarget).toBeDefined();
    expect(nonXyzTarget).toBeDefined();
    moveDuelCard(session.state, xyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, nonXyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, armorTorpedo!.uid, "spellTrapZone", 0);
    armorTorpedo!.faceUp = true;
    armorTorpedo!.equippedToUid = xyzTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${armorTorpedoCode}),0,LOCATION_SZONE,0,nil)
      local e5=Effect.CreateEffect(c)
      e5:SetType(EFFECT_TYPE_EQUIP)
      e5:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      e5:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e5:SetCondition(function(e)
        local c=e:GetHandler()
        local ec=c:GetEquipTarget()
        return ec and ec:IsType(TYPE_XYZ)
      end)
      e5:SetValue(aux.tgoval)
      c:RegisterEffect(e5)
      `,
      "xyz-armor-torpedo-official-local-handler-equipped-target-type.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 71);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: `condition:equipped-target-type:${typeXyz}`,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["spellTrapZone"],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredArmor = restored.session.state.cards.find((card) => card.code === armorTorpedoCode);
    const restoredNonXyz = restored.session.state.cards.find((card) => card.code === nonXyzTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 71 && candidate.sourceUid === armorTorpedo!.uid);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredArmor!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredArmor!.equippedToUid = restoredNonXyz!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredArmor!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local equipped-target type checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const armorTorpedoCode = "94151981";
    const xyzTargetCode = "94151982";
    const nonXyzTargetCode = "94151983";
    const typeXyz = 0x800000;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === armorTorpedoCode),
      { code: xyzTargetCode, name: "Armor Torpedo Xyz Target", kind: "extra", typeFlags: 0x800001, level: 4, attack: 2000, defense: 2000 },
      { code: nonXyzTargetCode, name: "Armor Torpedo Non-Xyz Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9416, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [armorTorpedoCode, xyzTargetCode], main: [nonXyzTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const armorTorpedo = session.state.cards.find((card) => card.code === armorTorpedoCode);
    const xyzTarget = session.state.cards.find((card) => card.code === xyzTargetCode);
    const nonXyzTarget = session.state.cards.find((card) => card.code === nonXyzTargetCode);
    expect(armorTorpedo).toBeDefined();
    expect(xyzTarget).toBeDefined();
    expect(nonXyzTarget).toBeDefined();
    moveDuelCard(session.state, xyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, nonXyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, armorTorpedo!.uid, "spellTrapZone", 0);
    armorTorpedo!.faceUp = true;
    armorTorpedo!.equippedToUid = xyzTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${armorTorpedoCode}),0,LOCATION_SZONE,0,nil)
      local e5=Effect.CreateEffect(c)
      e5:SetType(EFFECT_TYPE_EQUIP)
      e5:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      e5:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e5:SetCondition(function(e)
        local ec=e:GetHandler():GetEquipTarget()
        return ec and ec:IsType(TYPE_XYZ)
      end)
      e5:SetValue(aux.tgoval)
      c:RegisterEffect(e5)
      `,
      "xyz-armor-torpedo-official-local-equipped-target-type.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 71);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: `condition:equipped-target-type:${typeXyz}`,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["spellTrapZone"],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredArmor = restored.session.state.cards.find((card) => card.code === armorTorpedoCode);
    const restoredNonXyz = restored.session.state.cards.find((card) => card.code === nonXyzTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 71 && candidate.sourceUid === armorTorpedo!.uid);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredArmor!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredArmor!.equippedToUid = restoredNonXyz!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredArmor!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores equipped-target type checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const armorTorpedoCode = "94151981";
    const xyzTargetCode = "94151982";
    const nonXyzTargetCode = "94151983";
    const typeXyz = 0x800000;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === armorTorpedoCode),
      { code: xyzTargetCode, name: "Armor Torpedo Xyz Target", kind: "extra", typeFlags: 0x800001, level: 4, attack: 2000, defense: 2000 },
      { code: nonXyzTargetCode, name: "Armor Torpedo Non-Xyz Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9415, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [armorTorpedoCode, xyzTargetCode], main: [nonXyzTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const armorTorpedo = session.state.cards.find((card) => card.code === armorTorpedoCode);
    const xyzTarget = session.state.cards.find((card) => card.code === xyzTargetCode);
    const nonXyzTarget = session.state.cards.find((card) => card.code === nonXyzTargetCode);
    expect(armorTorpedo).toBeDefined();
    expect(xyzTarget).toBeDefined();
    expect(nonXyzTarget).toBeDefined();
    moveDuelCard(session.state, xyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, nonXyzTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, armorTorpedo!.uid, "spellTrapZone", 0);
    armorTorpedo!.faceUp = true;
    armorTorpedo!.equippedToUid = xyzTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${armorTorpedoCode}),0,LOCATION_SZONE,0,nil)
      local e5=Effect.CreateEffect(c)
      e5:SetType(EFFECT_TYPE_EQUIP)
      e5:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      e5:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e5:SetCondition(function(e) return e:GetHandler():GetEquipTarget():IsType(TYPE_XYZ) end)
      e5:SetValue(aux.tgoval)
      c:RegisterEffect(e5)
      `,
      "xyz-armor-torpedo-official-equipped-target-type.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 71);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: `condition:equipped-target-type:${typeXyz}`,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["spellTrapZone"],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredArmor = restored.session.state.cards.find((card) => card.code === armorTorpedoCode);
    const restoredXyz = restored.session.state.cards.find((card) => card.code === xyzTargetCode);
    const restoredNonXyz = restored.session.state.cards.find((card) => card.code === nonXyzTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 71 && candidate.sourceUid === armorTorpedo!.uid);
    expect(restoredArmor).toBeDefined();
    expect(restoredXyz).toBeDefined();
    expect(restoredNonXyz).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: `condition:equipped-target-type:${typeXyz}`,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["spellTrapZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredArmor!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredArmor!.equippedToUid = restoredNonXyz!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredArmor!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
