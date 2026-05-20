import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const scrapyardCode = "1050684";
const tunerCode = "10506840";
const nonTunerDecoyCode = "10506841";
const offSetTunerDecoyCode = "10506842";
const responderCode = "10506843";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const setScrap = 0x24;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Scrapyard Tuner search", () => {
  it("restores free-chain Scrap Tuner Deck search and confirmation filtering", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${scrapyardCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsSetCard(SET_SCRAP) and c:IsType(TYPE_TUNER) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === scrapyardCode),
      {
        code: tunerCode,
        name: "Scrapyard Fixture Scrap Tuner",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeTuner,
        race: raceMachine,
        attribute: attributeEarth,
        level: 3,
        attack: 1300,
        defense: 500,
        setcodes: [setScrap],
      },
      {
        code: nonTunerDecoyCode,
        name: "Scrapyard Fixture Scrap Non-Tuner Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceMachine,
        attribute: attributeEarth,
        level: 4,
        attack: 1600,
        defense: 1000,
        setcodes: [setScrap],
      },
      {
        code: offSetTunerDecoyCode,
        name: "Scrapyard Fixture Off-Set Tuner Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeTuner,
        race: raceWarrior,
        attribute: attributeEarth,
        level: 3,
        attack: 1200,
        defense: 800,
      },
      { code: responderCode, name: "Scrapyard Chain Responder", kind: "spell", typeFlags: typeSpell | 0x10000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1050684, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scrapyardCode, offSetTunerDecoyCode, nonTunerDecoyCode, tunerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const scrapyard = requireCard(session, scrapyardCode);
    const tuner = requireCard(session, tunerCode);
    const nonTunerDecoy = requireCard(session, nonTunerDecoyCode);
    const offSetTunerDecoy = requireCard(session, offSetTunerDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, scrapyard.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scrapyardCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === scrapyard.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: scrapyard.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("scrapyard responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === scrapyard.uid)).toMatchObject({ location: "graveyard", reason: duelReason.rule, reasonPlayer: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: scrapyard.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === nonTunerDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetTunerDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${tunerCode}`);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: tuner.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scrapyard.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: tuner.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [tuner.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scrapyard.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: tuner.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [tuner.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scrapyard.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: scrapyard.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

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
      e:SetOperation(function(e,tp) Debug.Message("scrapyard responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
