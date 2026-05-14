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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dragon Buster equipped Clock Lizard lock", () => {
  it("restores local handler equipped-only opponent Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dragonBusterCode = "76218313";
    const busterBladerCode = "78193831";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonBusterCode),
      { code: busterBladerCode, name: "Buster Blader Equip Target", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x1, level: 7, attack: 2600, defense: 2300 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 764, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonBusterCode, busterBladerCode] }, 1: { main: [] } });
    startDuel(session);
    const dragonBuster = session.state.cards.find((card) => card.code === dragonBusterCode);
    const busterBlader = session.state.cards.find((card) => card.code === busterBladerCode);
    expect(dragonBuster).toBeDefined();
    expect(busterBlader).toBeDefined();
    moveDuelCard(session.state, busterBlader!.uid, "monsterZone", 0);
    busterBlader!.faceUp = true;
    busterBlader!.position = "faceUpAttack";
    moveDuelCard(session.state, dragonBuster!.uid, "spellTrapZone", 0);
    dragonBuster!.faceUp = true;
    dragonBuster!.equippedToUid = busterBlader!.uid;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonBusterCode}),0,LOCATION_SZONE,0,nil)
      local e4=aux.createContinuousLizardCheck(c,LOCATION_SZONE,nil,0,0xff)
      e4:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetEquipTarget()
      end)
      c:RegisterEffect(e4)
      `,
      "dragon-buster-official-local-handler-equipped-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaConditionDescriptor: "condition:source-equipped",
      range: ["spellTrapZone"],
      targetRange: [0, 0xff],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const restoredDragonBuster = restored.session.state.cards.find((card) => card.code === dragonBusterCode);
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredDragonBuster).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragonBuster!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    delete restoredDragonBuster!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local equipped-only opponent Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dragonBusterCode = "76218313";
    const busterBladerCode = "78193831";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonBusterCode),
      { code: busterBladerCode, name: "Buster Blader Equip Target", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x1, level: 7, attack: 2600, defense: 2300 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 763, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonBusterCode, busterBladerCode] }, 1: { main: [] } });
    startDuel(session);
    const dragonBuster = session.state.cards.find((card) => card.code === dragonBusterCode);
    const busterBlader = session.state.cards.find((card) => card.code === busterBladerCode);
    expect(dragonBuster).toBeDefined();
    expect(busterBlader).toBeDefined();
    moveDuelCard(session.state, busterBlader!.uid, "monsterZone", 0);
    busterBlader!.faceUp = true;
    busterBlader!.position = "faceUpAttack";
    moveDuelCard(session.state, dragonBuster!.uid, "spellTrapZone", 0);
    dragonBuster!.faceUp = true;
    dragonBuster!.equippedToUid = busterBlader!.uid;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonBusterCode}),0,LOCATION_SZONE,0,nil)
      local e4=aux.createContinuousLizardCheck(c,LOCATION_SZONE,nil,0,0xff)
      e4:SetCondition(function(e)
        local ec=e:GetHandler():GetEquipTarget()
        return ec
      end)
      c:RegisterEffect(e4)
      `,
      "dragon-buster-official-local-equipped-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaConditionDescriptor: "condition:source-equipped",
      range: ["spellTrapZone"],
      targetRange: [0, 0xff],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const restoredDragonBuster = restored.session.state.cards.find((card) => card.code === dragonBusterCode);
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredDragonBuster).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragonBuster!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    delete restoredDragonBuster!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores its equipped-only opponent Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dragonBusterCode = "76218313";
    const busterBladerCode = "78193831";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonBusterCode),
      { code: busterBladerCode, name: "Buster Blader Equip Target", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x1, level: 7, attack: 2600, defense: 2300 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 762, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonBusterCode, busterBladerCode] }, 1: { main: [] } });
    startDuel(session);
    const dragonBuster = session.state.cards.find((card) => card.code === dragonBusterCode);
    const busterBlader = session.state.cards.find((card) => card.code === busterBladerCode);
    expect(dragonBuster).toBeDefined();
    expect(busterBlader).toBeDefined();
    moveDuelCard(session.state, busterBlader!.uid, "monsterZone", 0);
    busterBlader!.faceUp = true;
    busterBlader!.position = "faceUpAttack";
    moveDuelCard(session.state, dragonBuster!.uid, "spellTrapZone", 0);
    dragonBuster!.faceUp = true;
    dragonBuster!.equippedToUid = busterBlader!.uid;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dragonBusterCode}),0,LOCATION_SZONE,0,nil)
      local e4=aux.createContinuousLizardCheck(c,LOCATION_SZONE,nil,0,0xff)
      e4:SetCondition(function(e) return e:GetHandler():GetEquipTarget() end)
      c:RegisterEffect(e4)
      `,
      "dragon-buster-official-equipped-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaConditionDescriptor: "condition:source-equipped",
      range: ["spellTrapZone"],
      targetRange: [0, 0xff],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const restoredDragonBuster = restored.session.state.cards.find((card) => card.code === dragonBusterCode);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-equipped",
      range: ["spellTrapZone"],
      targetRange: [0, 0xff],
      value: 1,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredDragonBuster).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragonBuster!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    delete restoredDragonBuster!.equippedToUid;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
