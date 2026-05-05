import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle-confirm events", () => {
  it("queues battle-confirm triggers after battle start and before pre-damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Confirm Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Battle Confirm Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 190, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_BATTLE_CONFIRM)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("battle confirm resolved " .. tp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "battle-confirm-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleConfirmed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1133 });
    expect(session.state.eventHistory).toEqual([
      expect.objectContaining({ eventName: "phaseStartBattle", eventCode: 0x2008 }),
      expect.objectContaining({ eventName: "phaseChanged" }),
      expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 }),
      expect.objectContaining({ eventName: "attackDeclared", eventCode: 1130 }),
      expect.objectContaining({ eventName: "battleStarted", eventCode: 1132 }),
      expect.objectContaining({ eventName: "battleConfirmed", eventCode: 1133 }),
    ]);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    drainChain(session);
    expect(host.messages).toContain("battle confirm resolved 0");
  });

  it("applies restored Lua battle-confirm triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Battle Confirm Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Restore Battle Confirm Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_CONFIRM)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored battle confirm trigger " .. tp)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 191, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack")!).ok).toBe(true);

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleConfirmed"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleConfirmed"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1133 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("restored battle confirm trigger 0");
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
  }
}
