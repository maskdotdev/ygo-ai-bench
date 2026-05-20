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
const bonfireCode = "85106525";
const searchCode = "851065250";
const highLevelDecoyCode = "851065251";
const nonPyroDecoyCode = "851065252";
const responderCode = "851065253";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Bonfire oath search", () => {
  it("restores free-chain oath Spell search for one Level 4 or lower Pyro monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${bonfireCode}.lua`);
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsRace(RACE_PYRO) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bonfireCode),
      { code: searchCode, name: "Bonfire Search Pyro", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1500, defense: 200 },
      { code: highLevelDecoyCode, name: "Bonfire High Level Pyro Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 5, attack: 1800, defense: 200 },
      { code: nonPyroDecoyCode, name: "Bonfire Non-Pyro Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Bonfire Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 3, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 85106525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bonfireCode, searchCode, highLevelDecoyCode, nonPyroDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const bonfire = requireCard(session, bonfireCode);
    const search = requireCard(session, searchCode);
    const highLevelDecoy = requireCard(session, highLevelDecoyCode);
    const nonPyroDecoy = requireCard(session, nonPyroDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, bonfire.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(bonfireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === bonfire.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: bonfire.uid,
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
    expect(restoredChain.host.messages).not.toContain("bonfire responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === bonfire.uid)).toMatchObject({ location: "graveyard", reason: duelReason.rule, reasonPlayer: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bonfire.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highLevelDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === nonPyroDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bonfire.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bonfire.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bonfire.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: bonfire.uid,
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
      e:SetOperation(function(e,tp) Debug.Message("bonfire responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
