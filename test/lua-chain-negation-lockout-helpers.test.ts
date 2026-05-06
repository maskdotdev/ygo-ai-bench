import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain negation lockout helpers", () => {
  it("prevents Lua negation helpers from disabling protected chain links", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Protected Chain Source", kind: "monster", level: 4 },
      { code: "200", name: "Chain Negator", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 218, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("protected source resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CANNOT_DISEFFECT)
        e2:SetRange(LOCATION_HAND)
        c:RegisterEffect(e2)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("negatable " .. tostring(Duel.IsChainNegatable(1)))
          Debug.Message("negated " .. tostring(Duel.NegateEffect(1)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-diseffect.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.map((effect) => effect.code ?? 0)).toContain(13);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    expect(opened.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const negator = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect");
    expect(negator).toBeDefined();
    const chained = applyResponse(session, negator!);
    expect(chained.ok).toBe(true);
    expect(chained.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(chained.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(chained.legalActionGroups.flatMap((group) => group.actions)).toEqual(chained.legalActions);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(session, pass!);
    expect(resolved.ok).toBe(true);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);

    expect(host.messages).toEqual(["negatable false", "negated false", "protected source resolved"]);
  });

  it("restores protected Lua chain negation lockouts before responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Protected Chain Source", kind: "monster", level: 4 },
      { code: "200", name: "Restored Chain Negator", kind: "monster", level: 4 },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e1=Effect.CreateEffect(c)
            e1:SetType(EFFECT_TYPE_IGNITION)
            e1:SetRange(LOCATION_HAND)
            e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored protected source resolved")
            end)
            c:RegisterEffect(e1)
            local e2=Effect.CreateEffect(c)
            e2:SetType(EFFECT_TYPE_SINGLE)
            e2:SetCode(EFFECT_CANNOT_DISEFFECT)
            e2:SetRange(LOCATION_HAND)
            c:RegisterEffect(e2)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return Duel.GetCurrentChain()>0
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored negatable " .. tostring(Duel.IsChainNegatable(1)))
              Debug.Message("restored negated " .. tostring(Duel.NegateEffect(1)))
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 219, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const sourceCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(sourceCard).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const originalNegator = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect");
    expect(originalNegator).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const negator = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect");
    expect(negator).toBeDefined();
    const originalNegatorPreapply = applyLuaRestoreResponse(restored, originalNegator!);
    expect(originalNegatorPreapply.ok).toBe(false);
    expect(originalNegatorPreapply.error).toContain("Response is not currently legal");
    expect(originalNegatorPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    applyLuaRestoreAndAssert(restored, negator!);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.host.messages).toEqual(["restored negatable false", "restored negated false", "restored protected source resolved"]);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
