import { describe, expect, it } from "vitest";
import { createDuel, destroyDuelCard, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import type { LuaScriptHost } from "#lua/host-types.js";

interface PriorityFixture {
  host: LuaScriptHost;
  session: DuelSession;
  opponentCost: DuelCardInstance;
  threatened: DuelCardInstance;
  turnCost: DuelCardInstance;
}

describe("Lua replacement turn-player priority", () => {
  it("prioritizes the turn player's field destroy replacement over an earlier opponent replacement", () => {
    const fixture = setupPriorityFixture("EFFECT_DESTROY_REPLACE", "Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)");

    destroyDuelCard(fixture.session.state, fixture.threatened.uid, 0);

    expectTurnReplacementApplied(fixture);
  });

  it("prioritizes the turn player's field release replacement over an earlier opponent replacement", () => {
    const fixture = setupPriorityFixture("EFFECT_RELEASE_REPLACE", "Duel.Release(g, REASON_EFFECT+REASON_REPLACE)");

    const run = fixture.host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("release priority result " .. Duel.Release(c, REASON_COST))
      `,
      "release-replacement-turn-player-priority-run.lua",
    );

    expect(run.ok, run.error).toBe(true);
    expect(fixture.host.messages).toContain("release priority result 0");
    expectTurnReplacementApplied(fixture);
  });

  it("prioritizes the turn player's field send replacement over an earlier opponent replacement", () => {
    const fixture = setupPriorityFixture("EFFECT_SEND_REPLACE", "Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)");

    const run = fixture.host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("send priority result " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "send-replacement-turn-player-priority-run.lua",
    );

    expect(run.ok, run.error).toBe(true);
    expect(fixture.host.messages).toContain("send priority result 0");
    expectTurnReplacementApplied(fixture);
  });
});

function setupPriorityFixture(replacementCode: string, replacementOperation: string): PriorityFixture {
  const cards: DuelCardData[] = [
    { code: "100", name: "Opponent Replacement Source", kind: "monster" },
    { code: "101", name: "Turn Replacement Source", kind: "monster" },
    { code: "200", name: "Threatened Monster", kind: "monster" },
    { code: "300", name: "Opponent Replacement Cost", kind: "monster" },
    { code: "401", name: "Turn Replacement Cost", kind: "monster" },
  ];
  const session = createDuel({ seed: 280, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200", "300"] },
    1: { main: ["101", "401"] },
  });
  startDuel(session);
  session.state.turnPlayer = 1;

  const threatened = findHandCard(session, 0, "200");
  const opponentCost = findHandCard(session, 0, "300");
  const turnCost = findHandCard(session, 1, "401");
  const host = createLuaScriptHost(session);
  const result = host.loadScript(priorityReplacementScript(replacementCode, replacementOperation), `${replacementCode.toLowerCase()}-turn-player-priority.lua`);

  expect(result.ok, result.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { host, session, opponentCost, threatened, turnCost };
}

function priorityReplacementScript(replacementCode: string, replacementOperation: string): string {
  return `
  c100={}
  function c100.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
    e:SetCode(${replacementCode})
    e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
    e:SetRange(LOCATION_HAND)
    e:SetTargetRange(1,0)
    e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
      Duel.SetTargetCard(g)
      Debug.Message("opponent replacement target " .. Duel.GetTargetCards():GetCount())
      return true
    end)
    e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetTargetCards()
      Debug.Message("opponent replacement op " .. g:GetFirst():GetCode())
      ${replacementOperation}
    end)
    c:RegisterEffect(e)
  end
  c101={}
  function c101.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
    e:SetCode(${replacementCode})
    e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
    e:SetRange(LOCATION_HAND)
    e:SetTargetRange(0,1)
    e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 401), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 401), tp, LOCATION_HAND, 0, e:GetHandler())
      Duel.SetTargetCard(g)
      Debug.Message("turn replacement target " .. Duel.GetTargetCards():GetCount())
      return true
    end)
    e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetTargetCards()
      Debug.Message("turn replacement op " .. g:GetFirst():GetCode())
      ${replacementOperation}
    end)
    c:RegisterEffect(e)
  end
  `;
}

function expectTurnReplacementApplied({ host, opponentCost, session, threatened, turnCost }: PriorityFixture): void {
  expect(host.messages).toContain("turn replacement target 1");
  expect(host.messages).toContain("turn replacement op 401");
  expect(host.messages).not.toContain("opponent replacement op 300");
  expect(session.state.cards.find((card) => card.uid === threatened.uid)).toMatchObject({ location: "hand" });
  expect(session.state.cards.find((card) => card.uid === turnCost.uid)).toMatchObject({ location: "graveyard" });
  expect(session.state.cards.find((card) => card.uid === opponentCost.uid)).toMatchObject({ location: "hand" });
}

function findHandCard(session: DuelSession, controller: 0 | 1, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.controller === controller && candidate.location === "hand" && candidate.code === code);
  expect(card).toBeTruthy();
  return card!;
}
