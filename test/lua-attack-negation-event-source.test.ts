import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

function expectRestoredLegalActionGroups(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua attack negation event sources", () => {
  it("preserves active Lua effect sources on restored attack-disabled events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Source Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Attack Source Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Attack Source Negator", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetAttacker()~=nil end)
          e:SetOperation(function(e,tp) Duel.NegateAttack() end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 148, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const negator = session.state.cards.find((card) => card.code === "300");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    expect(negator).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    const negate = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect");
    expect(negate).toBeDefined();
    applyAndAssert(session, negate!);
    const pass = getDuelLegalActions(session, session.state.waitingFor!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);

    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "attackDisabled",
          eventCode: 1142,
          eventCardUid: attacker!.uid,
          eventReason: 0x40,
          eventReasonPlayer: 1,
          eventReasonCardUid: negator!.uid,
          eventReasonEffectId: 1,
        }),
      ]),
    );
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    expect(restored.session.state.eventHistory).toEqual(session.state.eventHistory);
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
