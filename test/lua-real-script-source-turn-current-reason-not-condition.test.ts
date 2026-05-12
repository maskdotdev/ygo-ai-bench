import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source current turn reason-not condition", () => {
  it("restores comma-local current turn checks guarded against return reason", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const titanikladCode = "41373230";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === titanikladCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [titanikladCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const titaniklad = session.state.cards.find((card) => card.code === titanikladCode);
    expect(titaniklad).toBeDefined();
    moveDuelCard(session.state, titaniklad!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${titanikladCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:GetTurnID()==Duel.GetTurnCount() and not c:IsReason(REASON_RETURN)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "titaniklad-comma-local-current-turn-reason-not-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-turn-current-reason-not:${duelReason.return}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredTitaniklad = restored.session.state.cards.find((card) => card.code === titanikladCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === titaniklad!.uid && effect.luaConditionDescriptor === descriptor);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredTitaniklad!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredTitaniklad!.reason = duelReason.return;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredTitaniklad!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredTitaniklad!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler current turn checks guarded against return reason", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const titanikladCode = "41373230";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === titanikladCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [titanikladCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const titaniklad = session.state.cards.find((card) => card.code === titanikladCode);
    expect(titaniklad).toBeDefined();
    moveDuelCard(session.state, titaniklad!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(titanikladCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "trigger",
          luaConditionDescriptor: `condition:source-turn-current-reason-not:${duelReason.return}`,
          range: ["graveyard"],
          triggerEvent: "phaseEnd",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredTitaniklad = restored.session.state.cards.find((card) => card.code === titanikladCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === titaniklad!.uid && effect.triggerEvent === "phaseEnd");
    expect(restoredTitaniklad).toMatchObject({ turnId: restored.session.state.turn });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: `condition:source-turn-current-reason-not:${duelReason.return}`,
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredTitaniklad!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredTitaniklad!.reason = duelReason.return;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredTitaniklad!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredTitaniklad!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredTitaniklad!.turnId = restored.session.state.turn;
    restoredTitaniklad!.reason = duelReason.return | duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
