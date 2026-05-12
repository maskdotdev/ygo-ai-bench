import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
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
    expect(result.messages).toContain("restored battle destroying 100/false");
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
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local tc=eg:GetFirst()
          Debug.Message("${message} " .. tc:GetCode() .. "/" .. tostring(tc:IsBattleDestroyed()))
          Debug.Message("${message} reason " .. tostring((r&REASON_BATTLE)~=0) .. "/" .. tostring(rp==0))
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
  const loaded = host.loadCardScript(300, source);
  expect(loaded.ok, loaded.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
  applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid)!);
  passBattleResponses(session);

  const expectedEventCard = eventCode === "EVENT_BATTLE_DESTROYING" ? attacker : target;
  const expectedMessage = eventCode === "EVENT_BATTLE_DESTROYING" ? `${message} 100/false` : `${message} 200/true`;
  const expectedReasonMessage = `${message} reason true/true`;
  expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
  expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDestroyed"]);
  expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1140, eventCardUid: expectedEventCard!.uid, eventReason: 0x21, eventReasonPlayer: 0, eventReasonCardUid: attacker!.uid });
  expect(session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonEffectId");

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDestroyed"]);
  expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1140, eventCardUid: expectedEventCard!.uid, eventReason: 0x21, eventReasonPlayer: 0, eventReasonCardUid: attacker!.uid });
  expect(restored.session.state.pendingTriggers[0]).not.toHaveProperty("eventReasonEffectId");
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  expect(trigger!.windowToken).toBeDefined();
  expect(
    getLuaRestoreLegalActionGroups(restored, 0).some(
      (group) =>
        group.windowId === restored.session.state.actionWindowId &&
        group.windowKind === "triggerBucket" &&
        group.actions.some(
          (action) =>
            action.type === "activateTrigger" &&
            action.effectId === trigger!.effectId &&
            action.windowId === restored.session.state.actionWindowId &&
            action.windowKind === "triggerBucket",
        ),
    ),
  ).toBe(true);
  const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
  expect(staleTrigger.ok).toBe(false);
  expect(staleTrigger.error).toContain("Response is not currently legal");
  expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
  expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  assertLuaRestoreLegalWindow(restored, staleTrigger, 0);
  expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["battleDestroyed"]);
  expect(restored.host.messages).not.toContain(expectedMessage);
  expect(restored.host.messages).not.toContain(expectedReasonMessage);
  const forgedEffectTrigger = applyLuaRestoreResponse(restored, {
    ...trigger!,
    effectId: `${trigger!.effectId}-forged`,
  });
  expect(forgedEffectTrigger.ok).toBe(false);
  expect(forgedEffectTrigger.error).toContain("Response is not currently legal");
  assertLuaRestoreLegalWindow(restored, forgedEffectTrigger, 0);
  expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["battleDestroyed"]);
  expect(restored.host.messages).not.toContain(expectedMessage);
  expect(restored.host.messages).not.toContain(expectedReasonMessage);

  applyLuaRestoreAndAssert(restored, trigger!);
  expect(restored.host.messages).toContain(expectedReasonMessage);
  const staleReplay = applyLuaRestoreResponse(restored, trigger!);
  expect(staleReplay.ok).toBe(false);
  expect(staleReplay.error).toContain("Response is not currently legal");
  expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
  expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  return { messages: restored.host.messages };
}

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  return result;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, result, result.state.waitingFor!);
  return result;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, result: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(result.state.actionWindowId).toBe(windowId);
  expect(result.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(result.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(result.state).not.toHaveProperty("triggerOrderPrompt");
  expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  for (const legalAction of result.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: result.state.windowKind });
  for (const group of result.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: result.state.windowKind });
}
