import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { currentAttack } from "#duel/card-stats.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const venomSnakeCode = "73899015";
const venomSwampCode = "54306223";
const targetCode = "73899016";
const responderCode = "73899017";
const counterVenom = 0x1009;
const categoryCounter = 0x800000;
const categoryDestroy = 0x1;
const effectCannotAttackAnnounce = 86;
const eventCustomVenomSwamp = 0x10000000 + Number(venomSwampCode);

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Venom Snake counter custom destroy", () => {
  it("restores Venom Counter placement, cannot-attack cost, Venom Swamp ATK loss, and custom-event destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const snakeScript = workspace.readScript(`c${venomSnakeCode}.lua`);
    const swampScript = workspace.readScript(`c${venomSwampCode}.lua`);
    expect(snakeScript).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
    expect(snakeScript).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_VENOM,1)");
    expect(snakeScript).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0)");
    expect(snakeScript).toContain("tc:AddCounter(COUNTER_VENOM,1)");
    expect(snakeScript).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+54306223,e,0,0,0,0)");
    expect(swampScript).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(swampScript).toContain("return c:GetCounter(COUNTER_VENOM)*-500");
    expect(swampScript).toContain("e4:SetCode(EVENT_CUSTOM+id)");
    expect(swampScript).toContain("Duel.SetTargetCard(eg)");
    expect(swampScript).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,#eg,0,0)");
    expect(swampScript).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === venomSnakeCode || card.code === venomSwampCode),
      { code: targetCode, name: "Venom Counter Destroy Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 1000 },
      { code: responderCode, name: "Venom Chain Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7389, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [venomSnakeCode, venomSwampCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const snake = requireCard(session, venomSnakeCode);
    const swamp = requireCard(session, venomSwampCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, snake.uid, 0);
    moveFaceUpAttack(session, target.uid, 1);
    moveDuelCard(session.state, swamp.uid, "spellTrapZone", 0).sequence = 5;
    swamp.faceUp = true;
    swamp.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(venomSnakeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(venomSwampCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(500);
    const placeCounter = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === snake.uid);
    expect(placeCounter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, placeCounter!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-2",
      operationInfos: [{ category: categoryCounter, count: 1, parameter: 0, player: 0, targetUids: [] }],
      player: 0,
      sourceUid: snake.uid,
      targetUids: [target.uid],
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === snake.uid && effect.code === effectCannotAttackAnnounce)).toHaveLength(1);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredOpen);

    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), counterVenom)).toBe(1);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: target.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonCardUid: snake.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const destroyTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === swamp.uid);
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, destroyTrigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 5,
      chainIndex: 1,
      effectId: "lua-5-322741679",
      eventCardUid: target.uid,
      eventCode: eventCustomVenomSwamp,
      eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      eventName: "customEvent",
      eventPlayer: 0,
      eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
      eventReason: 0,
      eventReasonCardUid: snake.uid,
      eventReasonEffectId: 1,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      eventUids: [target.uid],
      eventValue: 0,
      id: "chain-4",
      operationInfos: [{ category: categoryDestroy, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      player: 0,
      relatedEffectId: 1,
      sourceUid: swamp.uid,
      targetUids: [target.uid],
    });
    expectRestoredLegalActions(restoredTrigger, 1);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: swamp.uid,
      reasonEffectId: 5,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: swamp.uid,
        eventReasonEffectId: 5,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard" });
    const probe = restoredResolved.host.loadScript(attackLockProbeScript(venomSnakeCode), "venom-snake-attack-lock-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredResolved.host.messages).toContain("venom snake CanAttack false");
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, player: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function attackLockProbeScript(snakeCode: string): string {
  return `
    local snake=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${snakeCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("venom snake CanAttack " .. tostring(snake and snake:CanAttack()))
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("venom responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
