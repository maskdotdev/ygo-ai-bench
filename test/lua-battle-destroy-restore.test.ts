import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua battle destroy restore helpers", () => {
  it("applies restored Lua battle-destroyed triggers through restore responses", () => {
    const result = runBattleDestroyRestore("EVENT_BATTLE_DESTROYED", "restored battle destroyed");
    expect(result.messages).toContain("restored battle destroyed 200/true");
  });

  it("applies restored Lua battle-destroying alias triggers through restore responses", () => {
    const result = runBattleDestroyRestore("EVENT_BATTLE_DESTROYING", "restored battle destroying");
    expect(result.messages).toContain("restored battle destroying 200/true");
  });
});

function runBattleDestroyRestore(eventCode: string, message: string): { messages: string[] } {
  const cards: DuelCardData[] = [
    { code: "100", name: "Restore Battle Attacker", kind: "monster", attack: 1800, defense: 1000 },
    { code: "200", name: "Restore Battle Target", kind: "monster", attack: 1000, defense: 1000 },
    { code: "300", name: "Restore Battle Destroy Watcher", kind: "monster" },
  ];
  const source = {
    readScript(name: string) {
      if (name !== "c300.lua") return undefined;
      return `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(${eventCode})
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("${message} " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
        end)
        c:RegisterEffect(e)
      end
      `;
    },
  };
  const session = createDuel({ seed: eventCode === "EVENT_BATTLE_DESTROYED" ? 68 : 69, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
  startDuel(session);

  const attacker = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
  const target = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
  expect(attacker).toBeDefined();
  expect(target).toBeDefined();
  moveDuelCard(session.state, attacker!.uid, "monsterZone", 0);
  attacker!.position = "faceUpAttack";
  attacker!.faceUp = true;
  moveDuelCard(session.state, target!.uid, "monsterZone", 1);
  target!.position = "faceUpAttack";
  target!.faceUp = true;

  const host = createLuaScriptHost(session);
  expect(host.loadCardScript(300, source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
  expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!).ok).toBe(true);
  passBattleResponses(session);

  expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDestroyed"]);
  expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1140, eventCardUid: target!.uid });

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete).toBe(true);
  expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDestroyed"]);
  expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1140, eventCardUid: target!.uid });
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  const triggerResult = applyLuaRestoreResponse(restored, trigger!);
  expect(triggerResult.ok).toBe(true);
  expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
  expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
  expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
  return { messages: restored.host.messages };
}

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
