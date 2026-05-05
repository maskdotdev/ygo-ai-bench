import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle-target events", () => {
  it("queues Lua battle-target triggers when a monster is attacked", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeting Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Battle Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Battle Target Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 185, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BE_BATTLE_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("battle target resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "battle-target-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleTargeted"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1131, eventCardUid: target!.uid });
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    drainChain(session);
    expect(host.messages).toContain("battle target resolved 200");
  });

  it("applies restored Lua battle-target triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Targeting Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Restore Battle Target", kind: "monster", attack: 1000 },
      { code: "300", name: "Restore Battle Target Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BE_BATTLE_TARGET)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            Debug.Message("restored battle target trigger " .. eg:GetFirst():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 186, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleTargeted"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleTargeted"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1131, eventCardUid: target!.uid });
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const trigger = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("restored battle target trigger 200");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const passResult = applyLuaRestoreResponse(restored, pass!);
    expect(passResult.ok).toBe(true);
    expect(passResult.legalActions).toEqual(getDuelLegalActions(restored.session, passResult.state.waitingFor!));
    expect(passResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, passResult.state.waitingFor!));
    expect(passResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(passResult.legalActions);
  }
}
