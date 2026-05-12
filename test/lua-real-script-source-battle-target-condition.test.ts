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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source battle target condition", () => {
  it("restores source GetBattleTarget existence checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const basiliskCode = "56921677";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [basiliskCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8219, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [basiliskCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const basilisk = session.state.cards.find((card) => card.code === basiliskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(basilisk).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, basilisk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(basiliskCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-battle-target",
          sourceUid: basilisk!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredBasilisk = restored.session.state.cards.find((card) => card.code === basiliskCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === basilisk!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBasilisk!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredBasilisk!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source GetBattleTarget existence checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const basiliskCode = "56921677";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [basiliskCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8220, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [basiliskCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const basilisk = session.state.cards.find((card) => card.code === basiliskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(basilisk).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, basilisk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${basiliskCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetBattleTarget()
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "basilisk-official-local-battle-target-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-battle-target",
          sourceUid: basilisk!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredBasilisk = restored.session.state.cards.find((card) => card.code === basiliskCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === basilisk!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBasilisk!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
