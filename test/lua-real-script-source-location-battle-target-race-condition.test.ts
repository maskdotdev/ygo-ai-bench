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
const locationGraveyard = 0x10;
const racePyro = 0x80;
const raceDragon = 0x2000;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source location battle target race condition", () => {
  it("restores source location plus battle-target race checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oxygeddonCode = "58071123";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [oxygeddonCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8244, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oxygeddonCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const oxygeddon = session.state.cards.find((card) => card.code === oxygeddonCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(oxygeddon).toBeDefined();
    expect(target).toBeDefined();
    target!.data.race = racePyro;
    moveDuelCard(session.state, oxygeddon!.uid, "graveyard", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(oxygeddonCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-battle-target-race-source-location:${racePyro}:${locationGraveyard}`,
          sourceUid: oxygeddon!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredOxygeddon = restored.session.state.cards.find((card) => card.code === oxygeddonCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === oxygeddon!.uid && candidate.luaConditionDescriptor === `condition:source-battle-target-race-source-location:${racePyro}:${locationGraveyard}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredOxygeddon!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredOxygeddon!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.race = raceDragon;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTarget!.data.race = racePyro;
    moveDuelCard(restored.session.state, restoredOxygeddon!.uid, "monsterZone", 0);
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source location plus battle-target race checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oxygeddonCode = "58071123";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [oxygeddonCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8245, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oxygeddonCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const oxygeddon = session.state.cards.find((card) => card.code === oxygeddonCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(oxygeddon).toBeDefined();
    expect(target).toBeDefined();
    target!.data.race = racePyro;
    moveDuelCard(session.state, oxygeddon!.uid, "graveyard", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${oxygeddonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)
      e:SetCode(EVENT_BATTLE_DESTROYED)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsLocation(LOCATION_GRAVE) and c:GetBattleTarget():IsRace(RACE_PYRO)
      end)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) end)
      c:RegisterEffect(e)
      `,
      "oxygeddon-official-local-location-battle-target-race-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-battle-target-race-source-location:${racePyro}:${locationGraveyard}`,
          sourceUid: oxygeddon!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredOxygeddon = restored.session.state.cards.find((card) => card.code === oxygeddonCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === oxygeddon!.uid && candidate.luaConditionDescriptor === `condition:source-battle-target-race-source-location:${racePyro}:${locationGraveyard}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredOxygeddon!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredOxygeddon!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.data.race = raceDragon;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTarget!.data.race = racePyro;
    moveDuelCard(restored.session.state, restoredOxygeddon!.uid, "monsterZone", 0);
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
