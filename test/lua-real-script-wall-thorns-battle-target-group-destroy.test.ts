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
const typeTrap = 0x4;
const racePlant = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wall of Thorns battle target group destroy", () => {
  it("restores its Plant battle-target Trap trigger and destroys opponent attack-position monsters as a group", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wallCode = "2779999";
    const plantTargetCode = "27799990";
    const attackerCode = "27799991";
    const secondAttackCode = "27799992";
    const defenseDecoyCode = "27799993";
    const responderCode = "27799994";
    const script = workspace.readScript(`c${wallCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("tc:IsControler(tp) and tc:IsFaceup() and tc:IsRace(RACE_PLANT)");
    expect(script).toContain("return c:IsAttackPos()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wallCode),
      { code: plantTargetCode, name: "Wall of Thorns Plant Target", kind: "monster", typeFlags: typeMonster, race: racePlant, level: 4, attack: 1200, defense: 1000 },
      { code: attackerCode, name: "Wall of Thorns Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: secondAttackCode, name: "Wall of Thorns Second Attack Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: defenseDecoyCode, name: "Wall of Thorns Defense Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 2000 },
      { code: responderCode, name: "Wall of Thorns Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2779999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [wallCode, plantTargetCode] },
      1: { main: [attackerCode, secondAttackCode, defenseDecoyCode, responderCode] },
    });
    startDuel(session);

    const wall = requireCard(session, wallCode);
    const plantTarget = requireCard(session, plantTargetCode);
    const attacker = requireCard(session, attackerCode);
    const secondAttack = requireCard(session, secondAttackCode);
    const defenseDecoy = requireCard(session, defenseDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedWall = moveDuelCard(session.state, wall.uid, "spellTrapZone", 0);
    movedWall.position = "faceDown";
    movedWall.faceUp = false;
    movedWall.turnId = 0;
    const movedPlant = moveDuelCard(session.state, plantTarget.uid, "monsterZone", 0);
    movedPlant.position = "faceUpAttack";
    movedPlant.faceUp = true;
    const movedAttacker = moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    movedAttacker.sequence = 0;
    movedAttacker.position = "faceUpAttack";
    movedAttacker.faceUp = true;
    const movedSecondAttack = moveDuelCard(session.state, secondAttack.uid, "monsterZone", 1);
    movedSecondAttack.sequence = 1;
    movedSecondAttack.position = "faceUpAttack";
    movedSecondAttack.faceUp = true;
    const movedDefense = moveDuelCard(session.state, defenseDecoy.uid, "monsterZone", 1);
    movedDefense.sequence = 2;
    movedDefense.position = "faceUpDefense";
    movedDefense.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turn = 1;
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wallCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === plantTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: plantTarget.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1131",
        eventCardUid: plantTarget.uid,
        eventCode: 1131,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleTargeted",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-3-1",
        player: 0,
        sourceUid: wall.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === wall.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    const destroyedUids = [attacker.uid, secondAttack.uid];
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1131",
        eventCardUid: plantTarget.uid,
        eventCode: 1131,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleTargeted",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "chain-3",
        operationInfos: [{ category: 0x1, targetUids: destroyedUids, count: 2, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: wall.uid,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.pendingBattle).toBeUndefined();
    expect(restoredChain.session.state.cards.find((card) => card.uid === wall.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === plantTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === secondAttack.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === defenseDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("wall of thorns responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "battleTargeted")).toEqual([
      {
        eventName: "battleTargeted",
        eventCode: 1131,
        eventCardUid: plantTarget.uid,
        eventPreviousState: { location: "deck", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: 0,
        eventReasonPlayer: 0,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: attacker.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: wall.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: secondAttack.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: wall.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: attacker.uid,
        eventUids: destroyedUids,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: wall.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("wall of thorns responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
