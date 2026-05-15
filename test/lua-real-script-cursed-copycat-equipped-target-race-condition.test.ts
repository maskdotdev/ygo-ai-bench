import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cursed Copycat equipped target race condition", () => {
  it("restores local handler equipped-target race checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const copycatCode = "23249029";
    const warriorTargetCode = "23249030";
    const machineTargetCode = "23249031";
    const raceWarrior = 0x1;
    const raceMachine = 0x20;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === copycatCode),
      { code: warriorTargetCode, name: "Cursed Copycat Warrior Target", kind: "monster", typeFlags: 0x1, race: raceWarrior, level: 4, attack: 1500, defense: 1500 },
      { code: machineTargetCode, name: "Cursed Copycat Machine Target", kind: "monster", typeFlags: 0x1, race: raceMachine, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2325, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [copycatCode, warriorTargetCode, machineTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const copycat = session.state.cards.find((card) => card.code === copycatCode);
    const warriorTarget = session.state.cards.find((card) => card.code === warriorTargetCode);
    const machineTarget = session.state.cards.find((card) => card.code === machineTargetCode);
    expect(copycat).toBeDefined();
    expect(warriorTarget).toBeDefined();
    expect(machineTarget).toBeDefined();
    moveDuelCard(session.state, warriorTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, machineTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, copycat!.uid, "spellTrapZone", 0);
    copycat!.faceUp = true;
    copycat!.equippedToUid = warriorTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${copycatCode}),0,LOCATION_SZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_EQUIP)
      e1:SetCode(EFFECT_UPDATE_ATTACK)
      e1:SetCondition(function(e)
        local c=e:GetHandler()
        local ec=c:GetEquipTarget()
        return ec and ec:IsRace(RACE_WARRIOR)
      end)
      e1:SetValue(200)
      c:RegisterEffect(e1)
      `,
      "cursed-copycat-official-local-handler-equipped-target-race.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 100);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-race:${raceWarrior}`,
      range: ["spellTrapZone"],
      value: 200,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredCopycat = restored.session.state.cards.find((card) => card.code === copycatCode);
    const restoredMachine = restored.session.state.cards.find((card) => card.code === machineTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 100 && candidate.sourceUid === copycat!.uid);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredCopycat!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredCopycat!.equippedToUid = restoredMachine!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredCopycat!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local equipped-target race checks without treating every equip as valid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const copycatCode = "23249029";
    const warriorTargetCode = "23249030";
    const machineTargetCode = "23249031";
    const raceWarrior = 0x1;
    const raceMachine = 0x20;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === copycatCode),
      { code: warriorTargetCode, name: "Cursed Copycat Warrior Target", kind: "monster", typeFlags: 0x1, race: raceWarrior, level: 4, attack: 1500, defense: 1500 },
      { code: machineTargetCode, name: "Cursed Copycat Machine Target", kind: "monster", typeFlags: 0x1, race: raceMachine, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2324, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [copycatCode, warriorTargetCode, machineTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const copycat = session.state.cards.find((card) => card.code === copycatCode);
    const warriorTarget = session.state.cards.find((card) => card.code === warriorTargetCode);
    const machineTarget = session.state.cards.find((card) => card.code === machineTargetCode);
    expect(copycat).toBeDefined();
    expect(warriorTarget).toBeDefined();
    expect(machineTarget).toBeDefined();
    moveDuelCard(session.state, warriorTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, machineTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, copycat!.uid, "spellTrapZone", 0);
    copycat!.faceUp = true;
    copycat!.equippedToUid = warriorTarget!.uid;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${copycatCode}),0,LOCATION_SZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_EQUIP)
      e1:SetCode(EFFECT_UPDATE_ATTACK)
      e1:SetCondition(function(e) local ec=e:GetHandler():GetEquipTarget() return ec and ec:IsRace(RACE_WARRIOR) end)
      e1:SetValue(200)
      c:RegisterEffect(e1)
      `,
      "cursed-copycat-official-equipped-target-race.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 100);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-race:${raceWarrior}`,
      range: ["spellTrapZone"],
      value: 200,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredCopycat = restored.session.state.cards.find((card) => card.code === copycatCode);
    const restoredMachine = restored.session.state.cards.find((card) => card.code === machineTargetCode);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 100 && candidate.sourceUid === copycat!.uid);
    expect(restoredCopycat).toBeDefined();
    expect(restoredMachine).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 100,
      luaConditionDescriptor: `condition:equipped-target-race:${raceWarrior}`,
      range: ["spellTrapZone"],
      value: 200,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredCopycat!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredCopycat!.equippedToUid = restoredMachine!.uid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredCopycat!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
