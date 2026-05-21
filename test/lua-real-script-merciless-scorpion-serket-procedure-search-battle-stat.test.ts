import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const serketCode = "34926568";
const templeCode = "29762407";
const costCode = "349265680";
const searchCode = "349265681";
const battleTargetCode = "349265682";
const responderCode = "349265683";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSerketScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${serketCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSerketScript)("Lua real script Merciless Scorpion of Serket procedure search battle stat", () => {
  it("restores Temple-gated hand procedure cost, search ignition, and battle-start destroy ATK gain", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${serketCode}.lua`);
    expect(script).toContain("e0:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_TEMPLE_OF_THE_KINGS),tp,LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("return c:IsLevelAbove(10) and c:IsAbleToRemoveAsCost()");
    expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,1,nil,1,tp,HINTMSG_REMOVE,nil,nil,true)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("return (c:IsCode(CARD_TEMPLE_OF_THE_KINGS) or (c:IsSpell() and c:ListsCode(CARD_TEMPLE_OF_THE_KINGS))) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,bc,1,tp,0)");
    expect(script).toContain("local atk=bc:GetBaseAttack()/2");
    expect(script).toContain("Duel.Destroy(bc,REASON_EFFECT)");
    expect(script).toContain("c:UpdateAttack(atk)");

    const reader = createCardReader(serketCards());
    const procedureSession = createDuel({ seed: 34926568, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(procedureSession, { 0: { main: [serketCode, templeCode, costCode, searchCode] }, 1: { main: [responderCode] } });
    startDuel(procedureSession);

    const procedureSerket = requireCard(procedureSession, serketCode);
    const temple = requireCard(procedureSession, templeCode);
    const cost = requireCard(procedureSession, costCode);
    const search = requireCard(procedureSession, searchCode);
    const responder = requireCard(procedureSession, responderCode, 1);
    moveFaceUpAttack(procedureSession, procedureSerket, 0);
    moveDuelCard(procedureSession.state, cost.uid, "hand", 0);
    moveDuelCard(procedureSession.state, temple.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(procedureSession.state, responder.uid, "hand", 1);
    procedureSession.state.phase = "main1";
    procedureSession.state.turnPlayer = 0;
    procedureSession.state.waitingFor = 0;

    const procedureHost = createLuaScriptHost(procedureSession, workspace);
    for (const code of [serketCode, responderCode]) expect(procedureHost.loadCardScript(Number(code), source).ok).toBe(true);
    expect(procedureHost.registerInitialEffects()).toBe(2);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(procedureSession), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === procedureSerket.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: procedureSerket.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredSearchChain);
    expect(restoredSearchChain.host.messages).not.toContain("serket responder resolved");
    expect(restoredSearchChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: procedureSerket.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToHandEvent(search.uid, procedureSerket.uid),
      confirmedEvent(search.uid, procedureSerket.uid),
      sentToHandConfirmedEvent(search.uid, procedureSerket.uid),
    ]);

    const battleSession = createDuel({ seed: 34926569, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(battleSession, { 0: { main: [serketCode] }, 1: { main: [battleTargetCode, responderCode] } });
    startDuel(battleSession);
    const battleSerket = requireCard(battleSession, serketCode);
    const battleTarget = requireCard(battleSession, battleTargetCode, 1);
    moveFaceUpAttack(battleSession, battleSerket, 0);
    moveFaceUpAttack(battleSession, battleTarget, 1);
    battleSession.state.phase = "battle";
    battleSession.state.turnPlayer = 0;
    battleSession.state.waitingFor = 0;

    const battleHost = createLuaScriptHost(battleSession, workspace);
    expect(battleHost.loadCardScript(Number(serketCode), source).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);
    const attack = getLegalActions(battleSession, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleSerket.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(battleSession, 0), null, 2)).toBeDefined();
    applyAndAssert(battleSession, attack!);
    passUntilPendingTrigger(battleSession, "battleStarted");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), source, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("startDamageStep");
    expectRestoredLegalActions(restoredBattle, 0);
    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === battleSerket.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, trigger!);
    expect(restoredBattle.session.state.chain).toEqual([]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: battleSerket.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === battleSerket.uid), restoredBattle.session.state)).toBe(3500);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["battleStarted", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: battleSerket.uid,
        eventUids: [battleSerket.uid, battleTarget.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      destroyedEvent(battleTarget.uid, battleSerket.uid),
    ]);
  });
});

function sourceWithResponder() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function serketCards(): DuelCardData[] {
  return [
    { code: serketCode, name: "Merciless Scorpion of Serket", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 6, attack: 2500, defense: 2000 },
    { code: templeCode, name: "Temple of the Kings", kind: "spell", typeFlags: typeSpell },
    { code: costCode, name: "Serket Level 10 Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 10, attack: 3000, defense: 3000 },
    { code: searchCode, name: "Serket Temple Search Spell", kind: "spell", typeFlags: typeSpell, listedNames: [templeCode] },
    { code: battleTargetCode, name: "Serket Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: responderCode, name: "Serket Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("serket responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passAttack");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
