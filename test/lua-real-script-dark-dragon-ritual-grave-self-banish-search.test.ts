import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

const darkDragonRitualCode = "18803791";
const redEyesBlackDragonCode = "71408082";
const searchTargetCode = "18803792";
const offTypeDecoyCode = "18803793";
const offSetDecoyCode = "18803794";
const responderCode = "18803795";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeRitual = 0x80;
const setRedEyes = 0x3b;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Dragon Ritual grave self-banish search", () => {
  it("restores aux.exccon grave ignition, Cost.SelfBanish, and Red-Eyes Spell/Trap search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${darkDragonRitualCode}.lua`);
    expect(script).toContain("Ritual.AddProcGreaterCode(c,4,nil,71408082)");
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCondition(aux.exccon)");
    expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:IsSetCard(SET_RED_EYES) and c:IsSpellTrap() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [darkDragonRitualCode, redEyesBlackDragonCode].includes(card.code)),
      { code: searchTargetCode, name: "Dark Dragon Ritual Red-Eyes Spell Target", kind: "spell", typeFlags: typeSpell, setcodes: [setRedEyes] },
      { code: offTypeDecoyCode, name: "Dark Dragon Ritual Red-Eyes Monster Decoy", kind: "monster", typeFlags: typeMonster, setcodes: [setRedEyes], level: 4 },
      { code: offSetDecoyCode, name: "Dark Dragon Ritual Off-Set Trap Decoy", kind: "trap", typeFlags: typeTrap, setcodes: [0x123] },
      { code: responderCode, name: "Dark Dragon Ritual Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18803791, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkDragonRitualCode, redEyesBlackDragonCode, searchTargetCode, offTypeDecoyCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ritualSpell = requireCard(session, darkDragonRitualCode);
    const ritualMonster = requireCard(session, redEyesBlackDragonCode);
    const searchTarget = requireCard(session, searchTargetCode);
    const offTypeDecoy = requireCard(session, offTypeDecoyCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, ritualSpell.uid, "graveyard", 0).turnId = 0;
    moveDuelCard(session.state, ritualMonster.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkDragonRitualCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(ritualMonster.data.typeFlags! & typeRitual).toBe(typeRitual);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === ritualSpell.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: true });
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).not.toContain("dark dragon ritual responder resolved");
    expect(restored.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ritualSpell.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === offTypeDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      banishedEvent(ritualSpell.uid),
      sentToHandEvent(searchTarget.uid, ritualSpell.uid),
      confirmedEvent(searchTarget.uid, ritualSpell.uid),
      sentToHandConfirmedEvent(searchTarget.uid, ritualSpell.uid),
    ]);
  });
});

function banishedEvent(cardUid: string) {
  return {
    eventName: "banished",
    eventCode: 1011,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
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
      e:SetOperation(function(e,tp) Debug.Message("dark dragon ritual responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
