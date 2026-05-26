import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pursuit Chaser battle-destroyed defense damage", () => {
  it("restores its field EVENT_BATTLE_DESTROYED defense-position filter into CHAININFO damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pursuitCode = "27870033";
    const defenderCode = "27870034";
    const attackerCode = "27870035";
    const responderCode = "27870036";
    const script = workspace.readScript(`c${pursuitCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsPreviousPosition(POS_DEFENSE) and c:IsLocation(LOCATION_GRAVE)");
    expect(script).toContain("and c:IsReason(REASON_BATTLE) and c:IsMonster()");
    expect(script).toContain("return eg:IsExists(s.cfilter,1,nil)");
    expect(script).toContain("e:GetHandler():IsRelateToEffect(e) and e:GetHandler():IsFaceup()");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(500)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,500)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pursuitCode),
      { code: defenderCode, name: "Pursuit Chaser Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 100, defense: 900 },
      { code: attackerCode, name: "Pursuit Chaser Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Pursuit Chaser Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 27870033, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pursuitCode, defenderCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const pursuit = requireCard(session, pursuitCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, defender.uid, "monsterZone", 0);
    defender.position = "faceUpDefense";
    defender.faceUp = true;
    moveDuelCard(session.state, pursuit.uid, "monsterZone", 1);
    pursuit.position = "faceUpAttack";
    pursuit.faceUp = true;
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    attacker.position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = realPursuitWithLocalResponder(workspace, responderCode);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pursuitCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === pursuit.uid)).toMatchObject({
      category: 0x80000,
      code: 1140,
      event: "trigger",
      registryKey: "lua:27870033:lua-1-1140",
      triggerEvent: "battleDestroyed",
    });

    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, attack!);
    passBattleUntilTrigger(restoredInitial.session);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousPosition: "faceUpDefense",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
    });
    expect(restoredInitial.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1140",
        eventCardUid: defender.uid,
        eventCode: 1140,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventName: "battleDestroyed",
        eventPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        id: "trigger-4-1",
        player: 1,
        sourceUid: pursuit.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 1);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) => action.type === "activateTrigger" && action.uid === pursuit.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    expect(trigger).toEqual({
      player: 1,
      type: "activateTrigger",
      uid: pursuit.uid,
      effectId: "lua-1-1140",
      label: "Pursuit Chaser: lua-1-1140",
      triggerId: "trigger-4-1",
      triggerBucket: "turnMandatory",
      windowId: 13,
      windowKind: "triggerBucket",
      windowToken: trigger!.windowToken,
    });
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: pursuit.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredTrigger.host.messages).not.toContain("pursuit chaser responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function realPursuitWithLocalResponder(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, responderCode: string) {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("pursuit chaser responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
