import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua pre-battle-damage events", () => {
  it("queues pre-battle-damage triggers before battle-damage triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pre Battle Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Pre Battle Damage Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 191, startingHandSize: 2, cardReader: createCardReader(cards) });
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
        e:SetCode(EVENT_PRE_BATTLE_DAMAGE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("pre battle damage resolved " .. Duel.GetBattleDamage(1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "pre-battle-damage-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!).ok).toBe(true);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!).ok).toBe(true);
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["beforeBattleDamage", "battleDamageDealt"]);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    drainChain(session);
    expect(host.messages).toContain("pre battle damage resolved 1800");
  });
});

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}
