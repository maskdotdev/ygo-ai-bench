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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Therion equipped target setcode condition", () => {
  it("restores local handler equipped-target setcode checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const regulusCode = "10604644";
    const therionTargetCode = "10604645";
    const offSetTargetCode = "10604646";
    const setTherion = 0x17b;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === regulusCode),
      { code: therionTargetCode, name: "Therion Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [setTherion], level: 4, attack: 1500, defense: 1500 },
      { code: offSetTargetCode, name: "Off-Set Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [0x123], level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 108, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [regulusCode, therionTargetCode, offSetTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const regulus = session.state.cards.find((card) => card.code === regulusCode);
    const therionTarget = session.state.cards.find((card) => card.code === therionTargetCode);
    const offSetTarget = session.state.cards.find((card) => card.code === offSetTargetCode);
    expect(regulus).toBeDefined();
    expect(therionTarget).toBeDefined();
    expect(offSetTarget).toBeDefined();
    moveDuelCard(session.state, therionTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, offSetTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, regulus!.uid, "spellTrapZone", 0);
    regulus!.faceUp = true;
    regulus!.equippedToUid = therionTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regulusCode}),0,LOCATION_SZONE,0,nil)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_EQUIP)
      e3:SetCode(EFFECT_UPDATE_ATTACK)
      e3:SetCondition(function(e)
        local c=e:GetHandler()
        local ec=c:GetEquipTarget()
        return ec and ec:IsSetCard(SET_THERION)
      end)
      e3:SetValue(700)
      c:RegisterEffect(e3)
      `,
      "therion-regulus-official-local-handler-equipped-target-setcode.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 100);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-setcode:${setTherion}`,
      range: ["spellTrapZone"],
      value: 700,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredRegulus = restored.session.state.cards.find((card) => card.code === regulusCode);
    const restoredOffSet = restored.session.state.cards.find((card) => card.code === offSetTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 100 && candidate.sourceUid === regulus!.uid);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRegulus!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredRegulus!.equippedToUid = restoredOffSet!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredRegulus!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local equipped-target setcode checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const regulusCode = "10604644";
    const therionTargetCode = "10604645";
    const offSetTargetCode = "10604646";
    const setTherion = 0x17b;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === regulusCode),
      { code: therionTargetCode, name: "Therion Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [setTherion], level: 4, attack: 1500, defense: 1500 },
      { code: offSetTargetCode, name: "Off-Set Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [0x123], level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 107, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [regulusCode, therionTargetCode, offSetTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const regulus = session.state.cards.find((card) => card.code === regulusCode);
    const therionTarget = session.state.cards.find((card) => card.code === therionTargetCode);
    const offSetTarget = session.state.cards.find((card) => card.code === offSetTargetCode);
    expect(regulus).toBeDefined();
    expect(therionTarget).toBeDefined();
    expect(offSetTarget).toBeDefined();
    moveDuelCard(session.state, therionTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, offSetTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, regulus!.uid, "spellTrapZone", 0);
    regulus!.faceUp = true;
    regulus!.equippedToUid = therionTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regulusCode}),0,LOCATION_SZONE,0,nil)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_EQUIP)
      e3:SetCode(EFFECT_UPDATE_ATTACK)
      e3:SetCondition(function(e)
        local ec=e:GetHandler():GetEquipTarget()
        return ec and ec:IsSetCard(SET_THERION)
      end)
      e3:SetValue(700)
      c:RegisterEffect(e3)
      `,
      "therion-regulus-official-local-equipped-target-setcode.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 100);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-setcode:${setTherion}`,
      range: ["spellTrapZone"],
      value: 700,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredRegulus = restored.session.state.cards.find((card) => card.code === regulusCode);
    const restoredOffSet = restored.session.state.cards.find((card) => card.code === offSetTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 100 && candidate.sourceUid === regulus!.uid);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRegulus!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredRegulus!.equippedToUid = restoredOffSet!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredRegulus!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores equipped-target setcode checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const regulusCode = "10604644";
    const therionTargetCode = "10604645";
    const offSetTargetCode = "10604646";
    const setTherion = 0x17b;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === regulusCode),
      { code: therionTargetCode, name: "Therion Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [setTherion], level: 4, attack: 1500, defense: 1500 },
      { code: offSetTargetCode, name: "Off-Set Equipped Target", kind: "monster", typeFlags: 0x1, setcodes: [0x123], level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 106, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [regulusCode, therionTargetCode, offSetTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const regulus = session.state.cards.find((card) => card.code === regulusCode);
    const therionTarget = session.state.cards.find((card) => card.code === therionTargetCode);
    const offSetTarget = session.state.cards.find((card) => card.code === offSetTargetCode);
    expect(regulus).toBeDefined();
    expect(therionTarget).toBeDefined();
    expect(offSetTarget).toBeDefined();
    moveDuelCard(session.state, therionTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, offSetTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, regulus!.uid, "spellTrapZone", 0);
    regulus!.faceUp = true;
    regulus!.equippedToUid = therionTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${regulusCode}),0,LOCATION_SZONE,0,nil)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_EQUIP)
      e3:SetCode(EFFECT_UPDATE_ATTACK)
      e3:SetCondition(function(e) return e:GetHandler():GetEquipTarget():IsSetCard(SET_THERION) end)
      e3:SetValue(700)
      c:RegisterEffect(e3)
      `,
      "therion-regulus-official-equipped-target-setcode.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 100);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-setcode:${setTherion}`,
      range: ["spellTrapZone"],
      value: 700,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredRegulus = restored.session.state.cards.find((card) => card.code === regulusCode);
    const restoredTherion = restored.session.state.cards.find((card) => card.code === therionTargetCode);
    const restoredOffSet = restored.session.state.cards.find((card) => card.code === offSetTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 100 && candidate.sourceUid === regulus!.uid);
    expect(restoredRegulus).toBeDefined();
    expect(restoredTherion).toBeDefined();
    expect(restoredOffSet).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-setcode:${setTherion}`,
      range: ["spellTrapZone"],
      value: 700,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRegulus!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredRegulus!.equippedToUid = restoredOffSet!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredRegulus!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
