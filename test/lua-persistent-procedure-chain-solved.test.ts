import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua persistent procedure chain-solved targets", () => {
  it("records the activated target relation and restores PersistentTargetFilter state", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Fixture", kind: "trap", typeFlags: 0x20004 },
      { code: "200", name: "Persistent Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 456, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(trap).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    trap!.position = "faceDown";
    trap!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = persistentTrapSource();
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript("100", source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === trap!.uid);
    expect(activation, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    resolveChain(session);

    expect(host.messages).toContain("persistent fixture resolved");
    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
      cardTargetUids: [target!.uid],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer)).toEqual(getGroupedDuelLegalActions(restored.session, restoredPlayer));
    expect(getLuaRestoreLegalActionGroups(restored, restoredPlayer).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, restoredPlayer),
    );
    expect(restored.session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({ cardTargetUids: [target!.uid] });
    const probe = restored.host.loadScript(
      `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_SZONE,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message("persistent restored " .. tostring(trap:IsHasCardTarget(target)) .. "/" .. tostring(aux.PersistentTargetFilter(e,target)) .. "/" .. trap:GetCardTargetCount())
      `,
      "persistent-procedure-chain-solved-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("persistent restored true/true/1");
  });
});

function persistentTrapSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name !== "c100.lua") return undefined;
      return `
        local s,id=GetID()
        function s.initial_effect(c)
          aux.AddPersistentProcedure(c,0,aux.FilterBoolFunction(Card.IsFaceup),CATEGORY_DISABLE,nil,nil,TIMINGS_CHECK_MONSTER,nil,nil,nil,function(e,tp)
            Debug.Message("persistent fixture resolved")
          end)
        end
      `;
    },
  };
}

function applyAndAssert(session: ReturnType<typeof createDuel>, response: DuelResponse): void {
  const result = applyResponse(session, response);
  expect(result.ok, result.error).toBe(true);
}

function resolveChain(session: ReturnType<typeof createDuel>): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}
