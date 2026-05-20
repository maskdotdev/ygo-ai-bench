import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const darksoulCode = "31383545";
const searchCode = "313835450";
const spellDecoyCode = "313835451";
const offSetDecoyCode = "313835452";
const responderCode = "313835453";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setXSaber = 0x100d;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script XX-Saber Darksoul End Phase search", () => {
  it("restores to-Graveyard registration of the End Phase X-Saber Deck search trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${darksoulCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("return c:IsSetCard(SET_X_SABER) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darksoulCode),
      { code: searchCode, name: "XX-Saber Darksoul Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000, setcodes: [setXSaber] },
      { code: spellDecoyCode, name: "XX-Saber Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setXSaber] },
      { code: offSetDecoyCode, name: "XX-Saber Off-Set Monster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "XX-Saber Darksoul Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31383545, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darksoulCode, searchCode, spellDecoyCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const darksoul = requireCard(session, darksoulCode);
    const search = requireCard(session, searchCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, darksoul.uid, "monsterZone", 0);
    darksoul.faceUp = true;
    darksoul.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main2";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darksoulCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const destroyed = destroyDuelCard(session.state, darksoul.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });

    const restoredRegistered = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredRegistered);
    expectRestoredLegalActions(restoredRegistered, 0);
    expect(restoredRegistered.session.state.effects.find((effect) => effect.sourceUid === darksoul.uid && effect.code === phaseEndEventCode)).toMatchObject({
      event: "trigger",
      triggerEvent: "phaseEnd",
      range: ["graveyard"],
      sourceUid: darksoul.uid,
    });

    const endPhase = getLuaRestoreLegalActions(restoredRegistered, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredRegistered, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRegistered, endPhase!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredRegistered.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-3-4608",
        sourceUid: darksoul.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "phaseEnd",
        eventCode: 4608,
        eventTriggerTiming: "when",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darksoul.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-3-4608",
        sourceUid: darksoul.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "phaseEnd",
        eventCode: 4608,
        eventTriggerTiming: "when",
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("darksoul responder resolved");
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: darksoul.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["phaseEnd", "destroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: darksoul.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
      sentToHandEvent(search.uid, darksoul.uid, 3),
      confirmedEvent(search.uid, darksoul.uid, 3),
      sentToHandConfirmedEvent(search.uid, darksoul.uid, 3),
    ]);
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
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
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
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
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
      e:SetOperation(function(e,tp) Debug.Message("darksoul responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
