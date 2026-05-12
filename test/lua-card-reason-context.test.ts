import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import type { DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { cards } from "./full-duel-engine-fixtures.js";

function effectContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
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

describe("Lua card reason context", () => {
  it("uses active event reason card and effect metadata for Card reason APIs", () => {
    const session = createDuel({ seed: 9921, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "400"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const reasonCard = session.state.cards.find((card) => card.code === "400");
    expect(source).toBeDefined();
    expect(reasonCard).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, reasonCard!.uid, "monsterZone", 0);
    source!.reasonCardUid = source!.uid;
    source!.reasonEffectId = 9999;

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        local rc=c:GetReasonCard()
        local re=c:GetReasonEffect()
        return rc and rc:IsCode(400) and c:IsReasonCard(rc) and re and c:IsReasonEffect(re)
      end)
      e:SetValue(100)
      c:RegisterEffect(e)
      `,
      "reason-context.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.sourceUid === source!.uid && candidate.canActivate);
    expect(effect?.canActivate).toBeDefined();
    const ctx = effectContext(session.state, source!);
    const eventReasonEffectId = Number(effect!.id.match(/^lua-(\d+)/)?.[1]);

    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventCard: source!, eventReasonCardUid: reasonCard!.uid, eventReasonEffectId })).toBe(true);
  });
});
