import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
        e:SetOperation(function(e,tp,eg,ep,ev,re,r)
          Debug.Message("pre battle damage resolved " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetBattleDamage(1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "pre-battle-damage-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "beforeBattleDamage", eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
      expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    drainChain(session);
    expect(host.messages).toContain("pre battle damage resolved 1/1800/32/0/1800");
  });

  it("applies restored Lua pre-battle-damage triggers with event payloads", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Pre Battle Damage Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Restore Pre Battle Damage Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_PRE_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored pre battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetBattleDamage(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 192, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(200, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid)!);
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.players[1].lifePoints).toBe(6200);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("restored pre battle damage 1/1800/32/0/1800");
  });

  it("uses the defending monster controller as reason player when the attacker takes battle damage", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Small Attacker", kind: "monster", attack: 1000 },
      { code: "200", name: "Counter Damage Watcher", kind: "monster" },
      { code: "300", name: "Large Defender", kind: "monster", attack: 1800 },
    ];
    const session = createDuel({ seed: 193, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const defender = session.state.cards.find((card) => card.code === "300");
    expect(attacker).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PRE_BATTLE_DAMAGE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r)
          Debug.Message("counter battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer())
        end)
        c:RegisterEffect(e)
      end
      `,
      "counter-battle-damage-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === defender!.uid)!);
    passBattleResponses(session);

    expect(session.state.players[0].lifePoints).toBe(7200);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1136, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "beforeBattleDamage", eventCode: 1136, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 }),
      expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 }),
    ]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    drainChain(session);
    expect(host.messages).toContain("counter battle damage 0/800/32/1");
  });
});

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    if (!pass) return;
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

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  const publicState = queryPublicState(restored.session);
  expect(response.ok, response.error).toBe(true);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}
