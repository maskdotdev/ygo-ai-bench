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
    player: source.controller,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source battle target monster condition", () => {
  it("restores comma-local source battle-target monster checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blizzardWarriorCode = "96565487";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [blizzardWarriorCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blizzardWarriorCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const blizzardWarrior = session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(blizzardWarrior).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, blizzardWarrior!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${blizzardWarriorCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsRelateToBattle() and c:GetBattleTarget():IsMonster()
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "blizzard-warrior-comma-local-battle-target-monster-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-relate-battle-target-monster",
          sourceUid: blizzardWarrior!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredBlizzardWarrior = restored.session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === blizzardWarrior!.uid && candidate.luaConditionDescriptor === "condition:source-relate-battle-target-monster");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBlizzardWarrior!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.typeFlags = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTarget!.data.typeFlags = 0x1;
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source battle-target monster checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blizzardWarriorCode = "96565487";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [blizzardWarriorCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8241, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blizzardWarriorCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const blizzardWarrior = session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(blizzardWarrior).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, blizzardWarrior!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(blizzardWarriorCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-relate-battle-target-monster",
          sourceUid: blizzardWarrior!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredBlizzardWarrior = restored.session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === blizzardWarrior!.uid && candidate.luaConditionDescriptor === "condition:source-relate-battle-target-monster");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBlizzardWarrior!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.typeFlags = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTarget!.data.typeFlags = 0x1;
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores direct source battle-target monster checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blizzardWarriorCode = "96565487";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [blizzardWarriorCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blizzardWarriorCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const blizzardWarrior = session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(blizzardWarrior).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, blizzardWarrior!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${blizzardWarriorCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        return e:GetHandler():IsRelateToBattle() and e:GetHandler():GetBattleTarget():IsMonster()
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "blizzard-warrior-official-direct-battle-target-monster-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-relate-battle-target-monster",
          sourceUid: blizzardWarrior!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredBlizzardWarrior = restored.session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === blizzardWarrior!.uid && candidate.luaConditionDescriptor === "condition:source-relate-battle-target-monster");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBlizzardWarrior!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.typeFlags = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTarget!.data.typeFlags = 0x1;
    restored.session.state.currentAttack = { attackerUid: restoredBlizzardWarrior!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
